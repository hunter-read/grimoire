"""Cross-process file locks that hold even where the data folder ignores them.

Grimoire's workers agree on who does what through ``flock()`` on files under
DATA_PATH: who migrates a new database, who runs the startup scan, who purges
sessions, which worker is running a scan. Some mounts accept ``flock()`` and
``lockf()`` without enforcing either between processes - a Docker Desktop bind
mount of a macOS or Windows folder does exactly that - and there every worker
won every lock. Two workers on a new database both ran the migrations, and one
failed with "table app_settings already exists", stopping the server; both ran
the startup scan.

So a :class:`FileLock` takes two locks for its path: the file itself, and a twin
in the local temp directory. The temp directory is on the machine's (or the
container's) own disk, shared by every worker on it, where the lock holds. The
file under DATA_PATH still covers processes that share the data folder but not a
temp directory, and anything that checks that file directly.

The twin is named for this user as well as the path, since another user's file
in the temp directory may not be ours to open. Stdlib only, so the database
layer can use it before anything else is set up.
"""
import errno
import fcntl
import hashlib
import os
import tempfile
from types import TracebackType
from typing import Optional, TextIO


def local_twin(path: str) -> str:
    """The temp-directory lock file that stands in for ``path`` on this machine."""
    digest = hashlib.sha256(os.path.realpath(path).encode("utf-8", "surrogateescape"))
    return os.path.join(
        tempfile.gettempdir(), f"grimoire-{os.getuid()}-{digest.hexdigest()[:16]}.lock"
    )


class FileLock:
    """An exclusive lock on ``path`` and its local twin, taken in that order.

    Released by ``release()``, by leaving a ``with`` block, or by the process
    exiting, since closing a file drops its lock.
    """

    def __init__(self, path: str) -> None:
        self.path = path
        self._handles: list[TextIO] = []

    def acquire(self, blocking: bool = True) -> bool:
        """Take both locks. False, holding neither, if another process has one.

        A lock file that can't be opened or locked at all (a mount with no lock
        support) is skipped and the other still taken. Raises the OSError when
        neither can be used.
        """
        if self._handles:
            raise RuntimeError(f"lock already held: {self.path}")
        flags = fcntl.LOCK_EX if blocking else fcntl.LOCK_EX | fcntl.LOCK_NB
        error: Optional[OSError] = None
        for lock_path in (local_twin(self.path), self.path):
            try:
                handle = open(lock_path, "a")
            except OSError as e:
                error = e
                continue
            try:
                fcntl.flock(handle, flags)
            except OSError as e:
                handle.close()
                if e.errno in (errno.EAGAIN, errno.EACCES, errno.EWOULDBLOCK):
                    self.release()
                    return False
                error = e
                continue
            self._handles.append(handle)
        if not self._handles:
            assert error is not None
            raise error
        return True

    def release(self) -> None:
        while self._handles:
            handle = self._handles.pop()
            try:
                fcntl.flock(handle, fcntl.LOCK_UN)
            finally:
                handle.close()

    @property
    def held(self) -> bool:
        """Whether this object holds the lock."""
        return bool(self._handles)

    def __enter__(self) -> "FileLock":
        self.acquire()
        return self

    def __exit__(
        self,
        exc_type: Optional[type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.release()


def held_elsewhere(path: str) -> bool:
    """Whether another holder has the lock on ``path`` right now.

    False when neither lock file can be opened: there is nothing to tell by.
    """
    probe = FileLock(path)
    try:
        if not probe.acquire(blocking=False):
            return True
    except OSError:
        return False
    probe.release()
    return False
