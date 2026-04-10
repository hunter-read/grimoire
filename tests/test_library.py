"""Tests for library stats and scan endpoints."""
import pytest
from tests.conftest import make_game_system, make_book, make_map, make_token


class TestLibraryStats:
    def test_stats_endpoint_accessible(self, client, admin_headers):
        resp = client.get("/api/stats", headers=admin_headers)
        assert resp.status_code == 200

    def test_stats_response_shape(self, client, admin_headers):
        resp = client.get("/api/stats", headers=admin_headers)
        body = resp.json()
        assert "game_systems" in body
        assert "books" in body
        assert "maps" in body
        assert "tokens" in body
        assert "indexed_books" in body
        assert "total_pages" in body
        assert "total_size_mb" in body
        assert "version" in body

    def test_stats_counts_are_non_negative(self, client, admin_headers):
        resp = client.get("/api/stats", headers=admin_headers)
        body = resp.json()
        assert body["game_systems"] >= 0
        assert body["books"] >= 0
        assert body["maps"] >= 0
        assert body["tokens"] >= 0
        assert body["indexed_books"] >= 0
        assert body["total_pages"] >= 0
        assert body["total_size_mb"] >= 0

    def test_stats_reflects_created_data(self, client, admin_headers):
        # Record baseline
        before = client.get("/api/stats", headers=admin_headers).json()
        before_books = before["books"]

        # Create a new book
        sys = make_game_system()
        make_book(system_id=sys.id)

        after = client.get("/api/stats", headers=admin_headers).json()
        assert after["books"] >= before_books + 1

    def test_player_can_view_stats(self, client, player_headers):
        resp = client.get("/api/stats", headers=player_headers)
        assert resp.status_code == 200

    def test_unauthenticated_denied(self, client):
        resp = client.get("/api/stats")
        assert resp.status_code == 401


class TestScanStatus:
    def test_scan_status_accessible(self, client, admin_headers):
        resp = client.get("/api/scan-status", headers=admin_headers)
        assert resp.status_code == 200

    def test_scan_status_has_running_field(self, client, admin_headers):
        resp = client.get("/api/scan-status", headers=admin_headers)
        body = resp.json()
        assert "running" in body
        assert isinstance(body["running"], bool)

    def test_scan_status_has_progress_fields(self, client, admin_headers):
        resp = client.get("/api/scan-status", headers=admin_headers)
        body = resp.json()
        for field in (
            "phase",
            "total_books",
            "scanned_books",
            "total_maps",
            "scanned_maps",
            "total_tokens",
            "scanned_tokens",
            "indexed",
            "to_index",
            "new_books",
            "new_maps",
            "new_tokens",
        ):
            assert field in body, f"missing field: {field}"

    def test_scan_status_progress_fields_are_numeric(self, client, admin_headers):
        resp = client.get("/api/scan-status", headers=admin_headers)
        body = resp.json()
        for field in (
            "total_books",
            "scanned_books",
            "total_maps",
            "scanned_maps",
            "total_tokens",
            "scanned_tokens",
            "indexed",
            "to_index",
            "new_books",
            "new_maps",
            "new_tokens",
        ):
            assert isinstance(body[field], int), f"{field} should be int"

    def test_player_cannot_view_scan_status(self, client, player_headers):
        resp = client.get("/api/scan-status", headers=player_headers)
        assert resp.status_code == 403

    def test_gm_cannot_view_scan_status(self, client, gm_headers):
        resp = client.get("/api/scan-status", headers=gm_headers)
        assert resp.status_code == 403

    def test_unauthenticated_cannot_view_scan_status(self, client):
        resp = client.get("/api/scan-status")
        assert resp.status_code == 401


class TestRescan:
    def test_admin_can_trigger_rescan(self, client, admin_headers):
        resp = client.post("/api/rescan", headers=admin_headers)
        assert resp.status_code == 200

    def test_gm_cannot_trigger_rescan(self, client, gm_headers):
        resp = client.post("/api/rescan", headers=gm_headers)
        assert resp.status_code == 403

    def test_player_cannot_trigger_rescan(self, client, player_headers):
        resp = client.post("/api/rescan", headers=player_headers)
        assert resp.status_code == 403

    def test_unauthenticated_cannot_rescan(self, client):
        resp = client.post("/api/rescan")
        assert resp.status_code == 401


class TestCancelScan:
    def test_cancel_when_not_running_returns_not_running(self, client, admin_headers):
        # Ensure no scan is running
        from backend.routers.library import _helpers
        _helpers._scan_status["running"] = False
        resp = client.post("/api/cancel-scan", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "not_running"

    def test_cancel_while_running_returns_stop_requested(self, client, admin_headers):
        from backend.routers.library import _helpers
        _helpers._scan_status["running"] = True
        try:
            resp = client.post("/api/cancel-scan", headers=admin_headers)
            assert resp.status_code == 200
            assert resp.json()["status"] == "stop_requested"
            assert _helpers.is_stop_requested() is True
        finally:
            _helpers._scan_status["running"] = False
            _helpers.clear_stop()

    def test_gm_cannot_cancel_scan(self, client, gm_headers):
        resp = client.post("/api/cancel-scan", headers=gm_headers)
        assert resp.status_code == 403

    def test_player_cannot_cancel_scan(self, client, player_headers):
        resp = client.post("/api/cancel-scan", headers=player_headers)
        assert resp.status_code == 403

    def test_unauthenticated_cannot_cancel_scan(self, client):
        resp = client.post("/api/cancel-scan")
        assert resp.status_code == 401
