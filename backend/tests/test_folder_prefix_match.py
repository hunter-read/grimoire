"""A folder's rows are the rows under *that* folder, matched exactly (issue #754).

Finding them with ``column.startswith(prefix)`` compiled to SQLite ``LIKE``,
which ignores ASCII case and treats ``_`` and ``%`` as wildcards. Deleting the
empty ``core`` folder beside ``Core`` deleted every book in ``Core``, and moving
or renaming it rewrote their paths. Nothing on disk changed, so the response
looked like a success.

The look-alike folder's rows here have no file behind them on purpose: on a
case-insensitive filesystem (macOS) ``core`` and ``Core`` cannot both exist, but
the rows can, and the rows are what the bug destroyed.
"""
import os
import shutil
import uuid

import pytest
from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, select

from backend.config import LIBRARY_PATH, SessionLocal
from backend.models import Book, FolderNamingRule, MapFolder
from backend.services import library_fs as fs
from backend.services.filename_rules import folders as rule_folders
from backend.services.filename_rules import renames
from backend.sql_paths import path_at_or_under, path_under

from .conftest import make_book, make_game_system


LIB = LIBRARY_PATH


def _matches(rows: list[str], clause_for) -> list[str]:
    """The ``rows`` a clause built by ``clause_for(column)`` selects, in a scratch DB."""
    engine = create_engine("sqlite://")
    meta = MetaData()
    table = Table("t", meta, Column("id", Integer, primary_key=True), Column("p", String))
    meta.create_all(engine)
    with engine.begin() as conn:
        conn.execute(table.insert(), [{"p": r} for r in rows])
        out = conn.execute(select(table.c.p).where(clause_for(table.c.p)).order_by(table.c.id))
        return [r[0] for r in out]


class TestPathUnder:
    def test_case_matters(self):
        rows = ["books/X/Core/a.pdf", "books/X/core/b.pdf"]
        assert _matches(rows, lambda c: path_under(c, "books/X/core/")) == ["books/X/core/b.pdf"]

    def test_underscore_and_percent_are_literal(self):
        rows = ["books/X/core_old/a.pdf", "books/X/coreZold/b.pdf", "books/X/50%/c.pdf", "books/X/50ab/d.pdf"]
        assert _matches(rows, lambda c: path_under(c, "books/X/core_old/")) == ["books/X/core_old/a.pdf"]
        assert _matches(rows, lambda c: path_under(c, "books/X/50%/")) == ["books/X/50%/c.pdf"]

    def test_non_ascii_names_count_characters(self):
        """``substr`` counts characters, so an accent or emoji is one, as in Python."""
        rows = ["maps/Étude 🐉/a.png", "maps/Étude 🐉 2/b.png", "maps/étude 🐉/c.png"]
        assert _matches(rows, lambda c: path_under(c, "maps/Étude 🐉/")) == ["maps/Étude 🐉/a.png"]

    def test_at_or_under_takes_the_folder_itself_and_not_a_name_sharing_its_start(self):
        rows = ["Swamps", "Swamps/Deep", "Swamps2", "swamps/Deep", "Swamps.png"]
        assert _matches(rows, lambda c: path_at_or_under(c, "Swamps")) == ["Swamps", "Swamps/Deep"]


@pytest.fixture
def look_alikes():
    """An empty ``core`` and ``core_old`` on disk, and books indexed under ``Core`` and ``coreZold``."""
    stamp = uuid.uuid4().hex[:8]
    system_rel = f"books/Prefix-{stamp}"
    for name in ("core", "core_old"):
        os.makedirs(os.path.join(LIB, system_rel, name), exist_ok=True)
    system = make_game_system(name=f"Prefix-{stamp}")
    books = {}
    for folder in ("Core", "coreZold"):
        rel = f"{system_rel}/{folder}/Handbook.pdf"
        books[folder] = make_book(
            system.id,
            filename="Handbook.pdf",
            filepath=os.path.join(LIB, rel),
            relative_path=rel,
        ).id
    yield {"rel": system_rel, "books": books}
    shutil.rmtree(os.path.join(LIB, system_rel), ignore_errors=True)


def _relative_path(book_id: str):
    db = SessionLocal()
    try:
        row = db.query(Book).filter(Book.id == book_id).first()
        return row.relative_path if row else None
    finally:
        db.close()


class TestFolderOperationsLeaveLookAlikesAlone:
    @pytest.mark.parametrize("folder, other", [("core", "Core"), ("core_old", "coreZold")])
    def test_deleting_an_empty_folder_keeps_the_other_folders_books(self, look_alikes, folder, other):
        db = SessionLocal()
        result = fs.delete_path(db, f"{look_alikes['rel']}/{folder}")
        db.close()
        assert result["records"] == 0
        assert _relative_path(look_alikes["books"][other]) == f"{look_alikes['rel']}/{other}/Handbook.pdf"

    @pytest.mark.parametrize("folder, other", [("core", "Core"), ("core_old", "coreZold")])
    def test_unindexing_a_folder_keeps_the_other_folders_books(self, look_alikes, folder, other):
        db = SessionLocal()
        result = fs.unindex_path(db, f"{look_alikes['rel']}/{folder}")
        db.close()
        assert result["records"] == 0
        assert _relative_path(look_alikes["books"][other]) is not None

    def test_renaming_a_folder_leaves_the_other_folders_paths(self, look_alikes):
        db = SessionLocal()
        result = fs.rename_path(db, f"{look_alikes['rel']}/core", "Rules")
        db.close()
        assert result["records"] == 0
        assert _relative_path(look_alikes["books"]["Core"]) == f"{look_alikes['rel']}/Core/Handbook.pdf"

    def test_moving_a_folder_leaves_the_other_folders_paths(self, look_alikes):
        os.makedirs(os.path.join(LIB, look_alikes["rel"], "Archive"), exist_ok=True)
        db = SessionLocal()
        result = fs.move_paths(db, [f"{look_alikes['rel']}/core_old"], f"{look_alikes['rel']}/Archive")
        db.close()
        assert result.count == 1
        assert _relative_path(look_alikes["books"]["coreZold"]) == f"{look_alikes['rel']}/coreZold/Handbook.pdf"


@pytest.fixture
def map_folders():
    """An empty ``swamps`` on disk beside a tagged ``Swamps`` folder row."""
    stamp = uuid.uuid4().hex[:8]
    top = f"Prefix-{stamp}"
    os.makedirs(os.path.join(LIB, "maps", top, "swamps"), exist_ok=True)
    db = SessionLocal()
    db.add(MapFolder(path=f"{top}/Swamps", tags=["bog"]))
    db.add(MapFolder(path=f"{top}/Swamps/Deep", tags=["deep"]))
    db.commit()
    db.close()
    yield top
    shutil.rmtree(os.path.join(LIB, "maps", top), ignore_errors=True)
    db = SessionLocal()
    db.query(MapFolder).filter(MapFolder.path.contains(top)).delete(synchronize_session=False)
    db.commit()
    db.close()


def _map_folder_paths(top: str) -> list[str]:
    db = SessionLocal()
    try:
        return sorted(f.path for f in db.query(MapFolder).filter(MapFolder.path.contains(top)))
    finally:
        db.close()


class TestFolderTagRows:
    def test_deleting_a_folder_keeps_the_other_folders_tag_rows(self, map_folders):
        db = SessionLocal()
        fs.delete_path(db, f"maps/{map_folders}/swamps")
        db.close()
        assert _map_folder_paths(map_folders) == [f"{map_folders}/Swamps", f"{map_folders}/Swamps/Deep"]

    def test_renaming_a_folder_keeps_the_other_folders_tag_rows(self, map_folders):
        db = SessionLocal()
        fs.rename_path(db, f"maps/{map_folders}/swamps", "Marshes")
        db.close()
        assert _map_folder_paths(map_folders) == [f"{map_folders}/Swamps", f"{map_folders}/Swamps/Deep"]


class TestNamingRules:
    def test_relink_and_purge_respect_case(self):
        stamp = uuid.uuid4().hex[:8]
        db = SessionLocal()
        # On a subfolder: the folder itself is matched with ``=``, which never
        # ignored case; only the prefix test for what is beneath it did.
        db.add(FolderNamingRule(path=f"books/R{stamp}/Core/Sub", pattern="{title}"))
        db.commit()
        try:
            assert rule_folders.relink_rules(db, f"books/R{stamp}/core", f"books/R{stamp}/x") == 0
            assert rule_folders.purge_rules(db, f"books/R{stamp}/core") == 0
            db.commit()
            assert db.query(FolderNamingRule).filter_by(path=f"books/R{stamp}/Core/Sub").count() == 1
        finally:
            db.query(FolderNamingRule).filter(FolderNamingRule.path.contains(stamp)).delete(
                synchronize_session=False
            )
            db.commit()
            db.close()

    def test_preview_lists_only_the_folders_own_books(self, look_alikes):
        db = SessionLocal()
        try:
            out = renames.preview(db, f"{look_alikes['rel']}/core", "{title}")
        finally:
            db.close()
        assert out["total"] == 0
