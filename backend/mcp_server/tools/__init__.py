"""The tools Grimoire offers over MCP, and the registry that lists and runs them.

What makes a tool different from an endpoint is in ``_base.py``; the tools
themselves are grouped by area (``library``, ``pages``, ``campaigns``).

A tool that runs and fails (bad arguments, missing book, a permission the key
lacks) answers with ``isError: true`` and a sentence saying what went wrong,
so the model can correct itself and retry. JSON-RPC errors are kept for calls
that are malformed at the protocol level (see protocol.py).

``tools/list`` shows a key only the tools it may call, by permission and by its
owner's role, so the model is never offered one that would only refuse.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import HTTPException
from pydantic import ValidationError

from . import campaigns, library, pages
from ._base import Tool, ToolContext, result

__all__ = ["TOOLS", "Tool", "ToolContext", "call_tool", "list_tools"]

logger = logging.getLogger("grimoire.mcp")

TOOLS: dict[str, Tool] = {
    tool.name: tool for tool in (*library.TOOLS, *pages.TOOLS, *campaigns.TOOLS)
}


def list_tools(ctx: ToolContext) -> list[dict[str, Any]]:
    """The tools this key may call - the model never sees one it can't use."""
    return [t.definition() for t in TOOLS.values() if t.allowed(ctx)]


def validation_problems(exc: ValidationError) -> str:
    return "; ".join(
        f"{'.'.join(str(p) for p in e['loc']) or 'arguments'}: {e['msg']}" for e in exc.errors()
    )


def call_tool(name: str, arguments: dict[str, Any], ctx: ToolContext) -> Optional[dict[str, Any]]:
    """Run tool ``name``; None when there is no such tool."""
    tool = TOOLS.get(name)
    if tool is None:
        return None
    if not tool.allowed(ctx):
        return result(
            f"This API key needs {tool.level!r} access to {tool.permission!r}"
            + (f" and a {tool.min_role} account" if tool.min_role != "player" else "")
            + f" to use {name}. The user can grant it under Settings → API keys.",
            is_error=True,
        )
    try:
        args = tool.arguments.model_validate(arguments)
    except ValidationError as exc:
        return result(f"Invalid arguments for {name}: {validation_problems(exc)}", is_error=True)
    try:
        return result(tool.run(args, ctx))
    except HTTPException as exc:
        # The REST code underneath speaks HTTP; the model gets the sentence. A
        # half-done write must not linger in the session either.
        ctx.db.rollback()
        return result(str(exc.detail), is_error=True)
    except Exception:
        ctx.db.rollback()
        logger.exception("MCP tool %s failed", name)
        return result(f"{name} failed with an internal error.", is_error=True)
