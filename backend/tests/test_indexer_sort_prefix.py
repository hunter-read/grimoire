"""Tests for leading sort-order prefix (!$%) stripping in the library scanner.

People prepend characters like "!", "$", or "%" to system folders so their file
browser sorts them first. The scanner strips that leading run when deriving the
system name/slug, while keeping the rest of the name (including internal specials)
verbatim.
"""
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


def _scan(lib: Path, tmp: str):
    db = SessionLocal()
    try:
        scan_library(str(lib), tmp, db)
    finally:
        db.close()


class TestSortPrefixStripping:
    def test_double_bang_prefix_stripped_from_name(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "!!Dungeons & Dragons"))
        _scan(lib, tmp)

        system = _get_system_by_slug("dungeons-dragons")
        assert system is not None
        assert system.name == "Dungeons & Dragons"

    def test_single_bang_agnostic_folder_still_agnostic(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "!system-agnostic"))
        _scan(lib, tmp)

        system = _get_system_by_slug("system-agnostic")
        assert system is not None
        assert system.name == "system-agnostic"
        assert system.is_system_agnostic is True

    def test_mixed_prefix_chars_stripped(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "!$%Pathfinder 2e"))
        _scan(lib, tmp)

        system = _get_system_by_slug("pathfinder-2e")
        assert system is not None
        assert system.name == "Pathfinder 2e"
        assert system.is_system_agnostic is False
        assert system.is_one_page is False

    def test_internal_special_chars_preserved(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "!!Vampire: The Masquerade"))
        _scan(lib, tmp)

        system = _get_system_by_slug("vampire-the-masquerade")
        assert system is not None
        assert system.name == "Vampire: The Masquerade"

    def test_prefix_and_nsfw_combined(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_books_dir(lib, "!!Forbidden Lore (NSFW)"))
        _scan(lib, tmp)

        system = _get_system_by_slug("forbidden-lore")
        assert system is not None
        assert system.name == "Forbidden Lore"
        assert system.is_explicit is True
