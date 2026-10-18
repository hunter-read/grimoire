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


def check_origin(request: Request) -> None:
    """Refuse browser requests from other sites (DNS rebinding), as the spec asks.

    MCP clients that aren't browsers send no Origin at all.
    """
    origin = request.headers.get("origin")
    if origin and urlsplit(origin).netloc != request.headers.get("host"):
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
