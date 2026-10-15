"""What a tool is, and the context every tool and resource runs in.

A tool is not an endpoint. An endpoint is shaped for a program a developer
wrote against the docs; a tool is shaped for a model choosing what to do next,
so each one is:

* **described for the model** - ``description`` is the model's only guide to
  when the tool is useful, so it reads like advice, not a reference page;
* **typed by a JSON Schema** - generated from the Pydantic model that also
  validates the arguments, so the two cannot drift;
* **answered as content** - text the model reads (or an image it looks at),
  not JSON a UI renders. Ids the model will need for a follow-up call are
  spelled out in that text.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any, Callable, Union

from pydantic import BaseModel
from sqlalchemy.orm import Session

from ... import api_keys
from ...auth import CurrentUser

# A tool answers with plain text, or with a list of MCP content blocks when it
# has something other than text to hand back (a page image).
ToolOutput = Union[str, list[dict[str, Any]]]


@dataclass
class ToolContext:
    """Who is calling, what their key may do, and a DB session for the call."""

    user: CurrentUser
    permissions: dict[str, str]
    db: Session


@dataclass(frozen=True)
class Tool:
    name: str
    title: str
    description: str
    arguments: type[BaseModel]
    # The API key permission and level this tool needs, from the same table the
    # REST API uses (api_keys.PERMISSIONS).
    permission: str
    level: str
    run: Callable[[Any, ToolContext], ToolOutput]
    # The weakest role allowed, mirroring the REST route's role guard. Tools
    # call handler functions directly, which skips FastAPI's Depends() guards,
    # so the role check has to live here.
    min_role: str = "player"
    # Behaviour hints for the client, e.g. whether to ask before running it.
    # Advisory only: the permission and role checks are what enforce anything.
    destructive: bool = False
    idempotent: bool = False

    @property
    def read_only(self) -> bool:
        return self.level == api_keys.LEVEL_READ

    def allowed(self, ctx: ToolContext) -> bool:
        return api_keys.ROLE_RANK.get(ctx.user.role, -1) >= api_keys.ROLE_RANK[
            self.min_role
        ] and api_keys.has_level(ctx.permissions, self.permission, self.level)

    def definition(self) -> dict[str, Any]:
        """The tool as ``tools/list`` shows it."""
        annotations: dict[str, Any] = {"readOnlyHint": self.read_only, "openWorldHint": False}
        if not self.read_only:
            annotations["destructiveHint"] = self.destructive
            annotations["idempotentHint"] = self.idempotent
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": self.arguments.model_json_schema(),
            "annotations": annotations,
        }


def text_block(text: str) -> dict[str, Any]:
    return {"type": "text", "text": text}


def image_block(data: bytes, mime_type: str) -> dict[str, Any]:
    return {"type": "image", "data": base64.b64encode(data).decode("ascii"), "mimeType": mime_type}


def result(output: ToolOutput, is_error: bool = False) -> dict[str, Any]:
    """A ``tools/call`` result from a tool's output."""
    content = [text_block(output)] if isinstance(output, str) else output
    return {"content": content, "isError": is_error}


def truncate(text: str, limit: int) -> str:
    """``text`` cut to ``limit`` characters, saying so when it was cut."""
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + f"\n[... cut at {limit} characters]"
