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

The twins live in a folder of this user's own in the temp directory,
``grimoire-{uid}/``, made mode 0700 on first use, so every file in it is one
this user made. A folder by that name that is not a directory this user owns
and alone can write to is not used: the lock then goes without its twin, as it
does when a lock file can't be opened. Stdlib only, so the database layer can
use it before anything else is set up.
"""
import errno
import fcntl
import hashlib
import os
import stat
import tempfile
from types import TracebackType
from typing import Optional, TextIO


def twin_dir() -> str:
    """This user's folder for lock twins, created on first use.

    Raises OSError when it can't be made, or when what is there is not a
    directory (a symlink counts as not one) owned by this user with no access
    for anyone else.
    """
    uid = os.getuid()
    folder = os.path.join(tempfile.gettempdir(), f"grimoire-{uid}")
    try:
        os.mkdir(folder, 0o700)
    except FileExistsError:
        pass
    info = os.lstat(folder)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or info.st_mode & 0o077:
        raise PermissionError(errno.EACCES, "Lock folder is not this user's alone", folder)
    return folder


def local_twin(path: str) -> str:
    """The temp-directory lock file that stands in for ``path`` on this machine.

    Raises OSError when this user's twin folder can't be used (see
    :func:`twin_dir`).
    """
    digest = hashlib.sha256(os.path.realpath(path).encode("utf-8", "surrogateescape"))
    return os.path.join(twin_dir(), f"{digest.hexdigest()[:16]}.lock")


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
        support, or a twin folder that isn't usable) is skipped and the other
        still taken. Raises the OSError when neither can be used.
        """
        if self._handles:
            raise RuntimeError(f"lock already held: {self.path}")
        flags = fcntl.LOCK_EX if blocking else fcntl.LOCK_EX | fcntl.LOCK_NB
        error: Optional[OSError] = None
        lock_paths = [self.path]
        try:
            lock_paths.insert(0, local_twin(self.path))
        except OSError as e:
            error = e
        for lock_path in lock_paths:
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
