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
from typing import Any, Callable, Optional

import anyio
from mcp import types
from mcp.server.context import ServerRequestContext
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.shared.exceptions import MCPError

from .. import config
from ..auth import CurrentUser
from . import prompts, resources
from .errors import INTERNAL_ERROR, INVALID_PARAMS, ProtocolError
from .tools import TOOLS, ToolContext, call_tool, list_tools

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

    Errors leave as MCPError so the SDK answers with a JSON-RPC error. Anything
    unexpected is logged and answered with a bare "Internal error" rather than
    the exception's own text.
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
        raise MCPError(code=exc.code, message=exc.message) from exc
    except Exception as exc:
        db.rollback()
        logger.exception("MCP request failed")
        raise MCPError(code=INTERNAL_ERROR, message="Internal error") from exc
    finally:
        db.close()


async def _answer(
    request_ctx: ServerRequestContext[Any, Any], work: Callable[[ToolContext], dict[str, Any]]
) -> dict[str, Any]:
    """Run ``work`` for the API key behind this request, off the event loop."""
    request = request_ctx.request
    assert request is not None  # set for every call over the HTTP transport
    principal = getattr(request.state, PRINCIPAL_STATE)
    # Tools run blocking DB queries and renders; keep them off the event loop.
    return await anyio.to_thread.run_sync(_run_in_context, principal, work)


def _tool_input_schema(name: str) -> Optional[dict[str, Any]]:
    """A tool's argument schema, for the SDK's ``Mcp-Param-*`` header check.

    Schemas are the same for every caller, so the SDK can look one up here
    instead of running a whole ``tools/list`` (a DB session and a permission
    pass) ahead of each ``tools/call``.
    """
    tool = TOOLS.get(name)
    return tool.definition()["inputSchema"] if tool else None


# The SDK hands each handler the request context and the validated params.
# Grimoire validates tool arguments with the tools' own Pydantic models and
# words its own errors, so the handlers only adapt between the SDK's types
# and the tools, resources and prompts modules.

Ctx = ServerRequestContext[Any, Any]


async def _tools_list(ctx: Ctx, params: Optional[types.PaginatedRequestParams]) -> types.ListToolsResult:
    data = await _answer(ctx, lambda c: {"tools": list_tools(c)})
    return types.ListToolsResult.model_validate(data)


async def _tools_call(ctx: Ctx, params: types.CallToolRequestParams) -> types.CallToolResult:
    name, arguments = params.name, params.arguments or {}

    def run(c: ToolContext) -> dict[str, Any]:
        outcome = call_tool(name, arguments, c)
        if outcome is None:
            raise ProtocolError(INVALID_PARAMS, f"Unknown tool: {name}")
        return outcome

    return types.CallToolResult.model_validate(await _answer(ctx, run))


async def _resources_list(
    ctx: Ctx, params: Optional[types.PaginatedRequestParams]
) -> types.ListResourcesResult:
    data = await _answer(ctx, lambda c: {"resources": resources.list_resources(c)})
    return types.ListResourcesResult.model_validate(data)


async def _templates_list(
    ctx: Ctx, params: Optional[types.PaginatedRequestParams]
) -> types.ListResourceTemplatesResult:
    data = await _answer(ctx, lambda c: {"resourceTemplates": resources.list_templates(c)})
    return types.ListResourceTemplatesResult.model_validate(data)


async def _resources_read(ctx: Ctx, params: types.ReadResourceRequestParams) -> types.ReadResourceResult:
    uri = str(params.uri)
    data = await _answer(ctx, lambda c: resources.read_resource(uri, c))
    return types.ReadResourceResult.model_validate(data)


async def _prompts_list(ctx: Ctx, params: Optional[types.PaginatedRequestParams]) -> types.ListPromptsResult:
    data = await _answer(ctx, lambda c: {"prompts": prompts.list_prompts(c)})
    return types.ListPromptsResult.model_validate(data)


async def _prompts_get(ctx: Ctx, params: types.GetPromptRequestParams) -> types.GetPromptResult:
    name, arguments = params.name, params.arguments or {}
    data = await _answer(ctx, lambda c: prompts.get_prompt(name, arguments, c))
    return types.GetPromptResult.model_validate(data)


async def _complete(ctx: Ctx, params: types.CompleteRequestParams) -> types.CompleteResult:
    ref = params.ref.model_dump(mode="json")
    argument = params.argument.model_dump(mode="json")
    data = await _answer(ctx, lambda c: prompts.complete(ref, argument, c))
    return types.CompleteResult.model_validate(data)


def build_server() -> Server[Any]:
    """The low-level SDK server with Grimoire's handlers registered."""
    return Server(
        "grimoire",
        version=config.VERSION,
        instructions=INSTRUCTIONS,
        get_tool_input_schema=_tool_input_schema,
        on_list_tools=_tools_list,
        on_call_tool=_tools_call,
        on_list_resources=_resources_list,
        on_list_resource_templates=_templates_list,
        on_read_resource=_resources_read,
        on_list_prompts=_prompts_list,
        on_get_prompt=_prompts_get,
        on_completion=_complete,
    )


def build_session_manager() -> StreamableHTTPSessionManager:
    """The SDK's Streamable HTTP transport: stateless, one JSON body per POST.

    DNS-rebinding protection is on twice over: the router's ``check_origin``
    and the SDK's own check, both from the same host allow-list, so neither
    layer depends on the other staying in place.
    """
    from mcp.server.transport_security import TransportSecuritySettings

    from ..routers.mcp.core import allowed_hosts

    hosts = allowed_hosts()
    security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=hosts,
        allowed_origins=[f"{scheme}://{host}" for host in hosts for scheme in ("http", "https")],
    )
    return StreamableHTTPSessionManager(
        build_server(), json_response=True, stateless=True, security_settings=security
    )
