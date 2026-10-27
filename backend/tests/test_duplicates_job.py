"""The duplicate-scan job: status plumbing, cancellation, and failure.

Separate from test_duplicates_detection.py, which is about *what* the scan
finds. This is about how the job behaves - especially the paths that only run
when something goes wrong, or when Valkey is in the picture.
"""
import fcntl
import os
from unittest.mock import MagicMock

import pytest

from backend import config
from backend.config import SessionLocal
from backend.models import Book
from backend.models.duplicates import DuplicateGroup
from backend.services.duplicates import job
from backend.services.jobs import Job
from backend.tests.conftest import make_book, make_game_system


@pytest.fixture(autouse=True)
def _clean_status():
    """Every test starts from a settled, cancel-free job."""
    job.JOB._status = dict(job.DEFAULT_STATUS)
    job.clear_stop()
    yield
    job.JOB._status = dict(job.DEFAULT_STATUS)
    job.clear_stop()


class TestStopFlag:
    def test_in_process_round_trip(self):
        assert job.is_stop_requested() is False
        job.request_stop()
        assert job.is_stop_requested() is True
        job.clear_stop()
        assert job.is_stop_requested() is False

    def test_uses_valkey_when_present(self, monkeypatch):
        fake = MagicMock()
        fake.exists.return_value = 1
        monkeypatch.setattr(config, "_valkey", fake)

        job.request_stop()
        fake.set.assert_called_once()
        assert job.is_stop_requested() is True
        job.clear_stop()
        fake.delete.assert_called_once()

    def test_falls_back_when_valkey_errors(self, monkeypatch):
        """A Valkey outage must degrade to the stop file, not crash."""
        try:
            from redis.exceptions import RedisError
        except ImportError:  # pragma: no cover - redis is a normal dependency
            pytest.skip("redis not installed")

        fake = MagicMock()
        fake.set.side_effect = RedisError("down")
        fake.delete.side_effect = RedisError("down")
        fake.exists.side_effect = RedisError("down")
        monkeypatch.setattr(config, "_valkey", fake)

        job.request_stop()
        assert job.is_stop_requested() is True  # the stop file carried it
        job.clear_stop()
        assert job.is_stop_requested() is False


class TestStatus:
    def test_in_process_round_trip(self):
        job.set_status({"phase": "hashing", "scanned": 3})
        status = job.get_status()
        assert status["phase"] == "hashing" and status["scanned"] == 3

    def test_reads_and_writes_valkey(self, monkeypatch):
        store = {}
        fake = MagicMock()
        fake.get.side_effect = lambda k: store.get(k)
        fake.set.side_effect = lambda k, v, ex=None: store.__setitem__(k, v)
        monkeypatch.setattr(config, "_valkey", fake)

        job.set_status({"phase": "grouping"})
        assert job.get_status()["phase"] == "grouping"
        assert job.JOB.status_key in store

    def test_corrupt_valkey_blob_falls_back(self, monkeypatch):
        fake = MagicMock()
        fake.get.return_value = "{not json"
        monkeypatch.setattr(config, "_valkey", fake)
        # Must not raise - a corrupt cache is not a reason to fail a request.
        assert job.get_status()["running"] is False


class TestRunGuards:
    def test_refuses_to_start_twice(self):
        job.set_status({"running": True, "phase": "hashing"})
        status = job.run_detection_sync(["book"])
        assert status["running"] is True  # untouched; the first run owns it

    def test_unknown_resource_types_fall_back_to_all(self, monkeypatch):
        seen = []
        monkeypatch.setattr(job, "_candidates", lambda db, model: seen.append(model) or [])
        job.run_detection_sync(["sandwich"])
        assert len(seen) == len(job.RESOURCE_MODELS)

    def test_cancelled_run_discards_partial_results(self, monkeypatch):
        system = make_game_system()
        make_book(system_id=system.id, title="Cancel Me", content_hash="cancel900")
        make_book(system_id=system.id, title="Cancel Me", content_hash="cancel900")

        # Stop is requested the moment the first collection is reached.
        monkeypatch.setattr(job, "is_stop_requested", lambda: True)
        status = job.run_detection_sync(["book"])

        assert status["running"] is False
        db = SessionLocal()
        try:
            assert (
                db.query(DuplicateGroup).filter_by(scan_id=status["scan_id"]).count() == 0
            )
        finally:
            db.close()

    def test_a_completed_run_replaces_the_previous_one(self):
        system = make_game_system()
        make_book(system_id=system.id, title="Replace Me", content_hash="replace910")
        make_book(system_id=system.id, title="Replace Me", content_hash="replace910")

        first = job.run_detection_sync(["book"])
        second = job.run_detection_sync(["book"])
        assert first["scan_id"] != second["scan_id"]

        db = SessionLocal()
        try:
            scan_ids = {g.scan_id for g in db.query(DuplicateGroup).all()}
            # Only the newest run's rows survive.
            assert scan_ids <= {second["scan_id"]}
        finally:
            db.close()

    def test_a_failure_is_recorded_not_raised(self, monkeypatch):
        def boom(db, model):
            raise RuntimeError("disk on fire")

        monkeypatch.setattr(job, "_candidates", boom)
        status = job.run_detection_sync(["book"])
        assert status["running"] is False
        assert "disk on fire" in status["error"]

    def test_a_collection_with_one_item_is_skipped(self, monkeypatch):
        system = make_game_system()
        only = make_book(system_id=system.id)
        monkeypatch.setattr(
            job,
            "_candidates",
            lambda db, model: [db.query(Book).filter_by(id=only.id).first()]
            if model is Book
            else [],
        )
        status = job.run_detection_sync(["book"])
        assert status["groups_found"] == 0
        assert status["error"] is None


def _hold_run_lock():
    """Take the job's lock on a file of its own, as a scan on another worker does."""
    lock = open(job.JOB.lock_path(), "a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return lock


class TestAnotherWorker:
    """Without Valkey the scan's status is per-process, so another worker's run
    shows only in the lock and its Stop only in the stop file (issue #711)."""

    def test_a_stop_from_another_worker_cancels_the_run(self, monkeypatch):
        seen = []

        def candidates(db, model):
            seen.append(model)
            # Another worker has its own Job of the same name and none of this
            # process's state: only what it writes to disk reaches this one.
            Job(job.JOB.name, {}).request_stop()
            return []

        monkeypatch.setattr(job, "_candidates", candidates)
        status = job.run_detection_sync(["book", "map"])
        assert len(seen) == 1
        assert status["running"] is False

    def test_a_run_on_another_worker_is_not_doubled(self, monkeypatch):
        monkeypatch.setattr(job, "_candidates", lambda db, model: pytest.fail("ran twice"))
        lock = _hold_run_lock()
        try:
            status = job.run_detection_sync(["book"])
        finally:
            lock.close()
        assert status["running"] is False and status["scan_id"] is None

    def test_cancel_reaches_a_run_on_another_worker(self, client, admin_headers):
        lock = _hold_run_lock()
        try:
            resp = client.post("/api/duplicates/cancel-scan", headers=admin_headers)
        finally:
            lock.close()
        assert resp.json()["status"] == "stop_requested"
        assert os.path.exists(job.JOB.stop_file())

    def test_cancel_with_nothing_running_anywhere_is_left_alone(self, client, admin_headers):
        resp = client.post("/api/duplicates/cancel-scan", headers=admin_headers)
        assert resp.json()["status"] == "not_running"
        assert not os.path.exists(job.JOB.stop_file())

    def test_start_is_refused_while_another_worker_runs(self, client, admin_headers, monkeypatch):
        from backend.routers.library import _helpers as lib

        monkeypatch.setattr(lib, "scan_in_progress", lambda: False)
        lock = _hold_run_lock()
        try:
            resp = client.post("/api/duplicates/scan", headers=admin_headers, json={})
        finally:
            lock.close()
        assert resp.json()["status"] == "already_running"
