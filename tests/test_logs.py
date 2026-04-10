"""Tests for the /api/logs endpoint."""
import logging
import pytest


class TestLogsAccess:
    def test_admin_can_access_logs(self, client, admin_headers):
        resp = client.get("/api/logs", headers=admin_headers)
        assert resp.status_code == 200

    def test_gm_cannot_access_logs(self, client, gm_headers):
        resp = client.get("/api/logs", headers=gm_headers)
        assert resp.status_code == 403

    def test_player_cannot_access_logs(self, client, player_headers):
        resp = client.get("/api/logs", headers=player_headers)
        assert resp.status_code == 403

    def test_unauthenticated_cannot_access_logs(self, client):
        resp = client.get("/api/logs")
        assert resp.status_code == 401


class TestLogsResponseShape:
    def test_response_has_required_fields(self, client, admin_headers):
        resp = client.get("/api/logs", headers=admin_headers)
        body = resp.json()
        assert "entries" in body
        assert "total" in body
        assert "max_seq" in body
        assert "level" in body
        assert "limit" in body
        assert "offset" in body

    def test_max_seq_is_non_negative_int(self, client, admin_headers):
        resp = client.get("/api/logs", headers=admin_headers)
        body = resp.json()
        assert isinstance(body["max_seq"], int)
        assert body["max_seq"] >= 0

    def test_after_seq_returns_only_newer_entries(self, client, admin_headers):
        # Get current max_seq
        resp1 = client.get("/api/logs?level=info&limit=500", headers=admin_headers)
        seq = resp1.json()["max_seq"]
        # Emit a known new entry
        logging.getLogger("grimoire").info("after_seq test marker")
        # Poll with after_seq
        resp2 = client.get(f"/api/logs?level=info&after_seq={seq}", headers=admin_headers)
        body = resp2.json()
        assert resp2.status_code == 200
        assert len(body["entries"]) >= 1
        assert any("after_seq test marker" in e["message"] for e in body["entries"])
        # All returned entries must have seq > the cursor
        for e in body["entries"]:
            assert e["seq"] > seq

    def test_after_seq_only_returns_entries_after_cursor(self, client, admin_headers):
        # Any entries returned must have seq strictly greater than the cursor
        resp1 = client.get("/api/logs?level=info&limit=500", headers=admin_headers)
        seq = resp1.json()["max_seq"]
        resp2 = client.get(f"/api/logs?level=info&after_seq={seq}", headers=admin_headers)
        assert resp2.status_code == 200
        for entry in resp2.json()["entries"]:
            assert entry["seq"] > seq

    def test_entries_is_list(self, client, admin_headers):
        resp = client.get("/api/logs", headers=admin_headers)
        assert isinstance(resp.json()["entries"], list)

    def test_total_is_non_negative_int(self, client, admin_headers):
        resp = client.get("/api/logs", headers=admin_headers)
        body = resp.json()
        assert isinstance(body["total"], int)
        assert body["total"] >= 0

    def test_entry_fields(self, client, admin_headers):
        # Emit a known log entry so at least one exists
        logging.getLogger("grimoire").info("test_entry_fields probe")
        resp = client.get("/api/logs?level=info&limit=500", headers=admin_headers)
        entries = resp.json()["entries"]
        assert len(entries) > 0
        entry = entries[-1]
        assert "seq" in entry
        assert "timestamp" in entry
        assert "level" in entry
        assert "logger" in entry
        assert "message" in entry
        assert isinstance(entry["seq"], int)
        assert entry["seq"] > 0

    def test_timestamp_format(self, client, admin_headers):
        logging.getLogger("grimoire").info("timestamp format probe")
        resp = client.get("/api/logs?level=info&limit=500", headers=admin_headers)
        entries = resp.json()["entries"]
        assert len(entries) > 0
        ts = entries[-1]["timestamp"]
        # Should end with Z and contain T separator
        assert ts.endswith("Z")
        assert "T" in ts


class TestLogsLevelFilter:
    def test_default_level_is_info(self, client, admin_headers):
        resp = client.get("/api/logs", headers=admin_headers)
        assert resp.json()["level"] == "info"

    def test_debug_level_accepted(self, client, admin_headers):
        resp = client.get("/api/logs?level=debug", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["level"] == "debug"

    def test_warning_level_accepted(self, client, admin_headers):
        resp = client.get("/api/logs?level=warning", headers=admin_headers)
        assert resp.status_code == 200

    def test_error_level_accepted(self, client, admin_headers):
        resp = client.get("/api/logs?level=error", headers=admin_headers)
        assert resp.status_code == 200

    def test_critical_level_accepted(self, client, admin_headers):
        resp = client.get("/api/logs?level=critical", headers=admin_headers)
        assert resp.status_code == 200

    def test_invalid_level_rejected(self, client, admin_headers):
        resp = client.get("/api/logs?level=verbose", headers=admin_headers)
        assert resp.status_code == 422

    def test_debug_returns_more_than_info(self, client, admin_headers):
        """DEBUG level should return >= entries compared to INFO level."""
        logging.getLogger("grimoire").debug("debug-only probe for filter test")
        logging.getLogger("grimoire").info("info probe for filter test")

        debug_resp = client.get("/api/logs?level=debug&limit=2000", headers=admin_headers)
        info_resp  = client.get("/api/logs?level=info&limit=2000",  headers=admin_headers)

        debug_total = debug_resp.json()["total"]
        info_total  = info_resp.json()["total"]
        assert debug_total >= info_total

    def test_info_entries_contain_no_debug(self, client, admin_headers):
        """Entries returned at INFO level must not include DEBUG-level entries."""
        resp = client.get("/api/logs?level=info&limit=2000", headers=admin_headers)
        for entry in resp.json()["entries"]:
            assert entry["level"] != "DEBUG"

    def test_error_entries_only_contain_error_or_above(self, client, admin_headers):
        resp = client.get("/api/logs?level=error&limit=2000", headers=admin_headers)
        allowed = {"ERROR", "CRITICAL"}
        for entry in resp.json()["entries"]:
            assert entry["level"] in allowed


class TestLogsPagination:
    def test_limit_param(self, client, admin_headers):
        # Ensure enough log entries exist
        log = logging.getLogger("grimoire")
        for i in range(10):
            log.info(f"pagination test probe {i}")

        resp = client.get("/api/logs?level=debug&limit=5", headers=admin_headers)
        body = resp.json()
        assert body["limit"] == 5
        assert len(body["entries"]) <= 5

    def test_offset_param(self, client, admin_headers):
        resp_no_offset = client.get("/api/logs?level=debug&limit=10&offset=0", headers=admin_headers)
        resp_offset    = client.get("/api/logs?level=debug&limit=10&offset=5", headers=admin_headers)

        entries_no = resp_no_offset.json()["entries"]
        entries_of = resp_offset.json()["entries"]
        # They should differ (assuming enough entries exist)
        if entries_no and entries_of:
            assert entries_no != entries_of

    def test_limit_too_large_rejected(self, client, admin_headers):
        resp = client.get("/api/logs?limit=99999", headers=admin_headers)
        assert resp.status_code == 422

    def test_limit_zero_rejected(self, client, admin_headers):
        resp = client.get("/api/logs?limit=0", headers=admin_headers)
        assert resp.status_code == 422

    def test_negative_offset_rejected(self, client, admin_headers):
        resp = client.get("/api/logs?offset=-1", headers=admin_headers)
        assert resp.status_code == 422


class TestMemoryHandler:
    def test_buffer_captures_info(self):
        from backend.config import _memory_handler
        initial = _memory_handler.get_total(min_level=logging.INFO)
        logging.getLogger("grimoire").info("memory handler capture test")
        after = _memory_handler.get_total(min_level=logging.INFO)
        assert after > initial

    def test_buffer_captures_debug(self):
        from backend.config import _memory_handler
        initial = _memory_handler.get_total(min_level=logging.DEBUG)
        logging.getLogger("grimoire").debug("memory handler debug capture test")
        after = _memory_handler.get_total(min_level=logging.DEBUG)
        assert after > initial

    def test_get_entries_respects_min_level(self):
        from backend.config import _memory_handler
        logging.getLogger("grimoire").debug("level-filter debug entry")
        logging.getLogger("grimoire").info("level-filter info entry")

        debug_entries, _ = _memory_handler.get_entries(min_level=logging.DEBUG, limit=2000)
        info_entries,  _ = _memory_handler.get_entries(min_level=logging.INFO,  limit=2000)

        assert len(debug_entries) >= len(info_entries)

    def test_entries_have_correct_structure(self):
        from backend.config import _memory_handler
        logging.getLogger("grimoire").info("structure check probe")
        entries, max_seq = _memory_handler.get_entries(min_level=logging.INFO, limit=10)
        assert len(entries) > 0
        e = entries[-1]
        assert set(e.keys()) == {"seq", "timestamp", "level", "logger", "message"}
        assert isinstance(e["seq"], int)
        assert e["seq"] > 0
        assert isinstance(max_seq, int)
        assert max_seq > 0
