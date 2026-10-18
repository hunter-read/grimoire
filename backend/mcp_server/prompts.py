"""Prompts: ready-made requests the *user* picks, like slash commands.

The third MCP primitive. Tools are chosen by the model and resources attached
by the user or app; a prompt is a template the user invokes by name - in
Claude Code, ``/mcp__grimoire__prep_session`` - filling in its arguments. The
server answers with the messages to start the conversation with, which can
already carry context (here, the campaign overview as an embedded resource).

Prompt arguments are always strings, and a client may ask the server to
complete one as it is typed (``completion/complete``): ``prep_session`` offers
the user's campaign names.

Arguments are kept to one optional word. Claude Code fills them from the words
after the command, one word each (quotes don't group them), so a campaign is
found from any distinctive word of its name, and free-text questions are asked
in the conversation rather than passed as arguments.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from fastapi import HTTPException

from . import errors
from .tools import ToolContext
from .tools.campaigns import campaign_rows, describe_campaign
from .. import api_keys

MAX_COMPLETIONS = 100


@dataclass(frozen=True)
class Argument:
    name: str
    description: str
    required: bool = True


@dataclass(frozen=True)
class Prompt:
    name: str
    title: str
    description: str
    arguments: tuple[Argument, ...]
    permission: str
    build: Callable[[dict[str, str], ToolContext], list[dict[str, Any]]]

    def definition(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "arguments": [
                {"name": a.name, "description": a.description, "required": a.required}
                for a in self.arguments
            ],
        }


def _user_text(text: str) -> dict[str, Any]:
    return {"role": "user", "content": {"type": "text", "text": text}}


def _find_campaign(ctx: ToolContext, wanted: str) -> Optional[dict[str, Any]]:
    """The one campaign ``wanted`` names - by id, name, or any part of the name."""
    rows = campaign_rows(ctx)
    needle = wanted.strip().lower()
    for c in rows:
        if c["id"] == wanted.strip() or c["name"].lower() == needle:
            return c
    partial = [c for c in rows if needle in c["name"].lower()]
    return partial[0] if len(partial) == 1 else None


_PREP_ASK = (
    "Using the Grimoire tools: read the most recent session notes in its wiki and any "
    "other pages that matter, then give me a short recap of where things stand, the "
    "open threads, a few scenes I could run, and the NPCs, monsters and rules I'll "
    "need - with book and page references from my library (search_library). Don't "
    "write anything into the campaign until I ask."
)


def _prep_session(args: dict[str, str], ctx: ToolContext) -> list[dict[str, Any]]:
    wanted = args.get("campaign", "")
    campaign = _find_campaign(ctx, wanted) if wanted else None
    if campaign is None:
        # Not named, or not uniquely: the model can ask, which beats an error
        # the user has to decode and retype.
        said = f' (I said "{wanted}")' if wanted else ""
        return [
            _user_text(
                f"Help me prepare the next session of one of my campaigns{said}. Find it "
                "with list_campaigns; if it isn't clear which one I mean, ask me. Then "
                "read its overview with get_campaign. " + _PREP_ASK
            )
        ]
    uri = f"grimoire://campaigns/{campaign['id']}"
    try:
        overview = describe_campaign(ctx, campaign["id"])
    except HTTPException as exc:
        raise errors.ProtocolError(errors.INVALID_PARAMS, str(exc.detail))
    return [
        _user_text(
            f"Help me prepare the next session of my campaign {campaign['name']}. "
            "Its overview is attached. " + _PREP_ASK
        ),
        {
            "role": "user",
            "content": {
                "type": "resource",
                "resource": {"uri": uri, "mimeType": "text/markdown", "text": overview},
            },
        },
    ]


def _answer_from_my_books(args: dict[str, str], ctx: ToolContext) -> list[dict[str, Any]]:
    return [
        _user_text(
            "For the rest of this conversation, answer my rules and lore questions from "
            "my own books in Grimoire, not from memory. For each one: search with "
            "search_library (try other words for the same thing if the first search "
            "misses), read the relevant pages in full with read_pages, and quote the "
            "text with its book and page. If my books don't cover it, say so. Ask me "
            "what my first question is."
        )
    ]


PROMPTS: dict[str, Prompt] = {
    p.name: p
    for p in (
        Prompt(
            name="prep_session",
            title="Prep the next session",
            description="Plan the next session of one of your campaigns from its notes and wiki.",
            arguments=(
                Argument(
                    "campaign",
                    "A word from the campaign's name; leave out to be asked.",
                    required=False,
                ),
            ),
            permission="campaigns",
            build=_prep_session,
        ),
        Prompt(
            name="answer_from_my_books",
            title="Answer from my books",
            description=(
                "Answer rules and lore questions from your own books, citing book and page."
            ),
            arguments=(),
            permission="search",
            build=_answer_from_my_books,
        ),
    )
}


def _allowed(prompt: Prompt, ctx: ToolContext) -> bool:
    return api_keys.has_level(ctx.permissions, prompt.permission, api_keys.LEVEL_READ)


def list_prompts(ctx: ToolContext) -> list[dict[str, Any]]:
    return [p.definition() for p in PROMPTS.values() if _allowed(p, ctx)]


def get_prompt(name: str, arguments: dict[str, str], ctx: ToolContext) -> dict[str, Any]:
    """The prompt's messages. The SDK has already checked the request's shape."""
    prompt = PROMPTS.get(name)
    if prompt is None or not _allowed(prompt, ctx):
        raise errors.ProtocolError(errors.INVALID_PARAMS, f"Unknown prompt: {name}")
    args = {k: str(v) for k, v in arguments.items() if v not in (None, "")}
    missing = [a.name for a in prompt.arguments if a.required and a.name not in args]
    if missing:
        raise errors.ProtocolError(
            errors.INVALID_PARAMS, f"Missing argument(s): {', '.join(missing)}"
        )
    return {"description": prompt.description, "messages": prompt.build(args, ctx)}


def complete(ref: Any, argument: Any, ctx: ToolContext) -> dict[str, Any]:
    """Suggestions for a prompt argument the user is typing."""
    values: list[str] = []
    if (
        isinstance(ref, dict)
        and ref.get("type") == "ref/prompt"
        and ref.get("name") == "prep_session"
        and isinstance(argument, dict)
        and argument.get("name") == "campaign"
        and _allowed(PROMPTS["prep_session"], ctx)
    ):
        typed = str(argument.get("value") or "").lower()
        values = sorted(c["name"] for c in campaign_rows(ctx) if typed in c["name"].lower())
    return {
        "completion": {
            "values": values[:MAX_COMPLETIONS],
            "total": len(values),
            "hasMore": len(values) > MAX_COMPLETIONS,
        }
    }
