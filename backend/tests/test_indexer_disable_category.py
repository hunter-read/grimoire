"""Tests for disabling folder-name category inference in the library scanner.

Covers the three precedence levels from issue #190:
  1. Global "disabled" via the DB setting or the env override.
  2. Per-system ``.no-auto-category`` marker file.
  3. Default behavior (inference on) when neither is present.
"""
import tempfile
from pathlib import Path

import backend.indexer as indexer
from backend.config import SessionLocal
from backend.models import AppSetting, Book, GameSystem
from backend.indexer import NO_AUTO_CATEGORY_MARKER, UNCATEGORIZED, scan_library


def _mk_lib():
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    lib.mkdir()
    return tmp, lib


def _category_folder(lib: Path, system_folder: str, category_folder: str) -> Path:
    d = lib / "books" / system_folder / category_folder
    d.mkdir(parents=True, exist_ok=True)
    return d


def _touch_pdf(folder: Path, name: str = "book.pdf") -> Path:
    p = folder / name
    p.write_bytes(b"%PDF-1.4")
    return p


def _scan(lib: Path, tmp: str) -> None:
    db = SessionLocal()
    try:
        scan_library(str(lib), tmp, db)
    finally:
        db.close()


def _book_category(system_slug: str, filename: str = "book.pdf") -> str:
    db = SessionLocal()
    try:
        system = db.query(GameSystem).filter_by(slug=system_slug).first()
        assert system is not None
        book = (
            db.query(Book)
            .filter_by(game_system_id=system.id, filename=filename)
            .first()
        )
        assert book is not None
        return book.category
    finally:
        db.close()


def _set_disable_setting(value: bool) -> None:
    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter_by(key="disable_folder_category_inference").first()
        if row:
            row.value = "true" if value else "false"
        else:
            db.add(
                AppSetting(
                    key="disable_folder_category_inference",
                    value="true" if value else "false",
                )
            )
        db.commit()
    finally:
        db.close()


class TestDefaultInference:
    """With no override, category is inferred from the folder name."""

    def test_core_folder_infers_core(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_category_folder(lib, "Cat190 Default", "Core Rules"))
        _scan(lib, tmp)
        assert _book_category("cat190-default") == "core"


class TestGlobalDisableSetting:
    """The DB setting turns inference off across the whole library."""

    def test_setting_forces_uncategorized(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_category_folder(lib, "Cat190 GlobalOff", "Adventures"))
        _set_disable_setting(True)
        try:
            _scan(lib, tmp)
            assert _book_category("cat190-globaloff") == UNCATEGORIZED
        finally:
            _set_disable_setting(False)

    def test_setting_false_keeps_inference(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_category_folder(lib, "Cat190 SettingOn", "Modules"))
        _set_disable_setting(False)
        _scan(lib, tmp)
        assert _book_category("cat190-settingon") == "adventure"


class TestGlobalDisableEnv:
    """The env override wins over the DB setting."""

    def test_env_forces_uncategorized(self, monkeypatch):
        tmp, lib = _mk_lib()
        _touch_pdf(_category_folder(lib, "Cat190 EnvOff", "Handouts"))
        # Env says disabled even though the DB setting is left at its default.
        monkeypatch.setattr(indexer.config, "DISABLE_FOLDER_CATEGORY_INFERENCE_ENV", True)
        _scan(lib, tmp)
        assert _book_category("cat190-envoff") == UNCATEGORIZED

    def test_env_false_overrides_db_true(self, monkeypatch):
        tmp, lib = _mk_lib()
        _touch_pdf(_category_folder(lib, "Cat190 EnvWins", "Core"))
        _set_disable_setting(True)  # DB wants it off ...
        monkeypatch.setattr(indexer.config, "DISABLE_FOLDER_CATEGORY_INFERENCE_ENV", False)
        try:
            _scan(lib, tmp)
            # ... but the env override (False) wins, so inference stays on.
            assert _book_category("cat190-envwins") == "core"
        finally:
            _set_disable_setting(False)


class TestPerSystemMarker:
    """A ``.no-auto-category`` file at a system root disables inference there."""

    def test_marker_disables_for_that_system_only(self):
        tmp, lib = _mk_lib()
        # System A has the marker; System B does not.
        _touch_pdf(_category_folder(lib, "Cat190 Marked", "Adventures"))
        (lib / "books" / "Cat190 Marked" / NO_AUTO_CATEGORY_MARKER).write_text("")
        _touch_pdf(_category_folder(lib, "Cat190 Unmarked", "Adventures"))

        _scan(lib, tmp)

        assert _book_category("cat190-marked") == UNCATEGORIZED
        assert _book_category("cat190-unmarked") == "adventure"

    def test_marker_file_is_not_indexed_as_a_book(self):
        tmp, lib = _mk_lib()
        _touch_pdf(_category_folder(lib, "Cat190 MarkerFile", "Core"))
        (lib / "books" / "Cat190 MarkerFile" / NO_AUTO_CATEGORY_MARKER).write_text("")

        _scan(lib, tmp)

        db = SessionLocal()
        try:
            system = db.query(GameSystem).filter_by(slug="cat190-markerfile").first()
            filenames = {
                b.filename for b in db.query(Book).filter_by(game_system_id=system.id).all()
            }
            assert NO_AUTO_CATEGORY_MARKER not in filenames
        finally:
            db.close()
