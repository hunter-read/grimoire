"""Tests for settings API and maintenance/cleanup endpoint."""
import os
import uuid
from typing import Optional
from unittest.mock import patch

import pytest

from tests.conftest import make_book, make_game_system, make_map, make_token
from backend.config import SessionLocal
from backend.models import AppSetting, Bookmark


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _set_setting(key: str, value: str) -> None:
    db = SessionLocal()
    row = db.query(AppSetting).filter_by(key=key).first()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))
    db.commit()
    db.close()


def _get_setting(key: str) -> Optional[str]:
    db = SessionLocal()
    row = db.query(AppSetting).filter_by(key=key).first()
    db.close()
    return row.value if row else None


# ---------------------------------------------------------------------------
# GET /api/settings — authentication
# ---------------------------------------------------------------------------


class TestGetSettingsAuth:
    def test_unauthenticated_rejected(self, client):
        assert client.get("/api/settings").status_code == 401

    def test_player_forbidden(self, client, player_headers):
        assert client.get("/api/settings", headers=player_headers).status_code == 403

    def test_gm_forbidden(self, client, gm_headers):
        assert client.get("/api/settings", headers=gm_headers).status_code == 403

    def test_admin_allowed(self, client, admin_headers):
        assert client.get("/api/settings", headers=admin_headers).status_code == 200


# ---------------------------------------------------------------------------
# GET /api/settings — response shape
# ---------------------------------------------------------------------------


class TestGetSettingsShape:
    def test_rescan_schedule_fields_present(self, client, admin_headers):
        data = client.get("/api/settings", headers=admin_headers).json()
        assert "rescan_schedule_enabled" in data
        assert "rescan_schedule_interval" in data
        assert "rescan_schedule_hour" in data
        assert "rescan_schedule_minute" in data
        assert "rescan_schedule_weekday" in data

    def test_cleanup_on_rescan_field_present(self, client, admin_headers):
        data = client.get("/api/settings", headers=admin_headers).json()
        assert "cleanup_on_rescan" in data

    def test_cleanup_on_rescan_is_bool(self, client, admin_headers):
        data = client.get("/api/settings", headers=admin_headers).json()
        assert isinstance(data["cleanup_on_rescan"], bool)

    def test_cleanup_on_rescan_defaults_false(self, client, admin_headers):
        data = client.get("/api/settings", headers=admin_headers).json()
        assert data["cleanup_on_rescan"] is False


# ---------------------------------------------------------------------------
# PATCH /api/settings — cleanup_on_rescan
# ---------------------------------------------------------------------------


class TestPatchCleanupOnRescan:
    def test_enable_cleanup_on_rescan(self, client, admin_headers):
        resp = client.patch(
            "/api/settings",
            json={"cleanup_on_rescan": True},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["cleanup_on_rescan"] is True

    def test_disable_cleanup_on_rescan(self, client, admin_headers):
        client.patch(
            "/api/settings",
            json={"cleanup_on_rescan": True},
            headers=admin_headers,
        )
        resp = client.patch(
            "/api/settings",
            json={"cleanup_on_rescan": False},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["cleanup_on_rescan"] is False

    def test_persisted_to_db(self, client, admin_headers):
        client.patch(
            "/api/settings",
            json={"cleanup_on_rescan": True},
            headers=admin_headers,
        )
        assert _get_setting("cleanup_on_rescan") == "true"
        client.patch(
            "/api/settings",
            json={"cleanup_on_rescan": False},
            headers=admin_headers,
        )
        assert _get_setting("cleanup_on_rescan") == "false"

    def test_other_fields_unaffected(self, client, admin_headers):
        before = client.get("/api/settings", headers=admin_headers).json()
        client.patch(
            "/api/settings",
            json={"cleanup_on_rescan": True},
            headers=admin_headers,
        )
        after = client.get("/api/settings", headers=admin_headers).json()
        for key in ("rescan_schedule_interval", "rescan_schedule_hour", "rescan_schedule_minute"):
            assert before[key] == after[key]

    def test_unauthenticated_rejected(self, client):
        assert (
            client.patch("/api/settings", json={"cleanup_on_rescan": True}).status_code == 401
        )


# ---------------------------------------------------------------------------
# Scheduler applies cleanup_fn when cleanup_on_rescan is enabled
# ---------------------------------------------------------------------------


class TestSchedulerApplyCleanup:
    def test_cleanup_fn_passed_when_enabled(self, client, admin_headers):
        with patch("backend.scheduler.start") as mock_start:
            client.patch(
                "/api/settings",
                json={
                    "rescan_schedule_enabled": True,
                    "rescan_schedule_interval": "daily",
                    "cleanup_on_rescan": True,
                },
                headers=admin_headers,
            )
            assert mock_start.called
            _, _, cleanup_fn = (
                mock_start.call_args.args[0],
                mock_start.call_args.args[4],
                mock_start.call_args.args[5]
                if len(mock_start.call_args.args) > 5
                else mock_start.call_args.kwargs.get("cleanup_fn"),
            )
            assert cleanup_fn is not None

    def test_cleanup_fn_none_when_disabled(self, client, admin_headers):
        with patch("backend.scheduler.start") as mock_start:
            client.patch(
                "/api/settings",
                json={
                    "rescan_schedule_enabled": True,
                    "rescan_schedule_interval": "daily",
                    "cleanup_on_rescan": False,
                },
                headers=admin_headers,
            )
            assert mock_start.called
            call_args = mock_start.call_args
            cleanup_fn = (
                call_args.args[5]
                if len(call_args.args) > 5
                else call_args.kwargs.get("cleanup_fn")
            )
            assert cleanup_fn is None


# ---------------------------------------------------------------------------
# POST /api/maintenance/cleanup-missing — authentication
# ---------------------------------------------------------------------------


class TestCleanupMissingAuth:
    def test_unauthenticated_rejected(self, client):
        assert client.post("/api/maintenance/cleanup-missing").status_code == 401

    def test_player_forbidden(self, client, player_headers):
        assert (
            client.post("/api/maintenance/cleanup-missing", headers=player_headers).status_code
            == 403
        )

    def test_gm_forbidden(self, client, gm_headers):
        assert (
            client.post("/api/maintenance/cleanup-missing", headers=gm_headers).status_code == 403
        )

    def test_admin_allowed(self, client, admin_headers):
        assert (
            client.post("/api/maintenance/cleanup-missing", headers=admin_headers).status_code
            == 200
        )


# ---------------------------------------------------------------------------
# POST /api/maintenance/cleanup-missing — response shape
# ---------------------------------------------------------------------------


class TestCleanupMissingShape:
    def test_removed_key_present(self, client, admin_headers):
        data = client.post("/api/maintenance/cleanup-missing", headers=admin_headers).json()
        assert "removed" in data

    def test_removed_has_books_maps_tokens(self, client, admin_headers):
        data = client.post("/api/maintenance/cleanup-missing", headers=admin_headers).json()
        assert "books" in data["removed"]
        assert "maps" in data["removed"]
        assert "tokens" in data["removed"]

    def test_removed_counts_are_ints(self, client, admin_headers):
        data = client.post("/api/maintenance/cleanup-missing", headers=admin_headers).json()
        assert isinstance(data["removed"]["books"], int)
        assert isinstance(data["removed"]["maps"], int)
        assert isinstance(data["removed"]["tokens"], int)


# ---------------------------------------------------------------------------
# POST /api/maintenance/cleanup-missing — removes missing records
# ---------------------------------------------------------------------------


class TestCleanupMissingBehavior:
    def test_removes_book_with_missing_file(self, client, admin_headers):
        sys = make_game_system()
        book = make_book(
            system_id=sys.id,
            filepath="/tmp/nonexistent-book-" + uuid.uuid4().hex + ".pdf",
        )
        book_id = book.id
        data = client.post("/api/maintenance/cleanup-missing", headers=admin_headers).json()
        assert data["removed"]["books"] >= 1
        resp = client.get(f"/api/books/{book_id}", headers=admin_headers)
        assert resp.status_code == 404

    def test_keeps_book_with_existing_file(self, client, admin_headers, tmp_path):
        pdf = tmp_path / "real.pdf"
        pdf.write_bytes(b"%PDF-1.4")
        sys = make_game_system()
        book = make_book(system_id=sys.id, filepath=str(pdf))
        book_id = book.id
        client.post("/api/maintenance/cleanup-missing", headers=admin_headers)
        resp = client.get(f"/api/books/{book_id}", headers=admin_headers)
        assert resp.status_code == 200

    def test_removes_map_with_missing_file(self, client, admin_headers):
        m = make_map(filepath="/tmp/nonexistent-map-" + uuid.uuid4().hex + ".png")
        map_id = m.id
        data = client.post("/api/maintenance/cleanup-missing", headers=admin_headers).json()
        assert data["removed"]["maps"] >= 1
        resp = client.get(f"/api/maps/{map_id}", headers=admin_headers)
        assert resp.status_code == 404

    def test_removes_token_with_missing_file(self, client, admin_headers):
        t = make_token(filepath="/tmp/nonexistent-token-" + uuid.uuid4().hex + ".png")
        token_id = t.id
        data = client.post("/api/maintenance/cleanup-missing", headers=admin_headers).json()
        assert data["removed"]["tokens"] >= 1
        resp = client.get(f"/api/tokens/{token_id}", headers=admin_headers)
        assert resp.status_code == 404

    def test_nothing_removed_when_all_present(self, client, admin_headers, tmp_path):
        pdf = tmp_path / "exists.pdf"
        pdf.write_bytes(b"%PDF-1.4")
        sys = make_game_system()
        make_book(system_id=sys.id, filepath=str(pdf))
        data = client.post("/api/maintenance/cleanup-missing", headers=admin_headers).json()
        assert data["removed"]["books"] == 0
        assert data["removed"]["maps"] == 0
        assert data["removed"]["tokens"] == 0

    def test_removes_bookmarks_with_missing_book(self, client, admin_headers, admin_id):
        sys = make_game_system()
        book = make_book(
            system_id=sys.id,
            filepath="/tmp/nonexistent-bm-book-" + uuid.uuid4().hex + ".pdf",
        )
        db = SessionLocal()
        bm = Bookmark(user_id=admin_id, book_id=book.id, page_number=1, label="test")
        db.add(bm)
        db.commit()
        bm_id = bm.id
        db.close()

        client.post("/api/maintenance/cleanup-missing", headers=admin_headers)

        db = SessionLocal()
        assert db.query(Bookmark).filter_by(id=bm_id).first() is None
        db.close()

    def test_returns_409_when_scan_running(self, client, admin_headers):
        with patch(
            "backend.routers.library._helpers._get_status",
            return_value={"running": True},
        ):
            resp = client.post("/api/maintenance/cleanup-missing", headers=admin_headers)
        assert resp.status_code == 409

    def test_proceeds_when_scan_not_running(self, client, admin_headers):
        with patch(
            "backend.routers.library._helpers._get_status",
            return_value={"running": False},
        ):
            resp = client.post("/api/maintenance/cleanup-missing", headers=admin_headers)
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# run_cleanup_sync — scheduler callable
# ---------------------------------------------------------------------------


class TestRunCleanupSync:
    def test_callable_without_http_context(self):
        from backend.routers.maintenance import run_cleanup_sync

        run_cleanup_sync()  # must not raise

    def test_removes_missing_records(self, tmp_path):
        from backend.routers.maintenance import run_cleanup_sync

        sys = make_game_system()
        missing_book = make_book(
            system_id=sys.id,
            filepath="/tmp/sync-missing-" + uuid.uuid4().hex + ".pdf",
        )
        book_id = missing_book.id

        run_cleanup_sync()

        db = SessionLocal()
        from backend.models import Book

        assert db.query(Book).filter_by(id=book_id).first() is None
        db.close()
