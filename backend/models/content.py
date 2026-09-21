"""Content packs and the catalog entries they carry.

A *content pack* is a directory of JSON files holding typed entries — spells,
classes, feats, kits — for one game system. A character references an entry
rather than copying it, so an erratum or a ruleset edit reaches every character
built on it.

Unlike ``character_schemas``, which are per user, **packs are server-wide**. A
schema is a small document, so a copy per account costs nothing; the 5e SRD's
spell list is not, and duplicating hundreds of entries per user would be waste
with no benefit — nobody edits an SRD entry in place. Editing happens by
importing a pack into a *ruleset*, or forking one entry into it, which is what
scopes content to a table rather than to the server.

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

from sqlalchemy.orm import relationship

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


class Ruleset(Base):
    """A named set of catalog entries — an SRD, a supplement, a table's house rules.

    A ruleset is what a campaign actually plays with. It holds the same data a
    filesystem content pack does, validated against the same content types and
    rendered by the same components; what differs is where it lives and who it
    reaches.

    Two kinds, decided by ``campaign_id``:

    * **campaign** — owned by one campaign. Everyone at that table can read it,
      and the GM who owns the campaign can edit it. This is what makes "these
      two games run the same system with different content" expressible:
      a ruleset belongs to a table, not to the server and not to a person.
    * **server** — ``campaign_id`` is null. Installed once by an admin and
      available in every game, which is what core rules want to be.

    ``source_pack_id`` records the filesystem pack a ruleset was imported from,
    so an SRD imported into a campaign can be told from one typed by hand.
    """

    __tablename__ = "rulesets"

    id = Column(String(36), primary_key=True, default=_uuid)
    # Null for a server ruleset. A campaign ruleset is deleted with its
    # campaign: the content existed to serve that table.
    campaign_id = Column(
        String(36), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=True, index=True
    )
    schema_id = Column(String(100), nullable=False, index=True)

    name = Column(String(200), nullable=False, default="")
    description = Column(Text, default="")
    version = Column(String(20), default="1.0.0")

    # Licence metadata, rendered verbatim wherever the ruleset's content is
    # surfaced. Several open licences mandate exact wording.
    license = Column(String(200), default="")
    license_url = Column(Text, default="")
    attribution = Column(Text, default="")

    # The filesystem pack this was imported from, when it was.
    source_pack_id = Column(String(100), nullable=True)
    created_by_id = Column(String(36), ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    entries = relationship(
        "RulesetEntry", back_populates="ruleset", cascade="all, delete-orphan"
    )


class RulesetEntry(Base):
    """One entry in a ruleset — a spell, a class, a feat.

    The same shape as a ``ContentEntry``, so the catalog, the character sheet
    and the formula language treat the two identically. What a ruleset adds is
    that its entries are editable and scoped to a table.
    """

    __tablename__ = "ruleset_entries"

    id = Column(String(36), primary_key=True, default=_uuid)
    ruleset_id = Column(
        String(36), ForeignKey("rulesets.id", ondelete="CASCADE"), nullable=False, index=True
    )

    schema_id = Column(String(100), nullable=False, index=True)
    content_type = Column(String(100), nullable=False, index=True)
    entry_id = Column(String(200), nullable=False)

    name = Column(String(500), nullable=False, default="")
    data = Column(JSON, default=dict)

    # The entry this was copied from, as "<source>:<entry_id>", so a variant
    # can be traced back to the SRD entry it started as.
    forked_from = Column(String(300), nullable=True)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    ruleset = relationship("Ruleset", back_populates="entries")

    __table_args__ = (
        # One ruleset cannot define the same entry twice; two rulesets may each
        # carry their own "fireball", which is the point of scoping them.
        UniqueConstraint("ruleset_id", "content_type", "entry_id"),
        Index("ix_ruleset_entries_lookup", "schema_id", "content_type"),
    )
