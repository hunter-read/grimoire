"""Content packs and the catalog entries they carry.

A *content pack* is a directory of JSON files holding typed entries — spells,
classes, feats, kits — for one game system. A character references an entry
rather than copying it, so an erratum or a homebrew edit reaches every character
built on it.

Unlike ``character_schemas``, which are per user, **packs are server-wide**. A
schema is a small document, so a copy per account costs nothing; the 5e SRD's
spell list is not, and duplicating hundreds of entries per user would be waste
with no benefit — nobody edits an SRD entry in place. Editing happens by forking
into homebrew, which is per user and arrives in Phase 4 (#132).

Packs are installed by an admin into ``DATA_PATH/character-content/``, one
directory per pack, and loaded on startup and rescan. The directory is the
source of truth for *what is installed*; these rows are a denormalised index of
it, rebuilt from the JSON whenever it changes.
"""
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)

from .base import Base, _utcnow, _uuid


class ContentPack(Base):
    """One installed pack of catalog content, owned by the server.

    ``schema_id`` names the character schema the pack supplies content for — the
    same id a ``character_schemas`` row carries. It is deliberately not a foreign
    key: a pack is server-wide while schemas are per user, so there is no single
    row to point at, and a pack may legitimately be installed before anyone has
    installed the matching sheet.

    Licence metadata is carried per pack and surfaced in the UI. Several open
    game licences require an exact credit, so ``attribution`` is stored verbatim
    and rendered as given.
    """

    __tablename__ = "content_packs"

    id = Column(String(36), primary_key=True, default=_uuid)
    pack_id = Column(String(100), nullable=False, unique=True, index=True)
    schema_id = Column(String(100), nullable=False, index=True)
    name = Column(String(200), nullable=False, default="")
    version = Column(String(20), default="1.0.0")
    description = Column(Text, default="")

    # Where the entries came from and under what terms. Rendered verbatim.
    license = Column(String(200), default="")
    license_url = Column(Text, default="")
    attribution = Column(Text, default="")
    source_url = Column(Text, default="")

    # Directory name under DATA_PATH/character-content/, so a pack can be found
    # again without guessing at its id.
    directory = Column(String(255), default="")
    entry_count = Column(Integer, default=0)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class ContentEntry(Base):
    """One catalog entry — a spell, a class, a feat.

    ``data`` holds the entry as authored; the columns beside it are denormalised
    out of it so the catalog can sort and filter without reading every blob.
    ``name`` is whichever field the content type names as its ``identity_field``.

    ``entry_id`` is the stable id a character references, unique **per pack**:
    one pack cannot define ``fireball`` twice, but two packs for the same system
    may each supply it, and a character's ``_source`` records which it chose.
    Constraining it any more tightly would make installing a second pack for a
    system fail rather than offer a choice.
    """

    __tablename__ = "content_entries"

    id = Column(String(36), primary_key=True, default=_uuid)
    pack_id = Column(String(36), ForeignKey("content_packs.id"), nullable=False, index=True)

    schema_id = Column(String(100), nullable=False, index=True)
    content_type = Column(String(100), nullable=False, index=True)
    entry_id = Column(String(200), nullable=False)
    # Which pack this came from, as a character's `_source` records it. "srd"
    # by convention for official open content.
    source = Column(String(100), nullable=False, default="srd")

    name = Column(String(500), nullable=False, default="")
    data = Column(JSON, default=dict)

    created_at = Column(DateTime, default=_utcnow)

    __table_args__ = (
        UniqueConstraint("pack_id", "content_type", "entry_id"),
        # The catalog's main query: every entry of one type for one system.
        Index("ix_content_entries_lookup", "schema_id", "content_type"),
    )
