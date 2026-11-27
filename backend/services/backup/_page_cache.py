"""Keeping a backup out of the operating system's page cache.

Linux keeps every file a process reads or writes in memory until something else
wants the room, and counts it against the container. A backup reads each
uploaded file once and writes an archive the app never reads back, so a
multi-gigabyte backup left `docker stats` showing gigabytes held by Grimoire
until the kernel got round to reclaiming them. Telling the kernel a file is
finished with (``POSIX_FADV_DONTNEED``) frees it at once.

Everything here is best-effort: on a system without ``posix_fadvise`` (macOS,
Windows) or a filesystem that refuses it, nothing happens and the backup is
unaffected.
"""
import os
import zipfile
from typing import Optional

# How much may go into the archive between releases. Smaller keeps less cached
# at the cost of more flushes to disk; 64 MB is a flush every second or so.
RELEASE_EVERY_BYTES = 64 * 1024 * 1024


def _drop_fd(fd: int, flush: bool) -> None:
    # Looked up by name: neither exists on macOS or Windows.
    fadvise = getattr(os, "posix_fadvise", None)
    dontneed = getattr(os, "POSIX_FADV_DONTNEED", None)
    if fadvise is None or dontneed is None:
        return
    try:
        if flush:
            # Only pages already on disk can be dropped, so write them out first.
            os.fsync(fd)
        fadvise(fd, 0, 0, dontneed)
    except OSError:
        pass


def drop_cached(path: str, *, flush: bool = False) -> None:
    """Ask the kernel to forget its cached copy of ``path``.

    ``flush`` writes the file out first, which a file just written needs.
    """
    if getattr(os, "posix_fadvise", None) is None:
        return
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        _drop_fd(fd, flush)
    finally:
        os.close(fd)


class ArchiveCacheRelease:
    """Drops the cache behind a backup while the archive is being written.

    Call ``added(source)`` after each file goes into the zip: the source's
    cached pages are dropped straight away, and the archive's own are flushed
    and dropped every ``every`` bytes, so neither builds up over the run.
    """

    def __init__(self, zf: zipfile.ZipFile, every: int = RELEASE_EVERY_BYTES) -> None:
        self._zf = zf
        self._every = every
        self._pending = 0

    def added(self, source: str, size: Optional[int] = None) -> None:
        drop_cached(source)
        if size is None:
            try:
                size = os.path.getsize(source)
            except OSError:
                size = 0
        self._pending += size
        if self._pending >= self._every:
            self.release()

    def release(self) -> None:
        """Flush what has been written to the archive so far and drop it."""
        self._pending = 0
        fp = self._zf.fp
        if fp is None:
            return
        try:
            fp.flush()
            _drop_fd(fp.fileno(), flush=True)
        except (OSError, ValueError):
            pass
