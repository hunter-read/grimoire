"""Database initialisation, Alembic migration cutover, and FTS5 setup.

Schema migrations are managed by Alembic (see ``backend/migrations/``). ``init_db``
applies them on startup: fresh databases upgrade from the baseline to head; an
existing database that predates Alembic (real tables, but no ``alembic_version``)
is brought fully current by the legacy imperative migrations one final time, then
stamped at the baseline so only genuinely new revisions run thereafter.
"""
import contextlib
import json
import logging
import os

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from .base import Base

logger = logging.getLogger("grimoire.db")

# Repo-root alembic.ini, resolved relative to this file (…/backend/models/db.py).
_ALEMBIC_INI = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "alembic.ini",
)


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
        "audio",
        "audio_folders",
    ]
    for table in tables:
        rows = conn.execute(
            text(f"SELECT rowid, tags FROM {table} WHERE tags IS NOT NULL")
        ).fetchall()
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
            except (ValueError, TypeError) as e:
                # Row holds tags that aren't valid JSON / not a list-of-strings;
                # skip it rather than aborting the whole normalization pass, but
                # log it so a corrupt row is visible instead of silently ignored.
                logger.warning(
                    "Skipping tag normalization for %s rowid=%s: %s", table, rowid, e
                )
    conn.commit()


def _apply_legacy_migrations(conn) -> None:
    """The pre-Alembic imperative migration replay.

    Runs once, only when cutting an existing pre-Alembic database over to
    Alembic, to bring its schema fully up to the baseline before it is stamped.
    Every statement swallows "already applied" errors so it is safe on a
    database at any prior version. New schema changes must be authored as
    Alembic revisions, not appended here.
    """
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
        "ALTER TABLE campaigns ADD COLUMN banner_path VARCHAR(255)",
        "ALTER TABLE campaign_members ADD COLUMN character_art_path VARCHAR(255)",
        "ALTER TABLE campaign_members ADD COLUMN character_sheet_path VARCHAR(255)",
        "ALTER TABLE campaign_members ADD COLUMN character_sheet_filename VARCHAR(255)",
        "ALTER TABLE campaign_resources ADD COLUMN gm_only BOOLEAN DEFAULT 0",
        "ALTER TABLE campaigns ADD COLUMN last_accessed_at DATETIME",
        "ALTER TABLE campaign_resources ADD COLUMN category_id VARCHAR(36)",
        "ALTER TABLE wiki_pages ADD COLUMN category_id VARCHAR(36)",
        "ALTER TABLE campaign_resources ADD COLUMN visibility VARCHAR(20) DEFAULT 'gm'",
        "ALTER TABLE campaign_resources ADD COLUMN sort_order INTEGER DEFAULT 0",
        "ALTER TABLE campaign_members ADD COLUMN character_sheet_url VARCHAR(1000)",
        "ALTER TABLE wiki_pages ADD COLUMN sort_order INTEGER DEFAULT 0",
        "ALTER TABLE wiki_pages ADD COLUMN icon VARCHAR(50)",
        "ALTER TABLE wiki_pages ADD COLUMN parent_id VARCHAR(36)",
        "ALTER TABLE campaign_categories ADD COLUMN icon VARCHAR(50)",
        "ALTER TABLE campaigns ADD COLUMN system_name VARCHAR(255)",
        "ALTER TABLE campaign_schedules ADD COLUMN enabled BOOLEAN DEFAULT 1 NOT NULL",
        "ALTER TABLE users ADD COLUMN campaign_access BOOLEAN DEFAULT 1",
        "ALTER TABLE campaigns ADD COLUMN resource_group_order JSON DEFAULT '[]'",
        "ALTER TABLE campaign_files ADD COLUMN is_image BOOLEAN DEFAULT 0",
        "ALTER TABLE users ADD COLUMN is_guest BOOLEAN DEFAULT 0",
        "ALTER TABLE campaigns ADD COLUMN guest_invites_enabled BOOLEAN DEFAULT 0",
        "ALTER TABLE campaign_members ADD COLUMN is_guest BOOLEAN DEFAULT 0",
        "ALTER TABLE campaign_members ADD COLUMN guest_code VARCHAR(10)",
        "CREATE INDEX IF NOT EXISTS ix_campaign_members_guest_code ON campaign_members(guest_code)",
        "ALTER TABLE books ADD COLUMN tags JSON DEFAULT '[]'",
        "ALTER TABLE game_systems ADD COLUMN is_system_agnostic BOOLEAN DEFAULT 0",
        "ALTER TABLE books ADD COLUMN ocr_pending BOOLEAN DEFAULT 0",
        "ALTER TABLE books ADD COLUMN ocr_pages_done INTEGER DEFAULT 0",
        "CREATE INDEX IF NOT EXISTS ix_books_ocr_pending ON books(ocr_pending)",
        "ALTER TABLE books ADD COLUMN ocr_dpi INTEGER",
    ]:
        try:
            conn.execute(text(migration))
            conn.commit()
        except OperationalError:
            # Expected on a partially-migrated DB: the column/index this
            # statement adds already exists ("duplicate column name" / "index
            # already exists"). Roll back the failed statement and move on.
            conn.rollback()

    try:
        cols = conn.execute(text("PRAGMA table_info(users)")).fetchall()
        # col tuple: (cid, name, type, notnull, dflt_value, pk)
        hp = next((c for c in cols if c[1] == "hashed_password"), None)
        if hp and hp[3]:  # notnull == 1
            conn.execute(text("PRAGMA foreign_keys=OFF"))
            conn.execute(
                text(
                    """
                    CREATE TABLE users_new (
                        id VARCHAR(36) PRIMARY KEY,
                        username VARCHAR(100) NOT NULL UNIQUE,
                        display_name VARCHAR(100),
                        email VARCHAR(254),
                        hashed_password VARCHAR(255),
                        role VARCHAR(20),
                        is_guest BOOLEAN DEFAULT 0,
                        allow_explicit BOOLEAN,
                        campaign_access BOOLEAN DEFAULT 1,
                        opds_token VARCHAR(64),
                        oidc_subject VARCHAR(255),
                        created_at DATETIME
                    )
                    """
                )
            )
            # is_guest is intentionally omitted from the column list so it takes
            # its default (0); the old table may or may not have had it yet, and
            # this rebuild runs before the ALTER that would re-add it — keeping it
            # in the new schema guarantees the column survives the rebuild.
            conn.execute(
                text(
                    """
                    INSERT INTO users_new
                        (id, username, display_name, email, hashed_password,
                         role, allow_explicit, campaign_access, opds_token,
                         oidc_subject, created_at)
                        SELECT id, username, display_name, email, hashed_password,
                               role, allow_explicit, 1, opds_token, oidc_subject,
                               created_at
                        FROM users
                    """
                )
            )
            conn.execute(text("DROP TABLE users"))
            conn.execute(text("ALTER TABLE users_new RENAME TO users"))
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users(email) WHERE email IS NOT NULL"
                )
            )
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_oidc_subject ON users(oidc_subject) WHERE oidc_subject IS NOT NULL"
                )
            )
            conn.execute(text("PRAGMA foreign_keys=ON"))
            conn.commit()
    except OperationalError as e:
        # The rebuild is guarded by the NOT NULL check above, so it only runs on
        # a DB that still needs it. A schema error here (e.g. the old table was
        # already partially rebuilt) is tolerated so the cutover can proceed, but
        # is logged rather than swallowed silently.
        conn.rollback()
        logger.warning("Legacy users-table rebuild skipped: %s", e)


def _alembic_config(connection):
    """Build an Alembic Config bound to a live connection for in-process runs."""
    from alembic.config import Config

    cfg = Config(_ALEMBIC_INI)
    # Resolve script_location relative to the repo root regardless of CWD.
    cfg.set_main_option(
        "script_location",
        os.path.join(os.path.dirname(_ALEMBIC_INI), "backend", "migrations"),
    )
    cfg.attributes["connection"] = connection
    return cfg


def _apply_migrations(engine) -> None:
    """Apply schema migrations via Alembic, handling the pre-Alembic cutover.

    - No ``alembic_version`` table but real app tables exist → a database created
      by the old imperative system: replay the legacy migrations one final time
      to reach the baseline schema, then stamp it at head (do not re-run the
      baseline, which would try to CREATE existing tables).
    - Otherwise (fresh/empty DB, or one already under Alembic) → ``upgrade head``.
    """
    from alembic import command

    insp = inspect(engine)
    tables = set(insp.get_table_names())
    has_version_table = "alembic_version" in tables
    # "Real" app tables, ignoring Alembic's own and SQLite's FTS shadow tables.
    app_tables = {
        t for t in tables if t != "alembic_version" and not t.startswith("book_search")
    }
    is_pre_alembic = not has_version_table and bool(app_tables)

    if is_pre_alembic:
        logger.info("Existing pre-Alembic database detected — cutting over to Alembic.")
        # Create any tables missing from the old DB, then replay the legacy
        # column/index migrations so the schema exactly matches the baseline
        # before we stamp it. create_all only touches missing tables. The replay
        # manages its own commits, so it runs on its own connection to avoid
        # interfering with the transaction Alembic drives.
        Base.metadata.create_all(engine)
        with engine.connect() as conn:
            _apply_legacy_migrations(conn)

    # Alembic (via env.py) begins/commits its own transaction on this connection.
    with engine.connect() as conn:
        cfg = _alembic_config(conn)
        if is_pre_alembic:
            command.stamp(cfg, "head")
        else:
            command.upgrade(cfg, "head")


def _post_migration_setup(engine) -> None:
    """One-time data fixups and FTS5 setup that run on every startup.

    Idempotent and independent of the migration path.
    """
    with engine.connect() as conn:
        # Normalize all stored tags to lowercase, deduplicating within each row.
        _normalize_tags_in_db(conn)

        # Backfill resource visibility from the legacy shared/gm_only flags. Runs
        # only on rows still at the column default; safe to repeat.
        try:
            conn.execute(
                text(
                    "UPDATE campaign_resources SET visibility='public' "
                    "WHERE visibility='gm' AND shared=1 AND COALESCE(gm_only,0)=0"
                )
            )
            conn.commit()
        except OperationalError as e:
            # Tolerated on very old databases where the legacy shared/gm_only
            # columns don't exist yet (the backfill has nothing to do); logged so
            # an unexpected failure isn't hidden.
            conn.rollback()
            logger.warning("Resource visibility backfill skipped: %s", e)

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


@contextlib.contextmanager
def _migration_lock(db_path: str):
    """Blocking cross-process lock so only one worker migrates at a time.

    Keyed on a sidecar ``<db>.migrate.lock`` file next to the database. A no-op
    for in-memory / unnamed databases (tests), and degrades to no locking if the
    platform lacks ``fcntl`` (e.g. Windows) or the lock file can't be created.
    """
    if not db_path or db_path == ":memory:":
        yield
        return
    try:
        import fcntl
    except ImportError:
        yield
        return

    lock_path = f"{db_path}.migrate.lock"
    try:
        lock_file = open(lock_path, "w")
    except OSError:
        yield
        return
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        yield
    finally:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_UN)
        finally:
            lock_file.close()


def init_db(db_path: str):
    """Initialize database and return engine + session factory.

    Applies Alembic migrations (with the pre-Alembic cutover handled by
    ``_apply_migrations``), then runs idempotent data fixups and FTS5 setup.
    """
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

    # Serialize migrations across workers: init_db runs once per process (at
    # config import), so with multiple uvicorn workers several may reach this
    # concurrently. A blocking file lock keyed on the DB lets the first worker
    # migrate while the others wait, then find the DB already at head.
    with _migration_lock(db_path):
        _apply_migrations(engine)
        _post_migration_setup(engine)

    Session = sessionmaker(bind=engine)
    return engine, Session
