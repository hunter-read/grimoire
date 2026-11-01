"""Not restarting a startup scan that keeps dying with the server (issue #762).

A worker killed mid-scan is replaced, and the replacement starts the same scan
over. ``startup_guard`` counts the startup scans that never finished and, after
``MAX_DEATHS`` in a row, holds the next one back for ``RETRY_AFTER``.
"""
import json
import logging
from unittest.mock import patch

import pytest

import backend.main as main
from backend import config, ocr
from backend.services.characters import packs
from backend.services.library_scan import runner, startup_guard


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_PATH", str(tmp_path))
    monkeypatch.setattr(startup_guard, "_started_here", False)
    return tmp_path


def _state(data_dir):
    return json.loads((data_dir / startup_guard.STATE_FILE).read_text())


def _die():
    """A process that started the scan and was killed before finishing it."""
    startup_guard._started_here = False


class TestGuard:
    def test_a_first_start_scans(self, data_dir):
        assert startup_guard.begin() is True
        assert _state(data_dir)["running"] is True
        assert _state(data_dir)["deaths"] == 0

    def test_a_finished_scan_clears_the_record(self, data_dir):
        startup_guard.begin()
        startup_guard.finish()
        assert _state(data_dir) == {"running": False}
        assert startup_guard.begin() is True
        assert _state(data_dir)["deaths"] == 0

    def test_deaths_are_counted_and_warned_about(self, data_dir, caplog):
        startup_guard.begin()
        _die()
        with caplog.at_level(logging.WARNING, logger="grimoire"):
            assert startup_guard.begin() is True
        assert _state(data_dir)["deaths"] == 1
        assert "stopped unexpectedly" in caplog.text

    def test_too_many_deaths_hold_the_scan_back(self, data_dir, caplog):
        for _ in range(startup_guard.MAX_DEATHS):
            assert startup_guard.begin() is True
            _die()
        started = _state(data_dir)["started"]
        with caplog.at_level(logging.ERROR, logger="grimoire"):
            assert startup_guard.begin() is False
        assert "will not start on its own" in caplog.text
        # The wait still counts from the last real attempt, and another start
        # inside it is held back too.
        assert _state(data_dir)["started"] == started
        assert startup_guard.begin() is False

    def test_held_back_until_the_wait_is_over(self, data_dir):
        for _ in range(startup_guard.MAX_DEATHS):
            startup_guard.begin()
            _die()
        later = _state(data_dir)["started"] + startup_guard.RETRY_AFTER + 1
        with patch.object(startup_guard.time, "time", return_value=later):
            assert startup_guard.begin() is True
        assert _state(data_dir)["started"] == later

    def test_a_process_that_held_the_scan_back_does_not_clear_the_deaths(self, data_dir):
        for _ in range(startup_guard.MAX_DEATHS):
            startup_guard.begin()
            _die()
        assert startup_guard.begin() is False
        startup_guard.finish()
        assert _state(data_dir)["running"] is True
        assert startup_guard.begin() is False

    def test_an_unreadable_record_is_a_first_start(self, data_dir, caplog):
        (data_dir / startup_guard.STATE_FILE).write_text("{oops")
        with caplog.at_level(logging.WARNING, logger="grimoire"):
            assert startup_guard.begin() is True
        assert "Couldn't read" in caplog.text
        (data_dir / startup_guard.STATE_FILE).write_text("[]")
        startup_guard._started_here = False
        assert startup_guard.begin() is True

    def test_a_record_that_cannot_be_saved_is_logged(self, data_dir, caplog):
        with patch.object(startup_guard.os, "replace", side_effect=OSError("read-only")):
            with caplog.at_level(logging.WARNING, logger="grimoire"):
                assert startup_guard.begin() is True
        assert "Couldn't save the startup scan state" in caplog.text


class TestStartupScan:
    def teardown_method(self):
        runner.clear_stop()

    def _run(self):
        with patch.object(config, "STARTUP_SCAN", True), \
             patch.object(main, "run_rescan_sync") as rescan, \
             patch.object(ocr, "requeue_image_only_books"), \
             patch.object(packs, "sync_packs") as sync:
            main.startup_scan()
        return rescan, sync

    def test_a_held_back_scan_still_does_the_rest(self, data_dir):
        with patch.object(startup_guard, "begin", return_value=False):
            rescan, sync = self._run()
        rescan.assert_not_called()
        sync.assert_called_once()

    def test_the_scan_is_recorded_as_finished_even_when_it_fails(self, data_dir):
        with patch.object(config, "STARTUP_SCAN", True), \
             patch.object(main, "run_rescan_sync", side_effect=RuntimeError("boom")), \
             patch.object(ocr, "requeue_image_only_books"):
            with pytest.raises(RuntimeError):
                main.startup_scan()
        assert _state(data_dir) == {"running": False}
