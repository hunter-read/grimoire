"""Pydantic schemas for the search API."""
from typing import Optional

from pydantic import BaseModel


class SearchHit(BaseModel):
    """One FTS5 page match, enriched with its parent book."""

    id: str
    title: str
    game_system: str
    game_system_id: str
    # `category` is `default="core"` rather than NOT NULL, so legacy rows can
    # hold NULL.
    category: Optional[str] = None
    page_number: int
    # HTML fragment: escaped page text with <mark> highlights.
    snippet: str


class SearchBookMatch(BaseModel):
    """A book matched on its own metadata rather than its page text (issue #343).

    Distinct from :class:`SearchHit`, which is always a *page*. This one carries
    no page number or snippet — a title match is about the book itself — and adds
    the cover/authors the client shows on a pinned row.
    """

    id: str
    title: str
    game_system: str
    game_system_id: str
    category: Optional[str] = None
    authors: list[str]
    publisher: str
    year: Optional[int] = None
    page_count: int
    has_thumbnail: bool
    tags: list[str]


class SearchMapHit(BaseModel):
    id: str
    filename: str
    relative_path: str
    has_thumbnail: bool = False
    tags: list[str]


class SearchTokenHit(BaseModel):
    id: str
    filename: str
    relative_path: str
    has_thumbnail: bool = False
    tags: list[str]


class SearchAudioHit(BaseModel):
    id: str
    filename: str
    relative_path: str
    # `default=""` on the model, so NULL is possible on legacy rows.
    title: Optional[str] = None
    # True when embedded/folder artwork or a UI-set cover exists.
    has_thumbnail: bool = False
    tags: list[str]


class SearchField(BaseModel):
    """One documented `field:` prefix, for the in-app help popover."""

    field: str
    aliases: list[str]


class SearchFieldsResponse(BaseModel):
    fields: list[SearchField]


class SearchResponse(BaseModel):
    query: str
    total: int
    # Page-text hits. Empty when a metadata filter (`title:`, `author:`, …)
    # suppresses content search.
    results: list[SearchHit]
    # Books matched on title/metadata, best match first. Empty when scoped to a
    # single `book_id`.
    book_matches: list[SearchBookMatch] = []
    # Only populated for unscoped searches (no book_id / system_id).
    maps: list[SearchMapHit]
    tokens: list[SearchTokenHit]
    audio: list[SearchAudioHit]
    # Canonical names of the `field:` filters recognised in `query`.
    fields: list[str] = []
