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


class SearchMapHit(BaseModel):
    id: str
    filename: str
    relative_path: str
    tags: list[str]


class SearchTokenHit(BaseModel):
    id: str
    filename: str
    relative_path: str
    tags: list[str]


class SearchAudioHit(BaseModel):
    id: str
    filename: str
    relative_path: str
    # `default=""` on the model, so NULL is possible on legacy rows.
    title: Optional[str] = None
    tags: list[str]


class SearchResponse(BaseModel):
    query: str
    total: int
    results: list[SearchHit]
    # Only populated for unscoped searches (no book_id / system_id).
    maps: list[SearchMapHit]
    tokens: list[SearchTokenHit]
    audio: list[SearchAudioHit]
