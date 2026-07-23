"""Integration tests for ``.grimoireignore`` in the library scanner (issue #224).

Drives the real ``scan_library`` against a temp library and asserts that files
and directories matched by a ``.grimoireignore`` rule are never registered, that
progress totals exclude them, and that a file newly matched by an ignore rule is
marked missing (removed from the UI) on rescan.
"""
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
