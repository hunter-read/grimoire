"""Remembering the file a scan died on, so the next scan does not die on it too.

Most of what a scan does to a file runs out of harm's way. Text extraction, OCR
and PDF/EPUB/DjVu thumbnails run in child processes (see ``isolation``), where a
crash or a hang costs that one file. The other thumbnails are still made in the
server process: a huge image, a 3D mesh, an archive's first page. One of those
can take the process down with it, through an out-of-memory kill or a native
crash, and the restarted server's startup scan then meets the same file again,
and again. Books guard against that with ``scan_failed``, committed before the
risky step. A new map, token or model has no row to flag yet: its thumbnail is
made before it is inserted.

So while a library scan runs, the file whose thumbnail it is making is written
down first, in ``.scan-inflight.json`` under DATA_PATH, and crossed off after. A
note still there when the next scan begins means the last one died on that file.
The file gets a strike in ``scan-quarantine.json``, and at two strikes in a row
scans stop making its thumbnail. Two, not one, so a scan killed from outside
(``docker kill``, a power cut) does not cost an innocent file its thumbnail. A
server stopping normally clears the note first (``abandon``).

A quarantined file is still scanned and listed; only its thumbnail is skipped.
It is tried again once it changes on disk (its size or modification time), as
replacing or repairing it does.
"""
import json
import logging
import os
import threading
from contextlib import contextmanager
from typing import Any, Iterator, Optional

from .. import config
from .hashing import file_signature

logger = logging.getLogger("grimoire.indexer")

INFLIGHT_FILE = ".scan-inflight.json"
QUARANTINE_FILE = "scan-quarantine.json"
# Scans in a row that must die on a file before its thumbnail is skipped.
STRIKES_TO_SKIP = 2

# Guards the fields below, and orders writing the in-flight note against
# ``abandon`` removing it.
_lock = threading.Lock()
# The thread running the current library scan; None when no scan is recording.
_scan_thread: Optional[int] = None
# The quarantine as read when the scan began: path -> {strikes, mtime, size}.
_entries: dict[str, dict[str, Any]] = {}
# Whether ``_entries`` changed and must be written back when the scan ends.
_dirty = False
# Files whose skip has been logged during this scan, so it is logged once.
_reported: set[str] = set()


def _path(name: str) -> str:
    return os.path.join(config.DATA_PATH, name)


def _read_json(path: str) -> dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        logger.warning(f"Couldn't read {path}: {e}")
        return {}
    return data if isinstance(data, dict) else {}


def _write_json(path: str, data: dict[str, Any]) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    os.replace(tmp, path)


def _remove(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError as e:
        logger.warning(f"Couldn't remove {path}: {e}")


def _unchanged(entry: dict[str, Any], filepath: str) -> bool:
    """Whether ``filepath`` still has the size and mtime ``entry`` recorded."""
    signature = file_signature(filepath)
    return signature is not None and [entry.get("mtime"), entry.get("size")] == list(signature)


def _strike(entries: dict[str, dict[str, Any]], filepath: str) -> None:
    """Record that a scan died making ``filepath``'s thumbnail."""
    entry = entries.get(filepath)
    strikes = entry.get("strikes", 0) + 1 if entry and _unchanged(entry, filepath) else 1
    signature = file_signature(filepath)
    entries[filepath] = {
        "strikes": strikes,
        "mtime": signature[0] if signature else None,
        "size": signature[1] if signature else None,
    }
    if strikes >= STRIKES_TO_SKIP:
        logger.error(
            f"The library scan stopped while making a thumbnail for '{filepath}' "
            f"{strikes} times in a row, so scans will skip that thumbnail from now on. "
            f"Replace or remove the file to have it tried again."
        )
    else:
        logger.warning(
            f"The last library scan stopped while making a thumbnail for '{filepath}'. "
            f"If it stops there again, scans will skip that file's thumbnail."
        )


def begin_scan() -> None:
    """Record thumbnails made on this thread until ``end_scan``.

    First gives a strike to the file the previous scan died on, if it did.
    """
    global _scan_thread, _entries, _dirty
    entries = _read_json(_path(QUARANTINE_FILE))
    leftover = _read_json(_path(INFLIGHT_FILE)).get("path")
    dirty = False
    if isinstance(leftover, str) and leftover:
        _strike(entries, leftover)
        dirty = True
    with _lock:
        _entries = entries
        _dirty = dirty
        _reported.clear()
        _scan_thread = threading.get_ident()
    _remove(_path(INFLIGHT_FILE))
    if dirty:
        _save()


def _save() -> None:
    global _dirty
    with _lock:
        entries = dict(_entries)
        _dirty = False
    try:
        if entries:
            _write_json(_path(QUARANTINE_FILE), entries)
        else:
            _remove(_path(QUARANTINE_FILE))
    except OSError as e:
        logger.warning(f"Couldn't save the scan quarantine: {e}")


def end_scan() -> None:
    """Stop recording; the scan on this thread finished without dying."""
    global _scan_thread
    with _lock:
        if _scan_thread != threading.get_ident():
            return
        _scan_thread = None
        dirty = _dirty
        _remove(_path(INFLIGHT_FILE))
    if dirty:
        _save()


def abandon() -> None:
    """The server is stopping on purpose, so the scan's current file did not crash it."""
    global _scan_thread
    with _lock:
        _scan_thread = None
        _remove(_path(INFLIGHT_FILE))


def _recording() -> bool:
    return _scan_thread is not None and _scan_thread == threading.get_ident()


def skip_thumbnail(filepath: str) -> bool:
    """Whether a scan should leave ``filepath``'s thumbnail alone: it stopped earlier scans."""
    if not _recording():
        return False
    entry = _entries.get(filepath)
    if not entry or entry.get("strikes", 0) < STRIKES_TO_SKIP or not _unchanged(entry, filepath):
        return False
    if filepath not in _reported:
        _reported.add(filepath)
        logger.warning(
            f"Skipping the thumbnail for '{filepath}': making it stopped earlier scans. "
            f"Replace or remove the file to have it tried again."
        )
    return True


@contextmanager
def making_thumbnail(filepath: str) -> Iterator[None]:
    """Note ``filepath`` as in flight for the duration, during a library scan.

    Returning normally, even with no thumbnail, shows the file does not crash
    the scan, so any strike it had is cleared.
    """
    global _dirty
    with _lock:
        recording = _recording()
        if recording:
            try:
                _write_json(_path(INFLIGHT_FILE), {"path": filepath})
            except OSError as e:
                logger.debug(f"Couldn't note the scan's current file: {e}")
    if not recording:
        yield
        return
    try:
        yield
    finally:
        with _lock:
            if _recording():
                _remove(_path(INFLIGHT_FILE))
    with _lock:
        if _entries.pop(filepath, None) is not None:
            _dirty = True
