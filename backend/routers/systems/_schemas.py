"""Pydantic schemas for the systems API."""
from typing import Optional

from pydantic import BaseModel, field_validator

from ...services import tag_service
from .._bulk_schemas import bulk_update_model
from .._json_list_coercion import (
    PublisherRef,
    coerce_link_list,
    coerce_publisher_list,
    coerce_str_list,
)


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


# Batch form of GameSystemUpdate: {"items": [{"id": ..., ...GameSystemUpdate fields}]}.
GameSystemBulkUpdate = bulk_update_model(GameSystemUpdate, "GameSystem")


# --- Response models ---------------------------------------------------------
# Almost every column below is declared `default=...` rather than `nullable=False`,
# so NULL stays representable (the default applies at insert only, and rows
# predating a column migration keep NULL). Those are Optional here — declaring
# them strictly would make response_model validation raise on legacy rows.


class BookOut(BaseModel):
    """One book, as built by `_serializers.serialize_book`."""

    id: str
    # `title`/`filename`/`relative_path` are NOT NULL on the model.
    title: str
    filename: str
    relative_path: str
    category: Optional[str] = None
    description: Optional[str] = None
    page_count: Optional[int] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    # The serializer coalesces every list field to `[]`.
    authors: list[str]
    artists: list[str]
    genres: list[str]
    publisher: Optional[str] = None
    publisher_url: Optional[str] = None
    urls: list[LinkEntry]
    # Coalesced with `or ""` by the serializer.
    isbn: str
    version: str
    language: str
    license: str
    year: Optional[int] = None
    month: Optional[int] = None
    day: Optional[int] = None
    indexed: Optional[bool] = None
    index_failed: Optional[bool] = None
    index_error: Optional[str] = None
    # Derived comparison, so always a concrete bool.
    ocr_indexed: bool
    ocr_dpi: Optional[int] = None
    has_thumbnail: Optional[bool] = None
    tags: list[str]
    # Both wrapped in `bool(...)` by the serializer.
    is_explicit: bool
    is_missing: bool

    # These columns are free-form JSON; normalize legacy shapes rather than
    # failing the response. See `_json_list_coercion`.
    _coerce_names = field_validator("authors", "artists", "genres", mode="before")(
        coerce_str_list
    )
    _coerce_urls = field_validator("urls", mode="before")(coerce_link_list)


class SystemSummary(BaseModel):
    """A game system, as built by `_serializers.serialize_system_summary`."""

    id: str
    # `name`/`slug` are NOT NULL on the model.
    name: str
    slug: str
    description: Optional[str] = None
    # `PublisherRef`, not the stricter request-side `PublisherEntry`: a stored
    # row may predate the current shape, and a response model must not reject it.
    publishers: list[PublisherRef]
    character_builder_url: Optional[str] = None
    character_builder_urls: list[LinkEntry]
    urls: list[LinkEntry]
    tags: list[str]
    genre: Optional[str] = None
    genres: list[str]
    dice_materials: list[str]
    # Coalesced with `or ""` by the serializer.
    system_family: str
    parent_system: str
    edition: str
    license: str
    year: Optional[int] = None
    book_count: int
    total_page_count: int
    cover_image: Optional[str] = None
    # Null for container folders, which own no books.
    cover_book_id: Optional[str] = None
    has_cover: bool
    is_explicit: bool
    is_system_agnostic: bool
    is_one_page: bool
    container_kind: str
    parent_id: Optional[str] = None
    parent_name: str
    parent_is_one_page: bool
    name_is_custom: bool
    child_count: int

    # As on `BookOut` — free-form JSON columns, normalized on the way out.
    _coerce_names = field_validator("genres", "dice_materials", mode="before")(
        coerce_str_list
    )
    _coerce_urls = field_validator("urls", "character_builder_urls", mode="before")(
        coerce_link_list
    )
    _coerce_publishers = field_validator("publishers", mode="before")(
        coerce_publisher_list
    )


class SystemDetail(SystemSummary):
    """`get_system` adds the system's books and, for a container, its children."""

    books: list[BookOut]
    children: list[SystemSummary]


class BookFolderOut(BaseModel):
    path: str
    tags: list[str]


class BookFoldersResponse(BaseModel):
    folders: list[BookFolderOut]


class StatusResponse(BaseModel):
    status: str


class SystemCoverResponse(BaseModel):
    cover_image: str
