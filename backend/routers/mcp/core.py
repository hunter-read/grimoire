"""MCP endpoint handlers - /mcp in front of the SDK server in backend/mcp_server.

MCP_ENABLED must be true (env var) for this router to be registered at all.

The protocol itself is the ``mcp`` SDK's (see mcp_server/server.py). What stays
here is what Grimoire adds around it: the Origin check against DNS rebinding,
API-key authentication, and the session manager's lifetime.

One URL, and in practice one verb: every JSON-RPC message from the client is a
POST to /mcp, answered with a single JSON body (a request) or a bare 202 (a
notification). The spec also lets a client GET the URL for a stream of
server-initiated messages, and DELETE it to end a session; Grimoire sends none
and keeps no sessions, so both get the 405 the spec asks for.

Authentication is an API key in ``X-API-Key``, as for the REST API, but checked
per tool call rather than per route: the route is always /mcp, so it says
nothing about what the call will touch (see mcp_server/tools).
"""
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import Response
from starlette.types import Receive, Scope, Send

from ... import api_keys

_MANAGER_STATE = "mcp_session_manager"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Run the SDK's session manager for as long as the app runs.

    A manager can only be started once, so each app start gets a new one. The
    SDK is imported here rather than at module level: this module is imported
    whether or not MCP is enabled, and only an enabled server should load it.
    """
    from ...mcp_server.server import build_session_manager

    manager = build_session_manager()
    async with manager.run():
        setattr(app.state, _MANAGER_STATE, manager)
        try:
            yield
        finally:
            delattr(app.state, _MANAGER_STATE)


# Reachable on loopback under any port, which is how an assistant on the same
# machine connects.
_LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "[::1]")


def allowed_hosts() -> list[str]:
    """Host patterns /mcp answers under: ``host``, ``host:port`` or ``host:*``.

    Loopback, BASE_URL's host and ``MCP_ALLOWED_HOSTS``. A bare host also
    allows it on any port. The same list feeds the SDK's own check
    (``mcp_server.server.build_session_manager``).
    """
    from ... import config

    names = [*_LOOPBACK_HOSTS, *config.MCP_ALLOWED_HOSTS]
    base = urlsplit(config.BASE_URL).netloc.lower()
    if base:
        names.append(base)
    patterns: list[str] = []
    for name in names:
        patterns.append(name)
        # "[::1]" and "host" have no port; "host:9481" and "host:*" do.
        if not name.rsplit("]", 1)[-1].count(":"):
            patterns.append(f"{name}:*")
    return list(dict.fromkeys(patterns))


def host_allowed(host: Optional[str], patterns: Optional[list[str]] = None) -> bool:
    if not host:
        return False
    host = host.lower()
    for pattern in patterns if patterns is not None else allowed_hosts():
        if host == pattern or (pattern.endswith(":*") and host.startswith(pattern[:-1])):
            return True
    return False


def check_origin(request: Request) -> None:
    """Refuse requests a DNS-rebinding page could make, as the spec asks.

    The ``Host`` must be one Grimoire is actually served under: a rebinding
    page controls the host name its requests carry, so comparing ``Origin``
    with ``Host`` alone would always agree. Browsers also send ``Origin``,
    which must name an allowed host too; MCP clients that aren't browsers send
    none.
    """
    patterns = allowed_hosts()
    if not host_allowed(request.headers.get("host"), patterns):
        raise HTTPException(
            403,
            "This host name isn't allowed for MCP - set BASE_URL to the address "
            "you use, or add it to MCP_ALLOWED_HOSTS",
        )
    origin = request.headers.get("origin")
    if origin and not host_allowed(urlsplit(origin).netloc, patterns):
        raise HTTPException(403, "Cross-origin MCP requests are not allowed")


def require_mcp_key(
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
) -> api_keys.KeyPrincipal:
    if not x_api_key:
        raise HTTPException(401, "The MCP server needs an API key in the X-API-Key header")
    # Existence, expiry, the owner still holding keys, and throttling - but not
    # the route check: each tool checks the key's permissions for itself.
    return api_keys.authenticate(x_api_key, request, check_route=False)


def _accepting_json(scope: Scope) -> Scope:
    """``scope`` with an Accept the SDK takes, if the client sent none or a wildcard.

    Streamable HTTP clients must list application/json in Accept, and the SDK
    answers 406 otherwise. Grimoire's endpoint never checked, so a script that
    POSTs with curl's default ``*/*`` keeps working.
    """
    accept = dict(scope["headers"]).get(b"accept", b"").lower()
    if b"application/json" in accept or (accept and b"*/*" not in accept):
        return scope
    headers = [(k, v) for k, v in scope["headers"] if k != b"accept"]
    return {**scope, "headers": [*headers, (b"accept", b"application/json")]}


class _SdkResponse(Response):
    """Hands the request to the SDK's transport, which writes the response itself.

    FastAPI leaves the request body unread for an endpoint with no body
    parameters, so the SDK reads the JSON-RPC message from ``receive``.
    """

    def __init__(self, manager: Any) -> None:
        super().__init__()
        self._manager = manager

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await self._manager.handle_request(_accepting_json(scope), receive, send)


def mcp_post(
    request: Request,
    principal: api_keys.KeyPrincipal = Depends(require_mcp_key),
):
    from ...mcp_server.server import PRINCIPAL_STATE

    setattr(request.state, PRINCIPAL_STATE, principal)
    return _SdkResponse(getattr(request.app.state, _MANAGER_STATE))


def mcp_not_allowed():
    return Response(status_code=405, headers={"Allow": "POST"})
