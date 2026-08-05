"""Tests for system container folders (issues #261, #262).

A container is a books folder whose immediate children are systems in their own
right rather than categories. Two flavours:

* ``parent``   — ``books/Dungeons & Dragons/5e/core/`` → system "Dungeons &
  Dragons 5e" with parent_system/edition filled in and normal category inference
  below the edition folder.
* ``one-page`` — ``books/one-page-rpgs/`` where every subfolder *and* every loose
  file is its own small system.

Containers are declared by marker file, by a ``(parent-system)``/``(one-page)``
folder-name suffix, or (for one-page) by a reserved folder slug.
"""
import tempfile
from pathlib import Path

from backend.config import SessionLocal
from backend.models import Book, GameSystem
from backend.indexer import scan_library


def _mk_lib():
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    lib.mkdir()
    return tmp, lib


def _books_dir(lib: Path, *parts: str) -> Path:
    d = lib.joinpath("books", *parts)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _touch_pdf(folder: Path, name: str = "book.pdf") -> Path:
    p = folder / name
    p.write_bytes(b"%PDF-1.4")
    return p


def _scan(lib: Path, tmp: str):
    db = SessionLocal()
    try:
        scan_library(str(lib), tmp, db)
    finally:
        db.close()


def _system(slug: str):
    db = SessionLocal()
    try:
        return db.query(GameSystem).filter_by(slug=slug).first()
    finally:
        db.close()


def _books_for(slug: str, lib: Path | None = None):
    """Books registered against a system.

    Tests in this module share one database, and each scan uses a fresh temp
    library, so rows from earlier tests linger under the same system slug. Pass
    ``lib`` to keep only the books belonging to that scan's library.
    """
    db = SessionLocal()
    try:
        system = db.query(GameSystem).filter_by(slug=slug).first()
        if system is None:
            return []
        books = db.query(Book).filter_by(game_system_id=system.id).all()
        if lib is not None:
            books = [b for b in books if b.filepath.startswith(str(lib))]
        return books
    finally:
        db.close()


class TestParentSystemContainer:
    """books/<parent>/<edition>/<category>/ via the .parent-system-container marker."""

    def _build(self):
        tmp, lib = _mk_lib()
        root = _books_dir(lib, "Ctr Dungeons & Dragons")
        (root / ".parent-system-container").write_text("")
        _touch_pdf(_books_dir(lib, "Ctr Dungeons & Dragons", "5e", "core"), "phb.pdf")
        _touch_pdf(_books_dir(lib, "Ctr Dungeons & Dragons", "3e", "core"), "phb3.pdf")
        _scan(lib, tmp)
        return tmp, lib

    def test_container_row_marked_and_holds_no_books(self):
        _, lib = self._build()
        container = _system("ctr-dungeons-dragons")
        assert container is not None
        assert container.container_kind == "parent"
        assert _books_for("ctr-dungeons-dragons", lib) == []

    def test_edition_folders_become_systems(self):
        self._build()
        child = _system("ctr-dungeons-dragons--5e")
        assert child is not None
        assert child.container_kind == ""

    def test_child_default_name_combines_parent_and_edition(self):
        self._build()
        assert _system("ctr-dungeons-dragons--5e").name == "Ctr Dungeons & Dragons 5e"

    def test_child_records_parent_system_and_edition(self):
        self._build()
        child = _system("ctr-dungeons-dragons--5e")
        assert child.parent_system == "Ctr Dungeons & Dragons"
        assert child.edition == "5e"

    def test_child_links_to_container_row(self):
        self._build()
        container = _system("ctr-dungeons-dragons")
        assert _system("ctr-dungeons-dragons--3e").parent_id == container.id

    def test_category_inference_runs_below_the_edition_folder(self):
        _, lib = self._build()
        books = _books_for("ctr-dungeons-dragons--5e", lib)
        assert [b.category for b in books] == ["core"]

    def test_books_belong_to_the_edition_not_the_container(self):
        _, lib = self._build()
        titles = {b.title for b in _books_for("ctr-dungeons-dragons--5e", lib)}
        assert titles == {"phb"}

    def test_sibling_editions_do_not_collide(self):
        _, lib = self._build()
        assert {b.title for b in _books_for("ctr-dungeons-dragons--3e", lib)} == {"phb3"}


class TestParentSystemSuffix:
    """The (parent-system) folder-name suffix, mirroring how (nsfw) works."""

    def test_suffix_declares_a_container(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "Ctr Cyberpunk (parent-system)", "Red", "core"))
        _scan(lib, tmp)
        assert _system("ctr-cyberpunk").container_kind == "parent"

    def test_suffix_stripped_from_stored_name(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "Ctr Cyberpunk (parent-system)", "Red", "core"))
        _scan(lib, tmp)
        assert _system("ctr-cyberpunk").name == "Ctr Cyberpunk"

    def test_child_named_from_stripped_parent(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "Ctr Cyberpunk (parent-system)", "Red", "core"))
        _scan(lib, tmp)
        assert _system("ctr-cyberpunk--red").name == "Ctr Cyberpunk Red"

    def test_suffix_combines_with_nsfw_and_sort_prefix(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "!!Ctr Forbidden (parent-system) (NSFW)", "1e", "core"))
        _scan(lib, tmp)
        container = _system("ctr-forbidden")
        assert container.container_kind == "parent"
        assert container.is_explicit is True


class TestNsfwMarkerFile:
    """.nsfw marker file, for parity with the (nsfw) folder-name suffix."""

    def test_marker_marks_system_explicit(self):
        tmp, lib = _mk_lib()
        root = _books_dir(lib, "Ctr Forbidden Lore")
        (root / ".nsfw").write_text("")
        _touch_pdf(_books_dir(lib, "Ctr Forbidden Lore", "core"))
        _scan(lib, tmp)
        assert _system("ctr-forbidden-lore").is_explicit is True

    def test_marker_does_not_alter_the_name(self):
        tmp, lib = _mk_lib()
        root = _books_dir(lib, "Ctr Forbidden Lore")
        (root / ".nsfw").write_text("")
        _touch_pdf(_books_dir(lib, "Ctr Forbidden Lore", "core"))
        _scan(lib, tmp)
        assert _system("ctr-forbidden-lore").name == "Ctr Forbidden Lore"

    def test_system_without_marker_is_not_explicit(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "Ctr Plain System", "core"))
        _scan(lib, tmp)
        assert _system("ctr-plain-system").is_explicit is False


class TestOnePageContainer:
    """The issue #262 layout: subfolders and loose files are both systems."""

    def _build(self):
        tmp, lib = _mk_lib()
        root = _books_dir(lib, "one-page-rpgs")
        _touch_pdf(root, "honey-heist.pdf")
        _touch_pdf(root, "lasers-and-feelings.pdf")
        _touch_pdf(_books_dir(lib, "one-page-rpgs", "cbr+pnk", "core"), "core-rules.pdf")
        _touch_pdf(
            _books_dir(lib, "one-page-rpgs", "cbr+pnk", "character-sheets"), "character.pdf"
        )
        _scan(lib, tmp)
        return tmp, lib

    def test_container_marked_one_page(self):
        self._build()
        container = _system("one-page-rpgs")
        assert container.container_kind == "one-page"
        assert container.is_one_page is True

    def test_loose_file_becomes_its_own_system(self):
        self._build()
        assert _system("one-page-rpgs--honey-heist") is not None

    def test_loose_file_system_name_is_prettified(self):
        self._build()
        assert _system("one-page-rpgs--honey-heist").name == "Honey Heist"

    def test_loose_file_system_holds_exactly_its_one_book(self):
        _, lib = self._build()
        books = _books_for("one-page-rpgs--honey-heist", lib)
        assert [b.filename for b in books] == ["honey-heist.pdf"]

    def test_each_loose_file_is_a_separate_system(self):
        _, lib = self._build()
        assert _system("one-page-rpgs--lasers-and-feelings") is not None
        assert len(_books_for("one-page-rpgs--lasers-and-feelings", lib)) == 1

    def test_subfolder_becomes_its_own_system(self):
        self._build()
        assert _system("one-page-rpgs--cbrpnk") is not None

    def test_subfolder_system_keeps_internal_categories(self):
        _, lib = self._build()
        categories = sorted(b.category for b in _books_for("one-page-rpgs--cbrpnk", lib))
        assert categories == ["character-sheet", "core"]

    def test_subfolder_system_holds_both_of_its_books(self):
        _, lib = self._build()
        assert len(_books_for("one-page-rpgs--cbrpnk", lib)) == 2

    def test_children_link_to_the_container(self):
        self._build()
        container = _system("one-page-rpgs")
        for slug in ("one-page-rpgs--honey-heist", "one-page-rpgs--cbrpnk"):
            assert _system(slug).parent_id == container.id

    def test_children_are_not_flagged_as_the_one_page_collection(self):
        """Children are ordinary systems, so they count toward the systems total."""
        self._build()
        assert _system("one-page-rpgs--honey-heist").is_one_page is False
        assert _system("one-page-rpgs--cbrpnk").is_one_page is False

    def test_container_itself_holds_no_books(self):
        _, lib = self._build()
        assert _books_for("one-page-rpgs", lib) == []


class TestMicroRpgsSlug:
    def test_micro_rpgs_is_a_one_page_container(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "micro-rpgs"), "tiny-game.pdf")
        _scan(lib, tmp)
        container = _system("micro-rpgs")
        assert container.container_kind == "one-page"
        assert container.is_one_page is True

    def test_micro_rpgs_loose_file_becomes_a_system(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "micro-rpgs"), "tiny-game.pdf")
        _scan(lib, tmp)
        assert _system("micro-rpgs--tiny-game").name == "Tiny Game"


class TestOnePageMarkerOnArbitraryFolder:
    def test_marker_makes_any_folder_a_one_page_container(self):
        tmp, lib = _mk_lib()
        root = _books_dir(lib, "Ctr Itch Bundle")
        (root / ".one-page-container").write_text("")
        _touch_pdf(root, "some-jam-game.pdf")
        _scan(lib, tmp)
        assert _system("ctr-itch-bundle").container_kind == "one-page"
        assert _system("ctr-itch-bundle--some-jam-game").name == "Some Jam Game"


class TestNonContainerUnchanged:
    """An ordinary system folder must behave exactly as it did before."""

    def test_plain_system_keeps_categories_not_child_systems(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "Ctr Shadowrun", "core"), "rules.pdf")
        _scan(lib, tmp)
        system = _system("ctr-shadowrun")
        assert system.container_kind == ""
        assert system.parent_id is None
        assert [b.category for b in _books_for("ctr-shadowrun", lib)] == ["core"]

    def test_system_agnostic_still_uses_subfolder_categories(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "system-agnostic", "maps"), "a-map.pdf")
        _scan(lib, tmp)
        system = _system("system-agnostic")
        assert system.is_system_agnostic is True
        assert system.container_kind == ""
        assert [b.category for b in _books_for("system-agnostic", lib)] == ["maps"]


class TestRenameSurvivesRescan:
    def test_user_renamed_child_keeps_its_name_on_rescan(self):
        tmp, lib = _mk_lib()
        root = _books_dir(lib, "Ctr Dungeons & Dragons")
        (root / ".parent-system-container").write_text("")
        _touch_pdf(_books_dir(lib, "Ctr Dungeons & Dragons", "2e", "core"), "phb2.pdf")
        _scan(lib, tmp)

        db = SessionLocal()
        try:
            child = db.query(GameSystem).filter_by(slug="ctr-dungeons-dragons--2e").first()
            assert child.name == "Ctr Dungeons & Dragons 2e"
            child.name = "Ctr Advanced Dungeons & Dragons"
            child.name_is_custom = True
            db.commit()
        finally:
            db.close()

        _scan(lib, tmp)
        assert _system("ctr-dungeons-dragons--2e").name == "Ctr Advanced Dungeons & Dragons"

    def test_untouched_child_name_refreshes_from_folders(self):
        tmp, lib = _mk_lib()
        root = _books_dir(lib, "Ctr Dungeons & Dragons")
        (root / ".parent-system-container").write_text("")
        _touch_pdf(_books_dir(lib, "Ctr Dungeons & Dragons", "5e", "core"), "phb.pdf")
        _scan(lib, tmp)

        db = SessionLocal()
        try:
            child = db.query(GameSystem).filter_by(slug="ctr-dungeons-dragons--5e").first()
            child.name = "stale"
            db.commit()
        finally:
            db.close()

        _scan(lib, tmp)
        assert _system("ctr-dungeons-dragons--5e").name == "Ctr Dungeons & Dragons 5e"


class TestNameCollisionWithExistingSystem:
    """A container child whose generated name already exists (the #261 upgrade path).

    ``game_systems.name`` is unique. Someone reorganising a flat
    ``books/Dungeons & Dragons 5e/`` into ``books/Dungeons & Dragons/5e/`` has a
    row under the old name already; the scan must neither crash nor orphan it.
    """

    def test_existing_flat_system_is_adopted_not_duplicated(self):
        tmp, lib = _mk_lib()
        # First scan: the flat layout people have today.
        _touch_pdf(_books_dir(lib, "Adopt Quest 5e", "core"), "phb.pdf")
        _scan(lib, tmp)
        original = _system("adopt-quest-5e")
        assert original is not None

        # Reorganise into a container and rescan.
        tmp2, lib2 = _mk_lib()
        root = _books_dir(lib2, "Adopt Quest")
        (root / ".parent-system-container").write_text("")
        _touch_pdf(_books_dir(lib2, "Adopt Quest", "5e", "core"), "phb.pdf")
        _scan(lib2, tmp2)

        # The same row was re-slugged rather than a second one inserted.
        adopted = _system("adopt-quest--5e")
        assert adopted is not None
        assert adopted.id == original.id

    def test_adopted_system_keeps_its_books(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "Adopt Books 5e", "core"), "phb.pdf")
        _scan(lib, tmp)
        assert len(_books_for("adopt-books-5e", lib)) == 1

        tmp2, lib2 = _mk_lib()
        root = _books_dir(lib2, "Adopt Books")
        (root / ".parent-system-container").write_text("")
        _touch_pdf(_books_dir(lib2, "Adopt Books", "5e", "core"), "phb.pdf")
        _scan(lib2, tmp2)

        # The original book is still attached to the adopted system.
        books = _books_for("adopt-books--5e")
        assert any(b.filepath.startswith(str(lib)) for b in books)

    def test_adopted_system_gains_container_metadata(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "Adopt Meta 5e", "core"), "phb.pdf")
        _scan(lib, tmp)

        tmp2, lib2 = _mk_lib()
        root = _books_dir(lib2, "Adopt Meta")
        (root / ".parent-system-container").write_text("")
        _touch_pdf(_books_dir(lib2, "Adopt Meta", "5e", "core"), "phb.pdf")
        _scan(lib2, tmp2)

        adopted = _system("adopt-meta--5e")
        container = _system("adopt-meta")
        assert adopted.parent_id == container.id
        assert adopted.parent_system == "Adopt Meta"
        assert adopted.edition == "5e"

    def test_unrelated_name_clash_falls_back_to_a_suffixed_name(self):
        """An unrelated system already owning the name must not be hijacked."""
        tmp, lib = _mk_lib()
        # A pre-existing system that is itself inside another container, so it is
        # not a candidate for adoption.
        root = _books_dir(lib, "Clash Owner")
        (root / ".parent-system-container").write_text("")
        _touch_pdf(_books_dir(lib, "Clash Owner", "5e", "core"), "phb.pdf")
        _scan(lib, tmp)
        owned = _system("clash-owner--5e")
        assert owned.name == "Clash Owner 5e"

        # A different container generating the identical child name.
        tmp2, lib2 = _mk_lib()
        root2 = _books_dir(lib2, "Clash Owner 5e")
        (root2 / ".parent-system-container").write_text("")
        _touch_pdf(_books_dir(lib2, "Clash Owner 5e", "x", "core"), "b.pdf")
        _scan(lib2, tmp2)

        # The original keeps its name; nothing crashed.
        assert _system("clash-owner--5e").name == "Clash Owner 5e"
        assert _system("clash-owner-5e") is not None

    def test_scan_completes_despite_the_collision(self):
        """Regression: the collision used to abort the whole scan with IntegrityError."""
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "Survive Quest 5e", "core"), "phb.pdf")
        _scan(lib, tmp)

        tmp2, lib2 = _mk_lib()
        root = _books_dir(lib2, "Survive Quest")
        (root / ".parent-system-container").write_text("")
        _touch_pdf(_books_dir(lib2, "Survive Quest", "5e", "core"), "phb.pdf")
        # A sibling registered *after* the colliding one — proof the scan kept going.
        _touch_pdf(_books_dir(lib2, "Survive Quest", "6e", "core"), "phb6.pdf")
        _scan(lib2, tmp2)

        assert _system("survive-quest--6e") is not None


class TestUpgradingAnExistingOnePageCollection:
    """Books must follow their game when a folder becomes a container.

    Before containers existed, ``books/one-page-rpgs/`` was one flat system that
    owned every book, with subfolder names used as categories. After the upgrade
    each game is its own system — the books have not moved on disk, so the
    scanner has to re-home them or they vanish from the UI.
    """

    def _legacy_then_upgrade(self, folder="one-page-rpgs"):
        import backend.indexer.scan as scanmod

        tmp, lib = _mk_lib()
        root = _books_dir(lib, folder)
        _touch_pdf(root, "solo-game.pdf")
        _touch_pdf(_books_dir(lib, folder, "twopager", "core"), "rules.pdf")

        # Scan as the pre-container version did: no container detection.
        original = scanmod.detect_container_kind
        scanmod.detect_container_kind = lambda d, n: ""
        try:
            _scan(lib, tmp)
        finally:
            scanmod.detect_container_kind = original

        _scan(lib, tmp)  # upgrade rescan, containers enabled
        return tmp, lib

    def test_loose_file_book_moves_to_its_own_system(self):
        _, lib = self._legacy_then_upgrade()
        books = _books_for("one-page-rpgs--solo-game", lib)
        assert [b.filename for b in books] == ["solo-game.pdf"]

    def test_subfolder_books_move_to_their_game(self):
        _, lib = self._legacy_then_upgrade()
        books = _books_for("one-page-rpgs--twopager", lib)
        assert [b.filename for b in books] == ["rules.pdf"]

    def test_container_keeps_no_books_after_the_upgrade(self):
        _, lib = self._legacy_then_upgrade()
        assert _books_for("one-page-rpgs", lib) == []

    def test_rehomed_book_category_is_recomputed(self):
        """The old category was the subfolder name; inside the game it is 'core'."""
        _, lib = self._legacy_then_upgrade()
        books = _books_for("one-page-rpgs--twopager", lib)
        assert [b.category for b in books] == ["core"]

    def test_upgrade_is_idempotent(self):
        tmp, lib = self._legacy_then_upgrade()
        _scan(lib, tmp)
        assert len(_books_for("one-page-rpgs--solo-game", lib)) == 1
        assert _books_for("one-page-rpgs", lib) == []
