"""Background indexer and rescan helpers for the library."""
import json
import time

from ...config import SessionLocal, LIBRARY_PATH, DATA_PATH, logger, _valkey
from ...models import Book
from ...indexer import scan_library, index_book_text
from ..books import _invalidate_book_cache

_SCAN_KEY = "grimoire:scan_status"

_DEFAULT_STATUS: dict = {
    "running": False,
    "phase": None,
    "total_books": 0,
    "scanned_books": 0,
    "total_maps": 0,
    "scanned_maps": 0,
    "total_tokens": 0,
    "scanned_tokens": 0,
    "new_books": 0,
    "new_maps": 0,
    "new_tokens": 0,
    "indexed": 0,
    "to_index": 0,
}

# In-process fallback when Valkey is unavailable (single-worker or no cache)
_scan_status: dict = dict(_DEFAULT_STATUS)


def _get_status() -> dict:
    if _valkey:
        try:
            raw = _valkey.get(_SCAN_KEY)
            if raw:
                return json.loads(raw)
        except Exception:
            pass
    return dict(_scan_status)


def _set_status(updates: dict) -> None:
    global _scan_status
    if _valkey:
        try:
            current = _get_status()
            current.update(updates)
            _valkey.set(_SCAN_KEY, json.dumps(current), ex=86400)
            return
        except Exception:
            pass
    _scan_status.update(updates)


def background_indexer():
    time.sleep(2)
    db = SessionLocal()
    try:
        unindexed = db.query(Book).filter_by(indexed=False, index_failed=False, mime_type="application/pdf").all()
        if not unindexed:
            return
        logger.info(f"Background indexer: {len(unindexed)} books to index")
        if not _get_status()["running"]:
            _set_status(
                {
                    "running": True,
                    "phase": "indexing",
                    "to_index": len(unindexed),
                    "indexed": 0,
                }
            )
        for book in unindexed:
            try:
                index_book_text(book, DATA_PATH, db)
            except Exception as e:
                logger.error(f"Indexing error for {book.title}: {e}")
                book.index_error = str(e)[:500]
                book.index_failed = True
                db.commit()
            _set_status({"indexed": _get_status()["indexed"] + 1})
    finally:
        db.close()
        if _get_status()["phase"] == "indexing":
            _set_status({"running": False, "phase": None})


def run_rescan_sync() -> None:
    """Full library rescan — scans disk and indexes PDFs.

    Guards against concurrent calls: if a rescan is already running this call
    returns immediately.  Updates scan status (via Valkey when available, or
    in-process dict) so GET /scan-status reflects progress in real time across
    all workers.
    """
    if _get_status()["running"]:
        logger.info("Rescan already running, skipping.")
        return

    _set_status({**_DEFAULT_STATUS, "running": True, "phase": "scanning"})
    try:
        _invalidate_book_cache()
        db = SessionLocal()
        try:

            def on_progress(sb, tb, sm, tm, st, tt):
                _set_status(
                    {
                        "scanned_books": sb,
                        "total_books": tb,
                        "scanned_maps": sm,
                        "total_maps": tm,
                        "scanned_tokens": st,
                        "total_tokens": tt,
                    }
                )

            stats = scan_library(LIBRARY_PATH, DATA_PATH, db, on_progress=on_progress)
            logger.info(f"Rescan complete: {stats}")
            _set_status(
                {
                    "new_books": stats.get("new_books", 0),
                    "new_maps": stats.get("new_maps", 0),
                    "new_tokens": stats.get("new_tokens", 0),
                }
            )

            to_index = db.query(Book).filter_by(indexed=False, index_failed=False, mime_type="application/pdf").all()
            _set_status({"phase": "indexing", "to_index": len(to_index), "indexed": 0})
            for book in to_index:
                try:
                    index_book_text(book, DATA_PATH, db)
                except Exception as e:
                    logger.error(f"Indexing error for {book.title}: {e}")
                    book.index_error = str(e)[:500]
                    book.index_failed = True
                    db.commit()
                _set_status({"indexed": _get_status()["indexed"] + 1})
        finally:
            db.close()
    finally:
        _set_status({"running": False, "phase": None})
