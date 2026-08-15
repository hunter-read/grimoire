"""Integration tests for ``.grimoireignore`` in the library scanner (issue #224).

Drives the real ``scan_library`` against a temp library and asserts that files
and directories matched by a ``.grimoireignore`` rule are never registered, that
progress totals exclude them, and that a file newly matched by an ignore rule is
marked missing (removed from the UI) on rescan.
"""
import shutil
import tempfile
from pathlib import Path

from backend.config import SessionLocal
from backend.indexer import scan_library
from backend.library_ignore import IGNORE_FILENAME
from backend.models import Audio, Book, GameSystem, GenericMap, Token


def _mk_lib():
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    lib.mkdir()
    return tmp, lib


def _mkdir(lib: Path, *parts: str) -> Path:
    d = lib.joinpath(*parts)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _touch_pdf(folder: Path, name: str) -> Path:
    p = folder / name
    p.write_bytes(b"%PDF-1.4")
    return p


def _touch_img(folder: Path, name: str) -> Path:
    p = folder / name
    p.write_bytes(b"\x89PNG\r\n\x1a\n")
    return p


def _touch_audio(folder: Path, name: str) -> Path:
    p = folder / name
    p.write_bytes(b"ID3fakefake")
    return p


def _scan(lib: Path, tmp: str, **kw) -> dict:
    db = SessionLocal()
    try:
        return scan_library(str(lib), tmp, db, **kw)
    finally:
        db.close()


def _book_filenames(system_slug: str) -> set[str]:
    db = SessionLocal()
    try:
        system = db.query(GameSystem).filter_by(slug=system_slug).first()
        if system is None:
            return set()
        return {b.filename for b in db.query(Book).filter_by(game_system_id=system.id).all()}
    finally:
        db.close()


class TestBooksIgnore:
    def test_ignored_directory_and_glob_not_indexed(self):
        tmp, lib = _mk_lib()
        core = _mkdir(lib, "books", "Ign224 Books", "core")
        ignore = _mkdir(lib, "books", "Ign224 Books", "ignore")
        _touch_pdf(core, "Players Handbook.pdf")
        _touch_pdf(core, "Players Handbook BW Single Pages.pdf")
        _touch_pdf(ignore, "Zine Variant.pdf")
        (lib / IGNORE_FILENAME).write_text("ignore/\n*BW Single Pages*.pdf\n")

        _scan(lib, tmp)

        names = _book_filenames("ign224-books")
        assert "Players Handbook.pdf" in names
        assert "Players Handbook BW Single Pages.pdf" not in names
        assert "Zine Variant.pdf" not in names

    def test_ignore_file_itself_not_indexed(self):
        tmp, lib = _mk_lib()
        core = _mkdir(lib, "books", "Ign224 Self", "core")
        _touch_pdf(core, "Book.pdf")
        (lib / IGNORE_FILENAME).write_text("*.tmp\n")
        _scan(lib, tmp)
        # The dot-file is skipped like any hidden file; only the real book lands.
        assert _book_filenames("ign224-self") == {"Book.pdf"}

    def test_nested_ignore_scoped_to_subtree(self):
        tmp, lib = _mk_lib()
        sys_a = _mkdir(lib, "books", "Ign224 SysA", "core")
        sys_b = _mkdir(lib, "books", "Ign224 SysB", "core")
        _touch_pdf(sys_a, "draft.bak.pdf")
        _touch_pdf(sys_b, "draft.bak.pdf")
        # Nested ignore under SysA only.
        (lib / "books" / "Ign224 SysA" / IGNORE_FILENAME).write_text("*.bak.pdf\n")

        _scan(lib, tmp)

        assert "draft.bak.pdf" not in _book_filenames("ign224-sysa")
        assert "draft.bak.pdf" in _book_filenames("ign224-sysb")

    def test_progress_total_excludes_ignored(self):
        tmp, lib = _mk_lib()
        core = _mkdir(lib, "books", "Ign224 Total", "core")
        _touch_pdf(core, "keep.pdf")
        _touch_pdf(core, "skip.pdf")
        (lib / IGNORE_FILENAME).write_text("skip.pdf\n")

        seen_totals = []

        def on_progress(sb, tb, *rest):
            seen_totals.append(tb)

        _scan(lib, tmp, on_progress=on_progress)
        # Total books reported to the progress callback counts only the kept file.
        assert max(seen_totals) == 1


class TestOtherCollectionsIgnore:
    def test_maps_tokens_audio_respect_ignore(self):
        tmp, lib = _mk_lib()
        maps = _mkdir(lib, "maps", "Ign224")
        tokens = _mkdir(lib, "tokens", "Ign224")
        audio = _mkdir(lib, "audio", "Ign224")
        _touch_img(maps, "keep.png")
        _touch_img(maps, "skip.png")
        _touch_img(tokens, "keep.png")
        _touch_img(tokens, "skip.png")
        _touch_audio(audio, "keep.mp3")
        _touch_audio(audio, "skip.mp3")
        (lib / IGNORE_FILENAME).write_text("skip.png\nskip.mp3\n")

        _scan(lib, tmp)

        db = SessionLocal()
        try:
            map_names = {m.filename for m in db.query(GenericMap).all()}
            token_names = {t.filename for t in db.query(Token).all()}
            audio_names = {a.filename for a in db.query(Audio).all()}
        finally:
            db.close()
        assert "keep.png" in map_names and "skip.png" not in map_names
        assert "keep.png" in token_names and "skip.png" not in token_names
        assert "keep.mp3" in audio_names and "skip.mp3" not in audio_names


class TestSystemFolderIgnore:
    """Directly-enumerated system folders honour ignore rules too (issue #333).

    The container and top-level system walks list directories themselves rather
    than going through ``os.walk``/``_prune_dirs``, so an ignored folder used to
    still be registered as a system (a NAS ``@eaDir`` becoming a bogus edition).
    """

    def test_ignored_container_child_not_registered_as_system(self):
        tmp, lib = _mk_lib()
        container = _mkdir(lib, "books", "Ign333 Shadowrun")
        (container / ".parent-system-container").write_text("")
        _touch_pdf(_mkdir(container, "6 DE", "core"), "core-book.pdf")
        _mkdir(container, "@eaDir")
        (lib / IGNORE_FILENAME).write_text("@eaDir/\n**/@eaDir/\n")

        _scan(lib, tmp)

        db = SessionLocal()
        try:
            children = db.query(GameSystem).filter_by(parent_system="Ign333 Shadowrun").all()
            editions = {c.edition for c in children}
        finally:
            db.close()
        # The real edition registers; the ignored NAS folder does not.
        assert "6 DE" in editions
        assert "@eaDir" not in editions

    def test_ignored_loose_file_not_registered_in_one_page_container(self):
        tmp, lib = _mk_lib()
        container = _mkdir(lib, "books", "Ign333 One Pagers")
        (container / ".one-page-container").write_text("")
        # Names are prefixed because game_systems.name is globally unique and the
        # test DB is shared across the suite.
        _touch_pdf(container, "ign333-honey-heist.pdf")
        _touch_pdf(container, "ign333-skip-me.pdf")
        (lib / IGNORE_FILENAME).write_text("ign333-skip-me.pdf\n")

        _scan(lib, tmp)

        db = SessionLocal()
        try:
            container_row = db.query(GameSystem).filter_by(slug="ign333-one-pagers").first()
            names = {
                s.name for s in db.query(GameSystem).filter_by(parent_id=container_row.id).all()
            }
        finally:
            db.close()
        assert any("Honey Heist" in n for n in names)
        assert not any("Skip Me" in n for n in names)

    def test_ignored_top_level_folder_not_registered_as_system(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_mkdir(lib, "books", "Ign333 Keeper", "core"), "book.pdf")
        _mkdir(lib, "books", "@eaDir")
        (lib / IGNORE_FILENAME).write_text("@eaDir/\n**/@eaDir/\n")

        _scan(lib, tmp)

        db = SessionLocal()
        try:
            names = {s.name for s in db.query(GameSystem).all()}
        finally:
            db.close()
        assert "Ign333 Keeper" in names
        assert not any("eaDir" in n for n in names)


class TestSystemPruning:
    """A system whose folder stops being scanned is removed (issue #354).

    ``TestSystemFolderIgnore`` covers the rule being present from the first scan.
    This is the other half, and the case actually reported: the folder was
    scanned *before* the rule existed, so a ``GameSystem`` row already exists.
    Ignoring the folder hid its books but left the system on the shelf forever.
    """

    def test_system_ignored_after_first_scan_is_removed(self):
        tmp, lib = _mk_lib()
        container = _mkdir(lib, "books", "Ign354 D&D")
        (container / ".parent-system-container").write_text("")
        _touch_pdf(_mkdir(container, "5e", "core"), "phb.pdf")
        # The NAS turd, indexed before anyone knew to exclude it.
        _touch_pdf(_mkdir(container, "@eaDir"), "thumb.pdf")

        _scan(lib, tmp)

        def _editions():
            db = SessionLocal()
            try:
                return {
                    c.edition
                    for c in db.query(GameSystem).filter_by(parent_system="Ign354 D&D").all()
                }
            finally:
                db.close()

        assert "@eaDir" in _editions(), "precondition: it was registered"

        # Now the user adds the rule the report describes.
        (container / IGNORE_FILENAME).write_text("@eaDir\n")
        stats = _scan(lib, tmp)

        editions = _editions()
        assert "5e" in editions, "the real edition must survive"
        assert "@eaDir" not in editions, "the ignored folder's system must be gone"
        assert stats["removed_systems"] >= 1

    def test_deleted_system_folder_is_removed(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_mkdir(lib, "books", "Ign354 Gone", "core"), "g.pdf")
        _touch_pdf(_mkdir(lib, "books", "Ign354 Stays", "core"), "s.pdf")
        _scan(lib, tmp)

        shutil.rmtree(lib / "books" / "Ign354 Gone")
        _scan(lib, tmp)

        db = SessionLocal()
        try:
            names = {s.name for s in db.query(GameSystem).all()}
        finally:
            db.close()
        assert "Ign354 Gone" not in names
        assert "Ign354 Stays" in names

    def test_user_renamed_or_annotated_systems_are_kept(self):
        """Pruning must not throw away a row someone has adapted by hand."""
        tmp, lib = _mk_lib()
        _touch_pdf(_mkdir(lib, "books", "Ign354 Renamed", "core"), "r.pdf")
        _touch_pdf(_mkdir(lib, "books", "Ign354 Described", "core"), "d.pdf")
        _scan(lib, tmp)

        db = SessionLocal()
        try:
            renamed = db.query(GameSystem).filter_by(slug="ign354-renamed").first()
            renamed.name = "Ign354 A Name I Chose"
            renamed.name_is_custom = True
            described = db.query(GameSystem).filter_by(slug="ign354-described").first()
            described.description = "notes I typed"
            # Drop the books too, so only the user's metadata argues for keeping.
            for book in db.query(Book).filter(
                Book.game_system_id.in_([renamed.id, described.id])
            ):
                db.delete(book)
            db.commit()
        finally:
            db.close()

        shutil.rmtree(lib / "books" / "Ign354 Renamed")
        shutil.rmtree(lib / "books" / "Ign354 Described")
        _scan(lib, tmp)

        db = SessionLocal()
        try:
            names = {s.name for s in db.query(GameSystem).all()}
        finally:
            db.close()
        assert "Ign354 A Name I Chose" in names
        assert "Ign354 Described" in names

    def test_scoped_rescan_prunes_nothing(self):
        """A scoped scan only walks one subtree, so everything else looks unseen."""
        tmp, lib = _mk_lib()
        _touch_pdf(_mkdir(lib, "books", "Ign354 Scoped", "core"), "a.pdf")
        _touch_pdf(_mkdir(lib, "books", "Ign354 Untouched", "core"), "b.pdf")
        _scan(lib, tmp)

        stats = _scan(lib, tmp, scope_path="books/Ign354 Scoped")

        db = SessionLocal()
        try:
            names = {s.name for s in db.query(GameSystem).all()}
        finally:
            db.close()
        assert stats["removed_systems"] == 0
        assert {"Ign354 Scoped", "Ign354 Untouched"} <= names

    def test_cancelled_scan_prunes_nothing(self):
        """A stopped scan must not delete the systems it never got to.

        Pruning keys off "this scan didn't walk here", and a cancelled scan
        stops walking partway — so without the stop check before the prune, a
        user hitting Cancel would lose every system below the stopping point.
        That turns issue #352 (editions missing until the next full scan) into
        actual data loss, so the guard is pinned here rather than left implicit.
        """
        tmp, lib = _mk_lib()
        container = _mkdir(lib, "books", "Ign354 Cancelled")
        (container / ".parent-system-container").write_text("")
        for edition in ("2e", "3e", "4e", "5e"):
            _touch_pdf(_mkdir(container, edition, "core"), f"{edition}-core.pdf")

        _scan(lib, tmp)

        def _editions():
            db = SessionLocal()
            try:
                return {
                    c.edition
                    for c in db.query(GameSystem)
                    .filter_by(parent_system="Ign354 Cancelled")
                    .all()
                }
            finally:
                db.close()

        assert {"2e", "3e", "4e", "5e"} <= _editions()

        # Cancel a few files in, so most of the container goes unwalked.
        calls = {"n": 0}

        def stop_after_a_few():
            calls["n"] += 1
            return calls["n"] > 3

        stats = _scan(lib, tmp, should_stop=stop_after_a_few)

        assert stats.get("removed_systems", 0) == 0
        assert {"2e", "3e", "4e", "5e"} <= _editions(), "cancel must not delete systems"

    def test_container_with_surviving_children_is_kept(self):
        """Deleting a container would orphan the children still on disk."""
        tmp, lib = _mk_lib()
        container = _mkdir(lib, "books", "Ign354 Family")
        (container / ".parent-system-container").write_text("")
        _touch_pdf(_mkdir(container, "2e", "core"), "core.pdf")
        _scan(lib, tmp)

        db = SessionLocal()
        try:
            row = db.query(GameSystem).filter_by(slug="ign354-family").first()
            # The container itself owns no books — only its child does.
            assert db.query(Book).filter_by(game_system_id=row.id).count() == 0
        finally:
            db.close()

        _scan(lib, tmp)

        db = SessionLocal()
        try:
            names = {s.name for s in db.query(GameSystem).all()}
        finally:
            db.close()
        assert "Ign354 Family" in names


class TestReconciliation:
    def test_newly_ignored_book_marked_missing_then_restored(self):
        tmp, lib = _mk_lib()
        core = _mkdir(lib, "books", "Ign224 Recon", "core")
        _touch_pdf(core, "later-ignored.pdf")

        # First scan: no ignore file — the book is present and visible.
        _scan(lib, tmp)

        def _book():
            db = SessionLocal()
            try:
                system = db.query(GameSystem).filter_by(slug="ign224-recon").first()
                return db.query(Book).filter_by(
                    game_system_id=system.id, filename="later-ignored.pdf"
                ).first(), db
            finally:
                pass  # caller closes

        book, db = _book()
        assert book is not None and not book.is_missing
        db.close()

        # Add an ignore rule and rescan: the on-disk file is now excluded, so it
        # should be flagged missing (hidden from the UI).
        (lib / IGNORE_FILENAME).write_text("later-ignored.pdf\n")
        _scan(lib, tmp)
        book, db = _book()
        assert book.is_missing is True
        db.close()

        # Remove the rule and rescan: the book comes back.
        (lib / IGNORE_FILENAME).unlink()
        _scan(lib, tmp)
        book, db = _book()
        assert book.is_missing is False
        db.close()
