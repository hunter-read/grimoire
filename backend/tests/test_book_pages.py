"""Page text in ``book_pages``, searched through the external-content
``book_search`` index (migration 0059, issue #751).

Covers the migration from the old self-contained FTS table - including one
interrupted part-way - the triggers that keep the index in step, and the query
plans that let per-book reads and deletes use an index instead of scanning.
"""
import importlib.util
import logging
import os
import tempfile

import pytest
from alembic import command
from sqlalchemy import create_engine, text

from backend.config import SessionLocal
from backend.models.db import _alembic_config, init_db

_BEFORE = "8b3f6d2a9c41"  # 0058, the last revision with the old book_search
_HERE = os.path.dirname(__file__)
_MIGRATION = os.path.join(_HERE, "..", "migrations", "versions", "0059_book_pages.py")

_OLD_FTS = (
    "CREATE VIRTUAL TABLE book_search USING fts5("
    "book_id UNINDEXED, page_number UNINDEXED, content, tokenize='porter unicode61')"
)

# (rowid, book_id, page_number, content) - rowids deliberately not contiguous,
# the way deletes leave them.
_ROWS = [
    (1, "b1", 1, "The goblin king rules the warrens"),
    (2, "b1", 2, "Dragons sleep beneath the mountain"),
    (5, "b2", 1, "A treatise on thaumaturgy"),
    (9, "b2", 2, "Goblins fear the light"),
    (12, "b3", 7, "Owlbears nest in the old forest"),
]


def _load_migration():
    spec = importlib.util.spec_from_file_location("_m0059", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _db_before_0059(rows=_ROWS):
    """A database at 0058 holding an old-format search index."""
    path = os.path.join(tempfile.mkdtemp(), "pre751.db")
    engine = create_engine(f"sqlite:///{path}")
    with engine.connect() as conn:
        command.upgrade(_alembic_config(conn), _BEFORE)
    with engine.begin() as conn:
        conn.execute(text(_OLD_FTS))
        for rowid, book_id, page, content in rows:
            conn.execute(
                text(
                    "INSERT INTO book_search (rowid, book_id, page_number, content) "
                    "VALUES (:r, :b, :p, :c)"
                ),
                {"r": rowid, "b": book_id, "p": page, "c": content},
            )
    engine.dispose()
    return path


def _upgrade(path):
    engine = create_engine(f"sqlite:///{path}")
    with engine.connect() as conn:
        command.upgrade(_alembic_config(conn), "head")
    engine.dispose()


def _query(path, sql, **params):
    engine = create_engine(f"sqlite:///{path}")
    try:
        with engine.connect() as conn:
            return conn.execute(text(sql), params).fetchall()
    finally:
        engine.dispose()


def _pages(path):
    return [
        tuple(r)
        for r in _query(path, "SELECT id, book_id, page_number, content FROM book_pages ORDER BY id")
    ]


def _hits(path, term):
    return sorted(
        (r[0], r[1])
        for r in _query(
            path,
            "SELECT book_id, page_number FROM book_search "
            "JOIN book_pages ON book_pages.id = book_search.rowid "
            "WHERE book_search MATCH :q",
            q=term,
        )
    )


def _tables(path):
    return {r[0] for r in _query(path, "SELECT name FROM sqlite_master WHERE type = 'table'")}


def _fts_check(path):
    """FTS5's own consistency check: raises if the index disagrees with book_pages."""
    engine = create_engine(f"sqlite:///{path}")
    try:
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO book_search (book_search) VALUES ('integrity-check')"))
    finally:
        engine.dispose()


class TestMigration:
    def test_fresh_database_gets_the_new_layout(self):
        path = os.path.join(tempfile.mkdtemp(), "fresh.db")
        init_db(path)
        tables = _tables(path)
        assert {"book_pages", "book_search"} <= tables
        assert "book_search_legacy" not in tables
        sql = _query(path, "SELECT sql FROM sqlite_master WHERE name = 'book_search'")[0][0]
        assert "content='book_pages'" in sql
        triggers = {
            r[0] for r in _query(path, "SELECT name FROM sqlite_master WHERE type = 'trigger'")
        }
        assert {"book_pages_ai", "book_pages_ad", "book_pages_au"} <= triggers

    def test_existing_index_keeps_every_row_and_rowid(self):
        path = _db_before_0059()
        _upgrade(path)
        assert _pages(path) == _ROWS
        assert "book_search_legacy" not in _tables(path)
        _fts_check(path)

    def test_converting_an_index_compacts_the_database_once(self):
        path = _db_before_0059()
        _upgrade(path)
        flag = "SELECT value FROM app_settings WHERE key = 'db_compact_pending'"
        assert _query(path, flag) == [("1",)]
        init_db(path)  # the startup VACUUM clears it
        assert _query(path, flag) == []
        assert _pages(path) == _ROWS

    def test_a_fresh_database_is_not_compacted(self):
        path = os.path.join(tempfile.mkdtemp(), "fresh.db")
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            command.upgrade(_alembic_config(conn), "head")
        engine.dispose()
        assert _query(path, "SELECT 1 FROM app_settings WHERE key = 'db_compact_pending'") == []

    def test_text_indexed_before_the_upgrade_is_still_searchable(self):
        path = _db_before_0059()
        _upgrade(path)
        # Porter stemming still applies: "goblin" finds "Goblins".
        assert _hits(path, "goblin") == [("b1", 1), ("b2", 2)]
        assert _hits(path, "thaumaturgy") == [("b2", 1)]
        snippet = _query(
            path,
            "SELECT snippet(book_search, 0, '[', ']', '...', 8) FROM book_search "
            "WHERE book_search MATCH 'owlbears'",
        )
        assert snippet == [("[Owlbears] nest in the old forest",)]

    def test_rows_without_a_book_or_page_are_left_behind(self):
        path = _db_before_0059()
        engine = create_engine(f"sqlite:///{path}")
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO book_search (rowid, book_id, page_number, content) "
                     "VALUES (20, NULL, 1, 'orphan'), (21, 'b4', NULL, 'orphan')")
            )
            conn.execute(
                text("INSERT INTO book_search (rowid, book_id, page_number, content) "
                     "VALUES (22, 'b4', 3, NULL)")
            )
        engine.dispose()
        _upgrade(path)
        assert _pages(path) == _ROWS + [(22, "b4", 3, "")]

    def test_resumes_after_an_interruption_mid_copy(self):
        """Killed after some chunks were committed: the rest are copied, none twice."""
        path = _db_before_0059()
        engine = create_engine(f"sqlite:///{path}")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE book_search RENAME TO book_search_legacy"))
            for statement in _load_migration()._SCHEMA:
                conn.execute(text(statement))
            # The first chunk landed before the process died.
            conn.execute(
                text(
                    "INSERT INTO book_pages (id, book_id, page_number, content) "
                    "SELECT rowid, book_id, page_number, content FROM book_search_legacy "
                    "WHERE rowid <= 5"
                )
            )
        engine.dispose()
        _upgrade(path)
        assert _pages(path) == _ROWS
        assert "book_search_legacy" not in _tables(path)
        assert _hits(path, "goblin") == [("b1", 1), ("b2", 2)]
        _fts_check(path)

    def test_resumes_after_an_interruption_right_after_the_rename(self):
        path = _db_before_0059()
        engine = create_engine(f"sqlite:///{path}")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE book_search RENAME TO book_search_legacy"))
        engine.dispose()
        _upgrade(path)
        assert _pages(path) == _ROWS
        _fts_check(path)

    def test_rerunning_over_the_new_layout_changes_nothing(self):
        path = _db_before_0059()
        _upgrade(path)
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            command.stamp(_alembic_config(conn), _BEFORE)
        engine.dispose()
        _upgrade(path)
        assert _pages(path) == _ROWS
        _fts_check(path)

    def test_copies_in_chunks_and_logs_progress(self, monkeypatch, caplog):
        module = _load_migration()
        monkeypatch.setattr(module, "_CHUNK", 2)
        rows = [(i, f"b{i % 7}", i, f"page {i} words") for i in range(1, 41)]
        path = _db_before_0059(rows)
        engine = create_engine(f"sqlite:///{path}")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE book_search RENAME TO book_search_legacy"))
            for statement in module._SCHEMA:
                conn.execute(text(statement))
        with caplog.at_level(logging.INFO, logger="grimoire.db"), engine.begin() as conn:
            module._copy_legacy_rows(conn)
        engine.dispose()
        assert _pages(path) == rows
        assert "Search index upgrade: 100% done." in caplog.text
        _fts_check(path)

    def test_resume_is_logged(self, caplog):
        module = _load_migration()
        path = _db_before_0059()
        engine = create_engine(f"sqlite:///{path}")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE book_search RENAME TO book_search_legacy"))
            for statement in module._SCHEMA:
                conn.execute(text(statement))
            conn.execute(
                text("INSERT INTO book_pages (id, book_id, page_number, content) "
                     "VALUES (1, 'b1', 1, 'The goblin king rules the warrens')")
            )
        with caplog.at_level(logging.INFO, logger="grimoire.db"), engine.begin() as conn:
            module._copy_legacy_rows(conn)
            # Nothing left to copy: a second pass is a no-op.
            module._copy_legacy_rows(conn)
        engine.dispose()
        assert "Resuming the search index upgrade from page row 1 of 12." in caplog.text
        assert _pages(path) == _ROWS

    def test_downgrade_restores_the_old_table(self):
        path = _db_before_0059()
        _upgrade(path)
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            command.downgrade(_alembic_config(conn), _BEFORE)
        engine.dispose()
        assert "book_pages" not in _tables(path)
        got = _query(
            path, "SELECT rowid, book_id, page_number, content FROM book_search ORDER BY rowid"
        )
        assert [tuple(r) for r in got] == _ROWS

    def test_downgrade_of_an_empty_index_leaves_no_table(self):
        path = os.path.join(tempfile.mkdtemp(), "empty.db")
        init_db(path)
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            command.downgrade(_alembic_config(conn), _BEFORE)
        engine.dispose()
        assert not {"book_pages", "book_search"} & _tables(path)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _insert(db, book_id, page, content):
    db.execute(
        text("INSERT INTO book_pages (book_id, page_number, content) VALUES (:b, :p, :c)"),
        {"b": book_id, "p": page, "c": content},
    )


def _matches(db, term):
    return {
        r[0]
        for r in db.execute(
            text(
                "SELECT book_pages.book_id FROM book_search "
                "JOIN book_pages ON book_pages.id = book_search.rowid "
                "WHERE book_search MATCH :q"
            ),
            {"q": term},
        )
    }


@pytest.mark.sqlite_only  # FTS5 triggers
class TestTriggers:
    def test_insert_delete_and_update_keep_the_index_in_step(self, db):
        _insert(db, "trig-a", 1, "quixotic basilisk")
        _insert(db, "trig-b", 1, "quixotic wyvern")
        assert {"trig-a", "trig-b"} <= _matches(db, "quixotic")

        db.execute(text("DELETE FROM book_pages WHERE book_id = 'trig-a'"))
        assert "trig-a" not in _matches(db, "quixotic")
        assert "trig-b" in _matches(db, "quixotic")

        db.execute(
            text("UPDATE book_pages SET content = 'serene manticore' WHERE book_id = 'trig-b'")
        )
        assert "trig-b" not in _matches(db, "quixotic")
        assert "trig-b" in _matches(db, "manticore")
        db.execute(text("INSERT INTO book_search (book_search) VALUES ('integrity-check')"))


def _plan(db, sql, **params):
    return " | ".join(r[3] for r in db.execute(text(f"EXPLAIN QUERY PLAN {sql}"), params))


@pytest.mark.sqlite_only  # SQLite EXPLAIN QUERY PLAN output
class TestQueryPlans:
    """None of the per-book paths scans the whole table (issue #751)."""

    INDEX = "INDEX ix_book_pages_book_page ("

    def test_page_text_read_uses_the_index(self, db):
        plan = _plan(
            db,
            "SELECT content FROM book_pages WHERE book_id = :bid AND page_number = :pnum LIMIT 1",
            bid="x",
            pnum=1,
        )
        assert self.INDEX in plan and "SCAN" not in plan

    def test_per_book_delete_uses_the_index(self, db):
        plan = _plan(db, "DELETE FROM book_pages WHERE book_id = :bid", bid="x")
        assert self.INDEX in plan and "SCAN" not in plan

    def test_chunked_delete_uses_the_index(self, db):
        plan = _plan(db, "DELETE FROM book_pages WHERE book_id IN (:a, :b)", a="x", b="y")
        assert self.INDEX in plan and "SCAN book_pages" not in plan

    def test_duplicate_fingerprint_read_uses_the_index(self, db):
        plan = _plan(
            db,
            "SELECT content FROM book_pages WHERE book_id = :bid ORDER BY page_number LIMIT 3",
            bid="x",
        )
        assert self.INDEX in plan and "SCAN" not in plan
        assert "TEMP B-TREE" not in plan

    def test_search_joins_hits_by_rowid(self, db):
        plan = _plan(
            db,
            "SELECT book_pages.book_id FROM book_search "
            "JOIN book_pages ON book_pages.id = book_search.rowid "
            "WHERE book_search MATCH :q",
            q="goblin",
        )
        assert "SCAN book_pages" not in plan


@pytest.mark.postgres_only
class TestPostgresSearchColumn:
    """book_pages.search, the generated tsvector that stands in for the FTS5 triggers."""

    def _matches(self, db, term):
        return {
            r[0]
            for r in db.execute(
                text(
                    "SELECT book_id FROM book_pages "
                    "WHERE search @@ phraseto_tsquery('grimoire', :q)"
                ),
                {"q": term},
            )
        }

    def test_insert_delete_and_update_keep_the_index_in_step(self, db):
        _insert(db, "pg-a", 1, "quixotic basilisk")
        _insert(db, "pg-b", 1, "quixotic wyvern")
        assert {"pg-a", "pg-b"} <= self._matches(db, "quixotic")
        db.execute(text("DELETE FROM book_pages WHERE book_id = 'pg-a'"))
        assert "pg-a" not in self._matches(db, "quixotic")
        db.execute(
            text("UPDATE book_pages SET content = 'serene manticore' WHERE book_id = 'pg-b'")
        )
        assert "pg-b" not in self._matches(db, "quixotic")
        assert "pg-b" in self._matches(db, "manticore")

    def test_accents_stemming_and_stopwords_match_fts5(self, db):
        _insert(db, "pg-c", 1, "The Café of Goblins")
        assert "pg-c" in self._matches(db, "cafe")  # unicode61 folds accents
        assert "pg-c" in self._matches(db, "goblin")  # porter stems
        assert "pg-c" in self._matches(db, "the")  # FTS5 has no stopwords

    def test_an_oversized_page_still_inserts(self, db):
        """Past the indexed length the text is stored but not indexed, never refused."""
        from backend.models.postgres import INDEXED_CHARS

        huge = " ".join(f"w{i}" for i in range(INDEXED_CHARS // 3))
        _insert(db, "pg-d", 1, huge + " needlexyz")
        assert db.execute(
            text("SELECT length(content) FROM book_pages WHERE book_id = 'pg-d'")
        ).scalar() > INDEXED_CHARS


@pytest.mark.postgres_only
class TestPostgresQueryPlans:
    """Per-book reads and deletes can use ix_book_pages_book_page (issue #751)."""

    def _plan(self, db, sql, **params):
        # A test table is tiny, so the planner would scan it whatever indexes
        # exist; turning sequential scans off asks whether an index *can* serve it.
        db.execute(text("SET LOCAL enable_seqscan = off"))
        return " | ".join(r[0] for r in db.execute(text(f"EXPLAIN {sql}"), params))

    def test_page_text_read_uses_the_index(self, db):
        plan = self._plan(
            db,
            "SELECT content FROM book_pages WHERE book_id = :bid AND page_number = :pnum LIMIT 1",
            bid="x",
            pnum=1,
        )
        assert "ix_book_pages_book_page" in plan and "Seq Scan" not in plan

    def test_per_book_delete_uses_the_index(self, db):
        plan = self._plan(db, "DELETE FROM book_pages WHERE book_id = :bid", bid="x")
        assert "ix_book_pages_book_page" in plan and "Seq Scan" not in plan

    def test_search_uses_the_gin_index(self, db):
        plan = self._plan(
            db,
            "SELECT book_id FROM book_pages WHERE search @@ phraseto_tsquery('grimoire', :q)",
            q="goblin",
        )
        assert "ix_book_pages_search" in plan
