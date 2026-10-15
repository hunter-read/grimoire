"""The Model Context Protocol (MCP) over JSON-RPC 2.0 - the protocol layer.

Transport-agnostic: :func:`handle_message` takes one decoded JSON-RPC message
and returns the response object, or None when there is nothing to answer (a
notification, or a response from the client). ``routers/mcp`` carries it over
HTTP.

Where REST spreads meaning over URLs, verbs and status codes, MCP sends every
call as ``{"jsonrpc": "2.0", "id": ..., "method": ..., "params": ...}`` to one
endpoint. A client's conversation is:

1. ``initialize`` - agree a protocol revision; learn the server's name,
   capabilities and ``instructions`` (text the client hands to the model).
2. ``notifications/initialized`` - the client is ready. No ``id``, so no reply.
3. ``tools/list`` - what the model may call, each tool with a description and
   a JSON Schema for its arguments. The client shows these to the model.
4. ``tools/call`` - the model picked a tool; run it and return content blocks.

Alongside tools sit the other two primitives: resources (``resources/*``,
content the user attaches by URI - see resources.py) and prompts
(``prompts/*``, templates the user invokes - see prompts.py), plus
``completion/complete`` to suggest prompt arguments as they are typed.

Grimoire serves the handshake-era revisions statelessly: no ``Mcp-Session-Id``,
every POST stands alone, and every answer is one JSON body rather than an SSE
stream. That is all the spec requires of a server that never pushes
notifications or sends requests of its own.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from .. import config
from . import prompts, resources
from .errors import (
    INTERNAL_ERROR,
    INVALID_PARAMS,
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    ProtocolError,
)
from .tools import ToolContext, call_tool, list_tools

__all__ = [
    "INTERNAL_ERROR",
    "INVALID_PARAMS",
    "INVALID_REQUEST",
    "METHOD_NOT_FOUND",
    "PARSE_ERROR",
    "handle_message",
]

logger = logging.getLogger("grimoire.mcp")

# Newest first. A client asking for one of these gets it back; anyone else gets
# the newest and decides for themselves whether they can speak it.
SUPPORTED_PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26")
LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

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


def error_response(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _result(request_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def negotiate_version(requested: Any) -> str:
    """The revision to answer ``initialize`` with."""
    if isinstance(requested, str) and requested in SUPPORTED_PROTOCOL_VERSIONS:
        return requested
    return LATEST_PROTOCOL_VERSION


def _initialize(params: dict[str, Any]) -> dict[str, Any]:
    return {
        "protocolVersion": negotiate_version(params.get("protocolVersion")),
        # listChanged=false: nothing changes mid-session, so the client need not
        # listen for */list_changed notifications. No resource subscriptions
        # either: Grimoire never pushes, so there is nothing to subscribe to.
        "capabilities": {
            "tools": {"listChanged": False},
            "resources": {"listChanged": False, "subscribe": False},
            "prompts": {"listChanged": False},
            "completions": {},
        },
        "serverInfo": {"name": "grimoire", "title": "Grimoire", "version": config.VERSION},
        "instructions": INSTRUCTIONS,
    }


def handle_message(message: Any, ctx: ToolContext) -> Optional[dict[str, Any]]:
    """Answer one JSON-RPC message, or return None when no answer is owed."""
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return error_response(None, INVALID_REQUEST, "Expected a JSON-RPC 2.0 object")

    method = message.get("method")
    if method is None:
        # A response to a request we sent. Grimoire sends none, so there is
        # nothing to match it to.
        return None
    if "id" not in message:
        # A notification (notifications/initialized, notifications/cancelled):
        # fire-and-forget by definition. Every call here finishes before its
        # response is sent, so there is nothing in flight to cancel either.
        return None

    request_id = message["id"]
    if isinstance(request_id, bool) or not isinstance(request_id, (str, int)):
        return error_response(None, INVALID_REQUEST, "id must be a string or an integer")
    if not isinstance(method, str):
        return error_response(request_id, INVALID_REQUEST, "method must be a string")
    params = message.get("params") or {}
    if not isinstance(params, dict):
        return error_response(request_id, INVALID_PARAMS, "params must be an object")

    try:
        return _result(request_id, _dispatch(method, params, ctx))
    except ProtocolError as exc:
        return error_response(request_id, exc.code, exc.message)
    except Exception:
        ctx.db.rollback()
        logger.exception("MCP %s failed", method)
        return error_response(request_id, INTERNAL_ERROR, "Internal error")


def _dispatch(method: str, params: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    """The result for one method call. Every list fits in one page: no nextCursor."""
    if method == "initialize":
        return _initialize(params)
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": list_tools(ctx)}
    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str) or not isinstance(arguments, dict):
            raise ProtocolError(INVALID_PARAMS, "tools/call needs a name and an arguments object")
        result = call_tool(name, arguments, ctx)
        if result is None:
            raise ProtocolError(INVALID_PARAMS, f"Unknown tool: {name}")
        return result
    if method == "resources/list":
        return {"resources": resources.list_resources(ctx)}
    if method == "resources/templates/list":
        return {"resourceTemplates": resources.list_templates(ctx)}
    if method == "resources/read":
        uri = params.get("uri")
        if not isinstance(uri, str):
            raise ProtocolError(INVALID_PARAMS, "resources/read needs a uri")
        return resources.read_resource(uri, ctx)
    if method == "prompts/list":
        return {"prompts": prompts.list_prompts(ctx)}
    if method == "prompts/get":
        return prompts.get_prompt(params.get("name"), params.get("arguments") or {}, ctx)
    if method == "completion/complete":
        return prompts.complete(params.get("ref"), params.get("argument"), ctx)
    raise ProtocolError(METHOD_NOT_FOUND, f"Method not found: {method}")
