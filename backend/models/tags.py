"""Shared cross-resource tags (issue #235).

Tags are application-wide: a single tag can be attached to a system, book, map,
token, or audio track. Each :class:`Tag` has an immutable lowercased ``internal``
key used for matching/deduplication and a human-facing ``display`` value (the
casing the user first entered, editable on the tags page). :class:`ResourceTag`
is the polymorphic join between a tag and a tagged resource.
"""
import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow, _uuid
from .collections import SINGULARS

# Resource kinds a tag can be attached to. Kept in sync with the tag service and
# the /api/tags router; mirrors the favorites VALID_TYPES set.
RESOURCE_TYPES = frozenset({"system", *SINGULARS})

# A tag belongs to exactly one category: the resource type it was created in, or
# ``shared`` once it is used across more than one type (see tag_service).
SHARED_CATEGORY = "shared"
TAG_CATEGORIES = frozenset(RESOURCE_TYPES | {SHARED_CATEGORY})


class Tag(Base):
    """An application-wide tag: an internal match key plus a display label."""

    __tablename__ = "tags"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # Lowercased, stripped match key — unique and immutable once created.
    internal: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    # Human-facing label; defaults to the first casing entered, editable later.
    display: Mapped[str] = mapped_column(String(200), nullable=False)
    # The tag's category: a single resource type, or ``shared`` when used across
    # more than one. Set on creation to the first category it's used in.
    category: Mapped[str] = mapped_column(String(20), nullable=False, default=SHARED_CATEGORY)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)


class ResourceTag(Base):
    """Polymorphic link between a :class:`Tag` and a tagged resource row."""

    __tablename__ = "resource_tags"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tag_id: Mapped[str] = mapped_column(String(36), ForeignKey("tags.id", ondelete="CASCADE"), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)  # system | book | map | token | audio
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)

    __table_args__ = (
        # A tag applies to a given resource at most once.
        UniqueConstraint("tag_id", "resource_type", "resource_id", name="uq_resource_tag"),
        # Fast lookup of "all tags for this resource".
        Index("ix_resource_tags_resource", "resource_type", "resource_id"),
        # Fast lookup of "all resources for this tag".
        Index("ix_resource_tags_tag", "tag_id"),
        # Per-type tag lookups, covering (issue #221): counting a type's live
        # links per tag, and a tag filter's "items of this type carrying one of
        # these tags", both read only this index.
        Index("ix_resource_tags_type_tag", "resource_type", "tag_id", "resource_id"),
    )
