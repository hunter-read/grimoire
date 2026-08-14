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
    # Appearance for the default app mode (Grimoire). `theme_mode` is
    # light/dark/system; `theme_id` names an installed UserTheme, or is null for
    # the built-in palette. Stored per user so the choice follows them between
    # browsers and devices — the client also mirrors it to localStorage so the
    # first paint needs no round trip.
    theme_mode = Column(String(10), nullable=True)
    theme_id = Column(String(100), nullable=True)
    # The same pair for every *other* app mode, as {app_mode: {mode, theme_id}}.
    # A JSON column rather than two more columns per app mode: the list of modes
    # will grow, and Grimoire's own choice stays in its original columns so
    # nothing has to be migrated or read two ways.
    theme_by_mode = Column(JSON, default=dict)
    created_at = Column(DateTime, default=_utcnow)


class AuthSession(Base):
    """One login session, and the unit of revocation.

    Access tokens are short-lived and stateless (checked by signature and
    ``exp`` alone, so the hot path stays a pure signature check with no database
    round trip). Everything revocable hangs off this row instead: the refresh
    token is only usable while its session is live, so revoking a row kills the
    session within at most one access-token lifetime.

    ``refresh_token_hash`` stores a SHA-256 of the refresh token rather than the
    token itself — a leaked database backup then yields no usable sessions. The
    token is rotated on every refresh, so the hash changes each time.

    ``rotated_at``/``previous_token_hash`` support one-time reuse detection: if a
    refresh token that was already exchanged comes back, the session is treated
    as stolen and revoked outright rather than merely refused.
    """

    __tablename__ = "auth_sessions"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    refresh_token_hash = Column(String(64), nullable=False, unique=True, index=True)
    # The immediately-previous refresh token, kept only to recognise a replay of
    # the token this one replaced. Cleared once the session is revoked.
    previous_token_hash = Column(String(64), nullable=True, index=True)
    # How the session was created: "password", "guest", or "oidc". Shown in the
    # session list so a user can tell an SSO login from a local one.
    origin = Column(String(20), default="password")
    # Best-effort client description for the session list. Truncated on write —
    # a User-Agent is attacker-controlled and must never be stored unbounded.
    user_agent = Column(String(255), nullable=True)
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    last_used_at = Column(DateTime, default=_utcnow)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_auth_sessions_user_revoked", "user_id", "revoked_at"),)


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


class UserTheme(Base):
    """A colour theme installed by one user, for that user only.

    Themes are per-user rather than server-wide: a theme is a small map of
    colour tokens, so a copy per user costs almost nothing, and it means one
    person's taste in a shared library never changes what anyone else sees.
    That is the opposite of add-ons (global, admin-installed) and closer to wiki
    templates, which are copied per campaign.

    A theme arrives one of two ways — downloaded from a community repository or
    written/pasted in the app — and ``source_id`` / ``source_url`` record the
    first of those so a downloaded theme can be traced back and updated later.
    Both are null for a theme the user authored.

    ``tokens`` holds the ``{name: colour}`` map. It is re-validated against the
    token allowlist on the way out as well as in, so a row edited directly in
    the database still cannot inject arbitrary CSS.
    """

    __tablename__ = "user_themes"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    # Stable identifier: the community id for a downloaded theme, or a slug
    # derived from the name for an authored one. Unique per user, so installing
    # the same theme twice updates it rather than duplicating it.
    theme_id = Column(String(100), nullable=False)
    name = Column(String(120), nullable=False)
    # The theme's primary colour mode — the one it is listed under, and the one
    # applied when it ships only one.
    mode = Column(String(10), default="dark")
    # Which app mode the theme was built for (grimoire/codex). A preference the
    # picker sorts by, not a restriction — the same theme may be used in either.
    app_mode = Column(String(20), default="grimoire")
    # {colour_mode: {token: colour}}. A theme that ships both a light and a dark
    # palette is one theme, so System mode can follow the OS without the user
    # having to install and switch between two entries.
    variants = Column(JSON, default=dict)
    # The primary variant, duplicated. Rows written before `variants` existed
    # have only this, and it is what a single-mode theme applies either way.
    tokens = Column(JSON, default=dict)

    source_id = Column(String(100), nullable=True)
    source_url = Column(Text, nullable=True)
    source_version = Column(String(20), nullable=True)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (UniqueConstraint("user_id", "theme_id"),)
