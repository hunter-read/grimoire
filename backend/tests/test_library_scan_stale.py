"""Recovering a library scan left stuck at ``running`` (issue #524).

A scan whose process dies never reaches the ``finally`` that clears its status,
so every later rescan was refused and Stop only set a flag for a thread that no
longer existed. The status now carries a heartbeat; a running status whose
heartbeat has stopped is stale, Stop clears it, and nothing defers to it.
"""
import threading
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from backend import config
from backend.services.library_scan import reindex_queue, runner
from backend.tests.conftest import live_scan_status


def _ago(seconds: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()


def _stuck(**extra) -> None:
    """Leave the in-process status the way a killed scan does."""
    runner.set_status({**runner.DEFAULT_STATUS, "running": True, "phase": "scanning", **extra})
    runner.SCAN_JOB._heartbeat = _ago(runner.SCAN_JOB.stale_after_seconds + 60)


@pytest.fixture(autouse=True)
def _clean_status():
    runner.clear_stop()
    runner.set_status({**runner.DEFAULT_STATUS})
    yield
    runner.clear_stop()
    runner.set_status({**runner.DEFAULT_STATUS})


def _fake_valkey():
    fake = MagicMock()
    store: dict = {}
    fake.set.side_effect = lambda k, v, **kw: store.__setitem__(k, v)
    fake.get.side_effect = lambda k: store.get(k)
    fake.delete.side_effect = lambda k: store.pop(k, None)
    fake.exists.side_effect = lambda k: k in store
    return fake, store


class TestIsStale:
    def test_an_idle_status_is_never_stale(self):
        assert runner.is_stale({"running": False, "heartbeat": None}) is False

    def test_a_fresh_heartbeat_is_live(self):
        assert runner.is_stale(live_scan_status()) is False

    def test_a_heartbeat_past_the_threshold_is_stale(self):
        status = {"running": True, "heartbeat": _ago(runner.SCAN_JOB.stale_after_seconds + 1)}
        assert runner.is_stale(status) is True

    def test_a_running_status_without_a_heartbeat_is_stale(self):
        # Written by a build that predates the heartbeat, so it outlived a restart.
        assert runner.is_stale({"running": True}) is True

    def test_an_unreadable_heartbeat_is_stale(self):
        assert runner.is_stale({"running": True, "heartbeat": "yesterday"}) is True

    def test_a_naive_timestamp_is_read_as_utc(self):
        naive = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        assert runner.is_stale({"running": True, "heartbeat": naive}) is False

    def test_reads_the_current_status_by_default(self):
        _stuck()
        assert runner.is_stale() is True
        assert runner.scan_in_progress() is False


class TestHeartbeat:
    def test_every_status_write_beats(self):
        runner.SCAN_JOB._heartbeat = None
        runner.set_status({"running": True})
        status = runner.get_status()
        assert status["heartbeat"] is not None
        assert runner.scan_in_progress() is True

    def test_valkey_keeps_the_heartbeat_out_of_the_status_blob(self):
        """A heartbeat write must never rewrite the status a scan is updating."""
        fake, store = _fake_valkey()
        with patch.object(config, "_valkey", fake):
            runner.set_status({**runner.DEFAULT_STATUS, "running": True})
            blob = store[runner.SCAN_JOB.status_key]
            runner.SCAN_JOB.beat()
            assert store[runner.SCAN_JOB.status_key] == blob
            assert "heartbeat" not in blob
            assert runner.get_status()["heartbeat"] == store[runner.SCAN_JOB.heartbeat_key]

    def test_valkey_bytes_heartbeat_is_decoded(self):
        fake, store = _fake_valkey()
        with patch.object(config, "_valkey", fake):
            store[runner.SCAN_JOB.heartbeat_key] = b"2026-01-01T00:00:00+00:00"
            assert runner.SCAN_JOB.heartbeat() == "2026-01-01T00:00:00+00:00"

    def test_valkey_errors_fall_back_to_in_process_heartbeat(self):
        from redis.exceptions import RedisError

        fake = MagicMock()
        fake.get.side_effect = RedisError("boom")
        fake.set.side_effect = RedisError("boom")
        with patch.object(config, "_valkey", fake):
            runner.SCAN_JOB._heartbeat = None
            runner.SCAN_JOB.beat()
            assert runner.SCAN_JOB.heartbeat() == runner.SCAN_JOB._heartbeat is not None

    def test_the_ticker_beats_until_stopped(self, monkeypatch):
        monkeypatch.setattr(runner.SCAN_JOB, "heartbeat_interval_seconds", 0.01)
        beats = []
        monkeypatch.setattr(runner.SCAN_JOB, "beat", lambda: beats.append(1))
        done = runner._start_heartbeat()
        deadline = time.monotonic() + 2
        while len(beats) < 3 and time.monotonic() < deadline:
            time.sleep(0.01)
        done.set()
        assert len(beats) >= 3
        time.sleep(0.05)
        settled = len(beats)
        time.sleep(0.05)
        assert len(beats) == settled

    def test_the_ticker_survives_a_failed_beat(self, monkeypatch):
        """A ticker that died would make a live scan look abandoned."""
        monkeypatch.setattr(runner.SCAN_JOB, "heartbeat_interval_seconds", 0.01)
        calls = []

        def flaky():
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("transient")

        monkeypatch.setattr(runner.SCAN_JOB, "beat", flaky)
        done = runner._start_heartbeat()
        deadline = time.monotonic() + 2
        while len(calls) < 3 and time.monotonic() < deadline:
            time.sleep(0.01)
        done.set()
        assert len(calls) >= 3


class TestForceClear:
    def test_resets_the_status_and_the_stop_flag(self):
        _stuck(scanned_books=40, total_books=40)
        runner.request_stop()
        status = runner.force_clear()
        assert status["running"] is False
        assert status["scanned_books"] == 0
        assert runner.is_stop_requested() is False


class TestCancelEndpoint:
    def test_clears_a_stuck_scan(self, client, admin_headers):
        _stuck()
        resp = client.post("/api/cancel-scan", headers=admin_headers)
        assert resp.json() == {"status": "cleared_stale"}
        assert runner.get_status()["running"] is False

    def test_only_asks_a_live_scan_to_stop(self, client, admin_headers):
        runner.set_status({"running": True, "phase": "scanning"})
        resp = client.post("/api/cancel-scan", headers=admin_headers)
        assert resp.json() == {"status": "stop_requested"}
        assert runner.get_status()["running"] is True
        assert runner.is_stop_requested() is True


class TestRescanEndpoint:
    def test_starts_over_a_stuck_scan(self, client, admin_headers):
        _stuck()
        with patch.object(runner, "run_rescan_sync") as run:
            resp = client.post("/api/rescan", headers=admin_headers, json={})
        assert resp.json() == {"status": "scan_started"}
        run.assert_called_once()

    def test_still_refuses_while_a_live_scan_runs(self, client, admin_headers):
        runner.set_status({"running": True, "phase": "scanning"})
        with patch.object(runner, "run_rescan_sync") as run:
            resp = client.post("/api/rescan", headers=admin_headers, json={})
        assert resp.json() == {"status": "already_running"}
        run.assert_not_called()

    def test_scan_status_reports_the_heartbeat(self, client, admin_headers):
        runner.set_status({"running": True})
        body = client.get("/api/scan-status", headers=admin_headers).json()
        assert body["heartbeat"] == runner.SCAN_JOB.heartbeat()


class TestScanOwners:
    """Every function that runs a scan recovers from a stuck one and stops its ticker."""

    @pytest.fixture
    def ticker(self, monkeypatch):
        done = threading.Event()
        monkeypatch.setattr(runner, "_start_heartbeat", lambda: done)
        return done

    def test_rescan_runs_over_a_stuck_scan(self, ticker):
        _stuck()
        with (
            patch.object(runner, "scan_library", return_value={}) as scan,
            patch.object(runner, "run_model_thumbnail_queue", return_value=0),
            patch.object(runner, "run_ocr_queue", return_value=0),
        ):
            runner.run_rescan_sync()
        scan.assert_called_once()
        assert ticker.is_set()
        assert runner.get_status()["running"] is False

    def test_rescan_defers_to_a_live_scan(self, ticker):
        runner.set_status({"running": True, "phase": "scanning"})
        with patch.object(runner, "scan_library") as scan:
            runner.run_rescan_sync()
        scan.assert_not_called()

    def test_single_book_rescan_runs_over_a_stuck_scan(self, ticker):
        _stuck()
        with patch.object(runner, "run_ocr_queue", return_value=0):
            runner.rescan_single_book("no-such-book")
        assert ticker.is_set()
        assert runner.get_status()["running"] is False

    def test_single_book_rescan_defers_to_a_live_scan(self, ticker):
        runner.set_status({"running": True, "phase": "scanning"})
        with patch.object(reindex_queue, "reindex_single_book") as reindex:
            runner.rescan_single_book("any")
        reindex.assert_not_called()
        assert not ticker.is_set()

    def test_ocr_trigger_runs_over_a_stuck_scan(self, ticker):
        _stuck()

        def drain():
            runner.set_status({"running": True, "phase": "ocr"})
            return 0

        with patch.object(runner, "run_ocr_queue", side_effect=drain) as run:
            runner.trigger_ocr_queue()
        run.assert_called_once()
        assert ticker.is_set()
        assert runner.get_status()["running"] is False

    def test_ocr_trigger_defers_to_a_live_scan(self, ticker):
        runner.set_status({"running": True, "phase": "scanning"})
        with patch.object(runner, "run_ocr_queue") as run:
            runner.trigger_ocr_queue()
        run.assert_not_called()


class TestOtherGuards:
    """Jobs that refuse to run during a scan no longer refuse over a stuck one."""

    def test_cleanup_proceeds_over_a_stuck_scan(self, client, admin_headers, library_mounted):
        _stuck()
        resp = client.post("/api/maintenance/cleanup-missing", headers=admin_headers)
        assert resp.status_code == 200
