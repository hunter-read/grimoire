"""The shared job machinery: status, stop flag, heartbeat and run lock (issue #711).

The library scan and the duplicate scan both run on ``services.jobs.Job``; their
own test files cover how each uses it. This covers what every job gets, using a
throwaway job so nothing here touches either real one.
"""
import fcntl
import os
import uuid
from unittest.mock import MagicMock, patch

import pytest

from backend import config
from backend.services import jobs


@pytest.fixture
def job():
    job = jobs.Job(f"test_{uuid.uuid4().hex[:8]}", {"running": False, "done": 0})
    yield job
    job.clear_stop()
    for path in (job.lock_path(), job.stop_file()):
        if os.path.exists(path):
            os.remove(path)


def _hold(path: str):
    """Hold ``path``'s lock on a file of its own, as another worker would."""
    lock = open(path, "a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return lock


class TestKeys:
    def test_each_job_has_keys_of_its_own(self, job):
        other = jobs.Job("other", {})
        mine = {job.status_key, job.stop_key, job.heartbeat_key, job.stop_file(), job.lock_path()}
        theirs = {
            other.status_key, other.stop_key, other.heartbeat_key,
            other.stop_file(), other.lock_path(),
        }
        assert not mine & theirs

    def test_the_library_scan_keeps_its_existing_names(self):
        """Renaming them would strand state an older build left behind."""
        from backend.services.library_scan import runner

        scan = runner.SCAN_JOB
        assert scan.status_key == "grimoire:scan_status"
        assert scan.stop_key == "grimoire:scan_stop"
        assert scan.heartbeat_key == "grimoire:scan_heartbeat"
        assert os.path.basename(scan.stop_file()) == ".scan.stop"
        assert os.path.basename(scan.lock_path()) == ".scan.lock"

    def test_the_duplicate_scan_keeps_its_existing_names(self):
        from backend.services.duplicates import job as dup

        assert dup.JOB.status_key == "grimoire:duplicate_scan_status"
        assert dup.JOB.stop_key == "grimoire:duplicate_scan_stop"


class TestStatus:
    def test_starts_from_the_defaults(self, job):
        assert job.status() == {"running": False, "done": 0, "heartbeat": None}

    def test_update_merges_and_beats(self, job):
        job.update({"done": 3})
        status = job.status()
        assert status["done"] == 3 and status["running"] is False
        assert status["heartbeat"] is not None

    def test_force_clear_resets_and_sets_the_extra_fields(self, job):
        job.update({"running": True, "done": 9})
        job.request_stop()
        status = job.force_clear(done=-1)
        assert status["running"] is False and status["done"] == -1
        assert job.is_stop_requested() is False


class TestStopFlag:
    def test_reaches_another_worker_through_the_file(self, job):
        job.request_stop()
        # Another worker has a Job of the same name and none of this one's state.
        elsewhere = jobs.Job(job.name, {})
        assert elsewhere.is_stop_requested() is True
        elsewhere.clear_stop()
        assert job.is_stop_requested() is False

    def test_a_stale_file_is_ignored(self, job):
        job.request_stop()
        old = os.stat(job.stop_file()).st_mtime - jobs.STOP_TTL_SECONDS - 60
        os.utime(job.stop_file(), (old, old))
        assert job.is_stop_requested() is False

    def test_valkey_decides_when_present(self, job):
        fake = MagicMock()
        fake.exists.return_value = 0
        with patch.object(config, "_valkey", fake):
            job.request_stop()
            fake.set.assert_called_once_with(job.stop_key, "1", ex=jobs.STOP_TTL_SECONDS)
            # The file is written too, but Valkey's answer is the one that counts.
            assert job.is_stop_requested() is False


class TestRunLock:
    def test_a_run_is_visible_to_other_workers(self, job):
        assert job.lock_held() is False
        with job.run_lock() as acquired:
            assert acquired is True
            assert job.lock_held() is True
        assert job.lock_held() is False

    def test_a_second_run_is_turned_away(self, job):
        lock = _hold(job.lock_path())
        try:
            with job.run_lock() as acquired:
                assert acquired is False
        finally:
            lock.close()
        with job.run_lock() as acquired:
            assert acquired is True

    def test_an_unopenable_lock_does_not_block_the_run(self, job):
        with patch("builtins.open", side_effect=PermissionError("ro")):
            with job.run_lock() as acquired:
                assert acquired is True
            assert job.lock_held() is False
