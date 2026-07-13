"""Tests for (nsfw) folder detection in the library scanner."""
import tempfile
from pathlib import Path


from backend.config import SessionLocal
from backend.models import GameSystem
from backend.indexer import scan_library


def _mk_lib():
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    lib.mkdir()
    return tmp, lib


def _books_dir(lib: Path, system_folder: str) -> Path:
    d = lib / "books" / system_folder
    d.mkdir(parents=True, exist_ok=True)
    return d


def _touch_pdf(folder: Path, name: str = "book.pdf") -> Path:
    p = folder / name
    p.write_bytes(b"%PDF-1.4")
    return p


def _get_system_by_slug(slug: str):
    db = SessionLocal()
    try:
        return db.query(GameSystem).filter_by(slug=slug).first()
    finally:
        db.close()


class TestNsfwFolderDetection:
    def test_nsfw_folder_sets_is_explicit(self):
        tmp, lib = _mk_lib()
        folder = _books_dir(lib, "Explicit System (NSFW)")
        _touch_pdf(folder)
        db = SessionLocal()
        try:
            scan_library(str(lib), tmp, db)
        finally:
            db.close()

        system = _get_system_by_slug("explicit-system")
        assert system is not None
        assert system.is_explicit is True

    def test_nsfw_folder_strips_nsfw_from_name(self):
        tmp, lib = _mk_lib()
        folder = _books_dir(lib, "Clean Name (nsfw)")
        _touch_pdf(folder)
        db = SessionLocal()
        try:
            scan_library(str(lib), tmp, db)
        finally:
            db.close()

        system = _get_system_by_slug("clean-name")
        assert system is not None
        assert system.name == "Clean Name"
        assert "(nsfw)" not in system.name.lower()

    def test_nsfw_case_insensitive(self):
        tmp, lib = _mk_lib()
        folder = _books_dir(lib, "Dark Arts (NSFW)")
        _touch_pdf(folder)
        db = SessionLocal()
        try:
            scan_library(str(lib), tmp, db)
        finally:
            db.close()

        system = _get_system_by_slug("dark-arts")
        assert system is not None
        assert system.is_explicit is True
        assert system.name == "Dark Arts"

    def test_normal_folder_not_marked_explicit(self):
        tmp, lib = _mk_lib()
        folder = _books_dir(lib, "Family Friendly RPG")
        _touch_pdf(folder)
        db = SessionLocal()
        try:
            scan_library(str(lib), tmp, db)
        finally:
            db.close()

        system = _get_system_by_slug("family-friendly-rpg")
        assert system is not None
        assert not system.is_explicit

    def test_nsfw_flag_applied_to_existing_system(self):
        """If a system exists but folder was renamed to include (nsfw), flag is set on rescan."""
        tmp, lib = _mk_lib()
        # First scan: no nsfw
        folder_clean = _books_dir(lib, "Later Marked NSFW")
        _touch_pdf(folder_clean)
        db = SessionLocal()
        try:
            scan_library(str(lib), tmp, db)
        finally:
            db.close()

        system = _get_system_by_slug("later-marked-nsfw")
        assert system is not None
        assert not system.is_explicit

        # Simulate rename: remove old folder, add nsfw variant with the same slug
        import shutil

        shutil.rmtree(str(folder_clean))
        folder_nsfw = _books_dir(lib, "Later Marked NSFW (nsfw)")
        _touch_pdf(folder_nsfw)

        db = SessionLocal()
        try:
            scan_library(str(lib), tmp, db)
        finally:
            db.close()

        system = _get_system_by_slug("later-marked-nsfw")
        assert system.is_explicit is True
