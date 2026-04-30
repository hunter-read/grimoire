"""Database models for Grimoire."""

import json
import uuid
import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Boolean,
    ForeignKey,
    JSON,
    UniqueConstraint,
    Index,
    create_engine,
    event,
    text,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

Base = declarative_base()

_utcnow = lambda: datetime.datetime.now(datetime.timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class GameSystem(Base):
    """A tabletop RPG game system (e.g., D&D 5e, PbtA, Fate)."""

    __tablename__ = "game_systems"

    id = Column(String(36), primary_key=True, default=_uuid)
    name = Column(String(255), unique=True, nullable=False)
    slug = Column(String(255), unique=True, nullable=False)
    description = Column(Text, default="")
    publishers = Column(JSON, default=list)
    character_builder_url = Column(String(512), default="")
    cover_image = Column(String(512), default="")
    cover_book_id = Column(String(36), nullable=True)
    tags = Column(JSON, default=list)
    genre = Column(String(100), default="")
    is_explicit = Column(Boolean, default=False)
    is_system_agnostic = Column(Boolean, default=False)

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
    publisher = Column(String(255), default="")
    publisher_url = Column(String(512), default="")
    year = Column(Integer, nullable=True)
    file_size = Column(Integer, default=0)
    page_count = Column(Integer, default=0)
    mime_type = Column(String(100), default="application/pdf")
    has_thumbnail = Column(Boolean, default=False)
    tags = Column(JSON, default=list)
    is_explicit = Column(Boolean, default=False)
    indexed = Column(Boolean, default=False)
    index_failed = Column(Boolean, default=False)
    index_error = Column(String(500), default="")
    scan_failed = Column(Boolean, default=False)
    is_missing = Column(Boolean, default=False)

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


class GenericMap(Base):
    """A generic map (not tied to a specific game system)."""

    __tablename__ = "generic_maps"

    id = Column(String(36), primary_key=True, default=_uuid)
    filename = Column(String(500), nullable=False)
    filepath = Column(String(1000), nullable=False, unique=True)
    relative_path = Column(String(1000), nullable=False)
    description = Column(Text, default="")
    tags = Column(JSON, default=list)
    map_type = Column(String(100), default="")
    grid_size = Column(String(50), default="")
    file_size = Column(Integer, default=0)
    has_thumbnail = Column(Boolean, default=False)
    is_missing = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow)


class MapFolder(Base):
    """Tags applied to a map folder path."""

    __tablename__ = "map_folders"

    id = Column(String(36), primary_key=True, default=_uuid)
    path = Column(String(1000), nullable=False, unique=True)
    tags = Column(JSON, default=list)


class Token(Base):
    """A token image (character, creature, object) for use on maps."""

    __tablename__ = "tokens"

    id = Column(String(36), primary_key=True, default=_uuid)
    filename = Column(String(500), nullable=False)
    filepath = Column(String(1000), nullable=False, unique=True)
    relative_path = Column(String(1000), nullable=False)
    description = Column(Text, default="")
    tags = Column(JSON, default=list)
    is_explicit = Column(Boolean, default=False)
    file_size = Column(Integer, default=0)
    has_thumbnail = Column(Boolean, default=False)
    is_missing = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow)


class TokenFolder(Base):
    """Tags applied to a token folder path."""

    __tablename__ = "token_folders"

    id = Column(String(36), primary_key=True, default=_uuid)
    path = Column(String(1000), nullable=False, unique=True)
    tags = Column(JSON, default=list)


class User(Base):
    """An authenticated user of the library."""

    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=_uuid)
    username = Column(String(100), unique=True, nullable=False)
    display_name = Column(String(100), nullable=True)
    email = Column(String(254), nullable=True, unique=True, index=True)
    hashed_password = Column(String(255), nullable=True)
    role = Column(String(20), default="player")
    allow_explicit = Column(Boolean, default=True)
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


class Campaign(Base):
    """A campaign — either a GM-run campaign or a player's personal campaign."""

    __tablename__ = "campaigns"

    id = Column(String(36), primary_key=True, default=_uuid)
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
    owner_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)

    is_gm_campaign = Column(Boolean, default=False)
    gm_title = Column(String(100), default="Game Master")
    parent_campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=True)
    system_id = Column(String(36), ForeignKey("game_systems.id"), nullable=True)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    members = relationship(
        "CampaignMember", back_populates="campaign", cascade="all, delete-orphan"
    )
    resources = relationship(
        "CampaignResource", back_populates="campaign", cascade="all, delete-orphan"
    )
    session_notes = relationship(
        "SessionNote",
        back_populates="campaign",
        cascade="all, delete-orphan",
        order_by="SessionNote.session_date",
    )
    schedule = relationship(
        "CampaignSchedule", back_populates="campaign", uselist=False, cascade="all, delete-orphan"
    )
    availability = relationship(
        "SessionAvailability", back_populates="campaign", cascade="all, delete-orphan"
    )


class CampaignMember(Base):
    """A player invited to (or who has joined) a GM-run campaign."""

    __tablename__ = "campaign_members"

    id = Column(String(36), primary_key=True, default=_uuid)
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    status = Column(String(20), default="invited")
    character_name = Column(String(100), nullable=True)

    created_at = Column(DateTime, default=_utcnow)

    campaign = relationship("Campaign", back_populates="members")

    __table_args__ = (UniqueConstraint("campaign_id", "user_id"),)


class CampaignResource(Base):
    """A book, map, token, or system linked to a campaign."""

    __tablename__ = "campaign_resources"

    id = Column(String(36), primary_key=True, default=_uuid)
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    resource_type = Column(String(20), nullable=False)
    resource_id = Column(String(36), nullable=False)
    shared = Column(Boolean, default=False)

    campaign = relationship("Campaign", back_populates="resources")

    __table_args__ = (UniqueConstraint("campaign_id", "resource_type", "resource_id"),)


class SessionNote(Base):
    """Notes for a single session of a campaign."""

    __tablename__ = "session_notes"

    id = Column(String(36), primary_key=True, default=_uuid)
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    session_date = Column(String(10), nullable=False)
    title = Column(String(255), default="")

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    campaign = relationship("Campaign", back_populates="session_notes")
    player_notes = relationship(
        "PlayerSessionNote", back_populates="session", cascade="all, delete-orphan"
    )
    gm_note = relationship(
        "GMSessionNote", back_populates="session", uselist=False, cascade="all, delete-orphan"
    )


class PlayerSessionNote(Base):
    """Per-player scratch pad for a session — readable by all, writable only by owner."""

    __tablename__ = "player_session_notes"

    id = Column(String(36), primary_key=True, default=_uuid)
    session_id = Column(String(36), ForeignKey("session_notes.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    content = Column(Text, default="")

    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    session = relationship("SessionNote", back_populates="player_notes")

    __table_args__ = (UniqueConstraint("session_id", "user_id"),)


class GMSessionNote(Base):
    """GM-only internal notes + shared external notes for a session."""

    __tablename__ = "gm_session_notes"

    id = Column(String(36), primary_key=True, default=_uuid)
    session_id = Column(String(36), ForeignKey("session_notes.id"), nullable=False, unique=True)
    internal_content = Column(Text, default="")
    external_content = Column(Text, default="")

    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    session = relationship("SessionNote", back_populates="gm_note")


class CampaignSchedule(Base):
    """Recurrence definition for a GM campaign's sessions."""

    __tablename__ = "campaign_schedules"

    id = Column(String(36), primary_key=True, default=_uuid)
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=False, unique=True)
    definition = Column(JSON, default=dict)

    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    campaign = relationship("Campaign", back_populates="schedule")


class SessionAvailability(Base):
    """A player's (or GM's) availability for a specific session date."""

    __tablename__ = "session_availability"

    id = Column(String(36), primary_key=True, default=_uuid)
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    session_date = Column(String(10), nullable=False)
    status = Column(String(20), default="available")
    is_cancelled = Column(Boolean, default=False)

    campaign = relationship("Campaign", back_populates="availability")

    __table_args__ = (UniqueConstraint("campaign_id", "user_id", "session_date"),)


class AppSetting(Base):
    """Application-level key-value settings persisted in the database."""

    __tablename__ = "app_settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, default="")


class Favorite(Base):
    """Per-user favorites across books, maps, and tokens."""

    __tablename__ = "favorites"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    item_type = Column(String(20), nullable=False)
    item_id = Column(String(36), nullable=False)
    created_at = Column(DateTime, default=_utcnow)

    __table_args__ = (UniqueConstraint("user_id", "item_type", "item_id"),)


def _normalize_tags_in_db(conn) -> None:
    """Lower-case and deduplicate tags in all tag-bearing tables."""
    tables = [
        "game_systems",
        "books",
        "book_folders",
        "generic_maps",
        "map_folders",
        "tokens",
        "token_folders",
    ]
    for table in tables:
        rows = conn.execute(text(f"SELECT rowid, tags FROM {table} WHERE tags IS NOT NULL")).fetchall()
        for rowid, raw in rows:
            try:
                tags = json.loads(raw) if isinstance(raw, str) else raw
                if not isinstance(tags, list):
                    continue
                seen: set[str] = set()
                normalized = []
                for t in tags:
                    lowered = str(t).strip().lower()
                    if lowered and lowered not in seen:
                        seen.add(lowered)
                        normalized.append(lowered)
                if normalized != tags:
                    conn.execute(
                        text(f"UPDATE {table} SET tags = :tags WHERE rowid = :rowid"),
                        {"tags": json.dumps(normalized), "rowid": rowid},
                    )
            except Exception:
                pass
    conn.commit()


def init_db(db_path: str):
    """Initialize database and return engine + session factory."""
    engine = create_engine(
        f"sqlite:///{db_path}",
        echo=False,
        connect_args={"timeout": 30, "check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

    Base.metadata.create_all(engine)

    with engine.connect() as conn:
        # Runtime migrations for columns added after initial release
        for migration in [
            "ALTER TABLE books ADD COLUMN index_failed BOOLEAN DEFAULT 0",
            "ALTER TABLE books ADD COLUMN scan_failed BOOLEAN DEFAULT 0",
            "ALTER TABLE books ADD COLUMN is_missing BOOLEAN DEFAULT 0",
            "ALTER TABLE generic_maps ADD COLUMN is_missing BOOLEAN DEFAULT 0",
            "ALTER TABLE tokens ADD COLUMN is_missing BOOLEAN DEFAULT 0",
            "ALTER TABLE users ADD COLUMN opds_token VARCHAR(64)",
            "ALTER TABLE users ADD COLUMN email VARCHAR(254)",
            "ALTER TABLE users ADD COLUMN oidc_subject VARCHAR(255)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users(email) WHERE email IS NOT NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_oidc_subject ON users(oidc_subject) WHERE oidc_subject IS NOT NULL",
        ]:
            try:
                conn.execute(text(migration))
                conn.commit()
            except Exception:
                pass  # Column already exists

        try:
            conn.execute(text("ALTER TABLE books ADD COLUMN tags JSON DEFAULT '[]'"))
            conn.commit()
        except Exception:
            pass  # Column already exists

        try:
            conn.execute(text("ALTER TABLE game_systems ADD COLUMN is_system_agnostic BOOLEAN DEFAULT 0"))
            conn.commit()
        except Exception:
            pass  # Column already exists

        # Normalize all stored tags to lowercase, deduplicating within each row.
        _normalize_tags_in_db(conn)

        conn.execute(
            text(
                """
            CREATE VIRTUAL TABLE IF NOT EXISTS book_search
            USING fts5(
                book_id UNINDEXED,
                page_number UNINDEXED,
                content,
                tokenize='porter unicode61'
            )
        """
            )
        )

        conn.commit()

    Session = sessionmaker(bind=engine)
    return engine, Session
