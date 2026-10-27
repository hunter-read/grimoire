"""Library tools: search, browse systems and books, and a book's details.

Each tool calls the REST handler for the same job - they are plain functions -
so restrictions, explicit-content settings and variant handling behave exactly
as they do in the app. Handlers called this way skip their FastAPI ``Depends``
guards, which is why every tool also carries a ``min_role``.
"""
from __future__ import annotations

import html
from typing import Any, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field

from ... import api_keys
from ...models import GameSystem
from ._base import Tool, ToolContext, truncate

# Most contents entries get_book lists; a long rulebook's full outline would
# crowd out everything else in the model's context.
TOC_LIMIT = 150
DESCRIPTION_LIMIT = 2000


def _book_label(row: dict[str, Any]) -> str:
    """A search row's title with its system, e.g. ``Player's Handbook (D&D 5e)``."""
    system = row.get("game_system")
    return f"{row['title']} ({system})" if system else str(row["title"])


def load_book(ctx: ToolContext, book_id: str) -> dict[str, Any]:
    """The book as the REST API returns it; 404/403 when the caller can't read it."""
    from ...routers.books.core import get_book

    return get_book(book_id=book_id, current_user=ctx.user, db=ctx.db)


# ---------------------------------------------------------------------------
# search_library
# ---------------------------------------------------------------------------


class SearchLibraryArgs(BaseModel):
    query: str = Field(
        min_length=2,
        description=(
            "Words to look for in book text. Also accepts field filters that match "
            'book metadata instead: title:, author:"Full Name", tag:, publisher:.'
        ),
    )
    book_id: Optional[str] = Field(
        None, description="Only search inside this book (an id from an earlier result)."
    )
    limit: int = Field(20, ge=1, le=50, description="Most page matches to return.")


def _plain_snippet(snippet: str) -> str:
    """The search API's HTML snippet as plain text, matches in **bold**."""
    text = snippet.replace("<mark>", "**").replace("</mark>", "**")
    return " ".join(html.unescape(text).split())


def search_library(args: SearchLibraryArgs, ctx: ToolContext) -> str:
    from ...routers.search.core import search_library as search

    found = search(
        q=args.query,
        limit=args.limit,
        book_id=args.book_id,
        system_id=None,
        current_user=ctx.user,
        db=ctx.db,
    )
    books = found["book_matches"]
    pages = found["results"]
    if not books and not pages:
        return (
            f'No books or pages matched "{args.query}". Try fewer or different words, '
            "or drop field filters."
        )

    lines: list[str] = []
    if books:
        lines.append(f"Books whose title or metadata match ({len(books)}):")
        for b in books:
            pages_note = f", {b['page_count']} pages" if b.get("page_count") else ""
            lines.append(f"- {_book_label(b)}, {b['category']}{pages_note} [book_id: {b['id']}]")
    if pages:
        if lines:
            lines.append("")
        lines.append(f"Page matches ({len(pages)}), best first:")
        for p in pages:
            lines.append(
                f"- {_book_label(p)}, page {p['page_number']} [book_id: {p['id']}]: "
                f"{_plain_snippet(p['snippet'])}"
            )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# list_game_systems
# ---------------------------------------------------------------------------


class NoArgs(BaseModel):
    pass


def list_game_systems(args: NoArgs, ctx: ToolContext) -> str:
    from ...routers.systems.core import list_systems

    systems = list_systems(
        sort="name",
        order="asc",
        genre=None,
        family=None,
        parent_system=None,
        edition=None,
        license=None,
        explicit=None,
        parent_id=None,
        include_children=True,
        current_user=ctx.user,
        db=ctx.db,
    )
    if not systems:
        return "The library has no game systems yet."
    lines = [f"Game systems in the library ({len(systems)}):"]
    for s in systems:
        edition = f", {s['edition']}" if s.get("edition") else ""
        lines.append(f"- {s['name']}{edition}: {s['book_count']} books [system_id: {s['id']}]")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# list_books
# ---------------------------------------------------------------------------


class ListBooksArgs(BaseModel):
    system_id: Optional[str] = Field(
        None, description="Only books in this game system (an id from list_game_systems)."
    )
    category: Optional[str] = Field(
        None,
        description="Only this category, e.g. core, supplements, adventures, handouts.",
    )
    offset: int = Field(0, ge=0, description="Skip this many books, to page through.")
    limit: int = Field(50, ge=1, le=100, description="Most books to return.")


def list_books(args: ListBooksArgs, ctx: ToolContext) -> str:
    from ...routers.books.core import list_books as list_

    found = list_(
        system_id=args.system_id,
        category=args.category,
        limit=args.limit,
        offset=args.offset,
        sort="title",
        order=None,
        added_since=None,
        current_user=ctx.user,
        db=ctx.db,
    )
    books, total = found["books"], found["total"]
    if not books:
        return "No books matched." if args.offset == 0 else f"No books past offset {args.offset}."
    ids = {b["game_system_id"] for b in books if b["game_system_id"]}
    names = {
        system_id: name
        for system_id, name in ctx.db.query(GameSystem.id, GameSystem.name)
        .filter(GameSystem.id.in_(ids))
        .all()
    }
    first = args.offset + 1
    lines = [f"Books {first}-{args.offset + len(books)} of {total}, by title:"]
    for b in books:
        system = names.get(b["game_system_id"], "")
        where = f"{system}, {b['category']}" if system else b["category"]
        pages = f", {b['page_count']} pages" if b.get("page_count") else ""
        lines.append(f"- {b['title']} ({where}{pages}) [book_id: {b['id']}]")
    if args.offset + len(books) < total:
        lines.append(f"More books: call again with offset={args.offset + len(books)}.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# get_book
# ---------------------------------------------------------------------------


class BookArgs(BaseModel):
    book_id: str = Field(description="The book's id, from search_library or list_books.")


def _toc_lines(ctx: ToolContext, book_id: str) -> list[str]:
    from ...routers.books.pages import get_book_toc

    try:
        tree = get_book_toc(book_id=book_id, current_user=ctx.user, db=ctx.db)["toc"]
    except Exception:
        # No outline in this format, or the file is missing or unreadable. The
        # contents are a bonus; the book's details are still worth returning.
        return []
    lines: list[str] = []

    def walk(nodes: list[dict[str, Any]], depth: int) -> None:
        for node in nodes:
            if len(lines) >= TOC_LIMIT:
                return
            lines.append(f"{'  ' * depth}- {node['title']} (p. {node['page']})")
            walk(node["children"], depth + 1)

    walk(tree, 0)
    return lines


def describe_book(ctx: ToolContext, book_id: str) -> str:
    """A book's details and contents as Markdown. Shared with the book resource."""
    b = load_book(ctx, book_id)
    facts = [
        ("System", (b["game_system"] or {}).get("name")),
        ("Category", b["category"]),
        ("Pages", b["page_count"]),
        ("Authors", ", ".join(b["authors"])),
        ("Publisher", b["publisher"]),
        ("Year", b["year"]),
        ("Product code", b["product_code"]),
        ("Tags", ", ".join(b["tags"])),
    ]
    lines = [f"# {b['title']}", f"book_id: {b['id']}"]
    lines += [f"{label}: {value}" for label, value in facts if value]
    if not b["indexed"]:
        lines.append("Text: not indexed - search and read_pages may find nothing; try view_page.")
    if b["description"]:
        lines += ["", truncate(b["description"].strip(), DESCRIPTION_LIMIT)]
    others = [v for v in b["variants"] if v["id"] != b["id"]]
    if others:
        lines += ["", "Other versions of this book:"]
        lines += [
            f"- {v['label'] or v['kind'] or v['filename']} [book_id: {v['id']}]" for v in others
        ]
    toc = _toc_lines(ctx, book_id)
    if toc:
        lines += ["", "Contents:"] + toc
        if len(toc) >= TOC_LIMIT:
            lines.append(f"[contents cut at {TOC_LIMIT} entries]")
    return "\n".join(lines)


def get_book(args: BookArgs, ctx: ToolContext) -> str:
    return describe_book(ctx, args.book_id)


# ---------------------------------------------------------------------------
# tag_books (write)
# ---------------------------------------------------------------------------


class TagBooksArgs(BaseModel):
    book_ids: list[str] = Field(min_length=1, max_length=50, description="Books to tag.")
    tags: list[str] = Field(
        min_length=1, max_length=20, description="Tags to add. Existing tags are kept."
    )


def tag_books(args: TagBooksArgs, ctx: ToolContext) -> str:
    from ...routers._bulk_schemas import BulkAddTags
    from ...routers.books.core import bulk_add_book_tags

    # The bulk route scopes rows with visible_books, which doesn't apply the
    # explicit-content rule. get_book does, so each book is read-checked first.
    readable: list[str] = []
    refused: list[str] = []
    for book_id in dict.fromkeys(args.book_ids):
        try:
            load_book(ctx, book_id)
            readable.append(book_id)
        except HTTPException:
            refused.append(book_id)
    lines: list[str] = []
    if readable:
        done = bulk_add_book_tags(
            data=BulkAddTags(ids=readable, tags=args.tags), current_user=ctx.user, db=ctx.db
        )
        for book_id in done["updated"]:
            lines.append(f"- {book_id}: now tagged {', '.join(done['tags'].get(book_id, []))}")
        refused.extend(error["id"] for error in done["errors"])
    if refused:
        lines.append(f"Not found: {', '.join(refused)}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# add_bookmark (write)
# ---------------------------------------------------------------------------


class AddBookmarkArgs(BaseModel):
    book_id: str = Field(description="The book to bookmark.")
    page: int = Field(ge=1, description="Page number, as in search results.")
    label: str = Field("", max_length=200, description="Short name shown in the bookmark list.")
    notes: str = Field("", max_length=5000, description="Optional longer note.")


def add_bookmark(args: AddBookmarkArgs, ctx: ToolContext) -> str:
    from ...routers.bookmarks._schemas import BookmarkCreate
    from ...routers.bookmarks.core import create_bookmark

    book = load_book(ctx, args.book_id)
    if book["page_count"] and args.page > book["page_count"]:
        raise HTTPException(400, f"{book['title']} has {book['page_count']} pages")
    bm = create_bookmark(
        data=BookmarkCreate(
            book_id=args.book_id, page_number=args.page, label=args.label, notes=args.notes
        ),
        user=ctx.user,
        db=ctx.db,
    )
    return f"Bookmarked page {args.page} of {book['title']} [bookmark_id: {bm['id']}]."


TOOLS = (
    Tool(
        name="search_library",
        title="Search the library",
        description=(
            "Full-text search across the user's TTRPG books, returning matching "
            "books and the pages a passage appears on, with a short excerpt of each. "
            "Use it to find where a rule, creature, spell, item or place is described. "
            "Pass book_id to search inside one book you already found."
        ),
        arguments=SearchLibraryArgs,
        permission="search",
        level=api_keys.LEVEL_READ,
        run=search_library,
    ),
    Tool(
        name="list_game_systems",
        title="List game systems",
        description=(
            "The game systems in the user's library (D&D 5e, Pathfinder 2e, ...) with "
            "how many books each has. Use it to learn what the user plays, or to get a "
            "system_id for list_books."
        ),
        arguments=NoArgs,
        permission="systems",
        level=api_keys.LEVEL_READ,
        run=list_game_systems,
    ),
    Tool(
        name="list_books",
        title="List books",
        description=(
            "Lists the user's books by title, optionally only one game system or "
            "category. Use it to see what books exist; use search_library to find "
            "what is inside them."
        ),
        arguments=ListBooksArgs,
        permission="books",
        level=api_keys.LEVEL_READ,
        run=list_books,
    ),
    Tool(
        name="get_book",
        title="Get book details",
        description=(
            "A book's details - system, authors, page count, description, tags - and its "
            "table of contents with page numbers. Use the contents to find the right "
            "pages to read_pages."
        ),
        arguments=BookArgs,
        permission="books",
        level=api_keys.LEVEL_READ,
        run=get_book,
    ),
    Tool(
        name="tag_books",
        title="Tag books",
        description=(
            "Adds tags to one or more books; tags they already have are kept. Only do "
            "this when the user asks for books to be tagged."
        ),
        arguments=TagBooksArgs,
        permission="books",
        level=api_keys.LEVEL_WRITE,
        min_role="gm",
        idempotent=True,
        run=tag_books,
    ),
    Tool(
        name="add_bookmark",
        title="Bookmark a page",
        description=(
            "Saves a bookmark on a book page in the user's own bookmark list, with an "
            "optional label and note. Use it when the user asks to bookmark or "
            "remember a page."
        ),
        arguments=AddBookmarkArgs,
        permission="personal",
        level=api_keys.LEVEL_WRITE,
        run=add_bookmark,
    ),
)
