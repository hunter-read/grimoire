"""Pydantic schemas for the systems API."""
from typing import Optional

from pydantic import BaseModel, field_validator

from ...services import tag_service


class PublisherEntry(BaseModel):
    name: str
    url: str = ""


class LinkEntry(BaseModel):
    """A labeled link (generic URL or character-builder URL)."""

    label: str = ""
    url: str = ""


class BookFolderUpdate(BaseModel):
    path: str
    tags: list[str]

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        # Keep the entered casing (dedupe by key); the book-folder handler
        # registers catalog rows with this casing and stores internal keys.
        return tag_service.dedupe_tags(v)


class MetadataSearch(BaseModel):
    """Search an installed add-on for candidates matching this system."""

    source_id: str
    # Blank means "use the system's own name", which is the common case.
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


class GameSystemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    publishers: Optional[list[PublisherEntry]] = None
    # Legacy single-value URL; still accepted for backward compatibility.
    character_builder_url: Optional[str] = None
    character_builder_urls: Optional[list[LinkEntry]] = None
    urls: Optional[list[LinkEntry]] = None
    tags: Optional[list[str]] = None
    # Legacy single-value genre; still accepted. New clients send ``genres``.
    genre: Optional[str] = None
    genres: Optional[list[str]] = None
    dice_materials: Optional[list[str]] = None
    system_family: Optional[str] = None
    parent_system: Optional[str] = None
    edition: Optional[str] = None
    license: Optional[str] = None
    year: Optional[int] = None
    cover_book_id: Optional[str] = None
    is_explicit: Optional[bool] = None

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        return tag_service.dedupe_tags(v) if v is not None else v

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v):
        """``name`` is NOT NULL and is the system's identity — reject a blank rename."""
        if v is None:
            return v
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Name cannot be empty")
        return trimmed

    @field_validator("genres", "dice_materials", mode="before")
    @classmethod
    def strip_list(cls, v):
        """Trim and drop empties, preserving case (genres are display values)."""
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
