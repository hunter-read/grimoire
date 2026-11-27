"""Keeping a backup out of the operating system's file cache.

Linux keeps every file a process reads or writes in memory until something else
wants the room, and counts it against the container. A backup reads each
uploaded file once and writes an archive the app never reads back, so a
multi-gigabyte backup left `docker stats` showing gigabytes held by Grimoire
until the kernel got round to reclaiming them. Telling the kernel a file is
finished with (``POSIX_FADV_DONTNEED``) frees it at once.

(This is the kernel's cache of files, not Grimoire's own cache of rendered
pages, ``page_cache`` in the data directory, which a backup does not touch.)

Dropping is best-effort: on a system without ``posix_fadvise`` (macOS, Windows)
or a filesystem that refuses it, nothing is dropped and the backup is
unaffected. Flushing is not: a flush that fails means the archive did not reach
the disk, and that fails the backup.
"""
import errno
import os
import zipfile
from typing import IO, Optional

# How much may go into the archive between releases. Smaller keeps less cached
# at the cost of more flushes to disk; 64 MB is a flush every second or so.
RELEASE_EVERY_BYTES = 64 * 1024 * 1024

# Files smaller than this are copied but left cached. They are the covers,
# portraits and branding the app serves on every page, which were most likely
# cached before the backup ran, and dropping them would make the next page
# load read them from disk again. They are also too small to matter.
DROP_FILES_FROM_BYTES = 4 * 1024 * 1024

# How much of a file is read and compressed at a time.
CHUNK_BYTES = 1024 * 1024

# fsync errors that mean "this file can't be flushed here" rather than "the
# data was lost": some network and FUSE filesystems answer these.
_FLUSH_UNSUPPORTED = frozenset({errno.EINVAL, errno.ENOTSUP, errno.EOPNOTSUPP, errno.EROFS})


class IncompleteCopyError(RuntimeError):
    """A file failed partway into the archive, which now holds a cut-off copy.

    A zip cannot take an entry back once it is started, and a cut-off entry
    still passes its checksum, so a restore would write a damaged file. The
    only safe outcome is to abandon the archive.
    """


def _flush(fd: int) -> None:
    """Write a file's pages out to disk. A real failure raises."""
    try:
        os.fsync(fd)
    except OSError as exc:
        if exc.errno not in _FLUSH_UNSUPPORTED:
            raise


def _forget(fd: int) -> None:
    """Drop whatever of the file is cached and already on disk. Never raises."""
    # Looked up by name: neither exists on macOS or Windows.
    fadvise = getattr(os, "posix_fadvise", None)
    dontneed = getattr(os, "POSIX_FADV_DONTNEED", None)
    if fadvise is None or dontneed is None:
        return
    try:
        fadvise(fd, 0, 0, dontneed)
    except OSError:
        pass


def drop_cached(path: str, *, flush: bool = False) -> None:
    """Ask the kernel to forget its cached copy of ``path``.

    ``flush`` writes the file out first, which a file just written needs (only
    pages already on disk can be dropped), and raises if that fails. Without it
    nothing here raises.
    """
    if flush:
        # Opened for writing: some network filesystems refuse to flush a file
        # through a read-only handle.
        fd = os.open(path, os.O_RDWR)
        try:
            _flush(fd)
            _forget(fd)
        finally:
            os.close(fd)
        return
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        _forget(fd)
    finally:
        os.close(fd)


def _set_compress_level(zinfo: zipfile.ZipInfo, level: Optional[int]) -> None:
    # ZipFile.write copies the archive's level onto each entry, and so must
    # this. The attribute became public (compress_level) in Python 3.13.
    name = "compress_level" if hasattr(zinfo, "compress_level") else "_compresslevel"
    setattr(zinfo, name, level)


class ArchiveCacheRelease:
    """Copies files into a backup archive without leaving them in memory.

    Each file goes in a megabyte at a time. Every ``every`` bytes, what has been
    read of the source is dropped, and the archive is flushed and dropped, so
    neither builds up however large a single file is. Small files are left
    cached (see ``DROP_FILES_FROM_BYTES``).
    """

    def __init__(
        self,
        zf: zipfile.ZipFile,
        every: Optional[int] = None,
        drop_from: Optional[int] = None,
    ) -> None:
        self._zf = zf
        # Read here rather than as defaults, so the module's values apply.
        self._every = RELEASE_EVERY_BYTES if every is None else every
        self._drop_from = DROP_FILES_FROM_BYTES if drop_from is None else drop_from
        self._pending = 0

    def add_file(self, source: str, arcname: str) -> None:
        """Copy ``source`` into the archive as ``arcname``.

        An ``OSError`` means the file could not be opened and nothing was
        added, so the caller may skip it. A failure once copying has begun
        raises ``IncompleteCopyError`` instead.
        """
        zinfo = zipfile.ZipInfo.from_file(source, arcname)
        zinfo.compress_type = self._zf.compression
        _set_compress_level(zinfo, self._zf.compresslevel)
        drop = zinfo.file_size >= self._drop_from
        with open(source, "rb") as src:
            # Nothing is in the archive until zf.open() below: an error before
            # it leaves the archive as it was.
            try:
                with self._zf.open(zinfo, "w") as dest:
                    self._copy(src, dest, drop)
            except OSError as exc:
                raise IncompleteCopyError(
                    f"'{source}' could not be copied completely ({exc})"
                ) from exc
            if drop:
                _forget(src.fileno())

    def _copy(self, src: IO[bytes], dest: IO[bytes], drop: bool) -> None:
        while chunk := src.read(CHUNK_BYTES):
            dest.write(chunk)
            self._pending += len(chunk)
            if self._pending >= self._every:
                if drop:
                    _forget(src.fileno())
                self.release()

    def release(self) -> None:
        """Flush what has been written to the archive so far and drop it.

        A failed flush raises: the archive is not on disk.
        """
        self._pending = 0
        fp = self._zf.fp
        if fp is None:
            return  # the archive is closed
        fp.flush()
        fd = fp.fileno()
        _flush(fd)
        _forget(fd)
