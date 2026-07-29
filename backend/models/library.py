"""Library models — game systems, books, and book folders."""
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from .base import Base, _utcnow, _uuid


class GameSystem(Base):
    """A tabletop RPG game system (e.g., D&D 5e, PbtA, Fate)."""

    __tablename__ = "game_systems"

    id = Column(String(36), primary_key=True, default=_uuid)
    name = Column(String(255), unique=True, nullable=False)
    slug = Column(String(255), unique=True, nullable=False)
    description = Column(Text, default="")
    publishers = Column(JSON, default=list)
    # Legacy single-value URL column. Kept for backward compatibility; new code
    # reads/writes the multi-value ``character_builder_urls`` list instead.
    character_builder_url = Column(String(512), default="")
    # Admin-uploaded cover: bare filename stored under DATA_PATH/system_covers/.
    cover_image = Column(String(512), default="")
    # Library-relative path to a cover.*/folder.* image found at the system's
    # folder root by the scanner. Takes precedence over the uploaded cover_image,
    # which in turn beats the cover_book_id fallback.
    folder_cover_path = Column(String(1000), default="")
    cover_book_id = Column(String(36), nullable=True)
    # Legacy single-value genre column. Superseded by the ``genres`` JSON list;
    # kept so old databases keep working and the backfill has a source.
    genre = Column(String(100), default="")
    # Multi-value metadata (issue #202).
    genres = Column(JSON, default=list)
    dice_materials = Column(JSON, default=list)
    system_family = Column(String(150), default="")
    # Parent-system / edition hierarchy: a system_family (e.g. "d20 System") may
    # contain several parent_systems (e.g. "Dungeons & Dragons"), each of which
    # has editions (e.g. "5e"). ``parent_system`` + ``edition`` combine for
    # display ("Cyberpunk" + "Red" → "Cyberpunk Red").
    parent_system = Column(String(150), default="")
    edition = Column(String(80), default="")
    license = Column(String(100), default="")
    year = Column(Integer, nullable=True)
    # Labeled link lists: ``[{"label": str, "url": str}, ...]``.
    urls = Column(JSON, default=list)
    character_builder_urls = Column(JSON, default=list)
    is_explicit = Column(Boolean, default=False)
    is_system_agnostic = Column(Boolean, default=False)
    # Special "one-page / small RPG" collection, grouped with system-agnostic
    # in the library view. Set by the indexer from the folder name.
    is_one_page = Column(Boolean, default=False)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    books = relationship("Book", back_populates="game_system", cascade="all, delete-orphan")


class Book(Base):
    """A single PDF/document in the library."""

    __tablename__ = "books"

    id = Column(String(36), primary_key=True, default=_uuid)
    game_system_id = Column(String(36), ForeignKey("game_systems.id"), nullable=True, index=True)
    title = Column(String(500), nullable=False)
    filename = Column(String(500), nullable=False)
    filepath = Column(String(1000), nullable=False, unique=True)
    relative_path = Column(String(1000), nullable=False)

    category = Column(String(100), default="core", index=True)
    description = Column(Text, default="")
    authors = Column(JSON, default=list)
    artists = Column(JSON, default=list)
    publisher = Column(String(255), default="")
    # Legacy single-value URL column, superseded by the ``urls`` list. Kept for
    # backward compatibility and as the backfill source.
    publisher_url = Column(String(512), default="")
    # Labeled link list: ``[{"label": str, "url": str}, ...]``.
    urls = Column(JSON, default=list)
    # Genres (issue #202). Independent of the system's genres; a book may carry
    # its own (e.g. a grimdark D&D book tagged Horror as well as Fantasy).
    genres = Column(JSON, default=list)
    isbn = Column(String(20), default="")
    version = Column(String(50), default="")
    language = Column(String(20), default="")
    # Per-book license override. Empty means "inherit the system's license" — an
    # OGL SRD can sit inside an otherwise-proprietary system (issue: metadata).
    license = Column(String(100), default="")
    # Publication date with variable precision. ``year`` may stand alone;
    # ``month`` and/or ``day`` refine it. All nullable.
    year = Column(Integer, nullable=True)
    month = Column(Integer, nullable=True)
    day = Column(Integer, nullable=True)
    file_size = Column(Integer, default=0)
    page_count = Column(Integer, default=0)
    mime_type = Column(String(100), default="application/pdf")
    has_thumbnail = Column(Boolean, default=False)
    is_explicit = Column(Boolean, default=False)
    indexed = Column(Boolean, default=False)
    index_failed = Column(Boolean, default=False)
    index_error = Column(String(500), default="")
    scan_failed = Column(Boolean, default=False)
    is_missing = Column(Boolean, default=False)
    # OCR is deferred to a separate background phase so scanned (image-only) PDFs
    # don't block the fast text-layer indexing of the rest of the library. A book
    # with no embedded text layer is marked ocr_pending here; a dedicated OCR
    # worker drains the queue page-by-page, checkpointing ocr_pages_done so a long
    # book resumes where it left off after a restart or crash instead of losing
    # hours of work. See docs/architecture.md and backend/indexer.ocr_book_page.
    ocr_pending = Column(Boolean, default=False, index=True)
    ocr_pages_done = Column(Integer, default=0)
    # Optional per-book OCR resolution override (DPI). NULL means "use the global
    # OCR_DPI default". Set when a user re-OCRs a specific book at a higher DPI
    # for a sharper read than the library-wide default gives; persisted so the
    # override survives a restart mid-re-OCR. See indexer.ocr_book / the
    # POST /api/books/{id}/reindex endpoint.
    ocr_dpi = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (Index("ix_books_indexer_queue", "indexed", "mime_type"),)

    game_system = relationship("GameSystem", back_populates="books")


class BookFolder(Base):
    """Tags applied to a book subcategory folder path (e.g. adventure path groupings)."""

    __tablename__ = "book_folders"

    id = Column(String(36), primary_key=True, default=_uuid)
    path = Column(String(1000), nullable=False, unique=True)
    tags = Column(JSON, default=list)


class Genre(Base):
    """A curated genre value, optionally nested under a parent (tiered).

    Powers the tiered genre picker (e.g. Science Fiction → Cyberpunk). Defaults
    are seeded on migration; users may add their own via settings. ``is_default``
    marks a seeded row so the UI can distinguish it, but defaults are removable.
    """

    __tablename__ = "genres"

    id = Column(String(36), primary_key=True, default=_uuid)
    name = Column(String(120), unique=True, nullable=False)
    parent_id = Column(String(36), ForeignKey("genres.id"), nullable=True, index=True)
    is_default = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)

    parent = relationship("Genre", remote_side=[id], back_populates="children")
    children = relationship(
        "Genre", back_populates="parent", cascade="all, delete-orphan"
    )


class SystemFamily(Base):
    """A curated system-family / engine value (e.g. Powered by the Apocalypse)."""

    __tablename__ = "system_families"

    id = Column(String(36), primary_key=True, default=_uuid)
    name = Column(String(150), unique=True, nullable=False)
    is_default = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)


class ParentSystem(Base):
    """A curated parent-system value (e.g. "Dungeons & Dragons").

    The mid tier between a broad system_family ("d20 System") and a concrete
    GameSystem ("D&D 5e"). Users manage the list in settings; systems reference
    it by name via ``GameSystem.parent_system``.
    """

    __tablename__ = "parent_systems"

    id = Column(String(36), primary_key=True, default=_uuid)
    name = Column(String(150), unique=True, nullable=False)
    is_default = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)


class License(Base):
    """A curated license value (e.g. OGL 1.0a, ORC, CC-BY 4.0, Proprietary).

    Applied at the system level as a default and optionally overridden per book.
    Seeded with common TTRPG licenses; users may add their own.
    """

    __tablename__ = "licenses"

    id = Column(String(36), primary_key=True, default=_uuid)
    name = Column(String(100), unique=True, nullable=False)
    is_default = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)


class DiceMaterial(Base):
    """A curated dice / materials value (e.g. D20, Playing Cards, Tarot Cards).

    Backs the dice/materials picker on systems. Seeded from the built-in default
    groups; users may add their own via settings.
    """

    __tablename__ = "dice_materials"

    id = Column(String(36), primary_key=True, default=_uuid)
    name = Column(String(120), unique=True, nullable=False)
    # Grouping label for the picker ("Dice", "Cards", "Other", "Custom").
    group = Column(String(60), default="Custom")
    is_default = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
