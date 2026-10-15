"""Campaign tools: what the user is playing, and its wiki.

Session notes are wiki pages too (``page_type`` "session", with a date): the
older per-session note tables are rolled into the wiki on every startup, so the
wiki is the one place a campaign's writing lives.

The campaign handlers check membership, page visibility and GM-only secrets
themselves, so a tool sees exactly what the user would see in the app - a
player never gets a GM-only page or ``||secret||`` text.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from ... import api_keys
from ._base import Tool, ToolContext, truncate

WIKI_BODY_LIMIT = 30_000
LIST_LIMIT = 100


class ListCampaignsArgs(BaseModel):
    include_archived: bool = Field(False, description="Also list archived campaigns.")


def campaign_rows(ctx: ToolContext, include_archived: bool = False) -> list[dict[str, Any]]:
    from ...routers.campaigns.core import list_campaigns

    rows: list[dict[str, Any]] = list_campaigns(
        include_archived=include_archived, current_user=ctx.user, db=ctx.db
    )
    return rows


def list_campaigns(args: ListCampaignsArgs, ctx: ToolContext) -> str:
    rows = campaign_rows(ctx, args.include_archived)
    if not rows:
        return "The user has no campaigns."
    lines = [f"Campaigns ({len(rows)}):"]
    for c in rows:
        role = "runs it" if c["owner_id"] == ctx.user.id else f"GM: {c['owner_display_name']}"
        if c.get("invitation_status") == "invited":
            role += ", invitation not yet accepted"
        bits = [b for b in (c["system_display_name"], role) if b]
        if c.get("next_session"):
            bits.append(f"next session {c['next_session']}")
        lines.append(f"- {c['name']} ({'; '.join(bits)}) [campaign_id: {c['id']}]")
    return "\n".join(lines)


class CampaignArgs(BaseModel):
    campaign_id: str = Field(description="The campaign's id, from list_campaigns.")


def describe_campaign(ctx: ToolContext, campaign_id: str) -> str:
    """A campaign's overview and wiki outline. Shared with the resource."""
    from ...routers.campaigns.core import get_campaign
    from ...routers.campaigns.wiki import list_pages

    c = get_campaign(campaign_id=campaign_id, current_user=ctx.user, db=ctx.db)
    lines = [f"# {c['name']}", f"campaign_id: {c['id']}"]
    if c["system_display_name"]:
        lines.append(f"System: {c['system_display_name']}")
    lines.append(f"GM: {c['owner_display_name']}")
    if c.get("next_session"):
        lines.append(f"Next session: {c['next_session']}")
    if c["description"]:
        lines += ["", truncate(c["description"].strip(), 3000)]

    players = [
        m for m in c.get("members", []) if not m.get("is_owner") and m["status"] == "accepted"
    ]
    if players:
        lines += ["", "Players:"]
        for m in players:
            who = m.get("display_name") or m.get("username") or "?"
            role = f" playing {m['character_name']}" if m.get("character_name") else ""
            lines.append(f"- {who}{role}")

    pages = list_pages(
        campaign_id=campaign_id,
        mine=False,
        include_hidden=False,
        current_user=ctx.user,
        db=ctx.db,
    )
    if pages:
        tree = _page_tree(pages)
        lines += ["", f"Wiki pages ({len(pages)}), as nested in the wiki:"]
        lines += tree[:LIST_LIMIT]
        if len(tree) > LIST_LIMIT:
            lines.append(f"[{len(tree) - LIST_LIMIT} more not listed - use search_campaign_wiki]")
    return "\n".join(lines)


def _page_line(page: dict[str, Any]) -> str:
    dated = f" (session {page['session_date']})" if page.get("session_date") else ""
    return f"{page['title']}{dated} [page_id: {page['id']}]"


def _page_tree(pages: list[dict[str, Any]]) -> list[str]:
    """The pages as an indented outline, children under their parent page."""
    ids = {p["id"] for p in pages}
    children: dict[Any, list[dict[str, Any]]] = {}
    for p in pages:
        # A page under a parent the user can't see is shown at the top level.
        parent = p["parent_id"] if p["parent_id"] in ids else None
        children.setdefault(parent, []).append(p)
    lines: list[str] = []

    def walk(parent: Any, depth: int) -> None:
        for p in children.get(parent, []):
            lines.append(f"{'  ' * depth}- {_page_line(p)}")
            walk(p["id"], depth + 1)

    walk(None, 0)
    return lines


def get_campaign(args: CampaignArgs, ctx: ToolContext) -> str:
    return describe_campaign(ctx, args.campaign_id)


class WikiPageArgs(BaseModel):
    campaign_id: str = Field(description="The campaign the page belongs to.")
    page_id: str = Field(description="The page's id, from get_campaign.")


def describe_wiki_page(ctx: ToolContext, campaign_id: str, page_id: str) -> str:
    """A wiki page as Markdown. Shared with the resource."""
    from ...routers.campaigns.wiki import get_page

    p = get_page(campaign_id=campaign_id, page_id=page_id, current_user=ctx.user, db=ctx.db)
    lines = [f"# {p['title']}"]
    if p.get("created_by_name"):
        lines.append(f"Written by {p['created_by_name']}, updated {p['updated_at']}")
    lines += ["", truncate(p["body"] or "(empty page)", WIKI_BODY_LIMIT)]
    if p["backlinks"]:
        lines += ["", "Linked from:"]
        lines += [f"- {b['title']} [page_id: {b['id']}]" for b in p["backlinks"]]
    return "\n".join(lines)


def read_wiki_page(args: WikiPageArgs, ctx: ToolContext) -> str:
    return describe_wiki_page(ctx, args.campaign_id, args.page_id)


class SearchWikiArgs(BaseModel):
    campaign_id: str = Field(description="The campaign whose wiki to search.")
    query: str = Field(
        min_length=1, max_length=200, description="Text to find in page titles and bodies."
    )


def search_campaign_wiki(args: SearchWikiArgs, ctx: ToolContext) -> str:
    from ...routers.campaigns.wiki import search_pages

    found = search_pages(
        campaign_id=args.campaign_id, q=args.query, current_user=ctx.user, db=ctx.db
    )["results"]
    if not found:
        return f'No wiki pages mention "{args.query}".'
    lines = [f'Wiki pages mentioning "{args.query}" ({len(found)}):']
    for p in found[:LIST_LIMIT]:
        snippet = " ".join((p.get("snippet") or "").split())
        lines.append(f"- {_page_line(p)}" + (f": {snippet}" if snippet else ""))
    return "\n".join(lines)


class CreateWikiPageArgs(BaseModel):
    campaign_id: str = Field(description="The campaign to add the page to.")
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(
        "", max_length=100_000, description="The page in Markdown. [[Page Title]] links pages."
    )
    visibility: Literal["private", "shared"] = Field(
        "private",
        description="private: only the user can read it. shared: everyone in the campaign.",
    )


def create_wiki_page(args: CreateWikiPageArgs, ctx: ToolContext) -> str:
    from ...routers.campaigns._schemas import WikiPageCreate
    from ...routers.campaigns.wiki import create_page

    page = create_page(
        campaign_id=args.campaign_id,
        data=WikiPageCreate(
            title=args.title,
            body=args.body,
            visibility="group" if args.visibility == "shared" else "gm",
        ),
        current_user=ctx.user,
        db=ctx.db,
    )
    return f"Created wiki page {page['title']!r} [page_id: {page['id']}]."


TOOLS = (
    Tool(
        name="list_campaigns",
        title="List campaigns",
        description=(
            "The campaigns the user runs or plays in, with their game system and next "
            "session date. Start here for anything about the user's own games."
        ),
        arguments=ListCampaignsArgs,
        permission="campaigns",
        level=api_keys.LEVEL_READ,
        run=list_campaigns,
    ),
    Tool(
        name="get_campaign",
        title="Get campaign overview",
        description=(
            "A campaign's description, players and characters, and an outline of its "
            "wiki - NPCs, places, plans and dated session notes. Use it before reading "
            "pages; the session pages show what happened when."
        ),
        arguments=CampaignArgs,
        permission="campaigns",
        level=api_keys.LEVEL_READ,
        run=get_campaign,
    ),
    Tool(
        name="read_wiki_page",
        title="Read a campaign wiki page",
        description="One page of a campaign's wiki, such as an NPC or a session's notes, in Markdown.",
        arguments=WikiPageArgs,
        permission="campaigns",
        level=api_keys.LEVEL_READ,
        run=read_wiki_page,
    ),
    Tool(
        name="search_campaign_wiki",
        title="Search a campaign wiki",
        description=(
            "Finds the wiki pages of a campaign that mention a name or phrase, with an "
            "excerpt of each. Use it to find everything written about an NPC, place or "
            "item."
        ),
        arguments=SearchWikiArgs,
        permission="campaigns",
        level=api_keys.LEVEL_READ,
        run=search_campaign_wiki,
    ),
    Tool(
        name="create_wiki_page",
        title="Create a campaign wiki page",
        description=(
            "Adds a new page to a campaign's wiki, private to the user unless they say "
            "to share it. Use it when the user asks you to write something into their "
            "campaign, such as session prep, an NPC or a recap. It never changes "
            "existing pages."
        ),
        arguments=CreateWikiPageArgs,
        permission="campaigns",
        level=api_keys.LEVEL_WRITE,
        run=create_wiki_page,
    ),
)
