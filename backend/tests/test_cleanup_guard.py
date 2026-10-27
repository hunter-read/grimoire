"""Database cleanup's dry-run preview and its unmounted-library guard.

The test library folder and database are shared by every test on a worker, so
counts here are measured as a change from a baseline, and LIBRARY_PATH is
pointed at a per-test folder to stage "mounted", "empty" and "missing".
"""
import logging
import time
import uuid
from unittest.mock import patch

import pytest

from backend.config import SessionLocal
from backend.models import Book, GenericMap
from backend.services import library_cleanup
from backend.routers.maintenance.core import LIBRARY_UNAVAILABLE_DETAIL
from backend.tests.conftest import (
    live_scan_status,
    make_book,
    make_game_system,
    make_map,
)

PREVIEW = "/api/maintenance/cleanup-missing/preview"
CLEANUP = "/api/maintenance/cleanup-missing"
COLLECTIONS = {"books", "maps", "tokens", "audio", "models"}


def _missing_path(ext: str = "pdf") -> str:
    return f"/tmp/cleanup-guard-missing-{uuid.uuid4().hex}.{ext}"


def _exists(model, row_id: str) -> bool:
    db = SessionLocal()
    try:
        return db.query(model).filter_by(id=row_id).first() is not None
    finally:
        db.close()


@pytest.fixture
def mounted_library(tmp_path, monkeypatch):
    """A library folder with something in it - a healthy mount."""
    root = tmp_path / "library"
    root.mkdir()
    (root / "Some System").mkdir()
    monkeypatch.setattr(library_cleanup, "LIBRARY_PATH", str(root))
    return root


@pytest.fixture
def empty_library(tmp_path, monkeypatch):
    """An empty library folder - what an unmounted mount point looks like."""
    root = tmp_path / "mountpoint"
    root.mkdir()
    monkeypatch.setattr(library_cleanup, "LIBRARY_PATH", str(root))
    return root


@pytest.fixture
def a_book():
    """A book row whose file is missing, so the database is never empty."""
    system = make_game_system()
    return make_book(system_id=system.id, filepath=_missing_path())


# ---------------------------------------------------------------------------
# library_root_unavailable
# ---------------------------------------------------------------------------


class TestLibraryRootUnavailable:
    def test_mounted_library_is_available(self, mounted_library, a_book):
        db = SessionLocal()
        try:
            assert library_cleanup.library_root_unavailable(db) is False
        finally:
            db.close()

    def test_empty_folder_with_rows_is_unavailable(self, empty_library, a_book):
        db = SessionLocal()
        try:
            assert library_cleanup.library_root_unavailable(db) is True
        finally:
            db.close()

    def test_missing_folder_with_rows_is_unavailable(self, tmp_path, monkeypatch, a_book):
        monkeypatch.setattr(library_cleanup, "LIBRARY_PATH", str(tmp_path / "not-there"))
        db = SessionLocal()
        try:
            assert library_cleanup.library_root_unavailable(db) is True
        finally:
            db.close()

    def test_a_file_in_place_of_the_folder_is_unavailable(self, tmp_path, monkeypatch, a_book):
        target = tmp_path / "library"
        target.write_text("not a directory")
        monkeypatch.setattr(library_cleanup, "LIBRARY_PATH", str(target))
        db = SessionLocal()
        try:
            assert library_cleanup.library_root_unavailable(db) is True
        finally:
            db.close()

    def test_only_hidden_files_counts_as_empty(self, empty_library, a_book):
        (empty_library / ".DS_Store").write_bytes(b"")
        db = SessionLocal()
        try:
            assert library_cleanup.library_root_unavailable(db) is True
        finally:
            db.close()

    def test_empty_folder_with_empty_database_is_a_new_install(
        self, empty_library, monkeypatch
    ):
        monkeypatch.setattr(library_cleanup, "_db_has_library_rows", lambda db: False)
        db = SessionLocal()
        try:
            assert library_cleanup.library_root_unavailable(db) is False
        finally:
            db.close()

    def test_any_media_row_counts(self, empty_library):
        make_map(filepath=_missing_path("png"))
        db = SessionLocal()
        try:
            assert library_cleanup._db_has_library_rows(db) is True
        finally:
            db.close()

    def test_unreadable_folder_counts_as_empty(self, mounted_library, monkeypatch):
        def _denied(path):
            raise PermissionError(path)

        monkeypatch.setattr(library_cleanup.os, "scandir", _denied)
        assert library_cleanup._library_root_has_entries(str(mounted_library)) is False

    def test_hung_listing_counts_as_empty(self, mounted_library, monkeypatch, caplog):
        real_scandir = library_cleanup.os.scandir

        def _slow(path):
            time.sleep(0.3)
            return real_scandir(path)

        monkeypatch.setattr(library_cleanup, "_FS_TIMEOUT", 0.05)
        monkeypatch.setattr(library_cleanup.os, "scandir", _slow)
        with caplog.at_level(logging.WARNING, logger="grimoire"):
            assert library_cleanup._library_root_has_entries(str(mounted_library)) is False
        assert any("timed out" in r.getMessage() for r in caplog.records)
        time.sleep(0.3)  # let the stuck thread finish before scandir is restored


# ---------------------------------------------------------------------------
# GET /api/maintenance/cleanup-missing/preview
# ---------------------------------------------------------------------------


class TestCleanupPreview:
    def test_requires_admin(self, client, player_headers, gm_headers):
        assert client.get(PREVIEW).status_code == 401
        assert client.get(PREVIEW, headers=player_headers).status_code == 403
        assert client.get(PREVIEW, headers=gm_headers).status_code == 403

    def test_shape(self, client, admin_headers, mounted_library):
        data = client.get(PREVIEW, headers=admin_headers).json()
        assert set(data) == {"missing", "total", "library_unavailable"}
        assert set(data["missing"]) == COLLECTIONS
        assert set(data["total"]) == COLLECTIONS
        assert data["library_unavailable"] is False

    def test_counts_missing_and_total_without_deleting(
        self, client, admin_headers, mounted_library, tmp_path
    ):
        before = client.get(PREVIEW, headers=admin_headers).json()

        system = make_game_system()
        gone = make_book(system_id=system.id, filepath=_missing_path())
        present_file = tmp_path / "present.png"
        present_file.write_bytes(b"png")
        kept_map = make_map(filepath=str(present_file))

        after = client.get(PREVIEW, headers=admin_headers).json()
        assert after["missing"]["books"] == before["missing"]["books"] + 1
        assert after["total"]["books"] == before["total"]["books"] + 1
        assert after["missing"]["maps"] == before["missing"]["maps"]
        assert after["total"]["maps"] == before["total"]["maps"] + 1
        # A dry run: the missing book is still there.
        assert _exists(Book, gone.id)
        assert _exists(GenericMap, kept_map.id)

    def test_reports_an_unmounted_library(self, client, admin_headers, empty_library, a_book):
        data = client.get(PREVIEW, headers=admin_headers).json()
        assert data["library_unavailable"] is True
        assert data["missing"]["books"] >= 1

    def test_refused_while_a_scan_runs(self, client, admin_headers):
        with patch(
            "backend.services.library_scan.runner.get_status",
            return_value=live_scan_status(),
        ):
            resp = client.get(PREVIEW, headers=admin_headers)
        assert resp.status_code == 409


# ---------------------------------------------------------------------------
# POST /api/maintenance/cleanup-missing - the unmounted-library guard
# ---------------------------------------------------------------------------


class TestCleanupGuard:
    def test_refuses_when_library_is_empty(self, client, admin_headers, empty_library, a_book):
        resp = client.post(CLEANUP, headers=admin_headers)
        assert resp.status_code == 409
        assert resp.json()["detail"] == LIBRARY_UNAVAILABLE_DETAIL
        assert _exists(Book, a_book.id)

    def test_refuses_when_library_is_missing(self, client, admin_headers, tmp_path, monkeypatch):
        monkeypatch.setattr(library_cleanup, "LIBRARY_PATH", str(tmp_path / "gone"))
        system = make_game_system()
        book = make_book(system_id=system.id, filepath=_missing_path())
        resp = client.post(CLEANUP, headers=admin_headers)
        assert resp.status_code == 409
        assert _exists(Book, book.id)

    def test_force_runs_anyway(self, client, admin_headers, empty_library, a_book):
        resp = client.post(CLEANUP, params={"force": "true"}, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["removed"]["books"] >= 1
        assert not _exists(Book, a_book.id)

    def test_mounted_library_proceeds(self, client, admin_headers, mounted_library, a_book):
        resp = client.post(CLEANUP, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        assert "models" in resp.json()["removed"]
        assert not _exists(Book, a_book.id)


# ---------------------------------------------------------------------------
# run_cleanup_sync - the scheduled cleanup after a rescan
# ---------------------------------------------------------------------------


class TestScheduledCleanupGuard:
    def test_skips_with_a_warning_when_library_is_empty(self, empty_library, a_book, caplog):
        with caplog.at_level(logging.WARNING, logger="grimoire"):
            library_cleanup.run_cleanup_sync()
        assert _exists(Book, a_book.id)
        assert any("may not be mounted" in r.getMessage() for r in caplog.records)

    def test_runs_when_library_is_mounted(self, mounted_library, a_book):
        library_cleanup.run_cleanup_sync()
        assert not _exists(Book, a_book.id)
