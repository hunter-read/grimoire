"""The SDK's OAuth routes, throttled, ready to mount at the site root.

The SDK rate-limits none of its routes, so each is wrapped here. Hosted
clients call from many addresses shared by all their users, so what is counted
depends on who is calling:

- ``/token`` and ``/revoke`` are called by the client's servers: failed
  requests count per ``client_id`` and address together, so one client's
  broken refresh never throttles another's, and someone who learns a
  ``client_id`` can't lock that client out from their own address.
- ``/register`` and ``/authorize`` are where new clients and requests are
  made: every request counts, per address (``/authorize`` is the user's own
  browser). Both are also capped in the database (see ``clients`` and
  ``codes``), whatever the address.

Like the rest of Grimoire's limits, the counts are per worker unless
``VALKEY_URL`` is set.

The wrapper also reads the client secret a ``/token`` or ``/revoke`` request
carries and hands it to ``clients.presented_secret``, so the stored hash can be
checked (see ``clients.py``), and keeps ``/authorize`` from redirecting
anywhere but the consent page (:func:`_consent_only`).
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
from typing import Any, Optional
from urllib.parse import parse_qs, unquote, urlsplit

from mcp.server.auth.routes import create_auth_routes, create_protected_resource_routes
from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from starlette.routing import Route
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .. import config, security
from .clients import presented_secret
from .provider import CONSENT_PATH, GrimoireOAuthProvider, resource_url
from .tokens import SCOPE

logger = logging.getLogger("grimoire.mcp")

MAX_BODY = 64 * 1024

TOKEN_SCOPE = "oauth-token"
REVOKE_SCOPE = "oauth-revoke"
REGISTER_SCOPE = "oauth-register"
AUTHORIZE_SCOPE = "oauth-authorize"


def _form(body: bytes) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(body.decode("utf-8", errors="replace")).items() if v}


def _basic(headers: dict[bytes, bytes]) -> tuple[Optional[str], Optional[str]]:
    value = headers.get(b"authorization", b"").decode("latin-1")
    if not value.startswith("Basic "):
        return None, None
    try:
        user, _, secret = base64.b64decode(value[6:]).decode("utf-8").partition(":")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return None, None
    return unquote(user), unquote(secret)


async def _send_json(send: Send, status: int, body: dict[str, Any]) -> None:
    data = json.dumps(body).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(data)).encode()),
                (b"cache-control", b"no-store"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": data})


def _consent_only(send: Send) -> Send:
    """``send`` for ``/authorize``: redirect only to this server's consent page.

    When ``/authorize`` fails after the client and redirect address check out
    (a bad scope, a ``resource`` that isn't this server's, a host the allow-list
    no longer has, too many waiting sign-ins), the SDK redirects the browser to
    the client's redirect address with the error. Registration is open, so that
    address is anyone's: an ``/authorize`` link would bounce a visitor straight
    to any site, before they sign in or see anything (RFC 9700 4.11.2). Such a
    redirect is answered here with the same error as a plain 400 instead.
    """
    consent = f"{config.BASE_URL}{CONSENT_PATH}?"
    refused = False

    async def contained(message: Message) -> None:
        nonlocal refused
        if message["type"] == "http.response.start" and 300 <= message["status"] < 400:
            location = dict(message.get("headers", [])).get(b"location", b"").decode("latin-1")
            if not location.startswith(consent):
                refused = True
                query = parse_qs(urlsplit(location).query)
                await _send_json(
                    send,
                    400,
                    {
                        "error": query.get("error", ["invalid_request"])[0],
                        "error_description": query.get(
                            "error_description", ["This sign-in request can't be completed"]
                        )[0],
                    },
                )
                return
        if refused:  # the SDK's own (empty) redirect body
            return
        await send(message)

    return contained


class Throttled:
    """``app`` behind a limit on ``scope_name``.

    ``per_client``: count failed requests (4xx) per ``client_id``, and pass the
    presented client secret on. Otherwise: count every request per address.
    (A class, not a function: Starlette would wrap a plain function endpoint
    as a request handler rather than call it as an ASGI app.)
    """

    def __init__(self, app: ASGIApp, scope_name: str, *, per_client: bool) -> None:
        self.app = app
        self.scope_name = scope_name
        self.per_client = per_client

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        app, scope_name, per_client = self.app, self.scope_name, self.per_client
        if scope["type"] != "http" or scope["method"] == "OPTIONS":
            await app(scope, receive, send)
            return
        # Read the body to find the client_id, before the SDK's own size limit
        # sees it, so cap it here too: no OAuth request comes near this.
        body, more = b"", True
        while more:
            message = await receive()
            body += message.get("body", b"")
            more = message.get("more_body", False)
            if len(body) > MAX_BODY:
                await _send_json(send, 413, {"error": "invalid_request", "error_description": "Request too large"})
                return
        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if replayed:
                return await receive()
            replayed = True
            return {"type": "http.request", "body": body, "more_body": False}

        from starlette.requests import Request

        request = Request(scope)
        if per_client:
            form = _form(body)
            basic_id, basic_secret = _basic(dict(scope["headers"]))
            # The client *and* the address: a client_id isn't secret (it's in
            # the /authorize URL), so counting it alone would let anyone who
            # saw one lock that client out. One client's failures still never
            # count against another's, even from a shared address.
            client_id = form.get("client_id") or basic_id or ""
            key = f"client:{client_id}:{security.rate_limit_key(request)}"
        else:
            key = security.rate_limit_key(request)
        if security.oauth_attempts_blocked(scope_name, key):
            await _send_json(
                send,
                429,
                {"error": "invalid_request", "error_description": "Too many requests - try again later"},
            )
            return
        if not per_client:
            security.record_oauth_attempt(scope_name, key)
            await app(scope, replay, _consent_only(send) if scope_name == AUTHORIZE_SCOPE else send)
            return

        status: dict[str, int] = {}

        async def watch(message: Message) -> None:
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        token = presented_secret.set(form.get("client_secret") or basic_secret)
        try:
            await app(scope, replay, watch)
        finally:
            presented_secret.reset(token)
        if 400 <= status.get("code", 500) < 500:
            security.record_oauth_attempt(scope_name, key)


_LIMITS: dict[str, tuple[str, bool]] = {
    "/token": (TOKEN_SCOPE, True),
    "/revoke": (REVOKE_SCOPE, True),
    "/register": (REGISTER_SCOPE, False),
    "/authorize": (AUTHORIZE_SCOPE, False),
}


def issuer_problem(base_url: str) -> Optional[str]:
    """Why ``base_url`` can't be an OAuth issuer, or None if it can."""
    parts = urlsplit(base_url)
    if parts.scheme != "https" and parts.hostname not in ("localhost", "127.0.0.1", "::1"):
        return "BASE_URL must be an https:// address for OAuth sign-in"
    if parts.query or parts.fragment:
        return "BASE_URL must not have a query string or fragment"
    return None


def build_routes() -> list[Route]:
    """The discovery documents and OAuth endpoints, each throttled.

    ``/.well-known/oauth-authorization-server``, ``/authorize``, ``/token``,
    ``/register``, ``/revoke`` and ``/.well-known/oauth-protected-resource/mcp``.
    """
    from pydantic import AnyHttpUrl

    provider = GrimoireOAuthProvider()
    issuer = AnyHttpUrl(config.BASE_URL)
    routes = create_auth_routes(
        provider,
        issuer_url=issuer,
        client_registration_options=ClientRegistrationOptions(
            enabled=True, valid_scopes=[SCOPE], default_scopes=[SCOPE]
        ),
        revocation_options=RevocationOptions(enabled=True),
    )
    routes += create_protected_resource_routes(
        resource_url=AnyHttpUrl(resource_url()),
        authorization_servers=[issuer],
        scopes_supported=[SCOPE],
        resource_name="Grimoire",
    )
    out: list[Route] = []
    for route in routes:
        limit = _LIMITS.get(route.path)
        if limit is not None:
            route = Route(
                route.path,
                endpoint=Throttled(route.app, limit[0], per_client=limit[1]),
                methods=list(route.methods or ()),
            )
        out.append(route)
    return out


def mount(app: Any) -> bool:
    """Add the OAuth routes to ``app``; False (and why, logged) if they can't be.

    Must run before the SPA catch-alls are registered: Starlette tries routes
    in order, and the catch-alls answer every path.
    """
    problem = issuer_problem(config.BASE_URL)
    if problem:
        logger.error(f"MCP_OAUTH_ENABLED is on but {problem} - OAuth sign-in is off.")
        return False
    if urlsplit(config.BASE_URL).hostname in ("localhost", "127.0.0.1", "::1"):
        logger.warning(
            "MCP_OAUTH_ENABLED is on but BASE_URL is %s - OAuth clients elsewhere will be "
            "sent to an address they can't reach. Set BASE_URL to the public https:// address.",
            config.BASE_URL,
        )
    from . import OAUTH_STATE

    app.router.routes.extend(build_routes())
    setattr(app.state, OAUTH_STATE, True)
    return True
