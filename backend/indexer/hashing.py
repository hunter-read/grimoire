"""Content hashing and the cheap stat gate that keeps rescans free.

Library files are keyed by ``filepath``, which cannot express two things the
scanner needs to know: whether a file at a known path was *replaced* (same path,
new bytes) and whether a file that vanished simply *moved* (new path, same
bytes). A content hash answers both.

The cost model is the whole design. Today an unchanged rescan reads zero file
bytes, and there is no existing whole-file read to piggyback on — hashing every
file on every scan would make a routine rescan I/O-bound on the entire library
(hours on a large NAS-backed collection). So the hash is gated behind
``(mtime, size)``: the scan stats every file, which is essentially free next to
the per-file work it already does, and only reads content when that signature
moved or the row has never been hashed.

A stat mismatch that turns out to be a false alarm (a touch, a coarse network
mtime, a restored backup) costs one hash and nothing more — ``changed_content``
compares the resulting digest, so the expensive invalidation only fires on a
genuine content change.
"""
import hashlib
import logging
import os
from typing import Any, Callable, Optional

logger = logging.getLogger("grimoire.indexer")

# 1 MiB chunks: large enough that syscall overhead is irrelevant on big PDFs,
# small enough that a cancel is honoured promptly and memory stays flat.
_CHUNK_SIZE = 1 << 20

# Number of chunks between should_stop() checks. Hashing is the one place a scan
# can sit inside a single file for a long time, so a cancel must not have to wait
# for a multi-GB file to finish.
_STOP_CHECK_INTERVAL = 16


def file_signature(path: str) -> Optional[tuple[float, int]]:
    """Return ``(mtime, size)`` for ``path``, or None when it cannot be stat'd.

    This is the cheap gate: callers compare it against the stored
    ``file_mtime``/``file_size`` and only hash when it differs.
    """
    try:
        st = os.stat(path)
    except OSError as e:
        logger.warning(f"Cannot stat file: {path} ({e})")
        return None
    return st.st_mtime, st.st_size


def hash_file(
    path: str,
    should_stop: Optional[Callable[[], bool]] = None,
    chunk_size: int = _CHUNK_SIZE,
) -> Optional[str]:
    """Return the hex SHA-256 of ``path``'s contents, or None if unreadable.

    Reads in chunks so memory stays flat regardless of file size, and polls
    ``should_stop`` periodically so cancelling a scan doesn't block on a large
    file. Returns None on cancellation as well as on I/O error: in both cases the
    caller has no digest and must leave the stored hash alone rather than record
    a wrong one.
    """
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            chunks = 0
            while True:
                if should_stop and chunks % _STOP_CHECK_INTERVAL == 0 and should_stop():
                    logger.debug(f"Hashing cancelled: {path}")
                    return None
                block = f.read(chunk_size)
                if not block:
                    break
                digest.update(block)
                chunks += 1
    except OSError as e:
        logger.warning(f"Cannot hash file: {path} ({e})")
        return None
    return digest.hexdigest()


def signature_matches(record: Any, mtime: float, size: int) -> bool:
    """True when ``record``'s stored stat signature matches what's on disk.

    A row that predates content hashing (``content_hash`` NULL) never matches, so
    it gets hashed once to backfill. Callers must not treat that backfill as a
    content *change* — see ``changed_content``.
    """
    if record.content_hash is None:
        return False
    if record.file_mtime is None:
        return False
    return record.file_mtime == mtime and (record.file_size or 0) == size


def apply_signature(
    record: Any, mtime: float, size: int, content_hash: Optional[str]
) -> None:
    """Store the stat signature and hash on ``record``.

    ``content_hash`` of None (unreadable or cancelled) leaves the existing hash
    untouched: recording a null digest would make the next scan believe the file
    had changed again.
    """
    record.file_mtime = mtime
    record.file_size = size
    if content_hash is not None:
        record.content_hash = content_hash


def changed_content(record: Any, new_hash: Optional[str]) -> bool:
    """True when ``new_hash`` is a real, different digest from the stored one.

    Returns False when there is no new digest (unreadable/cancelled), and False
    when the row had no stored hash — a first-time backfill is not a change, and
    treating it as one would re-render an entire library on the first scan after
    upgrading.
    """
    if new_hash is None:
        return False
    if record.content_hash is None:
        return False
    return record.content_hash != new_hash
