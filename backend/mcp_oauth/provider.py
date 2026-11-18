"""The SDK's ``OAuthAuthorizationServerProvider``, over Grimoire's database.

The SDK calls these methods from async handlers; the database is synchronous,
so each one runs its work in the threadpool (:func:`_db`) rather than blocking
the event loop. The modules underneath hold the rules - see ``clients``,
``codes`` and ``grants``.
"""
from __future__ import annotations

import uuid
from typing import Any, Callable, Optional, TypeVar

import anyio
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    RefreshToken,
    RegistrationError,
    TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from .. import config
from .tokens import aware
from . import clients, codes, grants
from .tokens import SCOPE

T = TypeVar("T")

CONSENT_PATH = "/oauth/consent"


async def _db(work: Callable[[Any], T]) -> T:
    def run() -> T:
        db = config.SessionLocal()
        try:
            return work(db)
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    return await anyio.to_thread.run_sync(run)


def resource_url() -> str:
    """The one resource tokens are issued for: this server's /mcp."""
    return f"{config.BASE_URL}/mcp"


def _token(tokens: grants.Tokens) -> OAuthToken:
    return OAuthToken(
        access_token=tokens.access_token,
        expires_in=tokens.expires_in,
        scope=SCOPE,
        refresh_token=tokens.refresh_token,
    )


class GrimoireOAuthProvider:
    async def get_client(self, client_id: str) -> Optional[OAuthClientInformationFull]:
        # Read here, on the request's own context, rather than in the worker
        # thread: the route wrapper set it for this request (routes.Throttled).
        presented = clients.presented_secret.get()
        found = await _db(lambda db: clients.get(db, client_id, presented))
        if found is None:
            return None
        info, secret = found
        return OAuthClientInformationFull.model_validate({**info, "client_secret": secret})

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        for uri in client_info.redirect_uris or []:
            try:
                clients.check_redirect_uri(str(uri), config.MCP_OAUTH_REDIRECT_HOSTS)
            except clients.RedirectRefused as refused:
                raise RegistrationError(error="invalid_redirect_uri", error_description=str(refused))
        info = client_info.model_dump(mode="json", exclude={"client_secret"})

        def store(db: Any) -> bool:
            if not clients.make_room(db):
                return False
            clients.register(db, info, client_info.client_secret)
            return True

        if not await _db(store):
            raise RegistrationError(
                error="invalid_client_metadata",
                error_description="Too many clients are waiting for approval - try again later",
            )

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        # Tokens are only ever issued for this server's /mcp (RFC 8707).
        if params.resource is not None and params.resource.rstrip("/") != resource_url():
            raise AuthorizeError(
                error="invalid_target", error_description="Tokens here are only for this server's /mcp"
            )
        stored = {
            "state": params.state,
            "scopes": params.scopes or [SCOPE],
            "code_challenge": params.code_challenge,
            "redirect_uri": str(params.redirect_uri),
            "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
            "resource": params.resource,
        }
        try:
            request_id = await _db(lambda db: codes.create(db, client.client_id, stored))
        except codes.TooManyRequests:
            raise AuthorizeError(
                error="temporarily_unavailable",
                error_description="Too many sign-ins are waiting for this client - try again later",
            )
        return f"{config.BASE_URL}{CONSENT_PATH}?request={request_id}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> Optional[AuthorizationCode]:
        row = await _db(lambda db: codes.by_code(db, client.client_id, authorization_code))
        if row is None:
            return None
        p = row.params
        return AuthorizationCode(
            code=authorization_code,
            scopes=codes.scopes(p),
            expires_at=aware(row.expires_at).timestamp(),
            client_id=row.client_id,
            code_challenge=p["code_challenge"],
            redirect_uri=p["redirect_uri"],
            redirect_uri_provided_explicitly=p["redirect_uri_provided_explicitly"],
            resource=p.get("resource"),
            subject=row.user_id,
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        def exchange(db: Any) -> Optional[tuple[str, grants.Tokens]]:
            from .. import api_keys

            row = codes.by_code(db, client.client_id, authorization_code.code)
            if row is None:
                return None
            # The user approved minutes ago, but may have lost keys since.
            try:
                api_keys.check_owner(db, row.user_id)
            except api_keys.OwnerRefused:
                return None
            # Marking the code used, linking it to its grant and creating the
            # grant all commit together (grants.create commits).
            grant_id = str(uuid.uuid4())
            if not codes.claim(db, row, grant_id):
                db.rollback()
                return None
            clients.mark_granted(db, client.client_id)
            return grants.create(
                db,
                grant_id=grant_id,
                user_id=row.user_id,
                client_id=client.client_id,
                name=client.client_name,
                permissions=dict(row.permissions or {}),
            )

        tokens = await _db(exchange)
        if tokens is None:
            raise TokenError(error="invalid_grant", error_description="authorization code does not exist")
        return _token(tokens[1])

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> Optional[RefreshToken]:
        # Found whether or not it may renew now, so /revoke can always revoke
        # it; exchange_refresh_token refuses one that may not (grants.renewable).
        row = await _db(lambda db: grants.find_refresh(db, client.client_id, refresh_token))
        if row is None:
            return None
        return RefreshToken(
            token=refresh_token,
            client_id=client.client_id,
            scopes=[SCOPE],
            expires_at=int(aware(row.refresh_expires_at).timestamp()),
            resource=resource_url(),
            subject=row.user_id,
        )

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]
    ) -> OAuthToken:
        try:
            tokens = await _db(lambda db: grants.refresh(db, client.client_id, refresh_token.token))
        except grants.GrantRefused:
            raise TokenError(error="invalid_grant", error_description="refresh token does not exist")
        return _token(tokens)

    async def load_access_token(self, token: str) -> Optional[AccessToken]:
        # Used by the SDK's /revoke handler only; /mcp authenticates through
        # grants.authenticate, with the owner checks.
        row = await _db(lambda db: grants.by_access_token(db, token))
        if row is None:
            return None
        return AccessToken(
            token=token,
            client_id=row.client_id,
            scopes=[SCOPE],
            expires_at=int(aware(row.access_expires_at).timestamp()),
            resource=resource_url(),
            subject=row.user_id,
            claims={"grant_id": row.id},
        )

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        def revoke(db: Any) -> None:
            if isinstance(token, AccessToken):
                row = grants.by_access_token(db, token.token)
            else:
                row = grants.find_refresh(db, token.client_id, token.token)
            if row is not None:
                grants.revoke(db, row.id)

        await _db(revoke)

    async def exchange_identity_assertion(self, client: Any, params: Any) -> OAuthToken:
        # Not offered: create_auth_routes is called without identity assertions.
        raise TokenError(error="unsupported_grant_type")
