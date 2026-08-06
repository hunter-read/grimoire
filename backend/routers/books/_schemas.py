"""Pydantic schemas for the books API."""
from typing import Optional

from pydantic import BaseModel, field_validator

from .._bulk_schemas import bulk_update_model


class LinkEntry(BaseModel):
    """A labeled link on a book (publisher / DriveThruRPG page, etc.)."""

    label: str = ""
    url: str = ""


class BookUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    authors: Optional[list[str]] = None
    artists: Optional[list[str]] = None
    genres: Optional[list[str]] = None
    publisher: Optional[str] = None
    # Legacy single-value URL; still accepted. New clients send ``urls``.
    publisher_url: Optional[str] = None
    urls: Optional[list[LinkEntry]] = None
    isbn: Optional[str] = None
    version: Optional[str] = None
    language: Optional[str] = None
    license: Optional[str] = None
    year: Optional[int] = None
    month: Optional[int] = None
    day: Optional[int] = None
    tags: Optional[list[str]] = None
    is_explicit: Optional[bool] = None

    @field_validator("genres", mode="before")
    @classmethod
    def strip_genres(cls, v):
        if v is None:
            return v
        seen: set[str] = set()
        out: list[str] = []
        for item in v:
            s = str(item).strip()
            key = s.lower()
            if s and key not in seen:
                seen.add(key)
                out.append(s)
        return out

    @field_validator("month")
    @classmethod
    def check_month(cls, v):
        if v is not None and not (1 <= v <= 12):
            raise ValueError("month must be between 1 and 12")
        return v

    @field_validator("day")
    @classmethod
    def check_day(cls, v):
        if v is not None and not (1 <= v <= 31):
            raise ValueError("day must be between 1 and 31")
        return v


# Batch form of BookUpdate: {"items": [{"id": ..., ...BookUpdate fields}]}.
BookBulkUpdate = bulk_update_model(BookUpdate, "Book")


class MetadataSearch(BaseModel):
    """Search an installed add-on for candidates matching this book."""

    source_id: str
    # Blank means "use the book's own title", which is the common case.
    query: str = ""


class MetadataFetch(BaseModel):
    """Fetch one candidate's fields for review."""

    source_id: str
    # Empty when `paste` is supplied instead.
    identity: str = ""
    # Search-backed sources answer per query rather than serving a whole
    # catalogue, so the client echoes back the query its candidate came from.
    query: str = ""
    # A source URL or bare ID pasted by the user, used instead of `identity`
    # when they already know exactly which item they want.
    paste: str = ""

