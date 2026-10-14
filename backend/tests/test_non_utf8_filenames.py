"""Library entries whose names are not valid UTF-8 (issue #547).

A folder named on Windows with a legacy code page and copied to a share that
stores raw bytes ("MÖRK BORG" as ``M\\xd6RK BORG``) used to abort the whole scan
and 500 the file manager. These tests pin the fix: such entries are skipped by
every walk with a warning, shown in the file manager with a placeholder and no
actions, and never reach SQLite, JSON, or the in-app log buffer raw.

macOS (APFS) refuses to create a name like this at all, so the tests that need
one on disk skip there and run on Linux, which is where CI runs and where the
bug happens.
"""
import io
import json
import logging
import os
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path
from unittest.mock import patch

import fitz
import pytest

from backend import filenames
from backend.config import LIBRARY_PATH, SessionLocal, _memory_handler
from backend.indexer import scan_library
from backend.indexer import books as books_mod
from backend.indexer import systems as systems_mod
from backend.indexer._context import _count_eligible_files, _keep_entry, _prune_dirs
from backend.models import Book, GameSystem, GenericMap

# "MÖRK BORG" with the Ö written as Windows-1252 does it: one byte, 0xD6.
BAD = os.fsdecode(b"M\xd6RK BORG")
BAD_FILE = os.fsdecode(b"Caf\xe9 Guide.pdf")


def _can_create_bad_names() -> bool:
    probe = Path(tempfile.mkdtemp())
    try:
        (probe / BAD).mkdir()
        return True
    except OSError:
        return False
    finally:
        shutil.rmtree(probe, ignore_errors=True)


needs_raw_names = pytest.mark.skipif(
    not _can_create_bad_names(),
    reason="this filesystem refuses names that are not UTF-8 (macOS APFS)",
)


def _mk_lib() -> tuple[str, Path]:
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    lib.mkdir()
    return tmp, lib


def _scan(lib: Path, tmp: str) -> dict:
    db = SessionLocal()
    try:
        return scan_library(str(lib), tmp, db)
    finally:
        db.close()


def _pdf(folder: Path, name: str = "book.pdf") -> Path:
    """A real one-page PDF, so the scan reads it cleanly and ``errors`` stays exact."""
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    doc = fitz.open()
    doc.new_page()
    path.write_bytes(doc.tobytes())
    doc.close()
    return path


# ---------------------------------------------------------------------------
# The helpers themselves
# ---------------------------------------------------------------------------


class TestNameHelpers:
    def test_detects_escaped_bytes(self):
        assert filenames.is_undecodable(BAD)
        assert not filenames.is_undecodable("MÖRK BORG")
        assert not filenames.is_undecodable("plain")

    def test_display_name_uses_placeholder(self):
        assert filenames.display_name(BAD) == "M�RK BORG"
        # Output is encodable everywhere it is used.
        filenames.display_name(BAD).encode("utf-8")

    def test_display_name_leaves_valid_names_alone(self):
        assert filenames.display_name("MÖRK BORG") == "MÖRK BORG"

    def test_likely_name_reads_bad_bytes_as_windows_1252(self):
        assert filenames.likely_name(BAD) == "MÖRK BORG"

    def test_likely_name_keeps_valid_utf8_parts(self):
        # The "é" is valid UTF-8 already; only the escaped byte is re-read.
        name = "é/" + BAD
        assert filenames.likely_name(name) == "é/MÖRK BORG"

    def test_warning_names_both_spellings(self, caplog):
        with caplog.at_level(logging.WARNING, logger="grimoire.indexer"):
            filenames.warn_skipped("/library/books/" + BAD)
        message = caplog.records[-1].getMessage()
        assert "M�RK BORG" in message
        assert "MÖRK BORG" in message
        message.encode("utf-8")


class TestWalkFilters:
    def test_prune_dirs_drops_and_reports_bad_names(self, caplog):
        with caplog.at_level(logging.WARNING, logger="grimoire.indexer"):
            kept = _prune_dirs("/lib/books", ["Good", BAD, ".hidden"], None)
        assert kept == ["Good"]
        assert any("M�RK BORG" in r.getMessage() for r in caplog.records)

    def test_prune_dirs_can_stay_quiet(self, caplog):
        with caplog.at_level(logging.WARNING, logger="grimoire.indexer"):
            kept = _prune_dirs("/lib/books", ["Good", BAD], None, warn=False)
        assert kept == ["Good"]
        assert not caplog.records

    def test_keep_entry_rejects_bad_name(self):
        assert not _keep_entry(Path("/lib/books") / BAD, None, is_dir=True)
        assert _keep_entry(Path("/lib/books/Good"), None, is_dir=True)


class TestLogBuffer:
    def test_buffered_message_is_serialisable(self):
        logging.getLogger("grimoire.test").warning("raw name %s", BAD)
        entries, _ = _memory_handler.get_entries(limit=5)
        newest = entries[-1]["message"]
        assert newest == "raw name M�RK BORG"
        json.dumps(entries)


# ---------------------------------------------------------------------------
# One failing system must not take the rest of the scan with it
# ---------------------------------------------------------------------------


class TestSystemIsolation:
    def test_registration_failure_skips_only_that_folder(self):
        tmp, lib = _mk_lib()
        stamp = uuid.uuid4().hex[:8]
        _pdf(lib / "books" / f"Broken-{stamp}" / "core")
        _pdf(lib / "books" / f"Healthy-{stamp}" / "core")
        real = systems_mod._register_system_row

        def flaky(ctx, folder, **kw):
            if folder.name.startswith("Broken"):
                raise RuntimeError("database said no")
            return real(ctx, folder, **kw)

        with patch.object(systems_mod, "_register_system_row", side_effect=flaky):
            stats = _scan(lib, tmp)

        assert stats["errors"] == 1
        db = SessionLocal()
        try:
            assert db.query(GameSystem).filter_by(name=f"Broken-{stamp}").first() is None
            healthy = db.query(GameSystem).filter_by(name=f"Healthy-{stamp}").one()
            assert db.query(Book).filter_by(game_system_id=healthy.id).count() == 1
        finally:
            db.close()

    def test_walk_failure_moves_on_to_the_next_system(self):
        tmp, lib = _mk_lib()
        stamp = uuid.uuid4().hex[:8]
        _pdf(lib / "books" / f"A-Broken-{stamp}" / "core")
        _pdf(lib / "books" / f"B-Healthy-{stamp}" / "core")
        real = books_mod._scan_books_in_system

        def flaky(ctx, system, name, *args, **kw):
            if name.startswith("A-Broken"):
                raise RuntimeError("walk blew up")
            return real(ctx, system, name, *args, **kw)

        with patch.object(books_mod, "_scan_books_in_system", side_effect=flaky):
            stats = _scan(lib, tmp)

        assert stats["errors"] == 1
        assert stats["new_books"] == 1
        db = SessionLocal()
        try:
            healthy = db.query(GameSystem).filter_by(name=f"B-Healthy-{stamp}").one()
            assert db.query(Book).filter_by(game_system_id=healthy.id).count() == 1
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Real names on disk (Linux only)
# ---------------------------------------------------------------------------


@needs_raw_names
class TestScanSkipsBadNames:
    def test_bad_system_folder_no_longer_blocks_the_others(self, caplog):
        tmp, lib = _mk_lib()
        stamp = uuid.uuid4().hex[:8]
        _pdf(lib / "books" / BAD / "core")
        _pdf(lib / "books" / f"Cyberpunk-{stamp}" / "core")

        with caplog.at_level(logging.WARNING, logger="grimoire.indexer"):
            stats = _scan(lib, tmp)

        assert stats["errors"] == 0
        db = SessionLocal()
        try:
            system = db.query(GameSystem).filter_by(name=f"Cyberpunk-{stamp}").one()
            assert db.query(Book).filter_by(game_system_id=system.id).count() == 1
            assert db.query(GameSystem).filter_by(slug="mrk-borg").first() is None
        finally:
            db.close()
        messages = [r.getMessage() for r in caplog.records]
        assert any("M�RK BORG" in m and "MÖRK BORG" in m for m in messages)

    def test_bad_file_is_skipped_beside_good_ones(self):
        tmp, lib = _mk_lib()
        stamp = uuid.uuid4().hex[:8]
        core = lib / "books" / f"Sys-{stamp}" / "core"
        _pdf(core, "good.pdf")
        _pdf(core, BAD_FILE)
        (lib / "maps").mkdir()
        (lib / "maps" / os.fsdecode(b"Ru\xefns.png")).write_bytes(b"not really a png")

        stats = _scan(lib, tmp)

        assert stats["new_books"] == 1
        assert stats["new_maps"] == 0
        db = SessionLocal()
        try:
            system = db.query(GameSystem).filter_by(name=f"Sys-{stamp}").one()
            names = [b.filename for b in db.query(Book).filter_by(game_system_id=system.id)]
            assert names == ["good.pdf"]
            assert db.query(GenericMap).filter(GenericMap.filepath.like(f"{lib}%")).count() == 0
        finally:
            db.close()

    def test_counts_leave_out_bad_names(self):
        _, lib = _mk_lib()
        _pdf(lib / "books" / "Good")
        _pdf(lib / "books" / BAD)
        _pdf(lib / "books" / "Good", BAD_FILE)
        assert _count_eligible_files(lib / "books", {".pdf"}) == 1

    def test_tags_json_in_a_bad_folder_is_ignored(self):
        tmp, lib = _mk_lib()
        stamp = uuid.uuid4().hex[:8]
        _pdf(lib / "books" / f"Sys-{stamp}" / "core")
        bad = lib / "books" / BAD
        bad.mkdir(parents=True)
        (bad / "tags.json").write_text(json.dumps({".": ["horror"]}))
        maps_bad = lib / "maps" / BAD
        maps_bad.mkdir(parents=True)
        (maps_bad / "tags.json").write_text(json.dumps({".": ["horror"]}))

        stats = _scan(lib, tmp)
        assert stats["new_books"] == 1


@pytest.fixture
def bad_entries_in_library():
    """A books folder holding a good system, a bad-named system, and a bad file."""
    if not _can_create_bad_names():
        pytest.skip("this filesystem refuses names that are not UTF-8 (macOS APFS)")
    stamp = uuid.uuid4().hex[:8]
    top = Path(LIBRARY_PATH) / "books" / f"Enc-{stamp}"
    (top / "Good").mkdir(parents=True)
    (top / "Good" / "ok.pdf").write_bytes(b"opaque")
    (top / BAD / "core").mkdir(parents=True)
    (top / BAD / "core" / "x.pdf").write_bytes(b"opaque")
    (top / BAD_FILE).write_bytes(b"opaque")
    yield top
    shutil.rmtree(top, ignore_errors=True)


class TestFileManager:
    def test_browse_shows_placeholder_and_flags_entry(
        self, client, admin_headers, bad_entries_in_library
    ):
        rel = f"books/{bad_entries_in_library.name}"
        resp = client.get("/api/files/browse", headers=admin_headers, params={"path": rel})
        assert resp.status_code == 200, resp.text
        entries = {e["name"]: e for e in resp.json()["entries"]}

        folder = entries["M�RK BORG"]
        assert folder["unreadable_name"] is True
        assert folder["is_dir"] is True
        assert folder["path"] == f"{rel}/M�RK BORG"
        assert folder["child_count"] == 1
        assert folder["record_id"] is None

        file = entries["Caf� Guide.pdf"]
        assert file["unreadable_name"] is True
        assert file["is_dir"] is False
        assert file["size"] == len(b"opaque")

        assert entries["Good"]["unreadable_name"] is False

    def test_placeholder_path_is_not_a_real_folder(
        self, client, admin_headers, bad_entries_in_library
    ):
        rel = f"books/{bad_entries_in_library.name}/M�RK BORG"
        resp = client.get("/api/files/browse", headers=admin_headers, params={"path": rel})
        assert resp.status_code == 404

    def test_folder_archive_leaves_bad_names_out(
        self, client, admin_headers, bad_entries_in_library
    ):
        import backend.routers.downloads as dl_mod

        with patch.object(dl_mod, "_LIBRARY_ROOT", Path(LIBRARY_PATH).resolve()):
            resp = client.get(
                "/api/downloads/archive",
                headers=admin_headers,
                params={
                    "type": "library_folder",
                    "folder": f"books/{bad_entries_in_library.name}",
                },
            )
        assert resp.status_code == 200, resp.text
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            assert zf.namelist() == ["Good/ok.pdf"]


@needs_raw_names
def test_frame_listing_skips_bad_names():
    from backend.routers.token_frames import _helpers

    stamp = uuid.uuid4().hex[:8]
    folder = Path(LIBRARY_PATH) / "tokens" / f"Frames-{stamp}"
    folder.mkdir(parents=True)
    try:
        (folder / ".frames-container").write_bytes(b"")
        (folder / "ok.png").write_bytes(b"png")
        (folder / os.fsdecode(b"\xe9clat.png")).write_bytes(b"png")
        bad_dir = Path(LIBRARY_PATH) / "tokens" / BAD
        bad_dir.mkdir()
        (bad_dir / ".frames-container").write_bytes(b"")
        (bad_dir / "ring.png").write_bytes(b"png")
        _helpers.reset_frame_cache()

        names = {f["name"] for f in _helpers.scan_user_frames()}
        assert "ok" in names
        assert not any(filenames.is_undecodable(n) for n in names)
        json.dumps(_helpers.scan_user_frames())
    finally:
        shutil.rmtree(folder, ignore_errors=True)
        shutil.rmtree(Path(LIBRARY_PATH) / "tokens" / BAD, ignore_errors=True)
        _helpers.reset_frame_cache()
