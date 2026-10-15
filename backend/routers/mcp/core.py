"""MCP endpoint handlers - the Streamable HTTP transport for backend/mcp_server.

MCP_ENABLED must be true (env var) for this router to be registered at all.

One URL, and in practice one verb: every JSON-RPC message from the client is a
POST to /mcp, answered with a single JSON body (a request) or a bare 202 (a
notification). The spec also lets a client GET the URL for a stream of
server-initiated messages, and DELETE it to end a session; Grimoire sends none
and keeps no sessions, so both get the 405 the spec asks for.

Authentication is an API key in ``X-API-Key``, as for the REST API, but checked
per tool call rather than per route: the route is always /mcp, so it says
nothing about what the call will touch (see mcp_server/tools.py).
"""
import json
from typing import Optional
from urllib.parse import urlsplit

from fastapi import Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session

from ... import api_keys
from ...auth import CurrentUser
from ...config import get_db
from ...mcp_server import protocol
from ...mcp_server.tools import ToolContext


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


async def mcp_post(
    request: Request,
    principal: api_keys.KeyPrincipal = Depends(require_mcp_key),
    protocol_version: Optional[str] = Header(None, alias="MCP-Protocol-Version"),
    db: Session = Depends(get_db),
):
    # Sent on every request after initialize; absent means the client predates it.
    if protocol_version and protocol_version not in protocol.SUPPORTED_PROTOCOL_VERSIONS:
        return JSONResponse(
            protocol.error_response(
                None,
                protocol.INVALID_REQUEST,
                f"Unsupported MCP-Protocol-Version {protocol_version!r}",
            ),
            status_code=400,
        )
    try:
        message = json.loads(await request.body())
    except ValueError:
        return JSONResponse(
            protocol.error_response(None, protocol.PARSE_ERROR, "Body is not valid JSON"),
            status_code=400,
        )

    ctx = ToolContext(
        user=CurrentUser(
            id=principal.user_id,
            username=principal.username,
            role=principal.role,
            api_key_id=principal.id,
        ),
        permissions=principal.permissions,
        db=db,
    )
    # Tools run blocking DB queries; keep them off the event loop.
    answer = await run_in_threadpool(protocol.handle_message, message, ctx)
    if answer is None:
        return Response(status_code=202)
    # A message too broken to have an id is refused at the HTTP level too.
    rejected = "error" in answer and answer["id"] is None
    return JSONResponse(answer, status_code=400 if rejected else 200)


def mcp_not_allowed():
    return Response(status_code=405, headers={"Allow": "POST"})
