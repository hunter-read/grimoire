"""Tests for the armory: wargame books in the library's ``armory/`` folder.

``armory/<System>/...`` is laid out like ``books/``. Its systems and books are
tagged ``game_type="wargame"``, its books are read with the wargame category
vocabulary, and the folders a book sits in name its factions.
"""
import shutil
import tempfile
import uuid
from pathlib import Path

import pytest

from backend.config import SessionLocal
from backend.indexer import scan_library
from backend.indexer.factions import place_wargame_book
from backend.indexer.metadata import resolve_armory_dir, resolve_scope
from backend.models import Book, Faction, GameSystem
from backend.models.game_types import game_type_for_path, is_armory_path
from backend.services import tag_service


@pytest.fixture
def lib():
    tmp = tempfile.mkdtemp()
    library = Path(tmp) / "library"
    library.mkdir()
    yield tmp, library
    shutil.rmtree(tmp, ignore_errors=True)


def _pdf(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Unique bytes: the tests share a database, and a file whose hash another
    # test's vanished book has would be read as that book moving here.
    path.write_bytes(b"%PDF-1.4 " + uuid.uuid4().bytes)
    return path


def _scan(tmp: str, library: Path, **kw):
    db = SessionLocal()
    try:
        return scan_library(str(library), tmp, db, **kw)
    finally:
        db.close()


def _book(library: Path, *parts: str) -> Book:
    path = str(library.joinpath(*parts))
    db = SessionLocal()
    try:
        book = db.query(Book).filter_by(filepath=path).one()
        book.faction_names = sorted(f.name for f in book.factions)
        book.system_game_type = book.game_system.game_type
        db.expunge(book)
        return book
    finally:
        db.close()


def _name() -> str:
    """A system folder name no other test in the shared database uses."""
    return f"Game {uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# Systems and books
# ---------------------------------------------------------------------------


def test_wargame_and_rpg_systems_can_share_a_name(lib):
    tmp, library = lib
    name = _name()
    _pdf(library / "books" / name / "core" / "rpg.pdf")
    _pdf(library / "armory" / name / "Core" / "wargame.pdf")
    stats = _scan(tmp, library)
    assert stats["new_books"] == 2

    rpg = _book(library, "books", name, "core", "rpg.pdf")
    war = _book(library, "armory", name, "Core", "wargame.pdf")
    assert rpg.game_type == "ttrpg" and rpg.system_game_type == "ttrpg"
    assert war.game_type == "wargame" and war.system_game_type == "wargame"
    assert war.relative_path == f"armory/{name}/Core/wargame.pdf"
    assert rpg.game_system_id != war.game_system_id
    db = SessionLocal()
    try:
        systems = db.query(GameSystem).filter_by(name=name).all()
        assert sorted(s.game_type for s in systems) == ["ttrpg", "wargame"]
        assert {s.slug for s in systems} == {systems[0].slug}
    finally:
        db.close()


def test_the_british_spelling_is_the_armory_too(lib):
    tmp, library = lib
    name = _name()
    _pdf(library / "Armoury" / name / "Core" / "rules.pdf")
    _scan(tmp, library)
    assert _book(library, "Armoury", name, "Core", "rules.pdf").game_type == "wargame"
    assert resolve_armory_dir(library) == library / "Armoury"


def test_faction_first_layout_with_editions_and_sub_factions(lib):
    tmp, library = lib
    name = _name()
    root = library / "armory" / name
    edition = root / "10th Edition"
    root.mkdir(parents=True)
    (root / ".parent-system-container").touch()
    _pdf(edition / "Factions" / "Necrons" / "Codex - Necrons.pdf")
    _pdf(
        edition
        / "Factions"
        / "Space Marines"
        / "Blood Angels"
        / "Codex Supplement - Blood Angels.pdf"
    )
    _pdf(edition / "Factions" / "Necrons" / "Rules Updates" / "Balance.pdf")
    _pdf(edition / "Core" / "Core Book.pdf")
    _scan(tmp, library)

    parts = ("armory", name, "10th Edition")
    codex = _book(library, *parts, "Factions", "Necrons", "Codex - Necrons.pdf")
    assert (codex.category, codex.faction_names) == ("army-book", ["Necrons"])

    supplement = _book(
        library,
        *parts,
        "Factions",
        "Space Marines",
        "Blood Angels",
        "Codex Supplement - Blood Angels.pdf",
    )
    assert (supplement.category, supplement.faction_names) == ("supplement", ["Blood Angels"])

    errata = _book(library, *parts, "Factions", "Necrons", "Rules Updates", "Balance.pdf")
    assert (errata.category, errata.faction_names) == ("errata", ["Necrons"])

    core = _book(library, *parts, "Core", "Core Book.pdf")
    assert (core.category, core.faction_names) == ("core", [])

    db = SessionLocal()
    try:
        edition_row = db.query(GameSystem).filter_by(name=f"{name} 10th Edition").one()
        assert edition_row.game_type == "wargame"
        assert tag_service.system_category_depth(db, edition_row.id) == 3
        blood = (
            db.query(Faction).filter_by(game_system_id=edition_row.id, name="Blood Angels").one()
        )
        assert blood.parent.name == "Space Marines"
        assert blood.slug == "space-marines--blood-angels"
        # Each faction is created once however many books name it.
        assert (
            db.query(Faction).filter_by(game_system_id=edition_row.id, name="Necrons").count()
            == 1
        )
    finally:
        db.close()


def test_category_first_layout_and_markers(lib):
    tmp, library = lib
    name = _name()
    system = library / "armory" / name
    _pdf(system / "Codexes" / "Necrons" / "Codex.pdf")
    _pdf(system / "Campaigns" / "Pariah Nexus" / "Book One.pdf")
    _pdf(system / "Kill Team Extras" / "Extras.pdf")
    (system / "Kill Team Extras" / ".category").touch()
    _pdf(system / "Armies of Order" / "Order.pdf")
    (system / "Armies of Order" / ".faction").touch()
    _pdf(system / "loose rules.pdf")
    _scan(tmp, library)

    codex = _book(library, "armory", name, "Codexes", "Necrons", "Codex.pdf")
    assert (codex.category, codex.faction_names) == ("army-book", ["Necrons"])
    campaign = _book(library, "armory", name, "Campaigns", "Pariah Nexus", "Book One.pdf")
    assert (campaign.category, campaign.faction_names) == ("campaign", [])
    extras = _book(library, "armory", name, "Kill Team Extras", "Extras.pdf")
    assert (extras.category, extras.faction_names) == ("kill-team-extras", [])
    order = _book(library, "armory", name, "Armies of Order", "Order.pdf")
    assert (order.category, order.faction_names) == ("army-book", ["Armies of Order"])
    loose = _book(library, "armory", name, "loose rules.pdf")
    assert (loose.category, loose.faction_names) == ("core", [])


def test_role_playing_books_keep_their_vocabulary(lib):
    """'Campaigns' is an adventure in books/, and a campaign book in the armory."""
    tmp, library = lib
    name = _name()
    _pdf(library / "books" / name / "Campaigns" / "rpg.pdf")
    _pdf(library / "armory" / name / "Campaigns" / "war.pdf")
    _scan(tmp, library)
    rpg = _book(library, "books", name, "Campaigns", "rpg.pdf")
    war = _book(library, "armory", name, "Campaigns", "war.pdf")
    assert (rpg.category, rpg.faction_names) == ("adventure", [])
    assert (war.category, war.faction_names) == ("campaign", [])


def test_place_wargame_book_reads_the_filename_last(tmp_path):
    lib = str(tmp_path)
    assert place_wargame_book("armory/G/Necrons/Necron Painting Guide.pdf", 2, lib) == (
        "painting-guide",
        ["Necrons"],
    )
    assert place_wargame_book("armory/G/Missions/Deck.pdf", 2, lib) == ("mission-pack", [])
    assert place_wargame_book("armory/G/White Dwarf 500.pdf", 2, lib) == ("magazine", [])


def test_rehomed_wargame_book_picks_up_its_game_type(lib):
    """A book that changes system on a rescan takes the new system's type and factions."""
    tmp, library = lib
    name = _name()
    system = library / "armory" / name
    _pdf(system / "Necrons" / "Codex.pdf")
    _scan(tmp, library)
    db = SessionLocal()
    try:
        book = db.query(Book).filter_by(filepath=str(system / "Necrons" / "Codex.pdf")).one()
        book.game_system_id = None
        book.game_type = "ttrpg"
        db.commit()
    finally:
        db.close()
    _scan(tmp, library)
    book = _book(library, "armory", name, "Necrons", "Codex.pdf")
    assert (book.game_type, book.faction_names) == ("wargame", ["Necrons"])


def test_system_tags_json_applies_to_wargame_systems(lib):
    tmp, library = lib
    name = _name()
    _pdf(library / "books" / name / "core" / "rpg.pdf")
    system = library / "armory" / name
    _pdf(system / "Core" / "rules.pdf")
    (system / "tags.json").write_text('{".": ["Grimdark"]}')
    _scan(tmp, library)
    db = SessionLocal()
    try:
        war = db.query(GameSystem).filter_by(name=name, game_type="wargame").one()
        rpg = db.query(GameSystem).filter_by(name=name, game_type="ttrpg").one()
        assert tag_service.display_tags_for_resource(db, "system", war.id) == ["Grimdark"]
        # The role-playing system of the same name is not the folder's.
        assert tag_service.display_tags_for_resource(db, "system", rpg.id) == []
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Rescans
# ---------------------------------------------------------------------------


def test_vanished_wargame_system_is_pruned(lib):
    tmp, library = lib
    name = _name()
    (library / "books").mkdir()
    system = library / "armory" / name
    _pdf(system / "Core" / "rules.pdf")
    _scan(tmp, library)
    shutil.rmtree(system)
    stats = _scan(tmp, library)
    assert stats["removed_systems"] >= 1
    db = SessionLocal()
    try:
        assert db.query(GameSystem).filter_by(name=name, game_type="wargame").first() is None
    finally:
        db.close()


def test_scoped_rescan_of_an_armory_system(lib):
    tmp, library = lib
    name = _name()
    other = _name()
    _pdf(library / "armory" / name / "Necrons" / "Codex.pdf")
    _pdf(library / "armory" / other / "Core" / "rules.pdf")
    _pdf(library / "books" / name / "core" / "rpg.pdf")
    stats = _scan(tmp, library, scope_path=f"armory/{name}")
    assert stats["new_books"] == 1
    assert _book(library, "armory", name, "Necrons", "Codex.pdf").faction_names == ["Necrons"]
    db = SessionLocal()
    try:
        assert db.query(GameSystem).filter_by(name=other).first() is None
        assert db.query(GameSystem).filter_by(name=name, game_type="ttrpg").first() is None
    finally:
        db.close()

    # A books/ scope leaves the armory alone.
    stats = _scan(tmp, library, scope_path=f"books/{name}")
    assert stats["new_books"] == 1
    db = SessionLocal()
    try:
        assert db.query(GameSystem).filter_by(name=other).first() is None
    finally:
        db.close()


def test_resolve_scope_understands_the_armory(lib):
    tmp, library = lib
    (library / "Armoury" / "War").mkdir(parents=True)
    section, target = resolve_scope(str(library), "armoury/War")
    assert (section, target) == ("armory", library / "Armoury" / "War")
    assert resolve_scope(str(library), "armory")[0] == "armory"
    with pytest.raises(ValueError):  # escaping the library
        resolve_scope(str(library), "armory/../../elsewhere")


def test_game_type_helpers():
    assert is_armory_path("Armoury/G/x.pdf")
    assert is_armory_path("/armory/G/x.pdf")
    assert not is_armory_path("books/armory.pdf")
    assert not is_armory_path(None)
    assert game_type_for_path("armory/G/x.pdf") == "wargame"
    assert game_type_for_path("books/G/x.pdf") == "ttrpg"
