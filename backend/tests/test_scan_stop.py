"""Stop reaching a library scan wherever it runs (issue #651).

Without Valkey the stop flag lives in a file under DATA_PATH, so a Stop that
lands on one worker reaches the scan another worker is running. The concurrent
OCR drain checks it between books, not only inside the book in flight.
"""
import fcntl
import os
import threading
import time
import uuid
from unittest.mock import MagicMock, patch

from backend import config
from backend.config import SessionLocal
from backend.models import Book
from backend.routers.library import _helpers
from backend.services import jobs


def _queue_books(n: int) -> list[str]:
    db = SessionLocal()
    try:
        db.query(Book).filter_by(ocr_pending=True).update({"ocr_pending": False})
        ids = []
        for _ in range(n):
            uid = str(uuid.uuid4())[:8]
            book = Book(
                title=f"Stop-{uid}", filename=f"stop-{uid}.pdf",
                filepath=f"/tmp/stop-{uid}.pdf", relative_path=f"stop-{uid}.pdf",
                mime_type="application/pdf", ocr_pending=True,
            )
            db.add(book)
            db.flush()
            ids.append(book.id)
        db.commit()
        return ids
    finally:
        db.close()


class TestStopFile:
    def setup_method(self):
        _helpers.clear_stop()

    def teardown_method(self):
        _helpers.clear_stop()

    def test_request_writes_the_file_and_clear_removes_it(self):
        _helpers.request_stop()
        assert os.path.exists(_helpers.SCAN_JOB.stop_file())
        _helpers.clear_stop()
        assert not os.path.exists(_helpers.SCAN_JOB.stop_file())

    def test_a_stop_from_another_worker_is_seen(self):
        # What another worker's request_stop() leaves behind: just the file,
        # with no flag in this process.
        with open(_helpers.SCAN_JOB.stop_file(), "w"):
            pass
        assert _helpers.SCAN_JOB._stop_requested is False
        assert _helpers.is_stop_requested() is True

    def test_another_workers_clear_is_seen(self):
        _helpers.request_stop()
        os.remove(_helpers.SCAN_JOB.stop_file())  # another worker's clear_stop()
        assert _helpers.is_stop_requested() is False

    def test_a_stale_file_is_ignored(self):
        _helpers.request_stop()
        old = time.time() - jobs.STOP_TTL_SECONDS - 60
        os.utime(_helpers.SCAN_JOB.stop_file(), (old, old))
        assert _helpers.is_stop_requested() is False

    def test_unwritable_data_path_falls_back_to_the_process_flag(self, tmp_path):
        missing = str(tmp_path / "gone" / ".scan.stop")
        with patch.object(_helpers.SCAN_JOB, "stop_file", return_value=missing):
            _helpers.request_stop()
            assert _helpers.is_stop_requested() is True
            _helpers.clear_stop()
            assert _helpers.is_stop_requested() is False

    def test_clear_tolerates_a_file_it_cannot_remove(self):
        with patch.object(_helpers.os, "remove", side_effect=PermissionError("ro")):
            _helpers.clear_stop()  # logged, not raised
        assert _helpers.SCAN_JOB._stop_requested is False



def _hold_scan_lock():
    """Hold .scan.lock as another worker's startup scan does.

    flock locks belong to the open file, so a second open of the same path
    conflicts with it even inside one process.
    """
    lock = open(os.path.join(config.DATA_PATH, ".scan.lock"), "a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return lock


class TestCancelReachesAnotherWorker:
    """Without Valkey, the worker taking the Stop may not be the one scanning."""

    def setup_method(self):
        _helpers.clear_stop()
        _helpers._set_status({**_helpers._DEFAULT_STATUS})

    def teardown_method(self):
        _helpers.clear_stop()

    def test_startup_scan_running_tracks_the_lock(self):
        assert _helpers.startup_scan_running() is False
        lock = _hold_scan_lock()
        try:
            assert _helpers.startup_scan_running() is True
        finally:
            lock.close()
        assert _helpers.startup_scan_running() is False

    def test_unreadable_lock_counts_as_not_running(self):
        with patch("builtins.open", side_effect=PermissionError("ro")):
            assert _helpers.startup_scan_running() is False

    def test_stop_reaches_a_startup_scan_on_another_worker(self, client, admin_headers):
        lock = _hold_scan_lock()
        try:
            resp = client.post("/api/cancel-scan", headers=admin_headers)
        finally:
            lock.close()
        assert resp.json()["status"] == "stop_requested"
        assert os.path.exists(_helpers.SCAN_JOB.stop_file())

    def test_nothing_running_anywhere_is_left_alone(self, client, admin_headers):
        resp = client.post("/api/cancel-scan", headers=admin_headers)
        assert resp.json()["status"] == "not_running"
        assert not os.path.exists(_helpers.SCAN_JOB.stop_file())

    def test_with_valkey_the_shared_status_decides(self, client, admin_headers):
        fake = MagicMock()
        fake.get.return_value = None
        lock = _hold_scan_lock()
        try:
            with patch.object(config, "_valkey", fake):
                resp = client.post("/api/cancel-scan", headers=admin_headers)
        finally:
            lock.close()
        assert resp.json()["status"] == "not_running"
        assert all(c.args[0] != _helpers.SCAN_JOB.stop_key for c in fake.set.call_args_list)


class TestConcurrentOcrStop:
    def setup_method(self):
        _helpers.clear_stop()
        _helpers._set_status({**_helpers._DEFAULT_STATUS})

    def teardown_method(self):
        # run_ocr_queue leaves "running" to its caller to clear; left set, it
        # refuses later tests' rescans and cleanups as "a scan is running".
        _helpers.clear_stop()
        _helpers._set_status({**_helpers._DEFAULT_STATUS})

    def test_stop_before_the_drain_starts_no_book(self):
        _queue_books(3)
        _helpers.request_stop()
        with patch.object(config, "OCR_CONCURRENCY", 2), \
             patch.object(_helpers, "_ocr_one_book") as m:
            assert _helpers.run_ocr_queue() == 0
        m.assert_not_called()
        assert _helpers._get_status()["ocr_done"] == 0

    def test_stop_mid_drain_leaves_the_queued_books(self):
        _queue_books(6)
        lock = threading.Lock()
        stopped = threading.Event()
        calls = []

        def ocr(book_id):
            with lock:
                calls.append(book_id)
                first = len(calls) == 1
            if first:
                _helpers.request_stop()
                stopped.set()
            else:
                # Whatever started alongside the first book finishes only after
                # the stop, so no worker can take a third book before it.
                stopped.wait(5)
            return "done"

        with patch.object(config, "OCR_CONCURRENCY", 2), \
             patch.object(_helpers, "_ocr_one_book", side_effect=ocr):
            completed = _helpers.run_ocr_queue()

        assert 1 <= len(calls) <= 2
        assert completed == len(calls)
        assert _helpers._get_status()["ocr_done"] == len(calls)
