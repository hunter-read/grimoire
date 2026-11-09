"""PostgreSQL support (issue #13): setup, schema, search SQL and connection rules.

The pure-function tests run everywhere; the rest need TEST_DATABASE_URL and
each makes its own scratch database, so they never touch the suite's.
"""
import datetime
import threading
import time

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect, text

from backend.models.db import (
    _PG_MIGRATION_LOCK,
    _alembic_config,
    _postgres_migration_lock,
    init_db,
    postgres_engine,
    postgres_url,
)
from backend.services import pg_search
from backend.tests._postgres import ON_POSTGRES, scratch_database


class TestPostgresUrl:
    def test_uses_the_installed_driver(self):
        assert postgres_url("postgresql://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
        assert postgres_url("postgres://u:p@h:5433/db") == "postgresql+psycopg://u:p@h:5433/db"
        assert postgres_url("postgresql+psycopg://u@h/db") == "postgresql+psycopg://u@h/db"

    @pytest.mark.parametrize("url", ["mysql://u:p@h/db", "sqlite:///grimoire.db"])
    def test_refuses_other_databases(self, url):
        with pytest.raises(ValueError, match="PostgreSQL URL"):
            postgres_url(url)


class TestTsquery:
    """to_fts_query's FTS5 grammar read back as tsquery SQL, values bound."""

    def _sql(self, query):
        params: dict = {}
        return pg_search.tsquery(query, params), params

    def test_adjacent_terms_are_and(self):
        sql, params = self._sql("goblin king")
        assert sql == (
            "((phraseto_tsquery('grimoire', :tsq0) && phraseto_tsquery('grimoire', :tsq1)))"
        )
        assert params == {"tsq0": "goblin", "tsq1": "king"}

    def test_or_binds_loosest_and_not_tightest(self):
        sql, _ = self._sql("a b OR c NOT d")
        assert sql == (
            "((phraseto_tsquery('grimoire', :tsq0) && phraseto_tsquery('grimoire', :tsq1)) || "
            "((phraseto_tsquery('grimoire', :tsq2) && !!phraseto_tsquery('grimoire', :tsq3))))"
        )

    def test_explicit_and_is_the_same_as_adjacency(self):
        assert self._sql("a AND b")[0] == self._sql("a b")[0]

    def test_phrases_and_prefixes(self):
        sql, params = self._sql('"lucky feat" fire* "say ""hi"""')
        assert "to_tsquery('grimoire', :tsq1)" in sql
        assert params == {"tsq0": "lucky feat", "tsq1": "'fire':*", "tsq2": 'say "hi"'}

    def test_a_prefix_is_only_built_from_safe_characters(self):
        _, params = self._sql('"bad\'*"')
        assert params == {"tsq0": "bad'*"}  # quoted: a phrase, not a prefix

    def test_nothing_to_search(self):
        assert self._sql("")[0] is None

    def test_catalogue_prefixes(self):
        params: dict = {}
        sql = pg_search.prefix_tsquery(["fire", "don't", "'"], params)
        assert sql == (
            "(to_tsquery('grimoire', :ptq0) && to_tsquery('grimoire', :ptq1))"
        )
        assert params == {"ptq0": "'fire':*", "ptq1": "'don''t':*"}
        assert pg_search.prefix_tsquery(["'"], {}) is None


class TestSuiteDatabase:
    """The suite runs on the database TEST_DATABASE_URL names, start to finish.

    Run anywhere, so it also pins SQLite when the variable is unset.
    """

    expected = "postgresql" if ON_POSTGRES else "sqlite"

    def test_the_app_engine_is_on_it(self):
        from backend import config

        assert config.init_database().dialect.name == self.expected

    def test_request_sessions_are_on_it(self):
        from backend.tests.conftest import _ROUTER_GET_DB

        sessions = _ROUTER_GET_DB()
        db = next(sessions)
        try:
            assert db.get_bind().dialect.name == self.expected
        finally:
            sessions.close()

    def test_reloading_config_stays_on_it(self):
        import importlib

        from backend import config

        importlib.reload(config)
        assert config.init_database().dialect.name == self.expected


@pytest.fixture(scope="module")
def url():
    """A fresh PostgreSQL database Grimoire has started on once."""
    url = scratch_database("fresh")
    init_db(url)
    return url


@pytest.mark.postgres_only
class TestFreshDatabase:
    def test_is_stamped_at_head_and_matches_the_models(self, url):
        engine = postgres_engine(url)
        with engine.connect() as conn:
            command.check(_alembic_config(conn))
            stamped = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        from alembic.script import ScriptDirectory

        with engine.connect() as conn:
            head = ScriptDirectory.from_config(_alembic_config(conn)).get_current_head()
        assert stamped == head
        engine.dispose()

    def test_has_the_seed_rows_sqlite_gets_from_migrations(self, url):
        engine = postgres_engine(url)
        with engine.connect() as conn:
            counts = {
                t: conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
                for t in ("genres", "system_families", "licenses", "dice_materials")
            }
            subgenres = conn.execute(
                text("SELECT COUNT(*) FROM genres WHERE parent_id IS NOT NULL")
            ).scalar()
            defaults = conn.execute(
                text("SELECT bool_and(is_default) FROM licenses")
            ).scalar()
        engine.dispose()
        from backend.migrations._frozen import lookup_defaults as d

        assert counts["licenses"] == len(d.DEFAULT_LICENSES)
        assert counts["system_families"] == len(d.DEFAULT_SYSTEM_FAMILIES)
        assert counts["dice_materials"] == len(d.DEFAULT_DICE_MATERIALS)
        assert counts["genres"] == len(d.DEFAULT_GENRES) + subgenres
        assert defaults is True

    def test_starting_again_changes_nothing(self, url):
        engine = postgres_engine(url)
        with engine.connect() as conn:
            before = conn.execute(text("SELECT COUNT(*) FROM genres")).scalar()
        init_db(url)
        with engine.connect() as conn:
            assert conn.execute(text("SELECT COUNT(*) FROM genres")).scalar() == before
        engine.dispose()

    def test_sessions_run_in_utc_and_drop_nul(self, url):
        engine = postgres_engine(url)
        with engine.connect() as conn:
            assert conn.execute(text("SHOW timezone")).scalar() == "UTC"
            assert conn.execute(text("SHOW lock_timeout")).scalar() == "30s"
            assert conn.execute(text("SELECT :v"), {"v": "a\x00b"}).scalar() == "ab"
            # A plain string still reaches a json column: sent untyped, cast there.
            conn.execute(text("CREATE TEMP TABLE j (v json)"))
            conn.execute(text("INSERT INTO j VALUES (:v)"), {"v": '["a\x00b"]'})
            assert conn.execute(text("SELECT v FROM j")).scalar() == ["ab"]
            aware = datetime.datetime(2026, 1, 2, 3, 4, tzinfo=datetime.timezone.utc)
            conn.execute(text("CREATE TEMP TABLE t (at timestamp)"))
            conn.execute(text("INSERT INTO t VALUES (:at)"), {"at": aware})
            assert conn.execute(text("SELECT at FROM t")).scalar() == aware.replace(tzinfo=None)
        engine.dispose()

    def test_long_values_fit_as_they_do_on_sqlite(self, url):
        engine = postgres_engine(url)
        with engine.connect() as conn:
            columns = {c["name"]: c for c in inspect(conn).get_columns("books")}
            assert getattr(columns["isbn"]["type"], "length", None) is None
            assert columns["folder_path"]["type"].collation == "C"
            assert columns["file_size"]["type"].__class__.__name__ == "BIGINT"
        engine.dispose()

    def test_snippets_mark_cuts_like_fts5(self, url):
        engine = postgres_engine(url)
        long_page = " ".join(["filler"] * 80) + " basilisk " + " ".join(["filler"] * 80)
        with engine.connect() as conn:
            conn.execute(
                text("INSERT INTO book_pages (book_id, page_number, content) VALUES "
                     "('s1', 1, :long), ('s2', 1, 'A <b>basilisk</b> sleeps'), "
                     "('s3', 1, :ocr)"),
                {"long": long_page, "ocr": "SCANNED\n\nThe basilisk turns to stone.\n"},
            )
            params: dict = {}
            q = pg_search.tsquery("basilisk", params)
            head = pg_search.headline_sql("book_pages.content", "q.q")
            rows = dict(conn.execute(
                text(f"WITH q AS (SELECT {q} AS q) SELECT book_id, {head} "
                     "FROM book_pages, q WHERE book_id IN ('s1', 's2', 's3') ORDER BY book_id"),
                params,
            ).all())
            conn.rollback()
        engine.dispose()
        assert rows["s1"].startswith("...") and rows["s1"].endswith("...")
        assert "basilisk" in rows["s1"]
        # The whole page fits: no ellipsis, and tag-like text survives.
        assert rows["s2"] == "A <b>basilisk</b> sleeps"
        # A page ending in a newline (as OCR'd text does) is not "cut" there.
        assert rows["s3"] == "SCANNED\n\nThe \ue000basilisk\ue001 turns to stone."


@pytest.mark.postgres_only
def test_refuses_a_database_with_foreign_grimoire_tables():
    url = scratch_database("foreign")
    engine = create_engine(postgres_url(url))
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE books (id text)"))
    engine.dispose()
    with pytest.raises(RuntimeError, match="no migration record"):
        init_db(url)


@pytest.mark.postgres_only
def test_migrations_wait_for_each_other():
    """The advisory lock: a second process waits rather than migrating alongside."""
    url = scratch_database("lock")
    engine = postgres_engine(url)
    order = []

    def second():
        with _postgres_migration_lock(engine):
            order.append("second")

    with _postgres_migration_lock(engine):
        thread = threading.Thread(target=second)
        thread.start()
        time.sleep(0.3)
        order.append("first")
    thread.join(5)
    with engine.connect() as conn:
        # Released, and the pooled connection is back to the 30 s timeout.
        assert conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"), {"k": _PG_MIGRATION_LOCK}
        ).scalar()
        conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _PG_MIGRATION_LOCK})
    engine.dispose()
    assert order == ["first", "second"]
