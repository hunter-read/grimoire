"""The SQLite → PostgreSQL migration command (backend/scripts/sqlite_to_postgres.py)."""
import datetime
import hashlib
import json
import os
import sqlite3
import tempfile

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.models import AppSetting, Book, Campaign, GameSystem, Genre, User, WikiPage
from backend.models.db import init_db, postgres_engine
from backend.scripts import sqlite_to_postgres as mig
from backend.tests._postgres import scratch_database


def _digest(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _sqlite_install():
    """A migrated SQLite database holding a little of everything."""
    path = os.path.join(tempfile.mkdtemp(), "grimoire.db")
    engine, _ = init_db(path)
    with Session(engine) as db:
        system = GameSystem(name="Dragons & Dungeons", slug="dnd", genres=["fantasy", "classic"])
        db.add(system)
        db.flush()
        book = Book(
            game_system_id=system.id,
            title="Ünïcødé Grimoire " + "x" * 700,  # past String(500): SQLite never minded
            filename="tome.pdf",
            filepath="/lib/books/dnd/core/tome.pdf",
            relative_path="books/dnd/core/tome.pdf",
            category="core",
            indexed=True,
            is_explicit=False,
            genres=["horror"],
            urls=[{"label": "Store", "url": "https://example.com"}],
            file_size=3 * 1024**3,  # 3 GiB: past a 32-bit INTEGER
            year=2024,
        )
        db.add(book)
        user = User(username="Straße", role="admin")
        db.add(user)
        db.flush()
        campaign = Campaign(
            name="Curse", owner_id=user.id, created_at=datetime.datetime(2026, 1, 2, 3, 4, 5)
        )
        db.add(campaign)
        db.flush()
        # Rows that point at rows of their own table, written child first so a
        # copy in rowid order meets the child before its parent.
        child = WikiPage(campaign_id=campaign.id, title="Child", slug="child", body="c")
        db.add(child)
        db.flush()
        parent = WikiPage(campaign_id=campaign.id, title="Parent", slug="parent", body="p")
        db.add(parent)
        db.flush()
        child.parent_id = parent.id
        sub_genre = Genre(name="Zz Sub")
        db.add(sub_genre)
        db.flush()
        top_genre = Genre(name="Zz Top")
        db.add(top_genre)
        db.flush()
        sub_genre.parent_id = top_genre.id
        db.add(Campaign(name="Arc", owner_id=user.id, parent_campaign_id=campaign.id))
        db.add(AppSetting(key="db_compact_pending", value="1"))
        db.add(AppSetting(key="site_name", value=json.dumps({"name": "Grimoire"})))
        db.commit()
        book_id = book.id
    with engine.begin() as conn:
        for page, words in enumerate(["goblin warrens", "the café of goblins", "basilisk"], 1):
            conn.execute(
                text("INSERT INTO book_pages (book_id, page_number, content) VALUES (:b, :p, :c)"),
                {"b": book_id, "p": page, "c": words},
            )
        conn.execute(
            text(
                "INSERT INTO content_search (entry_row, pack_row, schema_id, content_type, name, body) "
                "VALUES ('e1', 'p1', 'dnd5e', 'spell', 'Fireball', 'a bright streak')"
            )
        )
    engine.dispose()
    return path, book_id


@pytest.fixture(scope="module")
def migrated():
    """One SQLite install migrated: (source, its digest before, url, counts, book id)."""
    source, book_id = _sqlite_install()
    before = _digest(source)
    url = scratch_database("migrate")
    counts = mig.migrate(source, url)
    return source, before, url, counts, book_id


@pytest.mark.postgres_only
class TestMigrate:
    def test_copies_and_verifies_every_table(self, migrated):
        _, _, _, counts, _ = migrated
        assert counts["books"] == 1
        assert counts["users"] == 1
        assert counts["book_pages"] == 3
        assert counts["content_search"] == 1
        assert counts["genres"] > 0  # the install's own lookup rows, not fresh seeds

    def test_leaves_the_sqlite_file_untouched(self, migrated):
        source, before, *_ = migrated
        assert _digest(source) == before

    def test_values_survive_the_move(self, migrated):
        _, _, url, _, book_id = migrated
        engine = postgres_engine(url)
        with Session(engine) as db:
            book = db.get(Book, book_id)
            assert book.title.startswith("Ünïcødé Grimoire") and len(book.title) > 700
            assert book.indexed is True and book.is_explicit is False
            assert book.genres == ["horror"]
            assert book.urls == [{"label": "Store", "url": "https://example.com"}]
            assert book.file_size == 3 * 1024**3
            user = db.query(User).one()
            assert user.username_folded == "strasse"
            campaign = db.query(Campaign).filter_by(name="Curse").one()
            assert campaign.created_at == datetime.datetime(2026, 1, 2, 3, 4, 5)
            # Links to rows of the same table were filled in after the copy.
            pages = {p.title: p for p in db.query(WikiPage)}
            assert pages["Child"].parent_id == pages["Parent"].id
            genres = {g.name: g for g in db.query(Genre)}
            assert genres["Zz Sub"].parent_id == genres["Zz Top"].id
            arc = db.query(Campaign).filter_by(name="Arc").one()
            assert arc.parent_campaign_id == campaign.id
            keys = {s.key for s in db.query(AppSetting)}
            assert "site_name" in keys
            # Describes the SQLite file, meaningless on PostgreSQL.
            assert "db_compact_pending" not in keys
        engine.dispose()

    def test_search_works_on_the_copied_text(self, migrated):
        _, _, url, _, book_id = migrated
        engine = postgres_engine(url)
        with engine.connect() as conn:
            hits = conn.execute(
                text(
                    "SELECT page_number FROM book_pages "
                    "WHERE search @@ phraseto_tsquery('grimoire', 'cafe') ORDER BY page_number"
                )
            ).scalars().all()
            catalogue = conn.execute(
                text(
                    "SELECT entry_row FROM content_search "
                    "WHERE search @@ to_tsquery('grimoire', '''fire'':*')"
                )
            ).scalars().all()
        engine.dispose()
        assert hits == [2]
        assert catalogue == ["e1"]

    def test_new_rows_do_not_collide_with_copied_ids(self, migrated):
        _, _, url, _, book_id = migrated
        engine = postgres_engine(url)
        with engine.begin() as conn:
            new_id = conn.execute(
                text(
                    "INSERT INTO book_pages (book_id, page_number, content) "
                    "VALUES (:b, 4, 'new page') RETURNING id"
                ),
                {"b": book_id},
            ).scalar()
            assert new_id > conn.execute(text("SELECT MAX(id) FROM book_pages WHERE page_number < 4")).scalar()
            conn.execute(text("DELETE FROM book_pages WHERE id = :i"), {"i": new_id})
        engine.dispose()

    def test_grimoire_starts_on_the_result(self, migrated):
        _, _, url, _, _ = migrated
        engine, _ = init_db(url)  # stamped at head: nothing left to create or migrate
        with engine.connect() as conn:
            assert conn.execute(text("SELECT COUNT(*) FROM books")).scalar() == 1
        engine.dispose()


@pytest.mark.postgres_only
def test_refuses_a_database_that_is_not_empty():
    source, _ = _sqlite_install()
    url = scratch_database("busy")
    engine = postgres_engine(url)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE notes (id int)"))
    with pytest.raises(mig.MigrationError, match="not empty"):
        mig.migrate(source, url)
    with engine.connect() as conn:
        # Nothing was added next to it.
        assert conn.execute(
            text("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")
        ).scalar() == 1
    engine.dispose()


@pytest.mark.postgres_only
def test_an_older_sqlite_database_is_upgraded_on_the_way(tmp_path):
    """A database from before #751 (the old self-contained FTS table) still moves across."""
    from alembic import command

    from backend.models.db import _alembic_config
    from sqlalchemy import create_engine

    path = str(tmp_path / "old.db")
    engine = create_engine(f"sqlite:///{path}")
    with engine.connect() as conn:
        command.upgrade(_alembic_config(conn), "8b3f6d2a9c41")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE VIRTUAL TABLE book_search USING fts5("
                "book_id UNINDEXED, page_number UNINDEXED, content, tokenize='porter unicode61')"
            )
        )
        conn.execute(
            text("INSERT INTO book_search (rowid, book_id, page_number, content) "
                 "VALUES (7, 'b1', 1, 'ancient owlbear')")
        )
    engine.dispose()
    before = _digest(path)
    url = scratch_database("older")
    counts = mig.migrate(path, url)
    assert counts["book_pages"] == 1
    assert _digest(path) == before
    target = postgres_engine(url)
    with target.connect() as conn:
        row = conn.execute(text("SELECT id, book_id, content FROM book_pages")).one()
    target.dispose()
    assert tuple(row) == (7, "b1", "ancient owlbear")


@pytest.mark.postgres_only
def test_verify_catches_a_difference():
    source, _ = _sqlite_install()
    url = scratch_database("verify")
    mig.migrate(source, url)
    target = postgres_engine(url)
    with target.begin() as conn:
        conn.execute(text("UPDATE book_pages SET content = 'tampered' WHERE page_number = 1"))
    copy = os.path.join(tempfile.mkdtemp(), "copy.db")
    mig.snapshot_sqlite(source, copy)
    src_engine, _ = init_db(copy)
    with src_engine.connect() as src, target.connect() as dst:
        with pytest.raises(mig.MigrationError, match="book_pages: row 1 differs"):
            mig.verify(src, dst)
    src_engine.dispose()
    target.dispose()


def test_self_references_are_filled_in_after_the_copy():
    from backend.models import Base

    links = mig.deferred_links(Base.metadata.sorted_tables)
    assert links["wiki_pages"] == ["parent_id"]
    assert links["genres"] == ["parent_id"]
    assert links["campaigns"] == ["parent_campaign_id"]
    # Every one of them must be nullable: they go in empty first.
    for table in Base.metadata.sorted_tables:
        for name in links.get(table.name, []):
            assert table.c[name].nullable, (table.name, name)


def test_an_unexpected_failure_is_reported_plainly(monkeypatch, caplog):
    import logging

    def explode(*_a):
        raise RuntimeError("boom")

    monkeypatch.setattr(mig, "migrate", explode)
    with caplog.at_level(logging.INFO, logger="grimoire.db"):
        assert mig.main(["--sqlite", "x.db", "--postgres", "postgresql://h/db"]) == 1
    assert "Nothing was written to PostgreSQL and" in caplog.text
    assert "x.db was not changed" in caplog.text


def test_a_missing_sqlite_file_is_reported(tmp_path):
    with pytest.raises(mig.MigrationError, match="No SQLite database"):
        mig.snapshot_sqlite(str(tmp_path / "nope.db"), str(tmp_path / "copy.db"))


def test_snapshot_is_a_complete_copy_and_reads_only(tmp_path):
    source = str(tmp_path / "src.db")
    conn = sqlite3.connect(source)
    conn.execute("CREATE TABLE t (v text)")
    conn.execute("INSERT INTO t VALUES ('kept')")
    conn.commit()
    conn.close()
    before = _digest(source)
    copy = str(tmp_path / "copy.db")
    mig.snapshot_sqlite(source, copy)
    assert sqlite3.connect(copy).execute("SELECT v FROM t").fetchall() == [("kept",)]
    assert _digest(source) == before


def test_cli_needs_a_target(monkeypatch, capsys):
    monkeypatch.setattr(mig, "migrate", lambda *a: pytest.fail("should not run"))
    from backend.config import env

    monkeypatch.setattr(env, "DATABASE_URL", "")
    with pytest.raises(SystemExit):
        mig.main(["--sqlite", "x.db"])
    assert "--postgres" in capsys.readouterr().err


def test_cli_reports_success_and_failure(monkeypatch, caplog):
    import logging

    monkeypatch.setattr(mig, "migrate", lambda s, p: {"books": 2, "users": 1})
    with caplog.at_level(logging.INFO, logger="grimoire.db"):
        assert mig.main(["--sqlite", "x.db", "--postgres", "postgresql://h/db"]) == 0
    assert "Done: 3 row(s) in 2 table(s) copied and verified" in caplog.text

    def refuse(*_a):
        raise mig.MigrationError("The PostgreSQL database is not empty")

    monkeypatch.setattr(mig, "migrate", refuse)
    with caplog.at_level(logging.INFO, logger="grimoire.db"):
        assert mig.main(["--sqlite", "x.db", "--postgres", "postgresql://h/db"]) == 1
    assert "Migration stopped: The PostgreSQL database is not empty" in caplog.text
