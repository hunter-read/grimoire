"""Stored sort keys and folders for paged browsing (issue #221).

``models/browse.py`` derives a natural sort key and the item's folder from
columns every row already has, keeps them current through ORM events, and
migration 0041 backfills them. These pin the derivations, that every write path
keeps them in step, and that the upgrade fills an existing library.
"""
import os
import tempfile

from alembic import command
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from backend.config import SessionLocal
from backend.models import Book, GenericMap, Token
from backend.models.browse import folder_path_of, natural_key
from backend.models.db import _alembic_config, init_db
from backend.tests.conftest import make_book, make_game_system, make_token

# The revision before 0041.
_BEFORE = "1edcfbd4f21c"


class TestNaturalKey:
    def test_numbers_compare_by_value(self):
        names = ["Map 10", "Map 2", "Map 1", "map 3"]
        assert sorted(names, key=natural_key) == ["Map 1", "Map 2", "map 3", "Map 10"]

    def test_leading_zeros_do_not_change_order(self):
        assert natural_key("Room 007") == natural_key("Room 7")

    def test_case_and_accents_are_folded(self):
        assert natural_key("Élan") == natural_key("elan")
        assert sorted(["zeta", "Élan", "beta"], key=natural_key) == ["beta", "Élan", "zeta"]

    def test_digits_sort_before_letters(self):
        assert sorted(["a1", "ab"], key=natural_key) == ["a1", "ab"]

    def test_empty(self):
        assert natural_key(None) == ""
        assert natural_key("") == ""


class TestFolderPath:
    def test_directory_with_trailing_slash(self):
        assert folder_path_of("maps/Swamps/Bog/fen.jpg") == "maps/Swamps/Bog/"

    def test_bare_filename_has_no_folder(self):
        assert folder_path_of("fen.jpg") == ""
        assert folder_path_of(None) == ""

    def test_windows_separators_are_normalised(self):
        assert folder_path_of("maps\\Swamps\\fen.jpg") == "maps/Swamps/"


class TestKeptInStep:
    def test_insert_sets_both(self):
        token = make_token(filename="Goblin 12.png", relative_path="tokens/Pack/Goblin 12.png")
        db = SessionLocal()
        try:
            row = db.get(Token, token.id)
            assert row.sort_name == natural_key("Goblin 12.png")
            assert row.folder_path == "tokens/Pack/"
        finally:
            db.close()

    def test_a_move_re_keys_the_row(self):
        token = make_token(filename="a.png", relative_path="tokens/Old/a.png")
        db = SessionLocal()
        try:
            row = db.get(Token, token.id)
            row.filename = "b 2.png"
            row.relative_path = "tokens/New/Deeper/b 2.png"
            db.commit()
            db.refresh(row)
            assert row.sort_name == natural_key("b 2.png")
            assert row.folder_path == "tokens/New/Deeper/"
        finally:
            db.close()

    def test_a_book_title_edit_re_keys_the_book(self, client, admin_headers):
        system = make_game_system()
        book = make_book(system.id, title="Volume 9")
        resp = client.patch(f"/api/books/{book.id}", json={"title": "Volume 10"}, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        db = SessionLocal()
        try:
            assert db.get(Book, book.id).sort_title == natural_key("Volume 10")
        finally:
            db.close()


class TestMigration:
    """0041 adds and backfills the columns, and creates the browse indexes."""

    def _db_before(self):
        """A current DB rewound to before 0041, holding rows with no keys."""
        path = os.path.join(tempfile.mkdtemp(), "t.db")
        init_db(path)
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            command.downgrade(_alembic_config(conn), _BEFORE)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO generic_maps (id, filename, filepath, relative_path) "
                    "VALUES ('m1', 'Cave 10.jpg', '/l/maps/Caves/Cave 10.jpg', "
                    "'maps/Caves/Cave 10.jpg')"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO books (id, title, filename, filepath, relative_path) "
                    "VALUES ('b1', 'Book 2', 'b.pdf', '/l/books/S/core/b.pdf', "
                    "'books/S/core/b.pdf')"
                )
            )
        engine.dispose()
        return path

    def test_downgrade_removes_the_columns(self):
        path = self._db_before()
        engine = create_engine(f"sqlite:///{path}")
        columns = {c["name"] for c in inspect(engine).get_columns("generic_maps")}
        engine.dispose()
        assert "sort_name" not in columns and "folder_path" not in columns

    def test_upgrade_backfills_existing_rows(self):
        path = self._db_before()
        init_db(path)
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            m = conn.execute(text("SELECT sort_name, folder_path FROM generic_maps")).one()
            b = conn.execute(text("SELECT sort_title, folder_path FROM books")).one()
        engine.dispose()
        assert tuple(m) == (natural_key("Cave 10.jpg"), "maps/Caves/")
        assert tuple(b) == (natural_key("Book 2"), "books/S/core/")

    def test_upgrade_creates_the_browse_indexes(self):
        path = self._db_before()
        init_db(path)
        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            names = {
                r[0]
                for r in conn.execute(
                    text("SELECT name FROM sqlite_master WHERE type = 'index'")
                )
            }
        engine.dispose()
        for table in ("generic_maps", "tokens", "audio", "models_3d"):
            for suffix in ("browse_folder", "browse_name", "browse_added", "browse_size", "live"):
                assert f"ix_{table}_{suffix}" in names
        assert {"ix_books_browse_folder", "ix_books_browse_title", "ix_books_live"} <= names
        assert "ix_resource_tags_type_tag" in names

    def test_rerunning_is_a_no_op(self):
        path = self._db_before()
        init_db(path)
        init_db(path)  # idempotent: no duplicate column or index errors


class TestQueryPlans:
    """The browse queries read the indexes built for them.

    Guards the subtle part: SQLite only uses an index when the WHERE/ORDER BY
    line up with its columns, and a tie-break the index does not end in makes it
    sort the whole table instead. Each case here was seconds on a 187k-token
    library before its index existed.
    """

    def _plan(self, db, query):
        from sqlalchemy.dialects import sqlite

        sql = str(
            query.statement.compile(dialect=sqlite.dialect(), compile_kwargs={"literal_binds": True})
        )
        rows = db.execute(text("EXPLAIN QUERY PLAN " + sql)).fetchall()
        return " | ".join(r[-1] for r in rows)

    def _db(self):
        path = os.path.join(tempfile.mkdtemp(), "t.db")
        init_db(path)
        return sessionmaker(bind=create_engine(f"sqlite:///{path}"))()

    def test_flat_name_page_walks_the_name_index(self):
        from backend.services.browse.media import MediaBrowse, MediaBrowser

        db = self._db()
        b = MediaBrowser(db, "token", "u", hide_explicit=False)
        p = MediaBrowse(sort="name")
        plan = self._plan(db, b.query(p).order_by(*b.order_by(p)).limit(10).offset(5000))
        assert "ix_tokens_browse_name" in plan
        assert "TEMP B-TREE" not in plan

    def test_one_folder_reads_the_folder_index(self):
        from backend.services.browse.media import MediaBrowse, MediaBrowser

        db = self._db()
        db.add(GenericMap(id="x", filename="a.png", filepath="/a", relative_path="maps/A/a.png"))
        db.commit()
        b = MediaBrowser(db, "map", "u", hide_explicit=False)
        p = MediaBrowse(folder="A", sort="name")
        assert "ix_generic_maps_browse_folder" in self._plan(
            db, b.query(p).order_by(*b.order_by(p))
        )

    def test_live_link_count_checks_the_live_index(self):
        from backend.models import ResourceTag
        from backend.services.tag_service._queries import live_links
        from sqlalchemy import func

        db = self._db()
        q = live_links(db, "token").with_entities(ResourceTag.tag_id, func.count())
        assert "ix_tokens_live" in self._plan(db, q.group_by(ResourceTag.tag_id))
