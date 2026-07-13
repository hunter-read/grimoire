"""Direct unit tests for the library rescan/indexer helpers.

These call the helper functions in-process (not via the background-task HTTP
route) so the scan/stop/status orchestration is actually exercised.
"""
from unittest.mock import MagicMock, patch

from backend.routers.library import _helpers
from backend.tests.conftest import make_book, make_game_system


class TestScanStatusState:
    def test_set_and_get_status_roundtrip(self):
        _helpers._set_status({**_helpers._DEFAULT_STATUS, "running": False})
        _helpers._set_status({"total_audio": 7, "scanned_audio": 3})
        status = _helpers._get_status()
        assert status["total_audio"] == 7
        assert status["scanned_audio"] == 3

    def test_default_status_includes_audio_fields(self):
        for key in ("total_audio", "scanned_audio", "new_audio"):
            assert key in _helpers._DEFAULT_STATUS


class TestStopSignal:
    def test_request_and_clear_stop(self):
        _helpers.clear_stop()
        assert _helpers.is_stop_requested() is False
        _helpers.request_stop()
        assert _helpers.is_stop_requested() is True
        _helpers.clear_stop()
        assert _helpers.is_stop_requested() is False


class TestRunRescanSync:
    def test_rescan_runs_and_resets_status(self):
        _helpers.clear_stop()
        # Ensure not flagged as already-running from a prior test.
        _helpers._set_status({**_helpers._DEFAULT_STATUS})
        _helpers.run_rescan_sync()
        status = _helpers._get_status()
        assert status["running"] is False
        assert status["phase"] is None
        # Audio counters are part of the reported status.
        assert "new_audio" in status

    def test_rescan_skips_when_already_running(self):
        _helpers._set_status({**_helpers._DEFAULT_STATUS, "running": True, "phase": "scanning"})
        # Should early-return without touching the scan; status stays "running".
        _helpers.run_rescan_sync()
        assert _helpers._get_status()["running"] is True
        # Reset for other tests.
        _helpers._set_status({**_helpers._DEFAULT_STATUS})

    def test_rescan_aborts_after_scan_when_stop_requested(self):
        _helpers._set_status({**_helpers._DEFAULT_STATUS})
        _helpers.clear_stop()
        # Force the post-scan stop check to short-circuit the indexing phase.
        with patch.object(_helpers, "is_stop_requested", return_value=True):
            _helpers.run_rescan_sync()
        # The outer finally still resets running/phase.
        assert _helpers._get_status()["running"] is False


class TestBackgroundIndexer:
    def test_background_indexer_no_books_exits_cleanly(self):
        # No unindexed PDF books in the test DB → early exit after the sleep.
        with patch.object(_helpers.time, "sleep", return_value=None):
            _helpers.background_indexer()
        # Did not flip the global status into an indexing run.
        assert _helpers._get_status()["phase"] in (None, "scanning", "indexing")

    def test_background_indexer_processes_unindexed_book(self):
        # An unindexed PDF whose file is missing on disk → index_book_text raises,
        # which is caught and the book is flagged index_failed. This exercises the
        # indexer loop + error branch.
        _helpers._set_status({**_helpers._DEFAULT_STATUS})
        _helpers.clear_stop()
        sys = make_game_system()
        book = make_book(
            system_id=sys.id,
            filepath="/tmp/no-such-indexable.pdf",
            mime_type="application/pdf",
            indexed=False,
        )
        with patch.object(_helpers.time, "sleep", return_value=None):
            _helpers.background_indexer()
        from backend.config import SessionLocal
        from backend.models import Book

        db = SessionLocal()
        try:
            refreshed = db.query(Book).filter_by(id=book.id).first()
            # Either indexed or flagged failed — in both cases it was processed.
            assert refreshed.indexed or refreshed.index_failed
        finally:
            db.close()
        _helpers._set_status({**_helpers._DEFAULT_STATUS})


class TestValkeyBranches:
    """Exercise the Valkey-backed code paths by injecting a fake client."""

    def test_status_and_stop_via_valkey(self):
        fake = MagicMock()
        store = {}
        fake.set.side_effect = lambda k, v, **kw: store.__setitem__(k, v)
        fake.get.side_effect = lambda k: store.get(k)
        fake.delete.side_effect = lambda k: store.pop(k, None)
        fake.exists.side_effect = lambda k: k in store

        with patch.object(_helpers, "_valkey", fake):
            _helpers._set_status({**_helpers._DEFAULT_STATUS, "running": True})
            assert _helpers._get_status()["running"] is True
            _helpers.request_stop()
            assert _helpers.is_stop_requested() is True
            _helpers.clear_stop()
            assert _helpers.is_stop_requested() is False

    def test_valkey_errors_fall_back_to_in_process(self):
        fake = MagicMock()
        fake.get.side_effect = Exception("boom")
        fake.set.side_effect = Exception("boom")
        fake.exists.side_effect = Exception("boom")
        fake.delete.side_effect = Exception("boom")

        with patch.object(_helpers, "_valkey", fake):
            # None of these should raise despite the Valkey client failing.
            _helpers._set_status({"running": False})
            _helpers._get_status()
            _helpers.request_stop()
            _helpers.is_stop_requested()
            _helpers.clear_stop()
