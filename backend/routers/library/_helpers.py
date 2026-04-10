"""Background indexer and rescan helpers for the library."""
import json
import time

from ...config import SessionLocal, LIBRARY_PATH, DATA_PATH, logger, _valkey
from ...models import Book
from ...indexer import scan_library, index_book_text
from ..books import _invalidate_book_cache

_SCAN_KEY = "grimoire:scan_status"
_STOP_KEY = "grimoire:scan_stop"

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
_stop_requested: bool = False


def request_stop() -> None:
    global _stop_requested
    _stop_requested = True
    if _valkey:
        try:
            _valkey.set(_STOP_KEY, "1", ex=3600)
        except Exception:
            pass


def clear_stop() -> None:
    global _stop_requested
    _stop_requested = False
    if _valkey:
        try:
            _valkey.delete(_STOP_KEY)
        except Exception:
            pass


def is_stop_requested() -> bool:
    if _valkey:
        try:
            return bool(_valkey.exists(_STOP_KEY))
        except Exception:
            pass
    return _stop_requested


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
            logger.debug("Background indexer: no unindexed books found, exiting.")
            return
        logger.info(f"Background indexer: starting — {len(unindexed)} book(s) to index")
        if not _get_status()["running"]:
            _set_status(
                {
                    "running": True,
                    "phase": "indexing",
                    "to_index": len(unindexed),
                    "indexed": 0,
                }
            )
        indexed_count = 0
        for book in unindexed:
            if is_stop_requested():
                logger.info("Background indexer: stop requested, halting.")
                break
            logger.debug(f"Index start: '{book.filename}' ('{book.title}', id={book.id})")
            try:
                result = index_book_text(book, DATA_PATH, db, should_stop=is_stop_requested)
                if result:
                    indexed_count += 1
                    logger.debug(f"Index end: '{book.filename}' — success")
                else:
                    logger.debug(f"Index end: '{book.filename}' — skipped or no text extracted")
            except Exception as e:
                logger.error(f"Indexing error for '{book.filename}': {e}")
                book.index_error = str(e)[:500]
                book.index_failed = True
                db.commit()
            _set_status({"indexed": _get_status()["indexed"] + 1})
        logger.info(f"Background indexer: complete — {indexed_count}/{len(unindexed)} book(s) indexed")
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

    clear_stop()
    _set_status({**_DEFAULT_STATUS, "running": True, "phase": "scanning"})
    try:
        _invalidate_book_cache()
        db = SessionLocal()
        try:
            # --- Phase 1: file scan ---
            logger.info("File scan start")

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
                logger.debug(
                    f"File scan progress: books={sb}/{tb}, maps={sm}/{tm}, tokens={st}/{tt}"
                )

            stats = scan_library(LIBRARY_PATH, DATA_PATH, db, on_progress=on_progress, should_stop=is_stop_requested)
            logger.info(
                f"File scan end: new_books={stats.get('new_books', 0)}, "
                f"new_maps={stats.get('new_maps', 0)}, new_tokens={stats.get('new_tokens', 0)}, "
                f"errors={stats.get('errors', 0)}"
            )
            _set_status(
                {
                    "new_books": stats.get("new_books", 0),
                    "new_maps": stats.get("new_maps", 0),
                    "new_tokens": stats.get("new_tokens", 0),
                }
            )

            if is_stop_requested():
                logger.info("Rescan: stop requested after file scan, skipping indexing.")
                return

            # --- Phase 2: PDF indexing ---
            to_index = db.query(Book).filter_by(indexed=False, index_failed=False, mime_type="application/pdf").all()
            _set_status({"phase": "indexing", "to_index": len(to_index), "indexed": 0})
            logger.info(f"Index scan start: {len(to_index)} PDF(s) to index")
            indexed_count = 0
            for book in to_index:
                if is_stop_requested():
                    logger.info("Rescan: stop requested during indexing.")
                    break
                logger.debug(f"Index start: '{book.filename}' ('{book.title}', id={book.id})")
                try:
                    result = index_book_text(book, DATA_PATH, db, should_stop=is_stop_requested)
                    if result:
                        indexed_count += 1
                        logger.debug(f"Index end: '{book.filename}' — success")
                    else:
                        logger.debug(f"Index end: '{book.filename}' — skipped or no text extracted")
                except Exception as e:
                    logger.error(f"Indexing error for '{book.filename}': {e}")
                    book.index_error = str(e)[:500]
                    book.index_failed = True
                    db.commit()
                _set_status({"indexed": _get_status()["indexed"] + 1})
            logger.info(f"Index scan end: {indexed_count}/{len(to_index)} PDF(s) indexed")
        finally:
            db.close()
    finally:
        _set_status({"running": False, "phase": None})
