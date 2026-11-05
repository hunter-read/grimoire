"""Cross-process locks that hold even where the data folder ignores them.

On a Docker Desktop bind mount, ``flock()`` on a file under DATA_PATH succeeds
in every worker at once. ``FileLock`` also locks a twin in the local temp
directory, so the workers on one machine still exclude each other.
"""
import errno
import fcntl
import os
import stat
import tempfile
import threading
import time
from unittest.mock import patch

import pytest

from backend import file_locks
from backend.file_locks import FileLock, held_elsewhere, local_twin


def _held(path: str) -> bool:
    """Whether another open of ``path`` is refused the lock right now."""
    with open(path, "a") as other:
        try:
            fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(other, fcntl.LOCK_UN)
        return False


def _hold(path: str):
    """Lock ``path`` alone, as a worker on another machine (or the mount) would."""
    handle = open(path, "a")
    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return handle


@pytest.fixture
def path(tmp_path):
    return str(tmp_path / ".job.lock")


@pytest.fixture
def temp_dir(tmp_path, monkeypatch):
    """A temp directory of the test's own, so the twin folder starts absent."""
    root = tmp_path / "tmp"
    root.mkdir()
    monkeypatch.setattr(file_locks.tempfile, "gettempdir", lambda: str(root))
    return root


class TestLocalTwin:
    def test_lives_in_a_folder_for_the_user_in_the_temp_directory(self, path):
        twin = local_twin(path)
        folder = os.path.dirname(twin)
        assert os.path.dirname(folder) == tempfile.gettempdir()
        assert os.path.basename(folder) == f"grimoire-{os.getuid()}"
        assert twin.endswith(".lock")

    def test_the_folder_is_made_for_this_user_alone(self, path, temp_dir):
        folder = file_locks.twin_dir()
        info = os.lstat(folder)
        assert info.st_uid == os.getuid()
        assert stat.S_IMODE(info.st_mode) == 0o700
        # Made once, then reused.
        assert file_locks.twin_dir() == folder

    def test_a_folder_others_can_reach_is_not_used(self, path, temp_dir):
        folder = temp_dir / f"grimoire-{os.getuid()}"
        folder.mkdir(mode=0o700)
        folder.chmod(0o777)
        with pytest.raises(PermissionError):
            local_twin(path)

    def test_a_symlink_in_its_place_is_not_used(self, path, temp_dir, tmp_path):
        elsewhere = tmp_path / "elsewhere"
        elsewhere.mkdir(mode=0o700)
        os.symlink(elsewhere, temp_dir / f"grimoire-{os.getuid()}")
        with pytest.raises(PermissionError):
            local_twin(path)

    def test_a_file_in_its_place_is_not_used(self, path, temp_dir):
        (temp_dir / f"grimoire-{os.getuid()}").write_text("")
        with pytest.raises(PermissionError):
            local_twin(path)

    def test_a_folder_owned_by_someone_else_is_not_used(self, path, temp_dir, monkeypatch):
        file_locks.twin_dir()
        monkeypatch.setattr(file_locks.os, "getuid", lambda: os.geteuid() + 1)
        (temp_dir / f"grimoire-{os.geteuid() + 1}").mkdir(mode=0o700)
        with pytest.raises(PermissionError):
            local_twin(path)

    def test_the_same_file_by_another_path_has_the_same_twin(self, tmp_path):
        (tmp_path / "real").mkdir()
        os.symlink(tmp_path / "real", tmp_path / "link")
        assert local_twin(str(tmp_path / "link" / "x.lock")) == local_twin(
            str(tmp_path / "real" / "x.lock")
        )

    def test_different_files_have_different_twins(self, tmp_path):
        assert local_twin(str(tmp_path / "a.lock")) != local_twin(str(tmp_path / "b.lock"))


class TestFileLock:
    def test_takes_the_file_and_its_twin(self, path):
        lock = FileLock(path)
        assert lock.acquire(blocking=False) is True
        assert lock.held
        assert _held(path) and _held(local_twin(path))
        lock.release()
        assert not lock.held
        assert not _held(path) and not _held(local_twin(path))

    def test_a_second_holder_is_turned_away(self, path):
        with FileLock(path):
            assert FileLock(path).acquire(blocking=False) is False

    def test_the_twin_alone_keeps_others_out(self, path):
        """The mount case: the file under DATA_PATH locks for anyone, the twin does not."""
        handle = _hold(local_twin(path))
        try:
            assert FileLock(path).acquire(blocking=False) is False
        finally:
            handle.close()

    def test_the_file_alone_keeps_others_out_and_frees_the_twin(self, path):
        handle = _hold(path)
        try:
            lock = FileLock(path)
            assert lock.acquire(blocking=False) is False
            assert not lock.held
            assert not _held(local_twin(path))
        finally:
            handle.close()

    def test_a_blocking_acquire_waits_its_turn(self, path):
        first = FileLock(path)
        first.acquire()
        got = []

        def second():
            with FileLock(path):
                got.append(time.monotonic())

        thread = threading.Thread(target=second)
        thread.start()
        time.sleep(0.2)
        assert got == []
        released = time.monotonic()
        first.release()
        thread.join(5)
        assert got and got[0] >= released

    def test_an_unopenable_file_still_gets_the_twin(self, tmp_path):
        path = str(tmp_path / "missing-dir" / ".job.lock")
        lock = FileLock(path)
        assert lock.acquire(blocking=False) is True
        assert _held(local_twin(path))
        lock.release()

    def test_a_mount_without_lock_support_still_gets_the_twin(self, path):
        real_flock = fcntl.flock

        def flock(handle, flags):
            if handle.name == path and flags != fcntl.LOCK_UN:
                raise OSError(errno.ENOLCK, "No locks available")
            return real_flock(handle, flags)

        with patch.object(file_locks.fcntl, "flock", side_effect=flock):
            lock = FileLock(path)
            assert lock.acquire(blocking=False) is True
            lock.release()

    def test_an_unusable_twin_folder_still_gets_the_file(self, path, temp_dir):
        (temp_dir / f"grimoire-{os.getuid()}").write_text("")
        lock = FileLock(path)
        assert lock.acquire(blocking=False) is True
        assert _held(path)
        lock.release()

    def test_no_usable_twin_folder_or_file_raises(self, temp_dir, tmp_path):
        (temp_dir / f"grimoire-{os.getuid()}").write_text("")
        with pytest.raises(OSError):
            FileLock(str(tmp_path / "missing-dir" / ".job.lock")).acquire()

    def test_no_usable_lock_file_raises(self, path):
        with patch("builtins.open", side_effect=PermissionError("read-only")):
            with pytest.raises(PermissionError):
                FileLock(path).acquire()

    def test_acquiring_twice_is_a_bug(self, path):
        with FileLock(path) as lock:
            with pytest.raises(RuntimeError, match="already held"):
                lock.acquire()

    def test_release_without_the_lock_does_nothing(self, path):
        FileLock(path).release()


class TestHeldElsewhere:
    def test_reports_a_holder(self, path):
        assert held_elsewhere(path) is False
        with FileLock(path):
            assert held_elsewhere(path) is True
        assert held_elsewhere(path) is False

    def test_an_unusable_lock_is_not_held(self, path):
        with patch("builtins.open", side_effect=PermissionError("read-only")):
            assert held_elsewhere(path) is False
