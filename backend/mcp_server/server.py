"""The Model Context Protocol server, built on the official ``mcp`` SDK.

The SDK owns the protocol: JSON-RPC framing, the ``initialize`` handshake and
version negotiation, request validation, error responses and the Streamable
HTTP transport. Grimoire supplies what to answer - its tools, resources and
prompts - through the low-level :class:`mcp.server.lowlevel.Server`, whose
handlers here only adapt between the SDK's types and those modules.

The server runs statelessly with JSON responses: no ``Mcp-Session-Id``, every
POST stands alone and is answered with one JSON body. That is all the spec asks
of a server that never pushes notifications or sends requests of its own.

Who is calling comes from the HTTP request: ``routers/mcp`` authenticates the
API key and leaves the principal on ``request.state`` for the handlers below.

Imported only when /mcp is actually served (see ``routers/mcp``), so a server
with ``MCP_ENABLED`` off never loads the SDK.
"""
from __future__ import annotations

import logging
from typing import Any, Callable

import anyio
from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.shared.exceptions import McpError

from .. import config
from ..auth import CurrentUser
from . import prompts, resources
from .errors import INTERNAL_ERROR, INVALID_PARAMS, ProtocolError
from .tools import ToolContext, call_tool, list_tools

logger = logging.getLogger("grimoire.mcp")

# Where routers/mcp leaves the authenticated api_keys.KeyPrincipal.
PRINCIPAL_STATE = "mcp_principal"

# Handed to the model on connect, alongside the tool list. Unlike API docs this
# is read by the model, so it says when to reach for Grimoire, not how to call it.
INSTRUCTIONS = (
    "Grimoire is the user's self-hosted library of tabletop RPG books (PDFs and "
    "other formats), maps, tokens and audio, with full-text search over book pages. "
    "Use it when the user asks about rules, monsters, spells, setting lore or "
    "anything else that might be in a book they own, and cite the book and page "
    "number you found it on. It also holds the user's campaigns - their wiki, "
    "session notes and players - for questions about their own games."
)


def _run_in_context(principal: Any, work: Callable[[ToolContext], dict[str, Any]]) -> dict[str, Any]:
    """Run ``work`` for ``principal`` with a DB session of its own (in a worker thread).

    Errors leave as McpError so the SDK answers with a JSON-RPC error. Anything
    unexpected is logged and answered with a bare "Internal error": the SDK
    would otherwise send the exception's own text to the client.
    """
    db = config.SessionLocal()
    try:
        ctx = ToolContext(
            user=CurrentUser(
                id=principal.user_id,
                username=principal.username,
                role=principal.role,
                api_key_id=principal.id,
                key_permissions=principal.permissions,
            ),
            permissions=principal.permissions,
            db=db,
        )
        return work(ctx)
    except ProtocolError as exc:
        raise McpError(types.ErrorData(code=exc.code, message=exc.message)) from exc
    except Exception as exc:
        db.rollback()
        logger.exception("MCP request failed")
        raise McpError(types.ErrorData(code=INTERNAL_ERROR, message="Internal error")) from exc
    finally:
        db.close()


def build_server() -> Server:
    """The low-level SDK server with Grimoire's handlers registered."""
    server: Server = Server("grimoire", version=config.VERSION, instructions=INSTRUCTIONS)

    async def answer(work: Callable[[ToolContext], dict[str, Any]]) -> dict[str, Any]:
        request = server.request_context.request
        assert request is not None  # set for every call over the HTTP transport
        principal = getattr(request.state, PRINCIPAL_STATE)
        # Tools run blocking DB queries and renders; keep them off the event loop.
        return await anyio.to_thread.run_sync(_run_in_context, principal, work)

    # Handlers are registered on request_handlers directly rather than through
    # the SDK's decorators. The call_tool decorator validates arguments against
    # a tool schema cache shared by every caller (tools/list differs per key)
    # and turns every exception into a result carrying its raw message; Grimoire
    # validates with the tools' own Pydantic models and words its own errors.

    async def tools_list(req: types.ListToolsRequest) -> types.ServerResult:
        data = await answer(lambda ctx: {"tools": list_tools(ctx)})
        return types.ServerResult(types.ListToolsResult.model_validate(data))

    async def tools_call(req: types.CallToolRequest) -> types.ServerResult:
        name, arguments = req.params.name, req.params.arguments or {}

        def run(ctx: ToolContext) -> dict[str, Any]:
            outcome = call_tool(name, arguments, ctx)
            if outcome is None:
                raise ProtocolError(INVALID_PARAMS, f"Unknown tool: {name}")
            return outcome

        return types.ServerResult(types.CallToolResult.model_validate(await answer(run)))

    async def resources_list(req: types.ListResourcesRequest) -> types.ServerResult:
        data = await answer(lambda ctx: {"resources": resources.list_resources(ctx)})
        return types.ServerResult(types.ListResourcesResult.model_validate(data))

    async def templates_list(req: types.ListResourceTemplatesRequest) -> types.ServerResult:
        data = await answer(lambda ctx: {"resourceTemplates": resources.list_templates(ctx)})
        return types.ServerResult(types.ListResourceTemplatesResult.model_validate(data))

    async def resources_read(req: types.ReadResourceRequest) -> types.ServerResult:
        uri = str(req.params.uri)
        data = await answer(lambda ctx: resources.read_resource(uri, ctx))
        return types.ServerResult(types.ReadResourceResult.model_validate(data))

    async def prompts_list(req: types.ListPromptsRequest) -> types.ServerResult:
        data = await answer(lambda ctx: {"prompts": prompts.list_prompts(ctx)})
        return types.ServerResult(types.ListPromptsResult.model_validate(data))

    async def prompts_get(req: types.GetPromptRequest) -> types.ServerResult:
        name, arguments = req.params.name, req.params.arguments or {}
        data = await answer(lambda ctx: prompts.get_prompt(name, arguments, ctx))
        return types.ServerResult(types.GetPromptResult.model_validate(data))

    async def complete(req: types.CompleteRequest) -> types.ServerResult:
        ref = req.params.ref.model_dump(mode="json")
        argument = req.params.argument.model_dump(mode="json")
        data = await answer(lambda ctx: prompts.complete(ref, argument, ctx))
        return types.ServerResult(types.CompleteResult.model_validate(data))

    server.request_handlers.update(
        {
            types.ListToolsRequest: tools_list,
            types.CallToolRequest: tools_call,
            types.ListResourcesRequest: resources_list,
            types.ListResourceTemplatesRequest: templates_list,
            types.ReadResourceRequest: resources_read,
            types.ListPromptsRequest: prompts_list,
            types.GetPromptRequest: prompts_get,
            types.CompleteRequest: complete,
        }
    )
    return server


def build_session_manager() -> StreamableHTTPSessionManager:
    """The SDK's Streamable HTTP transport: stateless, one JSON body per POST.

    DNS-rebinding protection is the Origin check in routers/mcp, which works
    whatever host name Grimoire is served under; the SDK's own needs a fixed
    allow-list of hosts, so it is left off here.
    """
    return StreamableHTTPSessionManager(build_server(), json_response=True, stateless=True)
