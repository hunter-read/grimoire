"""Resources: Grimoire content addressed by ``grimoire://`` URI.

Tools and resources can return the same text, but who decides to use them
differs. The *model* calls a tool when it thinks one will help. A resource is
picked by the *user or the app* and attached as context up front - in Claude
Code, by typing ``@grimoire:`` and choosing one - so the model starts already
holding the campaign overview rather than having to go and fetch it.

``resources/list`` offers the user's campaigns, a short list worth browsing.
Books and wiki pages are too many to list, so they are offered as URI
templates (``resources/templates/list``) the client fills in.

Reading one runs the same code as the matching tool, behind the same API key
permission.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import HTTPException

from . import errors
from .tools import ToolContext
from .tools.campaigns import campaign_rows, describe_campaign, describe_wiki_page
from .tools.library import describe_book
from .. import api_keys

MIME = "text/markdown"


@dataclass(frozen=True)
class Template:
    uri_template: str
    pattern: re.Pattern[str]
    name: str
    title: str
    description: str
    permission: str
    read: Callable[..., str]

    def definition(self) -> dict[str, Any]:
        return {
            "uriTemplate": self.uri_template,
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "mimeType": MIME,
        }


_ID = r"([A-Za-z0-9_-]+)"

TEMPLATES = (
    Template(
        uri_template="grimoire://campaigns/{campaign_id}",
        pattern=re.compile(rf"grimoire://campaigns/{_ID}"),
        name="campaign",
        title="Campaign overview",
        description="A campaign's description, players, sessions and wiki page titles.",
        permission="campaigns",
        read=describe_campaign,
    ),
    Template(
        uri_template="grimoire://campaigns/{campaign_id}/wiki/{page_id}",
        pattern=re.compile(rf"grimoire://campaigns/{_ID}/wiki/{_ID}"),
        name="wiki-page",
        title="Campaign wiki page",
        description="One page of a campaign's wiki.",
        permission="campaigns",
        read=describe_wiki_page,
    ),
    Template(
        uri_template="grimoire://books/{book_id}",
        pattern=re.compile(rf"grimoire://books/{_ID}"),
        name="book",
        title="Book details",
        description="A book's details and table of contents.",
        permission="books",
        read=describe_book,
    ),
)


def _can_read(ctx: ToolContext, permission: str) -> bool:
    return api_keys.has_level(ctx.permissions, permission, api_keys.LEVEL_READ)


def list_resources(ctx: ToolContext) -> list[dict[str, Any]]:
    if not _can_read(ctx, "campaigns"):
        return []
    return [
        {
            "uri": f"grimoire://campaigns/{c['id']}",
            "name": c["name"],
            "title": f"{c['name']} (campaign)",
            "description": c["system_display_name"] or "Campaign",
            "mimeType": MIME,
        }
        for c in campaign_rows(ctx)
    ]


def list_templates(ctx: ToolContext) -> list[dict[str, Any]]:
    return [t.definition() for t in TEMPLATES if _can_read(ctx, t.permission)]


def read_resource(uri: str, ctx: ToolContext) -> dict[str, Any]:
    for template in TEMPLATES:
        match = template.pattern.fullmatch(uri)
        if match is None:
            continue
        if not _can_read(ctx, template.permission):
            raise errors.ProtocolError(
                errors.INVALID_PARAMS,
                f"This API key needs 'read' access to {template.permission!r} to read {uri}",
            )
        try:
            text = template.read(ctx, *match.groups())
        except HTTPException:
            # Missing and forbidden read the same, so ids can't be probed.
            ctx.db.rollback()
            raise errors.ProtocolError(errors.RESOURCE_NOT_FOUND, f"Resource not found: {uri}")
        return {"contents": [{"uri": uri, "mimeType": MIME, "text": text}]}
    raise errors.ProtocolError(errors.RESOURCE_NOT_FOUND, f"Resource not found: {uri}")
