"""Direct unit tests for the library rescan/indexer helpers.

These call the helper functions in-process (not via the background-task HTTP
route) so the scan/stop/status orchestration is actually exercised.
"""
from unittest.mock import MagicMock, patch

from backend import config
from backend.services.library_scan import runner


class TestScanStatusState:
    def test_set_and_get_status_roundtrip(self):
        runner.set_status({**runner.DEFAULT_STATUS, "running": False})
        runner.set_status({"total_audio": 7, "scanned_audio": 3})
        status = runner.get_status()
        assert status["total_audio"] == 7
        assert status["scanned_audio"] == 3

    def test_default_status_includes_audio_fields(self):
        for key in ("total_audio", "scanned_audio", "new_audio"):
            assert key in runner.DEFAULT_STATUS

    def test_default_status_includes_ocr_fields(self):
        for key in ("total_ocr", "ocr_done", "ocr_current"):
            assert key in runner.DEFAULT_STATUS


class TestOcrConcurrency:
    def test_pool_used_when_concurrency_gt_1(self):
        """OCR_CONCURRENCY>1 drains the queue via a ThreadPoolExecutor."""
        import uuid as _uuid

        from backend import config
        from backend.config import SessionLocal
        from backend.models import Book

        runner.clear_stop()
        runner.set_status({**runner.DEFAULT_STATUS})
        # Clear any pending books left by other tests so we count only ours.
        db = SessionLocal()
        db.query(Book).filter_by(ocr_pending=True).update({"ocr_pending": False})
        db.commit()
        db.close()

        ids = []
        for _ in range(2):
            uid = str(_uuid.uuid4())[:8]
            db = SessionLocal()
            b = Book(
                title=f"S-{uid}", filename=f"s-{uid}.pdf", filepath=f"/tmp/s-{uid}.pdf",
                relative_path=f"s-{uid}.pdf", mime_type="application/pdf",
                ocr_pending=True,
            )
            db.add(b)
            db.commit()
            ids.append(b.id)
            db.close()

        with patch.object(config, "OCR_CONCURRENCY", 2), \
             patch.object(runner, "_ocr_one_book", return_value="done") as m:
            completed = runner.run_ocr_queue()

        assert completed == 2
        assert m.call_count == 2
        assert set(m.call_args_list[i].args[0] for i in range(2)) == set(ids)

    def test_concurrency_zero_disables_and_leaves_queue_pending(self):
        """OCR_CONCURRENCY=0 skips the drain and leaves queued books untouched."""
        import uuid as _uuid

        from backend import config
        from backend.config import SessionLocal
        from backend.models import Book

        runner.clear_stop()
        runner.set_status({**runner.DEFAULT_STATUS})
        db = SessionLocal()
        uid = str(_uuid.uuid4())[:8]
        b = Book(
            title=f"Z-{uid}", filename=f"z-{uid}.pdf", filepath=f"/tmp/z-{uid}.pdf",
            relative_path=f"z-{uid}.pdf", mime_type="application/pdf",
            ocr_pending=True,
        )
        db.add(b)
        db.commit()
        bid = b.id
        db.close()

        with patch.object(config, "OCR_CONCURRENCY", 0), \
             patch.object(runner, "_ocr_one_book") as m:
            completed = runner.run_ocr_queue()

        assert completed == 0
        m.assert_not_called()
        db = SessionLocal()
        try:
            assert db.get(Book, bid).ocr_pending is True  # left queued, not lost
        finally:
            db.close()


class TestStopSignal:
    def test_request_and_clear_stop(self):
        runner.clear_stop()
        assert runner.is_stop_requested() is False
        runner.request_stop()
        assert runner.is_stop_requested() is True
        runner.clear_stop()
        assert runner.is_stop_requested() is False


class TestRunRescanSync:
    def test_rescan_runs_and_resets_status(self):
        runner.clear_stop()
        # Ensure not flagged as already-running from a prior test.
        runner.set_status({**runner.DEFAULT_STATUS})
        runner.run_rescan_sync()
        status = runner.get_status()
        assert status["running"] is False
        assert status["phase"] is None
        # Audio counters are part of the reported status.
        assert "new_audio" in status

    def test_rescan_skips_when_already_running(self):
        runner.set_status({**runner.DEFAULT_STATUS, "running": True, "phase": "scanning"})
        # Should early-return without touching the scan; status stays "running".
        runner.run_rescan_sync()
        assert runner.get_status()["running"] is True
        # Reset for other tests.
        runner.set_status({**runner.DEFAULT_STATUS})

    def test_rescan_aborts_after_scan_when_stop_requested(self):
        runner.set_status({**runner.DEFAULT_STATUS})
        runner.clear_stop()
        # Force the post-scan stop check to short-circuit the indexing phase.
        with patch.object(runner, "is_stop_requested", return_value=True):
            runner.run_rescan_sync()
        # The outer finally still resets running/phase.
        assert runner.get_status()["running"] is False


class TestRescanDrainsTheModelQueue:
    """The thumbnail queue must be drained by the worker that actually runs.

    Regression, and the reason large models silently never got a preview: the
    drain lived in ``background_indexer``, which nothing called — main.py starts
    ``run_rescan_sync`` and so does the rescan endpoint. A model flagged
    thumbnail_pending during the walk was therefore picked up by nothing at all,
    and the scan still reported success, so there was no error to go looking for.
    """

    def test_rescan_drains_the_thumbnail_queue(self):
        runner.set_status({**runner.DEFAULT_STATUS})
        runner.clear_stop()
        with (
            patch.object(runner, "scan_library", return_value={}),
            patch.object(runner, "run_model_thumbnail_queue", return_value=0) as thumbs,
            patch.object(runner, "run_ocr_queue", return_value=0),
        ):
            runner.run_rescan_sync()
        thumbs.assert_called_once()

    def test_thumbnails_are_drained_before_ocr(self):
        """Previews are bounded and quick; OCR can run for hours.

        A user watching a rescan should get their model previews without waiting
        out a scanned library's text recognition.
        """
        order = []
        runner.set_status({**runner.DEFAULT_STATUS})
        runner.clear_stop()
        with (
            patch.object(runner, "scan_library", return_value={}),
            patch.object(
                runner, "run_model_thumbnail_queue", side_effect=lambda: order.append("thumbs")
            ),
            patch.object(runner, "run_ocr_queue", side_effect=lambda: order.append("ocr")),
        ):
            runner.run_rescan_sync()
        assert order == ["thumbs", "ocr"]

    def test_a_models_only_library_still_drains(self):
        """No books to index must not skip the drain — that was the original bug."""
        runner.set_status({**runner.DEFAULT_STATUS})
        runner.clear_stop()
        with (
            patch.object(runner, "scan_library", return_value={}),
            patch.object(runner, "run_model_thumbnail_queue", return_value=0) as thumbs,
            patch.object(runner, "run_ocr_queue", return_value=0),
        ):
            runner.run_rescan_sync()
        thumbs.assert_called_once()

    def test_a_stop_request_skips_the_drain(self):
        """A stop leaves the flags set so the next run picks the models back up."""
        runner.set_status({**runner.DEFAULT_STATUS})
        runner.clear_stop()
        with (
            patch.object(runner, "scan_library", return_value={}),
            patch.object(runner, "is_stop_requested", return_value=True),
            patch.object(runner, "run_model_thumbnail_queue", return_value=0) as thumbs,
            patch.object(runner, "run_ocr_queue", return_value=0),
        ):
            runner.run_rescan_sync()
        thumbs.assert_not_called()


class TestValkeyBranches:
    """Exercise the Valkey-backed code paths by injecting a fake client."""

    def test_status_and_stop_via_valkey(self):
        fake = MagicMock()
        store = {}
        fake.set.side_effect = lambda k, v, **kw: store.__setitem__(k, v)
        fake.get.side_effect = lambda k: store.get(k)
        fake.delete.side_effect = lambda k: store.pop(k, None)
        fake.exists.side_effect = lambda k: k in store

        with patch.object(config, "_valkey", fake):
            runner.set_status({**runner.DEFAULT_STATUS, "running": True})
            assert runner.get_status()["running"] is True
            runner.request_stop()
            assert runner.is_stop_requested() is True
            runner.clear_stop()
            assert runner.is_stop_requested() is False

    def test_valkey_errors_fall_back_to_in_process(self):
        from redis.exceptions import RedisError

        fake = MagicMock()
        fake.get.side_effect = RedisError("boom")
        fake.set.side_effect = RedisError("boom")
        fake.exists.side_effect = RedisError("boom")
        fake.delete.side_effect = RedisError("boom")

        with patch.object(config, "_valkey", fake):
            # A Valkey connection failure is the expected case: swallow + log and
            # fall back to in-process state without raising.
            runner.set_status({"running": False})
            assert runner.get_status()["running"] is False
            runner.request_stop()
            assert runner.is_stop_requested() is True
            runner.clear_stop()
            assert runner.is_stop_requested() is False

    def test_valkey_corrupt_status_falls_back(self):
        """A non-JSON cached status blob is tolerated (ValueError path)."""
        fake = MagicMock()
        fake.get.return_value = b"not-json"

        with patch.object(config, "_valkey", fake):
            # Falls back to the in-process default rather than raising.
            assert isinstance(runner.get_status(), dict)

    def test_unexpected_valkey_error_propagates(self):
        """An unexpected error type is no longer silently swallowed."""
        import pytest

        fake = MagicMock()
        fake.set.side_effect = RuntimeError("unexpected")

        with patch.object(config, "_valkey", fake):
            with pytest.raises(RuntimeError):
                runner.request_stop()
