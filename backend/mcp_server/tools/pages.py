"""Page tools: a book page's text, or the page itself as an image.

``view_page`` is where MCP differs most visibly from the REST API: a tool can
answer with an image content block, and a model that reads images sees the
page - its maps, stat blocks and tables - as a player would.
"""
from __future__ import annotations

import io
import os
from typing import Any, Optional

import fitz  # type: ignore[import-untyped]
from fastapi import HTTPException
from PIL import Image  # type: ignore[import-untyped]
from pydantic import BaseModel, Field

from ... import api_keys
from ._base import Tool, ToolContext, ToolOutput, image_block, text_block, truncate
from .library import load_book

MAX_PAGES_PER_READ = 10
READ_CHAR_LIMIT = 60_000
# Wide enough to read body text; a model shrinks anything much larger anyway.
VIEW_WIDTH = 1000


class ReadPagesArgs(BaseModel):
    book_id: str = Field(description="The book to read.")
    start_page: int = Field(ge=1, description="First page to read.")
    end_page: Optional[int] = Field(
        None,
        ge=1,
        description=f"Last page to read, at most {MAX_PAGES_PER_READ} pages after start_page. "
        "Leave out to read one page.",
    )


def read_pages(args: ReadPagesArgs, ctx: ToolContext) -> str:
    from ...routers.books.pages import get_page_text

    end = args.end_page or args.start_page
    if end < args.start_page:
        raise HTTPException(400, "end_page is before start_page")
    if end - args.start_page + 1 > MAX_PAGES_PER_READ:
        raise HTTPException(400, f"Read at most {MAX_PAGES_PER_READ} pages at a time")
    book = load_book(ctx, args.book_id)
    if book["page_count"] and args.start_page > book["page_count"]:
        raise HTTPException(400, f"{book['title']} has {book['page_count']} pages")
    end = min(end, book["page_count"] or end)

    parts = [f"{book['title']}, pages {args.start_page}-{end}:"]
    for page in range(args.start_page, end + 1):
        text = get_page_text(
            book_id=args.book_id, page_num=page, current_user=ctx.user, db=ctx.db
        )["text"].strip()
        parts.append(f"\n--- Page {page} ---")
        parts.append(text or "(no text on this page - it may be an image; try view_page)")
    return truncate("\n".join(parts), READ_CHAR_LIMIT)


class ViewPageArgs(BaseModel):
    book_id: str = Field(description="The book to look at.")
    page: int = Field(ge=1, description="The page number.")


def _render(filepath: str, mime_type: str, page: int) -> tuple[bytes, str]:
    """One page as image bytes and their MIME type."""
    from ...indexer import comics
    from ...indexer.formats import is_comic_path, is_fitz_mime
    from ...indexer.thumbnails import archive_ext
    from ...routers.books._helpers import open_pdf

    if not os.path.exists(filepath):
        raise HTTPException(404, "The book's file is missing from the library")
    if is_comic_path(filepath):
        found = comics.read_page(filepath, archive_ext(filepath), page)
        if found is None:
            raise HTTPException(400, f"No page {page} in this archive")
        return found
    if mime_type.startswith("image/") and not is_fitz_mime(mime_type):
        if page != 1:
            raise HTTPException(400, "An image file has only one page")
        with open(filepath, "rb") as fh:
            return fh.read(), mime_type
    if not is_fitz_mime(mime_type):
        raise HTTPException(400, "This book has no rendered pages; use read_pages instead")
    with open_pdf(filepath) as doc:
        if page > len(doc):
            raise HTTPException(400, f"This book has {len(doc)} pages")
        pdf_page = doc[page - 1]
        zoom = VIEW_WIDTH / pdf_page.rect.width
        pix = pdf_page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    # Encoded outside open_pdf() so the book's lock isn't held through it.
    buf = io.BytesIO()
    img.save(buf, format="webp", quality=80)
    return buf.getvalue(), "image/webp"


def view_page(args: ViewPageArgs, ctx: ToolContext) -> ToolOutput:
    from ...models import Book

    book = load_book(ctx, args.book_id)
    row: Any = ctx.db.query(Book.filepath, Book.mime_type).filter_by(id=args.book_id).first()
    data, mime_type = _render(row.filepath, row.mime_type or "", args.page)
    return [text_block(f"{book['title']}, page {args.page}:"), image_block(data, mime_type)]


TOOLS = (
    Tool(
        name="read_pages",
        title="Read book pages",
        description=(
            "The text of one or more pages of a book, up to "
            f"{MAX_PAGES_PER_READ} at a time. Use it after search_library or get_book "
            "to read a rule or passage in full rather than from an excerpt."
        ),
        arguments=ReadPagesArgs,
        permission="books",
        level=api_keys.LEVEL_READ,
        run=read_pages,
    ),
    Tool(
        name="view_page",
        title="View a book page",
        description=(
            "A book page as an image, as it looks in print. Use it for maps, stat "
            "blocks, tables and art, or a page read_pages found no text on."
        ),
        arguments=ViewPageArgs,
        permission="books",
        level=api_keys.LEVEL_READ,
        run=view_page,
    ),
)
