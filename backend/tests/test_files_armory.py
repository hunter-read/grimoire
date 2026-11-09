"""The file manager in the armory (``LIBRARY_PATH/armory``): wargame books.

The armory is laid out like ``books/`` - ``armory/<System>/...`` with containers
around systems - so the file manager treats it the same way: a protected
collection, system folders that are edited, moved and deleted as systems, and
books whose system, category, game type and factions are re-derived from the
folders they are moved into, exactly as the next rescan would read them.
"""
import hashlib
import io
import os
import shutil
import uuid
from pathlib import Path

import pytest

from backend.config import LIBRARY_PATH, SessionLocal
from backend.indexer import scan_library
from backend.indexer.constants import (
    CATEGORY_MARKER,
    CONTAINER_AGNOSTIC,
    CONTAINER_MARKERS,
    CONTAINER_ONE_PAGE,
    CONTAINER_PARENT,
    FACTION_MARKER,
)
from backend.indexer.factions import read_wargame_placement
from backend.models import Book, BookFolder, Faction, GameSystem
from backend.models.game_types import GAME_TYPE_TTRPG, GAME_TYPE_WARGAME
from backend.services import library_fs as fs
from backend.services.library_fs import moves as fs_moves
from backend.services.library_fs.constants import FOLDER_MODELS
from backend.services.library_fs import wargame_placement

from .conftest import make_book, make_game_system

LIB = LIBRARY_PATH
ARMORY = os.path.join(LIB, "armory")


@pytest.fixture
def armory_tree():
    """``armory/War-<stamp>`` with a Necrons faction and a Missions folder.

    The armory folder itself goes too once empty, so no other test's listing
    of the library root finds a stray collection.
    """
    stamp = str(uuid.uuid4())[:8]
    system_dir = os.path.join(ARMORY, f"War-{stamp}")
    for rel in ("Factions/Necrons", "Missions"):
        os.makedirs(os.path.join(system_dir, rel), exist_ok=True)
    yield stamp
    shutil.rmtree(system_dir, ignore_errors=True)
    shutil.rmtree(os.path.join(LIB, "books", f"Rpg-{stamp}"), ignore_errors=True)
    for leftover in (f"War-{stamp}-2", f"Family-{stamp}", f"New-{stamp}"):
        shutil.rmtree(os.path.join(ARMORY, leftover), ignore_errors=True)
    try:
        os.rmdir(ARMORY)
    except OSError:
        pass


def _write(rel: str, content: bytes = b"grimoire-test-fixture") -> str:
    path = os.path.join(LIB, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(content)
    return path


def _war_system(stamp: str, suffix: str = "") -> GameSystem:
    return make_game_system(
        name=f"War-{stamp}{suffix}",
        slug=f"war-{stamp}{suffix}",
        game_type=GAME_TYPE_WARGAME,
    )


def _wargame_book(stamp: str, rel_in_system: str, system: GameSystem | None = None):
    """A wargame system row and a book row for a file written into the armory."""
    system = system or _war_system(stamp)
    rel = f"armory/War-{stamp}/{rel_in_system}"
    filepath = _write(rel)
    book = make_book(
        system.id,
        filename=os.path.basename(filepath),
        filepath=filepath,
        relative_path=rel,
        category="army-book",
        game_type=GAME_TYPE_WARGAME,
    )
    return system, book


def _rpg_book(stamp: str, rel_in_system: str):
    system = make_game_system(name=f"Rpg-{stamp}", slug=f"rpg-{stamp}")
    rel = f"books/Rpg-{stamp}/{rel_in_system}"
    filepath = _write(rel)
    book = make_book(
        system.id,
        filename=os.path.basename(filepath),
        filepath=filepath,
        relative_path=rel,
        category="core",
    )
    return system, book


def _load(book_id: str) -> dict:
    """What a book row says now: its place, system, game type and factions."""
    db = SessionLocal()
    try:
        book = db.query(Book).filter(Book.id == book_id).one()
        return {
            "relative_path": book.relative_path,
            "filepath": book.filepath,
            "category": book.category,
            "game_type": book.game_type,
            "system_id": book.game_system_id,
            "factions": sorted(f.slug for f in book.factions),
        }
    finally:
        db.close()


def _move(sources: list[str], destination: str) -> fs.MoveResult:
    db = SessionLocal()
    try:
        return fs.move_paths(db, sources, destination)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# The collection
# ---------------------------------------------------------------------------


class TestCollection:
    def test_armory_is_a_book_collection(self, armory_tree):
        root = fs.library_root()
        assert fs.collection_of(root / "armory") == "armory"
        assert fs.collection_of(root / "Armory" / "x" / "y.pdf") == "armory"
        # The British spelling is the same collection.
        assert fs.collection_of(root / "Armoury" / "x.pdf") == "armory"
        assert fs.in_book_section(root / "armory" / "x.pdf")
        assert fs.in_book_section(root / "books" / "x.pdf")
        assert not fs.in_book_section(root / "maps" / "x.png")
        assert fs.is_armory(root / "armory") and not fs.is_armory(root / "books")

    def test_its_rows_are_books(self):
        assert fs.COLLECTIONS["armory"] is Book
        assert FOLDER_MODELS["armory"] is BookFolder
        # Books are thumbnailed and typed as books, wherever they sit.
        assert fs._section_for_model(Book) == "books"

    def test_the_armory_folder_is_protected(self, armory_tree):
        db = SessionLocal()
        try:
            for call in (
                lambda: fs.delete_path(db, "armory", confirm_name="armory"),
                lambda: fs.unindex_path(db, "armory"),
                lambda: fs.delete_empty_folder("armory"),
            ):
                with pytest.raises(fs.LibraryFSError) as exc:
                    call()
                assert exc.value.code == "forbidden"
        finally:
            db.close()
        assert os.path.isdir(ARMORY)

    def test_the_british_spelling_is_protected_too(self, armory_tree):
        british = os.path.join(LIB, "Armoury")
        os.makedirs(british, exist_ok=True)
        try:
            with pytest.raises(fs.LibraryFSError) as exc:
                fs.delete_empty_folder("Armoury")
            assert exc.value.code == "forbidden"
        finally:
            shutil.rmtree(british, ignore_errors=True)


# ---------------------------------------------------------------------------
# Browsing
# ---------------------------------------------------------------------------


class TestBrowse:
    def _browse(self, client, headers, path=""):
        resp = client.get("/api/files/browse", headers=headers, params={"path": path})
        assert resp.status_code == 200, resp.text
        return resp.json()

    def test_root_lists_the_armory(self, client, admin_headers, armory_tree):
        body = self._browse(client, admin_headers)
        row = next(e for e in body["entries"] if e["path"] == "armory")
        assert row["is_dir"] is True

    def test_armory_systems_are_system_folders(self, client, admin_headers, armory_tree):
        # A role-playing system of the same name must not be the one found.
        make_game_system(name=f"War-{armory_tree}", slug=f"war-{armory_tree}")
        war = _war_system(armory_tree)
        body = self._browse(client, admin_headers, "armory")
        assert body["children_accept_container_kind"] is True
        row = next(e for e in body["entries"] if e["name"] == f"War-{armory_tree}")
        assert row["record_id"] == war.id
        assert row["collection"] == "system"
        assert row["accepts_container_kind"] is True
        assert row["category_host"] is True

    def test_armory_books_are_reported_as_books(self, client, admin_headers, armory_tree):
        _, book = _wargame_book(armory_tree, "Factions/Necrons/Codex.pdf")
        body = self._browse(client, admin_headers, f"armory/War-{armory_tree}/Factions/Necrons")
        row = next(e for e in body["entries"] if e["name"] == "Codex.pdf")
        assert row["record_id"] == book.id
        # So the UI opens it in the book editor, as any other book.
        assert row["collection"] == "books"

    def test_a_system_folder_hosts_categories(self, client, admin_headers, armory_tree):
        body = self._browse(client, admin_headers, f"armory/War-{armory_tree}")
        assert body["category_host"] is True
        assert body["children_accept_container_kind"] is False


# ---------------------------------------------------------------------------
# System folders
# ---------------------------------------------------------------------------


class TestSystemFolders:
    def test_system_for_folder_matches_the_wargame(self, armory_tree):
        rpg = make_game_system(name=f"War-{armory_tree}", slug=f"war-{armory_tree}")
        war = _war_system(armory_tree)
        db = SessionLocal()
        try:
            found = fs.system_for_folder(db, Path(ARMORY) / f"War-{armory_tree}")
            assert found is not None and found.id == war.id
            # And books/ keeps finding the role-playing one.
            books_dir = Path(LIB) / "books" / f"War-{armory_tree}"
            assert fs.system_for_folder(db, books_dir).id == rpg.id
            # A category folder is no system.
            assert fs.system_for_folder(db, Path(ARMORY) / f"War-{armory_tree}" / "Missions") is None
        finally:
            db.close()

    def test_system_under_a_container(self, armory_tree):
        family = Path(ARMORY) / f"Family-{armory_tree}"
        (family / "8th" / "Factions" / "Elves").mkdir(parents=True)
        (family / CONTAINER_MARKERS[CONTAINER_PARENT]).touch()
        # The same slug on the role-playing side must not be picked.
        make_game_system(name=f"Rpg Family-{armory_tree} 8th", slug=f"family-{armory_tree}--8th")
        edition = make_game_system(
            name=f"Family-{armory_tree} 8th",
            slug=f"family-{armory_tree}--8th",
            game_type=GAME_TYPE_WARGAME,
        )
        db = SessionLocal()
        try:
            assert fs.system_for_folder(db, family / "8th").id == edition.id
            system_id, category = fs.resolve_book_placement(
                db, family / "8th" / "Factions" / "Elves" / "Elves.pdf"
            )
            assert system_id == edition.id
            assert category == "army-book"
            assert fs.holds_system_folders(family)
            assert fs.is_category_host(family / "8th")
            assert not fs.is_category_host(family)
        finally:
            db.close()

    def test_containers_can_be_declared(self, armory_tree):
        assert fs.holds_system_folders(Path(ARMORY))
        assert fs.accepts_container_kind(Path(ARMORY) / f"War-{armory_tree}")
        # A system's own children are categories and factions, not systems.
        assert not fs.accepts_container_kind(Path(ARMORY) / f"War-{armory_tree}" / "Missions")
        out = fs.set_folder_markers(f"armory/War-{armory_tree}", container_kind=CONTAINER_PARENT)
        assert out["container_kind"] == CONTAINER_PARENT
        made = fs.create_folder("armory", f"Family-{armory_tree}", container_kind=CONTAINER_PARENT)
        assert made["path"] == f"armory/Family-{armory_tree}"

    @pytest.mark.parametrize("kind", [CONTAINER_ONE_PAGE, CONTAINER_AGNOSTIC])
    def test_role_playing_collections_stay_in_books(self, armory_tree, kind):
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.set_folder_markers(f"armory/War-{armory_tree}", container_kind=kind)
        assert exc.value.code == "invalid"
        with pytest.raises(fs.LibraryFSError):
            fs.create_folder("armory", f"New-{armory_tree}", container_kind=kind)
        assert not os.path.exists(os.path.join(ARMORY, f"New-{armory_tree}"))

    def test_deleting_a_system_folder_takes_the_wargame_system(self, armory_tree):
        rpg = make_game_system(name=f"War-{armory_tree}", slug=f"war-{armory_tree}")
        system, book = _wargame_book(armory_tree, "Factions/Necrons/Gone.pdf")
        db = SessionLocal()
        try:
            db.add(Faction(game_system_id=system.id, name="Necrons", slug="necrons"))
            db.commit()
            out = fs.delete_path(db, f"armory/War-{armory_tree}", confirm_name=f"War-{armory_tree}")
            assert out["records"] == 2  # the book and its system
        finally:
            db.close()
        db = SessionLocal()
        try:
            assert db.get(Book, book.id) is None
            assert db.get(GameSystem, system.id) is None
            assert db.query(Faction).filter_by(game_system_id=system.id).count() == 0
            # The role-playing namesake is untouched.
            assert db.get(GameSystem, rpg.id) is not None
        finally:
            db.close()

    def test_renaming_a_system_folder_relinks_its_books(self, armory_tree):
        system, book = _wargame_book(armory_tree, "Factions/Necrons/Codex.pdf")
        db = SessionLocal()
        try:
            out = fs.rename_path(db, f"armory/War-{armory_tree}", f"War-{armory_tree}-2")
            assert out["records"] == 1
        finally:
            db.close()
        after = _load(book.id)
        assert after["relative_path"] == f"armory/War-{armory_tree}-2/Factions/Necrons/Codex.pdf"
        # No system is registered for the new name yet, so it keeps its own.
        assert after["system_id"] == system.id
        assert after["game_type"] == GAME_TYPE_WARGAME
        assert os.path.isfile(after["filepath"])

    def test_moving_a_system_folder_into_a_container(self, armory_tree):
        family = Path(ARMORY) / f"Family-{armory_tree}"
        family.mkdir()
        (family / CONTAINER_MARKERS[CONTAINER_PARENT]).touch()
        child = make_game_system(
            name=f"Family-{armory_tree} War-{armory_tree}",
            slug=f"family-{armory_tree}--war-{armory_tree}",
            game_type=GAME_TYPE_WARGAME,
        )
        _, book = _wargame_book(armory_tree, "Factions/Necrons/Codex.pdf")
        result = _move([f"armory/War-{armory_tree}"], f"armory/Family-{armory_tree}")
        assert result.count == 1, result.skipped
        after = _load(book.id)
        assert after["system_id"] == child.id
        assert after["category"] == "army-book"
        assert after["factions"] == ["necrons"]


# ---------------------------------------------------------------------------
# Moving books
# ---------------------------------------------------------------------------


class TestMoves:
    def test_move_between_factions_replaces_the_faction(self, armory_tree):
        stamp = armory_tree
        os.makedirs(os.path.join(ARMORY, f"War-{stamp}", "Factions", "Aeldari"))
        system, book = _wargame_book(stamp, "Factions/Necrons/Codex.pdf")
        db = SessionLocal()
        try:
            row = db.get(Book, book.id)
            necrons = Faction(game_system_id=system.id, name="Necrons", slug="necrons")
            row.factions.append(necrons)
            db.commit()
        finally:
            db.close()

        result = _move(
            [f"armory/War-{stamp}/Factions/Necrons/Codex.pdf"], f"armory/War-{stamp}/Factions/Aeldari"
        )
        assert result.count == 1, result.skipped
        after = _load(book.id)
        assert after["system_id"] == system.id
        assert after["category"] == "army-book"
        assert after["factions"] == ["aeldari"]

    def test_move_out_of_a_faction_clears_it(self, armory_tree):
        stamp = armory_tree
        system, book = _wargame_book(stamp, "Factions/Necrons/Pariah.pdf")
        db = SessionLocal()
        try:
            row = db.get(Book, book.id)
            row.factions.append(Faction(game_system_id=system.id, name="Necrons", slug="necrons"))
            db.commit()
        finally:
            db.close()
        result = _move([f"armory/War-{stamp}/Factions/Necrons/Pariah.pdf"], f"armory/War-{stamp}/Missions")
        assert result.count == 1, result.skipped
        after = _load(book.id)
        assert after["relative_path"] == f"armory/War-{stamp}/Missions/Pariah.pdf"
        # Read with the wargame vocabulary, as the scanner would.
        assert after["category"] == "mission-pack"
        assert after["factions"] == []

    def test_moving_a_faction_folder_nests_it(self, armory_tree):
        stamp = armory_tree
        os.makedirs(os.path.join(ARMORY, f"War-{stamp}", "Factions", "Xenos"))
        system, book = _wargame_book(stamp, "Factions/Necrons/Codex.pdf")
        result = _move([f"armory/War-{stamp}/Factions/Necrons"], f"armory/War-{stamp}/Factions/Xenos")
        assert result.count == 1, result.skipped
        after = _load(book.id)
        assert after["factions"] == ["xenos--necrons"]
        db = SessionLocal()
        try:
            inner = db.query(Faction).filter_by(game_system_id=system.id, slug="xenos--necrons").one()
            outer = db.query(Faction).filter_by(game_system_id=system.id, slug="xenos").one()
            assert inner.parent_id == outer.id
        finally:
            db.close()

    def test_move_from_books_into_the_armory(self, armory_tree):
        stamp = armory_tree
        # The role-playing namesake of the destination must not be chosen.
        make_game_system(name=f"War-{stamp}", slug=f"war-{stamp}")
        war = _war_system(stamp)
        rpg, book = _rpg_book(stamp, "core/Codex - Necrons.pdf")
        result = _move(
            [f"books/Rpg-{stamp}/core/Codex - Necrons.pdf"], f"armory/War-{stamp}/Factions/Necrons"
        )
        assert result.count == 1, result.skipped
        after = _load(book.id)
        assert after["relative_path"] == f"armory/War-{stamp}/Factions/Necrons/Codex - Necrons.pdf"
        assert after["system_id"] == war.id
        assert after["game_type"] == GAME_TYPE_WARGAME
        assert after["category"] == "army-book"
        assert after["factions"] == ["necrons"]

    def test_move_from_the_armory_into_books(self, armory_tree):
        stamp = armory_tree
        _, book = _wargame_book(stamp, "Factions/Necrons/Codex.pdf")
        rpg, _ = _rpg_book(stamp, "core/existing.pdf")
        os.makedirs(os.path.join(LIB, "books", f"Rpg-{stamp}", "Adventures"))
        db = SessionLocal()
        try:
            row = db.get(Book, book.id)
            row.factions.append(Faction(game_system_id=row.game_system_id, name="N", slug="n"))
            db.commit()
        finally:
            db.close()
        result = _move(
            [f"armory/War-{stamp}/Factions/Necrons/Codex.pdf"], f"books/Rpg-{stamp}/Adventures"
        )
        assert result.count == 1, result.skipped
        after = _load(book.id)
        assert after["system_id"] == rpg.id
        assert after["game_type"] == GAME_TYPE_TTRPG
        # Role-playing vocabulary, and no factions on the books/ side.
        assert after["category"] == "adventure"
        assert after["factions"] == []

    def test_move_into_an_unregistered_armory_folder(self, armory_tree):
        stamp = armory_tree
        rpg, book = _rpg_book(stamp, "core/Loose.pdf")
        result = _move([f"books/Rpg-{stamp}/core/Loose.pdf"], f"armory/War-{stamp}/Factions/Necrons")
        assert result.count == 1, result.skipped
        after = _load(book.id)
        # No wargame system to move onto yet: it keeps its shelf, and its game
        # type with it, until a rescan registers the folder.
        assert after["system_id"] == rpg.id
        assert after["game_type"] == GAME_TYPE_TTRPG
        assert after["category"] == "army-book"
        assert after["factions"] == []

    def test_a_move_reads_as_the_next_rescan_would(self, armory_tree):
        stamp = armory_tree
        necrons = Path(ARMORY) / f"War-{stamp}" / "Factions" / "Necrons"
        (necrons / "Imperial Armour").mkdir()
        (necrons / "Imperial Armour" / FACTION_MARKER).touch()
        _write(f"armory/War-{stamp}/Missions/Pack.pdf", b"%PDF-1.4 " + uuid.uuid4().bytes)
        db = SessionLocal()
        try:
            scan_library(LIB, os.path.dirname(LIB), db, scope_path=f"armory/War-{stamp}")
            book = db.query(Book).filter(
                Book.relative_path == f"armory/War-{stamp}/Missions/Pack.pdf"
            ).one()
            book_id = book.id
        finally:
            db.close()

        result = _move(
            [f"armory/War-{stamp}/Missions/Pack.pdf"],
            f"armory/War-{stamp}/Factions/Necrons/Imperial Armour",
        )
        assert result.count == 1, result.skipped
        moved = _load(book_id)
        assert moved["factions"] == ["necrons--imperial-armour"]

        db = SessionLocal()
        try:
            scan_library(LIB, os.path.dirname(LIB), db, scope_path=f"armory/War-{stamp}")
        finally:
            db.close()
        assert _load(book_id) == moved

    def test_the_thumbnail_follows_an_armory_book(self, armory_tree):
        from backend.config import THUMB_DIR

        stamp = armory_tree
        _, book = _wargame_book(stamp, "Factions/Necrons/Thumbed.pdf")
        db = SessionLocal()
        try:
            row = db.get(Book, book.id)
            row.title, row.has_thumbnail = "Thumbed", True
            db.commit()
            src = row.filepath
        finally:
            db.close()
        # Armory books are thumbnailed under thumbnails/books, as all books are.
        old_thumb = Path(THUMB_DIR) / "books" / f"thumbed_{hashlib.md5(src.encode()).hexdigest()[:8]}.webp"
        old_thumb.parent.mkdir(parents=True, exist_ok=True)
        old_thumb.write_bytes(b"webp")

        _move([f"armory/War-{stamp}/Factions/Necrons/Thumbed.pdf"], f"armory/War-{stamp}/Missions")
        after = _load(book.id)
        new_thumb = (
            Path(THUMB_DIR)
            / "books"
            / f"thumbed_{hashlib.md5(after['filepath'].encode()).hexdigest()[:8]}.webp"
        )
        assert new_thumb.is_file() and not old_thumb.exists()
        new_thumb.unlink()

    def test_short_armory_path_has_no_system(self):
        db = SessionLocal()
        try:
            placement = fs.read_book_placement(db, Path(ARMORY) / "x.pdf")
            assert placement.system is None
            assert placement.category == "uncategorized"
            assert placement.game_type == GAME_TYPE_WARGAME
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Uploads
# ---------------------------------------------------------------------------


class TestUploads:
    def test_the_armory_takes_what_books_takes(self, armory_tree):
        armory = Path(ARMORY) / f"War-{armory_tree}"
        assert fs.allowed_upload_exts(armory) == fs.allowed_upload_exts(Path(LIB) / "books")
        out = fs.save_upload(
            f"armory/War-{armory_tree}", "Codex.pdf", io.BytesIO(b"bytes"),
            relative_dir="Factions/Necrons",
        )
        assert out["path"] == f"armory/War-{armory_tree}/Factions/Necrons/Codex.pdf"
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.save_upload(f"armory/War-{armory_tree}", "theme.mp3", io.BytesIO(b"x"))
        assert exc.value.code == "invalid"

    def test_replacing_an_armory_book(self, armory_tree):
        _, book = _wargame_book(armory_tree, "Factions/Necrons/Codex.pdf")
        db = SessionLocal()
        try:
            out = fs.replace_upload(
                db, f"armory/War-{armory_tree}/Factions/Necrons", "Codex.pdf", io.BytesIO(b"new")
            )
        finally:
            db.close()
        assert out["record_id"] == book.id
        with open(_load(book.id)["filepath"], "rb") as f:
            assert f.read() == b"new"


# ---------------------------------------------------------------------------
# Scaffolding categories
# ---------------------------------------------------------------------------


class TestScaffold:
    def test_wargame_folders_each_read_back_as_their_category(self, armory_tree):
        target = f"armory/War-{armory_tree}"
        out = fs.scaffold_categories(target)
        # Factions and Missions were there already.
        assert out["existing"] == ["Factions", "Missions"]
        assert sorted(out["created"]) == sorted(
            n for n in fs.WARGAME_SCAFFOLD_CATEGORY_FOLDERS if n not in ("Missions", "Factions")
        )
        expected = {
            "Core": "core",
            "Factions": "army-book",
            "Rules Updates": "errata",
            "Missions": "mission-pack",
            "Campaigns": "campaign",
            "Supplements": "supplement",
        }
        for name, category in expected.items():
            got, chain, _ = read_wargame_placement(f"{target}/{name}/x.pdf", 2, LIB)
            assert (got, chain) == (category, []), name

    def test_factions_alone_do_not_cover_army_books(self, armory_tree):
        stamp = armory_tree
        shutil.rmtree(os.path.join(ARMORY, f"War-{stamp}", "Factions"))
        os.makedirs(os.path.join(ARMORY, f"War-{stamp}", "Necrons"))
        out = fs.scaffold_categories(f"armory/War-{stamp}")
        assert "Factions" in out["created"]

    def test_an_existing_spelling_covers_the_category(self, armory_tree):
        os.makedirs(os.path.join(ARMORY, f"War-{armory_tree}", "Codexes"))
        out = fs.scaffold_categories(f"armory/War-{armory_tree}")
        # Factions/ was already there; Codexes is an army-book folder too.
        assert "Factions" not in out["created"]

    def test_not_on_the_armory_itself_or_outside_book_collections(self, armory_tree):
        with pytest.raises(fs.LibraryFSError):
            fs.scaffold_categories("armory")
        os.makedirs(os.path.join(LIB, "maps", f"M-{armory_tree}"), exist_ok=True)
        try:
            with pytest.raises(fs.LibraryFSError) as exc:
                fs.scaffold_categories(f"maps/M-{armory_tree}")
            assert "armory" in exc.value.message
        finally:
            shutil.rmtree(os.path.join(LIB, "maps", f"M-{armory_tree}"), ignore_errors=True)


# ---------------------------------------------------------------------------
# Category edits
# ---------------------------------------------------------------------------


class TestWargameCategoryEdits:
    """A category edit moves a wargame book within its faction."""

    def _relocate(self, book_id, category):
        db = SessionLocal()
        try:
            book = db.query(Book).filter(Book.id == book_id).one()
            moved = fs.relocate_book_for_category(db, book, category)
            db.commit()
        finally:
            db.close()
        after = _load(book_id)
        return moved, after["relative_path"], after["category"], after["filepath"]

    def test_moves_into_a_category_folder_under_the_faction(self, armory_tree):
        _, book = _wargame_book(armory_tree, "Factions/Necrons/Codex.pdf")
        moved, rel, category, filepath = self._relocate(book.id, "supplement")
        expected = f"armory/War-{armory_tree}/Factions/Necrons/Supplements/Codex.pdf"
        assert moved == rel == expected
        assert category == "supplement"
        assert os.path.isfile(filepath)
        assert _load(book.id)["factions"] == ["necrons"]

    def test_through_the_book_editor(self, client, admin_headers, armory_tree):
        _, book = _wargame_book(armory_tree, "Factions/Necrons/Codex.pdf")
        resp = client.patch(
            f"/api/books/{book.id}", headers=admin_headers, json={"category": "lore"}
        )
        assert resp.status_code == 200, resp.text
        assert _load(book.id)["relative_path"] == (
            f"armory/War-{armory_tree}/Factions/Necrons/Lore/Codex.pdf"
        )

    def test_army_book_moves_back_into_the_faction(self, armory_tree):
        _, book = _wargame_book(armory_tree, "Factions/Necrons/Supplements/Old.pdf")
        _, rel, category, _ = self._relocate(book.id, "army-book")
        assert rel == f"armory/War-{armory_tree}/Factions/Necrons/Old.pdf"
        assert category == "army-book"

    def test_army_book_whose_name_says_otherwise_stays_put(self, armory_tree):
        # In the faction folder, or any army-book folder, the filename has the
        # last word: this reads as a supplement wherever it goes in Tau, so a
        # move would not keep the edit.
        _, book = _wargame_book(armory_tree, "Tau/Supplements/Codex Supplement - Farsight.pdf")
        moved, rel, _, _ = self._relocate(book.id, "army-book")
        assert moved is None
        assert rel == f"armory/War-{armory_tree}/Tau/Supplements/Codex Supplement - Farsight.pdf"
        assert sorted(os.listdir(os.path.join(ARMORY, f"War-{armory_tree}", "Tau"))) == [
            "Supplements"
        ]

    def test_army_book_outside_a_faction_joins_the_factions_folder(self, armory_tree):
        _, book = _wargame_book(armory_tree, "Missions/Index.pdf")
        _, rel, category, _ = self._relocate(book.id, "army-book")
        assert rel == f"armory/War-{armory_tree}/Factions/Index.pdf"
        assert category == "army-book"

    def test_book_outside_a_faction_joins_the_existing_folder(self, armory_tree):
        _, book = _wargame_book(armory_tree, "Core/Rules.pdf")
        _, rel, category, _ = self._relocate(book.id, "mission-pack")
        # The fixture's "Missions" folder, not a second one.
        assert rel == f"armory/War-{armory_tree}/Missions/Rules.pdf"
        assert category == "mission-pack"

    def test_book_outside_a_faction_gets_a_new_folder(self, armory_tree):
        _, book = _wargame_book(armory_tree, "Core/Rules.pdf")
        _, rel, _, _ = self._relocate(book.id, "errata")
        assert rel == f"armory/War-{armory_tree}/Rules Updates/Rules.pdf"

    def test_custom_category_folder_is_marked(self, armory_tree):
        _, book = _wargame_book(armory_tree, "Factions/Necrons/Report.pdf")
        _, rel, category, _ = self._relocate(book.id, "battle-reports")
        folder = Path(ARMORY) / f"War-{armory_tree}" / "Factions" / "Necrons"
        assert rel.endswith("/Factions/Necrons/Battle Reports/Report.pdf")
        assert (folder / "Battle Reports" / CATEGORY_MARKER).is_file()
        assert category == "battle-reports"

    def test_already_in_place_does_not_move(self, armory_tree):
        _, book = _wargame_book(armory_tree, "Missions/Pack.pdf")
        moved, rel, _, _ = self._relocate(book.id, "mission-pack")
        assert moved is None
        assert rel == f"armory/War-{armory_tree}/Missions/Pack.pdf"

    def test_a_faction_in_the_way_leaves_the_file(self, armory_tree):
        necrons = Path(ARMORY) / f"War-{armory_tree}" / "Factions" / "Necrons"
        (necrons / "Supplements").mkdir()
        (necrons / "Supplements" / FACTION_MARKER).touch()
        _, book = _wargame_book(armory_tree, "Factions/Necrons/Codex.pdf")
        moved, rel, category, _ = self._relocate(book.id, "supplement")
        assert moved is None
        assert rel.endswith("/Factions/Necrons/Codex.pdf")
        assert category == "army-book"

    def test_an_existing_folder_that_would_lose_the_faction(self, armory_tree, monkeypatch):
        _, book = _wargame_book(armory_tree, "Missions/Pack.pdf")
        monkeypatch.setattr(wargame_placement, "_category_folder_in", lambda a, c: Path(ARMORY))
        moved, _, _, _ = self._relocate(book.id, "lore")
        assert moved is None

    def test_a_name_taken_by_a_file_leaves_the_book(self, armory_tree):
        _write(f"armory/War-{armory_tree}/Factions/Necrons/Lore")
        _, book = _wargame_book(armory_tree, "Factions/Necrons/Codex.pdf")
        moved, _, _, _ = self._relocate(book.id, "lore")
        assert moved is None

    def test_a_folder_that_reads_wrong_is_not_left_behind(self, armory_tree):
        # "Army Lists" reads as army-book, so it cannot hold "army-lists".
        _, book = _wargame_book(armory_tree, "Factions/Necrons/Codex.pdf")
        moved, _, _, _ = self._relocate(book.id, "army-lists")
        assert moved is None
        necrons = Path(ARMORY) / f"War-{armory_tree}" / "Factions" / "Necrons"
        assert not (necrons / "Army Lists").exists()

    def test_paths_without_a_system_folder(self, armory_tree):
        db = SessionLocal()
        try:
            armory = Path(ARMORY)
            assert fs.wargame_category_folder_for(db, armory / "x.pdf", "core") is None
            assert fs.wargame_category_folder_for(db, armory / "x" / "y.pdf", "../x") is None
            # A file loose in a container sits above any system.
            container = armory / f"Family-{armory_tree}"
            container.mkdir()
            (container / CONTAINER_MARKERS[CONTAINER_PARENT]).touch()
            assert fs.wargame_category_folder_for(db, container / "x.pdf", "core") is None
        finally:
            db.close()

    def test_an_unreadable_anchor(self, monkeypatch):
        def boom(self):
            raise OSError("no")

        monkeypatch.setattr(Path, "iterdir", boom)
        assert wargame_placement._category_folder_in(Path(ARMORY), "core") is None

    def test_a_folder_that_cannot_be_created(self, armory_tree, monkeypatch):
        def boom(self, *a, **k):
            raise OSError("read-only")

        monkeypatch.setattr(Path, "mkdir", boom)
        anchor = Path(ARMORY) / f"War-{armory_tree}"
        assert (
            wargame_placement._create_category_folder(anchor, "lore", lambda _: True)
            is None
        )

    def test_a_marker_that_cannot_be_written(self, armory_tree, monkeypatch):
        def boom(self, *a, **k):
            raise OSError("read-only")

        monkeypatch.setattr(Path, "touch", boom)
        anchor = Path(ARMORY) / f"War-{armory_tree}"
        # Without its marker "Battle Reports" reads as a faction, so the
        # folder does not fit and is removed again.
        out = wargame_placement._create_category_folder(
            anchor, "battle-reports", lambda _: False
        )
        assert out is None
        assert not (anchor / "Battle Reports").exists()

    def test_a_folder_that_cannot_be_removed(self, armory_tree, monkeypatch):
        def boom(self):
            raise OSError("busy")

        anchor = Path(ARMORY) / f"War-{armory_tree}"
        monkeypatch.setattr(Path, "rmdir", boom)
        out = wargame_placement._create_category_folder(
            anchor, "lore", lambda _: False
        )
        assert out is None

    def test_the_move_is_never_attempted_on_a_role_playing_path(self, armory_tree, monkeypatch):
        called = []
        monkeypatch.setattr(
            fs_moves, "wargame_category_folder_for", lambda *a: called.append(a) or None
        )
        _, book = _rpg_book(armory_tree, "core/Book.pdf")
        os.makedirs(os.path.join(LIB, "books", f"Rpg-{armory_tree}", "Adventures"))
        moved, rel, _, _ = self._relocate(book.id, "adventure")
        assert moved == rel == f"books/Rpg-{armory_tree}/Adventures/Book.pdf"
        assert called == []
