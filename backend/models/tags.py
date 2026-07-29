"""Shared cross-resource tags (issue #235).

Tags are application-wide: a single tag can be attached to a system, book, map,
token, or audio track. Each :class:`Tag` has an immutable lowercased ``internal``
key used for matching/deduplication and a human-facing ``display`` value (the
casing the user first entered, editable on the tags page). :class:`ResourceTag`
is the polymorphic join between a tag and a tagged resource.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Index, String, UniqueConstraint

from .base import Base, _utcnow, _uuid

# Resource kinds a tag can be attached to. Kept in sync with the tag service and
# the /api/tags router; mirrors the favorites VALID_TYPES set.
RESOURCE_TYPES = frozenset({"system", "book", "map", "token", "audio"})

# A tag belongs to exactly one category: the resource type it was created in, or
# ``shared`` once it is used across more than one type (see tag_service).
SHARED_CATEGORY = "shared"
TAG_CATEGORIES = frozenset(RESOURCE_TYPES | {SHARED_CATEGORY})


class Tag(Base):
    """An application-wide tag: an internal match key plus a display label."""

    __tablename__ = "tags"

    id = Column(String(36), primary_key=True, default=_uuid)
    # Lowercased, stripped match key — unique and immutable once created.
    internal = Column(String(200), nullable=False, unique=True)
    # Human-facing label; defaults to the first casing entered, editable later.
    display = Column(String(200), nullable=False)
    # The tag's category: a single resource type, or ``shared`` when used across
    # more than one. Set on creation to the first category it's used in.
    category = Column(String(20), nullable=False, default=SHARED_CATEGORY)
    created_at = Column(DateTime, default=_utcnow)


class ResourceTag(Base):
    """Polymorphic link between a :class:`Tag` and a tagged resource row."""

    __tablename__ = "resource_tags"

    id = Column(String(36), primary_key=True, default=_uuid)
    tag_id = Column(String(36), ForeignKey("tags.id", ondelete="CASCADE"), nullable=False)
    resource_type = Column(String(20), nullable=False)  # system | book | map | token | audio
    resource_id = Column(String(36), nullable=False)
    created_at = Column(DateTime, default=_utcnow)

    __table_args__ = (
        # A tag applies to a given resource at most once.
        UniqueConstraint("tag_id", "resource_type", "resource_id", name="uq_resource_tag"),
        # Fast lookup of "all tags for this resource".
        Index("ix_resource_tags_resource", "resource_type", "resource_id"),
        # Fast lookup of "all resources for this tag".
        Index("ix_resource_tags_tag", "tag_id"),
    )
