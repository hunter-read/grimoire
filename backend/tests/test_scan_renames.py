"""Renamed and deleted folders, outside and inside the app (issue #670).

Renaming a system folder used to leave the old system behind as an empty
"0 books" shelf beside the new one; renaming a folder that held identical copies,
or one renamed while a scan was cut short, left every file twice - the old rows
missing, the new ones fresh. Deleting a folder whose books had bookmarks could
not prune its system at all. These cover each path a user can take: renaming or
deleting on disk and rescanning, and deleting from the app.

Every file gets unique bytes. Move detection pairs on content, and the test
database is shared, so identical fixtures from other tests would read as
ambiguous duplicates.
"""
import os
import shutil
import tempfile
import uuid
from pathlib import Path

from backend.config import LIBRARY_PATH, SessionLocal
from backend.indexer import scan_library
from backend.models import Book, GameSystem
from backend.models.campaigns import Campaign
from backend.models.users import Bookmark
from backend.services import library_fs as fs
from backend.services import tag_service


def _mk_lib() -> tuple[str, Path]:
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    lib.mkdir()
    return tmp, lib


def _file(folder: Path, name: str, body: bytes | None = None) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_bytes(body if body is not None else b"grimoire-670-" + uuid.uuid4().hex.encode())
    return path


def _scan(lib: Path, tmp: str, **kw) -> dict:
    db = SessionLocal()
    try:
        return scan_library(str(lib), tmp, db, **kw)
    finally:
        db.close()


def _books(lib: Path) -> dict[str, Book]:
    """This library's books, keyed by path relative to it."""
    db = SessionLocal()
    try:
        return {
            os.path.relpath(b.filepath, lib): b
            for b in db.query(Book).all()
            if b.filepath.startswith(str(lib) + os.sep)
        }
    finally:
        db.close()


def _system(**filters) -> GameSystem | None:
    db = SessionLocal()
    try:
        return db.query(GameSystem).filter_by(**filters).first()
    finally:
        db.close()


def _systems(**filters) -> list[GameSystem]:
    db = SessionLocal()
    try:
        return db.query(GameSystem).filter_by(**filters).all()
    finally:
        db.close()


def _update_system(system_id: str, **values) -> None:
    db = SessionLocal()
    try:
        system = db.get(GameSystem, system_id)
        for key, value in values.items():
            setattr(system, key, value)
        db.commit()
    finally:
        db.close()


def _stop_after(n: int):
    calls = {"n": 0}

    def should_stop() -> bool:
        calls["n"] += 1
        return calls["n"] > n

    return should_stop


def _stamp() -> str:
    return uuid.uuid4().hex[:8]


class TestRenamedSystemFolder:
    def test_rename_keeps_the_system_and_leaves_no_empty_shelf(self):
        tmp, lib = _mk_lib()
        name = f"Alpha {_stamp()}"
        _file(lib / "books" / name / "core", "a.pdf")
        _scan(lib, tmp)
        before = _system(name=name)
        book_id = _books(lib)[f"books/{name}/core/a.pdf"].id

        (lib / "books" / name).rename(lib / "books" / f"{name} Revised")
        stats = _scan(lib, tmp)

        assert _system(name=name) is None, "the old name was left as an empty shelf"
        after = _system(name=f"{name} Revised")
        assert after.id == before.id
        books = _books(lib)
        assert list(books) == [f"books/{name} Revised/core/a.pdf"]
        assert books[f"books/{name} Revised/core/a.pdf"].id == book_id
        assert not books[f"books/{name} Revised/core/a.pdf"].is_missing
        assert stats["moved_books"] == 1

    def test_rename_keeps_metadata_tags_and_campaigns(self, admin_id):
        tmp, lib = _mk_lib()
        name = f"Curated {_stamp()}"
        _file(lib / "books" / name / "core", "a.pdf")
        _scan(lib, tmp)
        system = _system(name=name)
        _update_system(system.id, description="A game we love")
        db = SessionLocal()
        try:
            tag_service.set_resource_tags(db, "system", system.id, ["favourite-670"])
            campaign = Campaign(name="Table 670", owner_id=admin_id, system_id=system.id)
            db.add(campaign)
            db.commit()
            campaign_id = campaign.id
        finally:
            db.close()

        (lib / "books" / name).rename(lib / "books" / f"{name} 2e")
        _scan(lib, tmp)

        after = _system(id=system.id)
        assert after is not None
        assert after.name == f"{name} 2e"
        assert after.slug.endswith("2e")
        assert after.description == "A game we love"
        db = SessionLocal()
        try:
            tags = tag_service.display_tags_for_resource(db, "system", system.id)
            assert "favourite-670" in [t if isinstance(t, str) else t["display"] for t in tags]
            assert db.get(Campaign, campaign_id).system_id == system.id
            assert db.query(GameSystem).filter_by(slug=after.slug).count() == 1
        finally:
            db.close()

    def test_a_custom_name_survives_the_rename(self):
        tmp, lib = _mk_lib()
        folder = f"Folder {_stamp()}"
        _file(lib / "books" / folder / "core", "a.pdf")
        _scan(lib, tmp)
        system = _system(name=folder)
        custom = f"My Name {_stamp()}"
        _update_system(system.id, name=custom, name_is_custom=True)

        (lib / "books" / folder).rename(lib / "books" / f"{folder} moved")
        _scan(lib, tmp)

        after = _system(id=system.id)
        assert after.name == custom
        assert _system(name=f"{folder} moved") is None

    def test_renamed_system_inside_a_container(self):
        """The reported case: ``Sword World 1`` renamed to ``Sword World 1.0``."""
        tmp, lib = _mk_lib()
        shelf = f"Sword World {_stamp()} (system-family)"
        _file(lib / "books" / shelf / "Sword World 1" / "core", "a.pdf")
        _file(lib / "books" / shelf / "Sword World 1" / "core", "b.pdf")
        _file(lib / "books" / shelf / "Sword World 2.5" / "core", "c.pdf")
        _scan(lib, tmp)
        container = _system(name=shelf.replace(" (system-family)", ""))
        child = _system(parent_id=container.id, name="Sword World 1")

        (lib / "books" / shelf / "Sword World 1").rename(lib / "books" / shelf / "Sword World 1.0")
        _scan(lib, tmp)

        db = SessionLocal()
        try:
            names = sorted(
                s.name for s in db.query(GameSystem).filter_by(parent_id=container.id)
            )
        finally:
            db.close()
        assert names == ["Sword World 1.0", "Sword World 2.5"]
        assert _system(id=child.id).name == "Sword World 1.0"
        books = _books(lib)
        assert len(books) == 3
        assert not any(b.is_missing for b in books.values())

    def test_renamed_container_keeps_the_shelf_and_its_systems(self):
        tmp, lib = _mk_lib()
        stamp = _stamp()
        _file(lib / "books" / f"Shelf {stamp} (publisher)" / "Game" / "core", "a.pdf")
        _scan(lib, tmp)
        container = _system(name=f"Shelf {stamp}")
        _update_system(container.id, description="Our shelf")
        child = _system(parent_id=container.id)

        (lib / "books" / f"Shelf {stamp} (publisher)").rename(
            lib / "books" / f"Shelf {stamp} Press (publisher)"
        )
        _scan(lib, tmp)

        after = _system(id=container.id)
        assert after is not None and after.name == f"Shelf {stamp} Press"
        assert after.description == "Our shelf"
        kept_child = _system(id=child.id)
        assert kept_child is not None and kept_child.parent_id == container.id
        assert kept_child.name == "Game", "the clash suffix from the walk must not stick"
        assert _system(name=f"Shelf {stamp}") is None

    def test_a_folder_split_in_two_is_not_a_rename(self):
        """Books going to two new systems pair with neither; the old row is pruned."""
        tmp, lib = _mk_lib()
        name = f"Split {_stamp()}"
        _file(lib / "books" / name / "core", "a.pdf")
        _file(lib / "books" / name / "core", "b.pdf")
        _scan(lib, tmp)
        old = _system(name=name)

        (lib / "books" / f"{name} A" / "core").mkdir(parents=True)
        (lib / "books" / f"{name} B" / "core").mkdir(parents=True)
        (lib / "books" / name / "core" / "a.pdf").rename(lib / "books" / f"{name} A" / "core" / "a.pdf")
        (lib / "books" / name / "core" / "b.pdf").rename(lib / "books" / f"{name} B" / "core" / "b.pdf")
        shutil.rmtree(lib / "books" / name)
        _scan(lib, tmp)

        assert _system(id=old.id) is None
        assert _system(name=f"{name} A") is not None
        assert _system(name=f"{name} B") is not None
        assert sorted(_books(lib)) == [
            f"books/{name} A/core/a.pdf",
            f"books/{name} B/core/b.pdf",
        ]

    def test_moving_everything_into_an_existing_system_prunes_the_old_one(self):
        tmp, lib = _mk_lib()
        stamp = _stamp()
        _file(lib / "books" / f"Old {stamp}" / "core", "a.pdf")
        _file(lib / "books" / f"Kept {stamp}" / "core", "b.pdf")
        _scan(lib, tmp)
        kept = _system(name=f"Kept {stamp}")

        (lib / "books" / f"Old {stamp}" / "core" / "a.pdf").rename(
            lib / "books" / f"Kept {stamp}" / "core" / "a.pdf"
        )
        shutil.rmtree(lib / "books" / f"Old {stamp}")
        _scan(lib, tmp)

        assert _system(name=f"Old {stamp}") is None
        assert _system(id=kept.id).name == f"Kept {stamp}"
        assert {b.game_system_id for b in _books(lib).values()} == {kept.id}


class TestRenamedCategoryFolder:
    def test_category_rename_moves_the_books(self):
        tmp, lib = _mk_lib()
        name = f"Cats {_stamp()}"
        _file(lib / "books" / name / "core", "a.pdf")
        _scan(lib, tmp)
        book_id = _books(lib)[f"books/{name}/core/a.pdf"].id

        (lib / "books" / name / "core").rename(lib / "books" / name / "adventures")
        _scan(lib, tmp)

        books = _books(lib)
        assert list(books) == [f"books/{name}/adventures/a.pdf"]
        moved = books[f"books/{name}/adventures/a.pdf"]
        assert moved.id == book_id
        assert moved.category == "adventure"
        assert not moved.is_missing


class TestIdenticalCopies:
    def test_renamed_folder_of_identical_copies_pairs_them_by_name(self):
        """Same bytes twice used to be ambiguous: both came back missing *and* new."""
        tmp, lib = _mk_lib()
        name = f"Dups {_stamp()}"
        body = b"grimoire-670-same-" + uuid.uuid4().hex.encode()
        _file(lib / "books" / name / "core", "a.pdf", body)
        _file(lib / "books" / name / "core", "a copy.pdf", body)
        _scan(lib, tmp)
        ids = {path: b.id for path, b in _books(lib).items()}

        (lib / "books" / name / "core").rename(lib / "books" / name / "rules")
        stats = _scan(lib, tmp)

        books = _books(lib)
        assert sorted(books) == [f"books/{name}/rules/a copy.pdf", f"books/{name}/rules/a.pdf"]
        assert books[f"books/{name}/rules/a.pdf"].id == ids[f"books/{name}/core/a.pdf"]
        assert books[f"books/{name}/rules/a copy.pdf"].id == ids[f"books/{name}/core/a copy.pdf"]
        assert stats["moved_books"] == 2
        assert not any(b.is_missing for b in books.values())

    def test_copies_renamed_as_well_stay_ambiguous(self):
        """Without a name to go on, nothing is guessed: old rows read as missing."""
        tmp, lib = _mk_lib()
        name = f"Guess {_stamp()}"
        body = b"grimoire-670-same-" + uuid.uuid4().hex.encode()
        _file(lib / "books" / name / "core", "a.pdf", body)
        _file(lib / "books" / name / "core", "b.pdf", body)
        _scan(lib, tmp)

        core = lib / "books" / name / "core"
        (core / "a.pdf").rename(core / "c.pdf")
        (core / "b.pdf").rename(core / "d.pdf")
        stats = _scan(lib, tmp)

        books = _books(lib)
        assert stats["moved_books"] == 0
        assert {p for p, b in books.items() if b.is_missing} == {
            f"books/{name}/core/a.pdf",
            f"books/{name}/core/b.pdf",
        }


class TestInterruptedScan:
    def test_a_rename_seen_by_a_stopped_scan_is_still_a_move(self):
        tmp, lib = _mk_lib()
        name = f"Cut {_stamp()}"
        _file(lib / "books" / name / "core", "a.pdf")
        _file(lib / "books" / name / "core", "b.pdf")
        _scan(lib, tmp)
        ids = {os.path.basename(p): b.id for p, b in _books(lib).items()}

        (lib / "books" / name).rename(lib / "books" / f"{name} 2")
        _scan(lib, tmp, should_stop=_stop_after(6))
        assert any(p.startswith(f"books/{name} 2/") for p in _books(lib)), (
            "the stopped scan should have inserted part of the renamed folder"
        )
        _scan(lib, tmp)

        books = _books(lib)
        assert sorted(books) == [f"books/{name} 2/core/a.pdf", f"books/{name} 2/core/b.pdf"]
        assert {os.path.basename(p): b.id for p, b in books.items()} == ids
        assert _system(name=name) is None

    def test_rows_reconciled_by_a_complete_scan_are_not_move_targets(self):
        """A file that has sat in place since the last full scan never moved."""
        tmp, lib = _mk_lib()
        name = f"Stay {_stamp()}"
        body = b"grimoire-670-twin-" + uuid.uuid4().hex.encode()
        _file(lib / "books" / name / "core", "a.pdf", body)
        _file(lib / "books" / name / "extras", "twin.pdf", body)
        _scan(lib, tmp)
        twin_id = _books(lib)[f"books/{name}/extras/twin.pdf"].id

        (lib / "books" / name / "core" / "a.pdf").unlink()
        stats = _scan(lib, tmp)

        books = _books(lib)
        assert stats["moved_books"] == 0
        assert books[f"books/{name}/core/a.pdf"].is_missing
        assert books[f"books/{name}/extras/twin.pdf"].id == twin_id


class TestDeletedFolderOnDisk:
    def test_deleted_folder_with_bookmarks_is_pruned(self, admin_id):
        """A bookmarked missing book used to fail the whole prune on its foreign key."""
        tmp, lib = _mk_lib()
        name = f"Marked {_stamp()}"
        _file(lib / "books" / name / "core", "a.pdf")
        _scan(lib, tmp)
        system = _system(name=name)
        book_id = _books(lib)[f"books/{name}/core/a.pdf"].id
        db = SessionLocal()
        try:
            db.add(Bookmark(user_id=admin_id, book_id=book_id, page_number=1))
            db.commit()
        finally:
            db.close()

        shutil.rmtree(lib / "books" / name)
        stats = _scan(lib, tmp)

        assert stats["removed_systems"] == 1
        assert _system(id=system.id) is None
        db = SessionLocal()
        try:
            assert db.query(Bookmark).filter_by(book_id=book_id).count() == 0
            assert db.get(Book, book_id) is None
        finally:
            db.close()

    def test_one_system_kept_by_a_campaign_does_not_block_the_others(self, admin_id):
        tmp, lib = _mk_lib()
        stamp = _stamp()
        _file(lib / "books" / f"Played {stamp}" / "core", "a.pdf")
        _file(lib / "books" / f"Unplayed {stamp}" / "core", "b.pdf")
        _scan(lib, tmp)
        played = _system(name=f"Played {stamp}")
        unplayed = _system(name=f"Unplayed {stamp}")
        db = SessionLocal()
        try:
            db.add(Campaign(name="Still running", owner_id=admin_id, system_id=played.id))
            db.commit()
        finally:
            db.close()

        shutil.rmtree(lib / "books" / f"Played {stamp}")
        shutil.rmtree(lib / "books" / f"Unplayed {stamp}")
        _scan(lib, tmp)

        assert _system(id=played.id) is not None
        assert _system(id=unplayed.id) is None

    def test_deleted_category_folder_flags_its_books_missing(self):
        tmp, lib = _mk_lib()
        name = f"Partial {_stamp()}"
        _file(lib / "books" / name / "core", "a.pdf")
        _file(lib / "books" / name / "extras", "b.pdf")
        _scan(lib, tmp)

        shutil.rmtree(lib / "books" / name / "extras")
        stats = _scan(lib, tmp)

        books = _books(lib)
        assert books[f"books/{name}/extras/b.pdf"].is_missing
        assert not books[f"books/{name}/core/a.pdf"].is_missing
        assert stats["missing_books"] == 1
        assert _system(name=name) is not None

    def test_scoped_scan_prunes_nothing(self):
        tmp, lib = _mk_lib()
        stamp = _stamp()
        _file(lib / "books" / f"Here {stamp}" / "core", "a.pdf")
        _file(lib / "books" / f"Gone {stamp}" / "core", "b.pdf")
        _scan(lib, tmp)

        shutil.rmtree(lib / "books" / f"Gone {stamp}")
        stats = _scan(lib, tmp, scope_path=f"books/Here {stamp}")

        assert stats["removed_systems"] == 0
        assert _system(name=f"Gone {stamp}") is not None


class TestDeletedInTheApp:
    """``POST /api/files/delete``, against the shared test library."""

    def _system_folder(self, stamp: str) -> tuple[str, GameSystem]:
        rel = f"books/AppSys-{stamp}"
        _file(Path(LIBRARY_PATH) / rel / "core", "a.pdf")
        db = SessionLocal()
        try:
            scan_library(LIBRARY_PATH, tempfile.mkdtemp(), db, scope_path=rel)
        finally:
            db.close()
        return rel, _system(name=f"AppSys-{stamp}")

    def test_deleting_a_system_folder_removes_the_system(self, client, admin_headers):
        rel, system = self._system_folder(_stamp())
        try:
            resp = client.post(
                "/api/files/delete",
                headers=admin_headers,
                json={"path": rel, "confirm_name": os.path.basename(rel), "delete_files": True},
            )
            assert resp.status_code == 200, resp.text
            assert _system(id=system.id) is None
            assert not os.path.exists(os.path.join(LIBRARY_PATH, rel))
        finally:
            shutil.rmtree(os.path.join(LIBRARY_PATH, rel), ignore_errors=True)

    def test_deleting_a_described_system_folder_still_removes_it(self, client, admin_headers):
        """Typing the folder's name to delete it is consent enough to lose its metadata."""
        rel, system = self._system_folder(_stamp())
        _update_system(system.id, description="Gone on purpose")
        try:
            resp = client.post(
                "/api/files/delete",
                headers=admin_headers,
                json={"path": rel, "confirm_name": os.path.basename(rel), "delete_files": True},
            )
            assert resp.status_code == 200, resp.text
            assert _system(id=system.id) is None
        finally:
            shutil.rmtree(os.path.join(LIBRARY_PATH, rel), ignore_errors=True)

    def test_unindexing_a_described_system_folder_keeps_it(self, client, admin_headers):
        """The folder is still there, so a rescan would bring the shelf straight back."""
        rel, system = self._system_folder(_stamp())
        _update_system(system.id, description="Still on disk")
        try:
            resp = client.post("/api/files/delete", headers=admin_headers, json={"path": rel})
            assert resp.status_code == 200, resp.text
            assert _system(id=system.id) is not None
        finally:
            shutil.rmtree(os.path.join(LIBRARY_PATH, rel), ignore_errors=True)

    def test_deleting_a_category_folder_keeps_the_system(self, client, admin_headers):
        rel, system = self._system_folder(_stamp())
        try:
            _file(Path(LIBRARY_PATH) / rel / "extras", "keep.bin")
            resp = client.post(
                "/api/files/delete",
                headers=admin_headers,
                json={"path": f"{rel}/core", "confirm_name": "core", "delete_files": True},
            )
            assert resp.status_code == 200, resp.text
            assert _system(id=system.id) is not None
        finally:
            shutil.rmtree(os.path.join(LIBRARY_PATH, rel), ignore_errors=True)

    def test_unindexing_a_system_folder_removes_the_system(self, client, admin_headers):
        rel, system = self._system_folder(_stamp())
        try:
            resp = client.post(
                "/api/files/delete", headers=admin_headers, json={"path": rel}
            )
            assert resp.status_code == 200, resp.text
            assert _system(id=system.id) is None
            assert os.path.exists(os.path.join(LIBRARY_PATH, rel, "core", "a.pdf"))
        finally:
            shutil.rmtree(os.path.join(LIBRARY_PATH, rel), ignore_errors=True)

    def test_deleting_the_last_system_on_a_shelf_keeps_the_shelf(
        self, client, admin_headers
    ):
        """The shelf's folder is still there, so its row (and metadata) stays."""
        stamp = _stamp()
        shelf = f"books/AppShelf-{stamp} (publisher)"
        _file(Path(LIBRARY_PATH) / shelf / "Only Game" / "core", "a.pdf")
        db = SessionLocal()
        try:
            scan_library(LIBRARY_PATH, tempfile.mkdtemp(), db, scope_path=shelf)
        finally:
            db.close()
        container = _system(name=f"AppShelf-{stamp}")
        child = _system(parent_id=container.id)
        try:
            resp = client.post(
                "/api/files/delete",
                headers=admin_headers,
                json={
                    "path": f"{shelf}/Only Game",
                    "confirm_name": "Only Game",
                    "delete_files": True,
                },
            )
            assert resp.status_code == 200, resp.text
            assert _system(id=child.id) is None
            assert _system(id=container.id) is not None
        finally:
            shutil.rmtree(os.path.join(LIBRARY_PATH, shelf), ignore_errors=True)

    def test_a_shelf_with_other_systems_survives(self, client, admin_headers):
        stamp = _stamp()
        shelf = f"books/AppShelf2-{stamp} (publisher)"
        _file(Path(LIBRARY_PATH) / shelf / "Game A" / "core", "a.pdf")
        _file(Path(LIBRARY_PATH) / shelf / "Game B" / "core", "b.pdf")
        db = SessionLocal()
        try:
            scan_library(LIBRARY_PATH, tempfile.mkdtemp(), db, scope_path=shelf)
            # Found by folder, not name: another test may already own a system
            # called "Game B", and the scanner then de-duplicates this one's name.
            game_b = fs.system_for_folder(db, fs.safe_join(f"{shelf}/Game B"))
        finally:
            db.close()
        container = _system(name=f"AppShelf2-{stamp}")
        try:
            resp = client.post(
                "/api/files/delete",
                headers=admin_headers,
                json={"path": f"{shelf}/Game A", "confirm_name": "Game A", "delete_files": True},
            )
            assert resp.status_code == 200, resp.text
            assert _system(id=container.id) is not None
            assert [s.id for s in _systems(parent_id=container.id)] == [game_b.id]
        finally:
            shutil.rmtree(os.path.join(LIBRARY_PATH, shelf), ignore_errors=True)


class TestSystemForFolder:
    def test_resolves_a_system_inside_a_container(self):
        stamp = _stamp()
        shelf = f"books/Resolve-{stamp} (system-family)"
        _file(Path(LIBRARY_PATH) / shelf / "Inner" / "core", "a.pdf")
        db = SessionLocal()
        try:
            scan_library(LIBRARY_PATH, tempfile.mkdtemp(), db, scope_path=shelf)
            container = db.query(GameSystem).filter_by(name=f"Resolve-{stamp}").first()
            found = fs.system_for_folder(db, fs.safe_join(f"{shelf}/Inner"))
            assert found is not None and found.parent_id == container.id
            assert fs.system_for_folder(db, fs.safe_join(f"{shelf}/Inner/core")) is None
        finally:
            db.close()
            shutil.rmtree(os.path.join(LIBRARY_PATH, shelf), ignore_errors=True)


class TestPruneEdges:
    """The conservative and failure paths of system pruning and rename adoption."""

    def test_a_vanished_system_with_a_description_is_kept(self):
        tmp, lib = _mk_lib()
        name = f"Loved {_stamp()}"
        _file(lib / "books" / name / "core", "a.pdf")
        _scan(lib, tmp)
        system = _system(name=name)
        _update_system(system.id, description="Keep me")

        shutil.rmtree(lib / "books" / name)
        _scan(lib, tmp)

        assert _system(id=system.id) is not None

    def test_two_folders_merged_into_a_new_one_adopt_neither(self):
        tmp, lib = _mk_lib()
        stamp = _stamp()
        _file(lib / "books" / f"Left {stamp}" / "core", "a.pdf")
        _file(lib / "books" / f"Right {stamp}" / "core", "b.pdf")
        _scan(lib, tmp)
        left, right = _system(name=f"Left {stamp}"), _system(name=f"Right {stamp}")

        merged = lib / "books" / f"Both {stamp}" / "core"
        merged.mkdir(parents=True)
        (lib / "books" / f"Left {stamp}" / "core" / "a.pdf").rename(merged / "a.pdf")
        (lib / "books" / f"Right {stamp}" / "core" / "b.pdf").rename(merged / "b.pdf")
        shutil.rmtree(lib / "books" / f"Left {stamp}")
        shutil.rmtree(lib / "books" / f"Right {stamp}")
        _scan(lib, tmp)

        assert _system(id=left.id) is None and _system(id=right.id) is None
        both = _system(name=f"Both {stamp}")
        assert {b.game_system_id for b in _books(lib).values()} == {both.id}

    def test_books_moved_out_of_a_folder_that_stays(self):
        """The old system is still walked to, so it is neither adopted nor pruned."""
        tmp, lib = _mk_lib()
        stamp = _stamp()
        _file(lib / "books" / f"Stays {stamp}" / "core", "a.pdf")
        _scan(lib, tmp)
        stays = _system(name=f"Stays {stamp}")

        (lib / "books" / f"Fresh {stamp}" / "core").mkdir(parents=True)
        (lib / "books" / f"Stays {stamp}" / "core" / "a.pdf").rename(
            lib / "books" / f"Fresh {stamp}" / "core" / "a.pdf"
        )
        _scan(lib, tmp)

        assert _system(id=stays.id).name == f"Stays {stamp}"
        assert _system(name=f"Fresh {stamp}") is not None

    def test_adoption_fills_fields_the_old_row_lacks(self):
        tmp, lib = _mk_lib()
        stamp = _stamp()
        shelf = f"Fam {stamp} (system-family)"
        _file(lib / "books" / shelf / "Game" / "core", "a.pdf")
        _scan(lib, tmp)
        child = _system(parent_id=_system(name=f"Fam {stamp}").id)
        _update_system(child.id, system_family="")

        (lib / "books" / shelf / "Game").rename(lib / "books" / shelf / "Game 2")
        _scan(lib, tmp)

        assert _system(id=child.id).system_family == f"Fam {stamp}"

    def test_a_deleted_container_goes_with_its_systems(self):
        tmp, lib = _mk_lib()
        stamp = _stamp()
        _file(lib / "books" / f"Gone Shelf {stamp} (publisher)" / "Game" / "core", "a.pdf")
        _scan(lib, tmp)
        container = _system(name=f"Gone Shelf {stamp}")

        shutil.rmtree(lib / "books" / f"Gone Shelf {stamp} (publisher)")
        stats = _scan(lib, tmp)

        assert _system(id=container.id) is None
        assert stats["removed_systems"] == 2

    def test_a_failed_adoption_falls_back_to_pruning(self, monkeypatch):
        from backend.indexer import system_prune

        def boom(ctx, old, new):
            raise RuntimeError("no")

        monkeypatch.setattr(system_prune, "_adopt_rename", boom)
        tmp, lib = _mk_lib()
        name = f"Fails {_stamp()}"
        _file(lib / "books" / name / "core", "a.pdf")
        _scan(lib, tmp)
        old = _system(name=name)

        (lib / "books" / name).rename(lib / "books" / f"{name} 2")
        _scan(lib, tmp)

        assert _system(id=old.id) is None
        assert _system(name=f"{name} 2") is not None

    def test_a_system_that_cannot_be_deleted_does_not_stop_the_scan(self, monkeypatch):
        import backend.services.library_fs.references as references

        def boom(db, system_id):
            raise RuntimeError("locked")

        tmp, lib = _mk_lib()
        name = f"Stuck {_stamp()}"
        _file(lib / "books" / name / "core", "a.pdf")
        _scan(lib, tmp)
        system = _system(name=name)

        monkeypatch.setattr(references, "purge_system_references", boom)
        shutil.rmtree(lib / "books" / name)
        stats = _scan(lib, tmp)

        assert stats["removed_systems"] == 0
        assert _system(id=system.id) is not None

    def test_failed_commits_and_a_hung_query_do_not_fail_the_scan(self, monkeypatch):
        """Each adoption and removal is atomic in its own savepoint.

        On SQLite a savepoint taken with no transaction open is released as a
        commit, so a final commit that fails cannot undo the rows already
        handled - what matters is that the scan carries on and reports nothing
        it could not confirm.
        """
        from backend.indexer import system_prune

        real = system_prune._run_with_timeout
        failing: set = set()

        def flaky(fn, timeout, label):
            if label in failing:
                raise TimeoutError(label)
            return real(fn, timeout, label)

        monkeypatch.setattr(system_prune, "_run_with_timeout", flaky)
        tmp, lib = _mk_lib()
        stamp = _stamp()
        _file(lib / "books" / f"Rn {stamp}" / "core", "a.pdf")
        _file(lib / "books" / f"Del {stamp}" / "core", "b.pdf")
        _scan(lib, tmp)
        renamed, deleted = _system(name=f"Rn {stamp}"), _system(name=f"Del {stamp}")

        failing.update({"commit renamed systems", "commit system pruning"})
        (lib / "books" / f"Rn {stamp}").rename(lib / "books" / f"Rn {stamp} 2")
        shutil.rmtree(lib / "books" / f"Del {stamp}")
        stats = _scan(lib, tmp)
        assert stats["removed_systems"] == 0
        assert stats["moved_books"] == 1

        failing.clear()
        failing.add("query systems for pruning")
        _file(lib / "books" / f"Del2 {stamp}" / "core", "c.pdf")
        _scan(lib, tmp)
        kept = _system(name=f"Del2 {stamp}")
        shutil.rmtree(lib / "books" / f"Del2 {stamp}")
        assert _scan(lib, tmp)["removed_systems"] == 0
        assert _system(id=kept.id) is not None, "a hung query must skip pruning"
        assert renamed.id and deleted.id
