"""Pydantic schemas for the books API."""
from typing import Optional

from pydantic import BaseModel, field_validator

from .._bulk_schemas import bulk_update_model
from .._json_list_coercion import coerce_link_list, coerce_str_list
from .._variant_schemas import VariantEntry


class LinkEntry(BaseModel):
    """A labeled link on a book (publisher / DriveThruRPG page, etc.)."""

    label: str = ""
    url: str = ""


# NOTE: the variant_* columns are deliberately absent from BookUpdate and
# BookBulkUpdate. bulk_service.apply_updates does a blind setattr for any field
# present in the schema, which would bypass every guard in services/variants.py
# (two-level rule, self-parenting, cycles). Variant links are set only through
# the /api/duplicates endpoints.
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


# --- Response models ---------------------------------------------------------
# `title`/`filename` are NOT NULL on the Book model; almost everything else is
# declared `default=...` rather than `nullable=False`, so NULL stays
# representable (the default applies at insert only, and rows predating a column
# migration keep NULL). Those are Optional here — a stricter declaration would
# make response_model validation raise on legacy rows.


class BookListItem(BaseModel):
    """One row of `list_books` — a deliberately smaller shape than `get_book`."""

    id: str
    title: str
    filename: str
    category: Optional[str] = None
    page_count: Optional[int] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    # Null for a book not attached to any system.
    game_system_id: Optional[str] = None
    has_thumbnail: Optional[bool] = None
    indexed: Optional[bool] = None
    index_failed: Optional[bool] = None
    # Derived comparison, so always a concrete bool.
    ocr_indexed: bool
    is_explicit: bool
    is_missing: bool
    # How many other versions collapse into this entry; 0 for most books. Drives
    # the "has other versions" badge without a per-row query.
    variant_count: int = 0


class BookListResponse(BaseModel):
    total: int
    books: list[BookListItem]


class BookSystemRef(BaseModel):
    """The book's game system, or null when it belongs to none."""

    id: str
    name: str
    slug: str


class BookDetail(BaseModel):
    """One book, as built by `core.get_book`."""

    id: str
    title: str
    filename: str
    category: Optional[str] = None
    description: Optional[str] = None
    page_count: Optional[int] = None
    file_size: Optional[int] = None
    # The handler coalesces every list field to `[]`.
    authors: list[str]
    artists: list[str]
    genres: list[str]
    publisher: Optional[str] = None
    publisher_url: Optional[str] = None
    urls: list[LinkEntry]
    # Coalesced with `or ""` by the handler.
    isbn: str
    version: str
    language: str
    license: str
    year: Optional[int] = None
    month: Optional[int] = None
    day: Optional[int] = None
    tags: list[str]
    indexed: Optional[bool] = None
    index_failed: Optional[bool] = None
    ocr_indexed: bool
    ocr_pending: bool
    ocr_dpi: Optional[int] = None
    is_missing: bool
    mime_type: Optional[str] = None
    has_thumbnail: Optional[bool] = None
    is_explicit: bool
    # Short token identifying the file's contents. The reader appends it to page
    # and thumbnail URLs so replacing the PDF on disk yields new URLs rather than
    # serving what the browser cached under the old ones (those are immutable for
    # a year). Null until the scanner has hashed the book.
    content_token: Optional[str] = None
    # Variant grouping (issues #304, #306). `variant_main_id` is the entry that
    # represents this family in listings — this book itself unless it is a
    # variant. `variants` is the full sibling list, so the reader's picker needs
    # no second request; it is empty for a book with no other versions.
    variant_parent_id: Optional[str] = None
    variant_kind: str = ""
    variant_label: str = ""
    variant_main_id: Optional[str] = None
    variants: list[VariantEntry] = []
    game_system: Optional[BookSystemRef] = None

    # These columns are free-form JSON; normalize legacy shapes rather than
    # failing the response. See `_json_list_coercion`.
    _coerce_names = field_validator("authors", "artists", "genres", mode="before")(
        coerce_str_list
    )
    _coerce_urls = field_validator("urls", mode="before")(coerce_link_list)


class StatusResponse(BaseModel):
    status: str


class ReindexResponse(BaseModel):
    status: str
    # Null when no override was passed (the global OCR_DPI default applies).
    ocr_dpi: Optional[int] = None


class TocEntry(BaseModel):
    """One PDF outline node; `children` nests the levels below it."""

    title: str
    page: int
    level: int
    children: list["TocEntry"]


TocEntry.model_rebuild()


class TocResponse(BaseModel):
    toc: list[TocEntry]


class PageTextResponse(BaseModel):
    text: str


class PageWord(BaseModel):
    """One word's bounding box, in PDF points."""

    x0: float
    y0: float
    x1: float
    y1: float
    text: str


class PageWordsResponse(BaseModel):
    width: float
    height: float
    words: list[PageWord]

