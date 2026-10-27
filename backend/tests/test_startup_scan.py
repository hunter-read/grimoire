"""The work the lock-holding worker does as it starts (issue #651).

``STARTUP_SCAN=false`` skips the library scan; the quick housekeeping around it
still runs.
"""
import os
from unittest.mock import patch

import backend.main as main
from backend import config, ocr
from backend.routers.library import _helpers
from backend.services.characters import packs


class TestStartupScan:
    def teardown_method(self):
        _helpers.clear_stop()

    def _run(self, enabled: bool, **patches):
        with patch.object(config, "STARTUP_SCAN", enabled), \
             patch.object(main, "run_rescan_sync") as rescan, \
             patch.object(ocr, "requeue_image_only_books", **patches.get("requeue", {})) as rq, \
             patch.object(packs, "sync_packs", **patches.get("packs", {})) as sync:
            main.startup_scan()
        return rescan, rq, sync

    def test_scans_by_default(self):
        rescan, rq, sync = self._run(True)
        rescan.assert_called_once_with()
        rq.assert_called_once()
        sync.assert_called_once()

    def test_off_skips_only_the_scan(self, caplog):
        with caplog.at_level("INFO", logger="grimoire"):
            rescan, rq, sync = self._run(False)
        rescan.assert_not_called()
        rq.assert_called_once()
        sync.assert_called_once()
        assert "STARTUP_SCAN=false" in caplog.text

    def test_clears_a_stop_left_by_the_previous_run(self):
        _helpers.request_stop()
        self._run(False)
        assert not os.path.exists(_helpers.SCAN_JOB.stop_file())
        assert _helpers.is_stop_requested() is False

    def test_failures_are_logged_and_the_rest_still_runs(self, caplog):
        boom = {"side_effect": RuntimeError("boom")}
        rescan, _, sync = self._run(True, requeue=boom, packs=boom)
        rescan.assert_called_once()
        sync.assert_called_once()
        assert "Couldn't queue scanned books" in caplog.text
        assert "Couldn't load character content packs" in caplog.text


class TestStartupScanSetting:
    def test_defaults_on(self, monkeypatch):
        monkeypatch.delenv("STARTUP_SCAN", raising=False)
        assert config._read_startup_scan() is True

    def test_false_turns_it_off(self, monkeypatch):
        monkeypatch.setenv("STARTUP_SCAN", " False ")
        assert config._read_startup_scan() is False

    def test_anything_else_leaves_it_on(self, monkeypatch):
        # A typo must not silently stop new files from being found.
        monkeypatch.setenv("STARTUP_SCAN", "no")
        assert config._read_startup_scan() is True
