"""MCP package — the /mcp endpoint for AI assistants, authenticated by API key."""
from fastapi import APIRouter, Depends

from .core import check_origin, lifespan, mcp_not_allowed, mcp_post

router = APIRouter(tags=["mcp"], dependencies=[Depends(check_origin)], lifespan=lifespan)
router.add_api_route(
    "/mcp",
    mcp_post,
    methods=["POST"],
    summary="MCP endpoint",
    description=(
        "Model Context Protocol (Streamable HTTP transport) for AI assistants such as "
        "Claude Code. Takes one JSON-RPC 2.0 message per POST and answers with JSON, "
        "or 202 for a notification. Requires an API key in `X-API-Key`; each tool "
        "checks the key's permissions. Only registered when `MCP_ENABLED=true`."
    ),
)
# GET (a server-to-client stream) and DELETE (end a session) are both optional
# in the spec and Grimoire offers neither. They are registered so they answer
# 405 rather than falling through to the SPA's index.html.
router.add_api_route(
    "/mcp",
    mcp_not_allowed,
    methods=["GET", "DELETE"],
    summary="MCP endpoint (unsupported methods)",
    include_in_schema=False,
)
