"""book_pages: page text in a real table, searched through external-content FTS

``book_search`` used to hold each page's ``book_id``, ``page_number`` and text
itself, as an FTS5 table with ``book_id UNINDEXED``. FTS5 can only look a row up
by ``MATCH`` or by rowid, so every ``WHERE book_id = ?`` without a ``MATCH`` - the
reader's page text, re-indexing a book, deleting one - read the whole table. On a
large library that is a second or more per lookup.

The text now lives in ``book_pages``, an ordinary table indexed on
``(book_id, page_number)``. ``book_search`` becomes an external-content FTS5
index over ``book_pages.content`` (``content_rowid='id'``), kept in step by
triggers on ``book_pages``, so search, ``snippet()`` and ``highlight()`` work as
before and per-book reads and deletes use the index. Writers insert into and
delete from ``book_pages`` only; the FTS table is never written directly.

An existing index is converted in place and keeps every row's rowid, so books
indexed before the upgrade stay searchable without being re-indexed. On a large
library this takes minutes and briefly needs about twice the disk space. It is
safe to stop part-way: the old table is renamed to ``book_search_legacy`` first,
its rows are copied in rowid order in committed chunks, and a restart resumes
after the last chunk copied. The old table is dropped only once every row is
across, and startup then compacts the database once to return its space.

Revision ID: 6e92be54a9d4
Revises: 8b3f6d2a9c41
Create Date: 2026-11-06 00:00:00.000000+00:00

"""
import logging
from typing import Optional, Sequence, Union

from alembic import op
from sqlalchemy import text
from sqlalchemy.engine import Connection


revision: str = "6e92be54a9d4"
down_revision: Union[str, None] = "8b3f6d2a9c41"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("grimoire.db")

LEGACY = "book_search_legacy"
# Rows per committed copy step. Each step is one statement, so it lands whole or
# not at all; small enough to keep the WAL in check, large enough that the FTS
# index is not flushed thousands of times.
_CHUNK = 10_000

_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS book_pages (
        id INTEGER PRIMARY KEY,
        book_id TEXT NOT NULL,
        page_number INTEGER NOT NULL,
        content TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_book_pages_book_page ON book_pages (book_id, page_number)",
    """
    CREATE VIRTUAL TABLE IF NOT EXISTS book_search
    USING fts5(
        content,
        content='book_pages',
        content_rowid='id',
        tokenize='porter unicode61'
    )
    """,
    # External content: FTS5 keeps no copy of the text, so it must be told the
    # old values to remove a row from its index.
    """
    CREATE TRIGGER IF NOT EXISTS book_pages_ai AFTER INSERT ON book_pages BEGIN
        INSERT INTO book_search (rowid, content) VALUES (new.id, new.content);
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS book_pages_ad AFTER DELETE ON book_pages BEGIN
        INSERT INTO book_search (book_search, rowid, content)
        VALUES ('delete', old.id, old.content);
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS book_pages_au AFTER UPDATE ON book_pages BEGIN
        INSERT INTO book_search (book_search, rowid, content)
        VALUES ('delete', old.id, old.content);
        INSERT INTO book_search (rowid, content) VALUES (new.id, new.content);
    END
    """,
)


def _table_sql(bind: Connection, name: str) -> Optional[str]:
    row = bind.execute(
        text("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = :n"), {"n": name}
    ).first()
    return row[0] if row else None


def _copy_legacy_rows(bind: Connection) -> None:
    """Copy ``book_search_legacy`` into ``book_pages`` in rowid order, resumably."""
    last = bind.execute(text("SELECT COALESCE(MAX(id), 0) FROM book_pages")).scalar() or 0
    top = bind.execute(
        text(f"SELECT rowid FROM {LEGACY} ORDER BY rowid DESC LIMIT 1")
    ).scalar()
    if top is None or last >= top:
        return
    if last:
        logger.info("Resuming the search index upgrade from page row %d of %d.", last, top)
    else:
        logger.info(
            "Upgrading the search index (%d page rows). On a large library this takes "
            "a few minutes; it resumes where it left off if interrupted.",
            top,
        )
    logged = 0
    while last < top:
        upper = last + _CHUNK
        # Rows missing a book or page number could never be shown; they are
        # left behind with the old table rather than failing the upgrade.
        bind.execute(
            text(
                "INSERT INTO book_pages (id, book_id, page_number, content) "
                f"SELECT rowid, book_id, CAST(page_number AS INTEGER), COALESCE(content, '') "
                f"FROM {LEGACY} WHERE rowid > :lo AND rowid <= :hi "
                "AND book_id IS NOT NULL AND page_number IS NOT NULL"
            ),
            {"lo": last, "hi": upper},
        )
        last = upper
        percent = min(100, last * 100 // top)
        if percent >= logged + 10:
            logged = percent - percent % 10
            logger.info("Search index upgrade: %d%% done.", logged)


def upgrade() -> None:
    bind = op.get_bind()
    current = _table_sql(bind, "book_search")
    if current is not None and "book_pages" not in current:
        # The old self-contained table. Renamed rather than read in place so the
        # new one can take its name, and so a restart can tell a copy still in
        # progress (the legacy table exists) from one never started.
        if _table_sql(bind, LEGACY) is None:
            op.execute(f"ALTER TABLE book_search RENAME TO {LEGACY}")

    for statement in _SCHEMA:
        op.execute(statement)

    if _table_sql(bind, LEGACY) is None:
        return
    # Commit each chunk as it goes, so an interrupted upgrade keeps its progress.
    with op.get_context().autocommit_block():
        _copy_legacy_rows(bind)
        # Dropping the old table leaves its pages as free space inside the file -
        # about as much again as the text itself - so startup VACUUMs once to give
        # it back (``_compact_if_pending`` in backend/models/db.py). Flagged before
        # the drop, so a restart between the two still compacts.
        op.execute(
            text("INSERT OR REPLACE INTO app_settings (key, value) VALUES (:k, '1')").bindparams(
                k="db_compact_pending"
            )
        )
        op.execute(f"DROP TABLE {LEGACY}")
    logger.info("Search index upgrade finished.")


def downgrade() -> None:
    bind = op.get_bind()
    for trigger in ("book_pages_ai", "book_pages_ad", "book_pages_au"):
        op.execute(f"DROP TRIGGER IF EXISTS {trigger}")
    op.execute("DROP TABLE IF EXISTS book_search")
    if _table_sql(bind, "book_pages") is None:
        return
    # Before this revision book_search was created at startup, not by a
    # migration, so it is only rebuilt here when there is page text to keep.
    has_rows = bind.execute(text("SELECT 1 FROM book_pages LIMIT 1")).first() is not None
    if has_rows:
        op.execute(
            """
            CREATE VIRTUAL TABLE book_search
            USING fts5(
                book_id UNINDEXED,
                page_number UNINDEXED,
                content,
                tokenize='porter unicode61'
            )
            """
        )
        op.execute(
            "INSERT INTO book_search (rowid, book_id, page_number, content) "
            "SELECT id, book_id, page_number, content FROM book_pages"
        )
    op.execute("DROP TABLE book_pages")
