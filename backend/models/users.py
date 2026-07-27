"""User account, bookmark, and favorite models."""
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
    UniqueConstraint,
)

from .base import Base, _utcnow, _uuid


class User(Base):
    """An authenticated user of the library."""

    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=_uuid)
    username = Column(String(100), unique=True, nullable=False)
    display_name = Column(String(100), nullable=True)
    email = Column(String(254), nullable=True, unique=True, index=True)
    hashed_password = Column(String(255), nullable=True)
    role = Column(String(20), default="player")
    # A guest is a lightweight, code-only account (no password/OIDC) scoped to a
    # single campaign they were invited to. role is also "guest"; this flag keeps
    # them out of the invitable-user pool and the user admin list.
    is_guest = Column(Boolean, default=False)
    allow_explicit = Column(Boolean, default=True)
    # Whether the user may create campaigns, be added to new campaigns, and manage
    # campaign content. Disabling it preserves existing campaigns but locks the user
    # out of all campaign writes. NULL is treated as enabled.
    campaign_access = Column(Boolean, default=True)
    opds_token = Column(String(64), nullable=True, unique=True, index=True)
    oidc_subject = Column(String(255), nullable=True, unique=True, index=True)
    created_at = Column(DateTime, default=_utcnow)


class Bookmark(Base):
    """Per-user bookmarks within a book — either a page or a text selection."""

    __tablename__ = "bookmarks"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    book_id = Column(String(36), ForeignKey("books.id"), nullable=False)
    page_number = Column(Integer, nullable=False)
    label = Column(String(255), default="")
    notes = Column(Text, default="")
    selected_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    __table_args__ = (Index("ix_bookmarks_user_book", "user_id", "book_id"),)


class Favorite(Base):
    """Per-user favorites across books, maps, and tokens."""

    __tablename__ = "favorites"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    item_type = Column(String(20), nullable=False)
    item_id = Column(String(36), nullable=False)
    created_at = Column(DateTime, default=_utcnow)

    __table_args__ = (UniqueConstraint("user_id", "item_type", "item_id"),)


class SavedFilter(Base):
    """A named, per-user saved sort/filter preset for a library scope.

    ``scope`` is one of the browsable content areas (systems/books/maps/tokens/
    audio). ``state`` holds the serialized sort/filter object the UI applies.
    At most one filter per (user, scope) may have ``is_default`` set — it is the
    view the user lands on. The (user, scope, name) uniqueness prevents dupes.
    """

    __tablename__ = "saved_filters"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    scope = Column(String(20), nullable=False)
    name = Column(String(120), nullable=False)
    state = Column(JSON, default=dict)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (UniqueConstraint("user_id", "scope", "name"),)
