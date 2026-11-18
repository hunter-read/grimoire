"""Grants: what a user approved, stored as an ``api_keys`` row with ``client_id`` set.

A grant acts as its owner exactly as an API key does - their role, their
visibility, narrowed by the permissions chosen on the consent page - and goes
through the same owner check (``api_keys.check_owner``) on every use.

**Every refusal covers the refresh token too.** A client that gets
``invalid_token`` on /mcp refreshes and retries straight away (claude.ai does
it within a second), so a check made only on the access token would be undone
by the next refresh. :func:`load_refresh` runs the same owner check as
:func:`authenticate`.

**Refresh rotation.** Each refresh replaces both tokens. The new pair is
derived from the refresh token presented (``tokens.derive``), so:

- two refreshes sent at once with the current token both write and return the
  same new pair;
- the token just replaced is accepted for ``REFRESH_GRACE`` and answered with
  that same pair, so a client that sent it twice is not signed out;
- presented after that, it means the token was copied: the grant is revoked
  (reuse detection, RFC 9700 section 4.14.2).

Revoking a grant (from the key list, by an admin, or through ``/revoke``)
deletes the row. The client then shows its user a Connect button, and the user
can approve it again: to cut someone off for good, turn API keys off for them.
"""
from __future__ import annotations

import hmac
from dataclasses import dataclass
from typing import Any, Optional

from fastapi import HTTPException

from .. import api_keys
from .tokens import (
    ACCESS_PREFIX,
    ACCESS_TTL,
    REFRESH_GRACE,
    REFRESH_PREFIX,
    REFRESH_TTL,
    aware,
    derive,
    digest,
    new_token,
    now,
)

# Shown in the key list when a client gave no name.
DEFAULT_NAME = "MCP client"
# The display prefix of a grant row; a grant has no key to show part of.
GRANT_PREFIX = "oauth"


@dataclass(frozen=True)
class Tokens:
    access_token: str
    refresh_token: str
    expires_in: int


class GrantRefused(Exception):
    pass


def _ttl_seconds(expires_at: Any) -> int:
    return max(0, int((aware(expires_at) - now()).total_seconds()))


def create(db: Any, *, user_id: str, client_id: str, name: Optional[str], permissions: dict) -> tuple[str, Tokens]:
    """A new grant for ``user_id`` and its first tokens; returns (grant id, tokens)."""
    from ..models import ApiKey

    access, refresh = new_token(ACCESS_PREFIX), new_token(REFRESH_PREFIX)
    stamp = now()
    row = ApiKey(
        user_id=user_id,
        name=(name or DEFAULT_NAME)[:100],
        prefix=GRANT_PREFIX,
        # Nobody holds this value, so the row can never be used as X-API-Key
        # (api_keys.authenticate refuses grant rows anyway).
        key_hash=digest(new_token()),
        permissions=permissions,
        client_id=client_id,
        access_token_hash=digest(access),
        access_expires_at=stamp + ACCESS_TTL,
        refresh_token_hash=digest(refresh),
        refresh_expires_at=stamp + REFRESH_TTL,
        created_at=stamp,
    )
    db.add(row)
    db.commit()
    return row.id, Tokens(access, refresh, int(ACCESS_TTL.total_seconds()))


def authenticate(token: str) -> api_keys.KeyPrincipal:
    """The principal behind an access token on /mcp, or HTTPException.

    401 ``invalid_token`` for a token that is unknown or expired, which tells
    the client to refresh; 403 when the owner may no longer use keys. Neither
    is counted against an address: hosted clients share addresses, and an
    access token is 32 random bytes, so there is nothing to guess.
    """
    from ..config import SessionLocal
    from ..models import ApiKey

    if not api_keys.keys_enabled():
        raise HTTPException(403, "API keys are disabled on this server")
    presented = digest(token.strip())
    stamp = now()
    db = SessionLocal()
    try:
        row = (
            db.query(ApiKey)
            .filter(ApiKey.access_token_hash == presented, ApiKey.client_id.isnot(None))
            .first()
        )
        if row is None or not hmac.compare_digest(row.access_token_hash or "", presented):
            raise HTTPException(401, "Invalid access token")
        if api_keys.is_expired(row.access_expires_at, stamp) or api_keys.is_expired(
            row.expires_at, stamp
        ):
            raise HTTPException(401, "Access token has expired")
        try:
            owner = api_keys.check_owner(db, row.user_id)
        except api_keys.OwnerRefused as refused:
            raise HTTPException(refused.status, refused.detail)
        api_keys.touch(db, row, owner, stamp)
        return api_keys.principal_for(row, owner)
    finally:
        db.close()


def load_refresh(db: Any, client_id: str, token: str) -> Optional[Any]:
    """The grant a refresh token renews, if it may still be renewed.

    None for an unknown or expired token, for a grant whose owner may no
    longer use keys, and for a replaced token past the grace window - which
    also revokes the grant.
    """
    from ..models import ApiKey

    presented = digest(token)
    stamp = now()
    row = (
        db.query(ApiKey)
        .filter(ApiKey.client_id == client_id, ApiKey.refresh_token_hash == presented)
        .first()
    )
    if row is None:
        row = (
            db.query(ApiKey)
            .filter(ApiKey.client_id == client_id, ApiKey.prev_refresh_hash == presented)
            .first()
        )
        if row is None:
            return None
        if api_keys.is_expired(row.prev_refresh_until, stamp):
            # A replaced token, presented after the window: treat it as stolen.
            db.delete(row)
            db.commit()
            return None
    # A grant has no expiry of its own unless its owner sets one in the key
    # list, as for a key; past it, nothing renews.
    if api_keys.is_expired(row.refresh_expires_at, stamp) or api_keys.is_expired(
        row.expires_at, stamp
    ):
        return None
    try:
        api_keys.check_owner(db, row.user_id)
    except api_keys.OwnerRefused:
        return None
    return row


def refresh(db: Any, client_id: str, token: str) -> Tokens:
    """Rotate a grant's tokens for the refresh token presented.

    Raises :class:`GrantRefused` when the token no longer renews anything
    (:func:`load_refresh` should have been asked first).
    """
    from ..models import ApiKey

    row = load_refresh(db, client_id, token)
    if row is None:
        raise GrantRefused()
    presented = digest(token)
    access, refresh_token = derive("at", token), derive("rt", token)
    stamp = now()
    if row.refresh_token_hash == presented:
        # The current token: rotate. Conditional, so if another worker rotated
        # with the same token a moment ago this changes nothing - and the pair
        # it wrote is the same one returned here.
        db.query(ApiKey).filter(
            ApiKey.id == row.id, ApiKey.refresh_token_hash == presented
        ).update(
            {
                "access_token_hash": digest(access),
                "access_expires_at": stamp + ACCESS_TTL,
                "refresh_token_hash": digest(refresh_token),
                "refresh_expires_at": stamp + REFRESH_TTL,
                "prev_refresh_hash": presented,
                "prev_refresh_until": stamp + REFRESH_GRACE,
            },
            synchronize_session=False,
        )
        db.commit()
        db.refresh(row)
    if row.refresh_token_hash != digest(refresh_token):
        # The previous token, but the grant has rotated again since: the pair
        # it would get is already gone.
        raise GrantRefused()
    return Tokens(access, refresh_token, _ttl_seconds(row.access_expires_at))


def by_access_token(db: Any, token: str) -> Optional[Any]:
    from ..models import ApiKey

    return (
        db.query(ApiKey)
        .filter(ApiKey.access_token_hash == digest(token), ApiKey.client_id.isnot(None))
        .first()
    )


def revoke(db: Any, grant_id: str) -> None:
    from ..models import ApiKey

    db.query(ApiKey).filter(ApiKey.id == grant_id, ApiKey.client_id.isnot(None)).delete(
        synchronize_session=False
    )
    db.commit()
