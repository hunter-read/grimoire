"""Background indexer and rescan helpers for the library."""
import json
import time

from ... import config
from ...config import SessionLocal, LIBRARY_PATH, DATA_PATH, logger, _valkey
from ...models import Book
from ...indexer import scan_library, index_book_text, ocr_book, reindex_single_book
from ...indexer.formats import INDEXABLE_MIMES
from ..books import _invalidate_book_cache

# Errors raised by the Valkey/Redis client for connection/protocol failures.
# When a Valkey op fails this way, callers fall back to in-process state; any
# other exception type is a real bug and should not be swallowed.
try:
    from redis.exceptions import RedisError as _RedisError

    _VALKEY_ERRORS: tuple = (_RedisError,)
except ImportError:  # redis not installed → _valkey is always None, never used
    _VALKEY_ERRORS = ()

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
    "total_audio": 0,
    "scanned_audio": 0,
    "new_books": 0,
    "new_maps": 0,
    "new_tokens": 0,
    "new_audio": 0,
    "updated_books": 0,
    # Books whose contents changed under an unchanged path (re-indexed in place),
    # and files recognised as moved rather than deleted-and-re-added (issue #284).
    "replaced_books": 0,
    "moved_files": 0,
    "indexed": 0,
    "to_index": 0,
    # Deferred-OCR queue progress (phase "ocr"). total_ocr = books queued,
    # ocr_done = books finished, ocr_current = filename in flight.
    "total_ocr": 0,
    "ocr_done": 0,
    "ocr_current": None,
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
        except _VALKEY_ERRORS as e:
            logger.warning("Valkey set(stop) failed, using in-process flag: %s", e)


def clear_stop() -> None:
    global _stop_requested
    _stop_requested = False
    if _valkey:
        try:
            _valkey.delete(_STOP_KEY)
        except _VALKEY_ERRORS as e:
            logger.warning("Valkey delete(stop) failed, using in-process flag: %s", e)


def is_stop_requested() -> bool:
    if _valkey:
        try:
            return bool(_valkey.exists(_STOP_KEY))
        except _VALKEY_ERRORS as e:
            logger.warning("Valkey exists(stop) failed, using in-process flag: %s", e)
    return _stop_requested


def _get_status() -> dict:
    if _valkey:
        try:
            raw = _valkey.get(_SCAN_KEY)
            if raw:
                return json.loads(raw)
        except (*_VALKEY_ERRORS, ValueError) as e:
            # ValueError covers a corrupt/non-JSON cached status blob.
            logger.warning("Valkey get(status) failed, using in-process status: %s", e)
    return dict(_scan_status)


def _set_status(updates: dict) -> None:
    global _scan_status
    if _valkey:
        try:
            current = _get_status()
            current.update(updates)
            _valkey.set(_SCAN_KEY, json.dumps(current), ex=86400)
            return
        except _VALKEY_ERRORS as e:
            logger.warning("Valkey set(status) failed, using in-process status: %s", e)
    _scan_status.update(updates)


def background_indexer():
    time.sleep(2)
    db = SessionLocal()
    try:
        unindexed = (
            db.query(Book)
            .filter(
                Book.indexed.is_(False),
                Book.index_failed.is_(False),
                # Every indexable format, not just PDF — an EPUB filtered out
                # here is what left them permanently unsearchable (issue #373).
                Book.mime_type.in_(INDEXABLE_MIMES),
            )
            .all()
        )
        if not unindexed:
            logger.debug("Background indexer: no unindexed books found, exiting.")
            return
        logger.info(f"Making {len(unindexed)} book(s) searchable…")
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
                logger.info("Stopping - leaving the rest for next time.")
                break
            logger.debug(f"Index start: '{book.filename}' ('{book.title}', id={book.id})")
            try:
                result = index_book_text(book, DATA_PATH, db, should_stop=is_stop_requested)
                if result:
                    indexed_count += 1
                    logger.debug(f"Index end: '{book.filename}' - success")
                else:
                    logger.debug(f"Index end: '{book.filename}' - skipped or no text extracted")
            except Exception as e:
                logger.error(f"Couldn't read text from '{book.title or book.filename}': {e}")
                book.index_error = str(e)[:500]
                book.index_failed = True
                db.commit()
            _set_status({"indexed": _get_status()["indexed"] + 1})
        logger.info(f"Finished - {indexed_count} of {len(unindexed)} book(s) are now searchable.")
    finally:
        db.close()
        if _get_status()["phase"] == "indexing":
            _set_status({"running": False, "phase": None})
    # Drain any books the fast phase queued for OCR (or left over from before).
    if not is_stop_requested():
        try:
            run_ocr_queue()
        finally:
            if _get_status()["phase"] == "ocr":
                _set_status({"running": False, "phase": None})


def _ocr_one_book(book_id: str) -> str:
    """Drain a single queued book on its own DB session (thread-pool unit).

    Returns ocr_book's result ("done"/"stopped"/"error"). Each book gets a fresh
    session so concurrent OCR workers don't share a Session across threads.

    An unexpected exception from ``ocr_book`` is contained here: the book is
    marked ``index_failed`` and cleared from the queue rather than escaping to
    stall the whole drain and leave the book ``ocr_pending`` forever (which would
    re-queue and re-crash it on every subsequent scan). Returns "error" in that
    case. ``ocr_book`` already handles the failures it anticipates; this is the
    backstop for the ones it doesn't.
    """
    db = SessionLocal()
    try:
        book = db.get(Book, book_id)
        if not book or not book.ocr_pending:
            return "done"
        _set_status({"ocr_current": book.filename})
        return ocr_book(book, db, should_stop=is_stop_requested)
    except Exception as e:
        logger.exception(f"OCR: unexpected error draining book {book_id}: {e}")
        try:
            db.rollback()
            book = db.get(Book, book_id)
            if book:
                book.ocr_pending = False
                book.index_failed = True
                book.index_error = f"ocr error: {e}"[:500]
                db.commit()
        except Exception as inner:  # don't let cleanup failure re-stall the queue
            logger.error(f"OCR: could not flag failed book {book_id}: {inner}")
            db.rollback()
        return "error"
    finally:
        db.close()


def run_ocr_queue() -> int:
    """Drain the deferred-OCR queue (books with ocr_pending=1).

    Runs after the fast scan/index phases. Processes books serially, or with up
    to OCR_CONCURRENCY workers when configured, each checkpointing pages as it
    goes so a restart resumes rather than restarts. Sets phase "ocr" and updates
    ocr_done/total_ocr for the admin UI. Returns the number of books completed.

    Resumable and idempotent: a stop or crash leaves ocr_pending set with a page
    checkpoint, so the next scan (or startup recovery) continues where it left
    off. Returns immediately when the queue is empty, or when OCR is disabled
    (OCR_CONCURRENCY=0) so already-queued books stay pending untouched until a
    user re-enables it.
    """
    concurrency = config.OCR_CONCURRENCY
    if concurrency == 0:
        logger.debug("OCR queue: OCR disabled (OCR_CONCURRENCY=0), skipping.")
        return 0

    db = SessionLocal()
    try:
        pending_ids = [
            b.id
            for b in db.query(Book)
            # OCR remains PDF-only: it rasterises pages of scanned PDFs.
            .filter_by(ocr_pending=True, mime_type="application/pdf")
            .order_by(Book.ocr_pages_done.desc())  # finish nearly-done books first
            .all()
        ]
    finally:
        db.close()

    if not pending_ids:
        return 0

    _set_status(
        {"running": True, "phase": "ocr", "total_ocr": len(pending_ids), "ocr_done": 0}
    )
    logger.info(
        f"Reading text from {len(pending_ids)} scanned book(s) - this can take a while."
    )
    logger.debug(f"OCR queue: {len(pending_ids)} book(s) to OCR (concurrency={concurrency})")
    completed = 0
    try:
        if concurrency <= 1:
            for book_id in pending_ids:
                if is_stop_requested():
                    logger.info("Stopping - leaving the rest for next time.")
                    break
                if _ocr_one_book(book_id) == "done":
                    completed += 1
                _set_status({"ocr_done": _get_status()["ocr_done"] + 1})
        else:
            from concurrent.futures import ThreadPoolExecutor

            with ThreadPoolExecutor(max_workers=concurrency) as pool:
                for result in pool.map(_ocr_one_book, pending_ids):
                    if result == "done":
                        completed += 1
                    _set_status({"ocr_done": _get_status()["ocr_done"] + 1})
        logger.info(f"Finished reading text from {completed} of {len(pending_ids)} scanned book(s).")
    finally:
        _set_status({"ocr_current": None})
    return completed


def background_ocr():
    """Startup recovery: resume any books left ocr_pending by a prior run."""
    time.sleep(2)
    if _get_status()["running"]:
        return
    try:
        run_ocr_queue()
    finally:
        if _get_status()["phase"] == "ocr":
            _set_status({"running": False, "phase": None})


def trigger_ocr_queue():
    """Drain the OCR queue now (on-demand, e.g. after a per-book re-OCR request).

    Unlike background_ocr this has no startup delay. It no-ops if a scan/OCR run
    is already in progress — the newly-queued book is picked up by that run (or
    the next one), since the queue lives in the DB. Clears the running/phase flags
    on completion when this call owns the OCR phase.
    """
    if _get_status()["running"]:
        return
    try:
        run_ocr_queue()
    finally:
        if _get_status()["phase"] == "ocr":
            _set_status({"running": False, "phase": None})


def rescan_single_book(book_id: str) -> None:
    """Re-read one book from disk and rebuild its index (background task).

    The per-book counterpart to run_rescan_sync: refreshes page count/thumbnail,
    rebuilds the FTS index for a text-layer PDF, or re-queues an image-only PDF
    for OCR. Guards against a concurrent library scan: if one is already running
    this no-ops rather than fighting it for the DB/scan-status (that scan will
    re-read changed files on its own; the user can also re-trigger once it
    finishes). Progress is observable via GET /scan-status.
    """
    if _get_status()["running"]:
        logger.info("A library scan is already running - skipping this single-book re-index.")
        return

    clear_stop()
    _set_status({**_DEFAULT_STATUS, "running": True, "phase": "indexing", "to_index": 1, "indexed": 0})
    try:
        _invalidate_book_cache()
        db = SessionLocal()
        try:
            book = db.get(Book, book_id)
            if not book:
                logger.warning(f"Re-index: book {book_id} no longer exists - skipping.")
                return
            logger.info(f"Re-reading '{book.title or book.filename}' from disk…")
            try:
                reindex_single_book(book, DATA_PATH, db, should_stop=is_stop_requested)
            except Exception as e:
                logger.error(f"Re-index failed for '{book.title or book.filename}': {e}")
                db.rollback()
                book = db.get(Book, book_id)
                if book:
                    book.index_error = str(e)[:500]
                    book.index_failed = True
                    db.commit()
            _set_status({"indexed": 1})
        finally:
            db.close()

        # An image-only PDF was left ocr_pending by reindex_single_book — drain it.
        if not is_stop_requested():
            run_ocr_queue()
    finally:
        _set_status({"running": False, "phase": None})


def run_rescan_sync(scope_path: str | None = None, metadata_mode: str = "new") -> None:
    """Library rescan — scans disk and indexes PDFs.

    Guards against concurrent calls: if a rescan is already running this call
    returns immediately.  Updates scan status (via Valkey when available, or
    in-process dict) so GET /scan-status reflects progress in real time across
    all workers.

    scope_path restricts the scan to a single subtree (e.g. "books/D&D 5e/adventure");
    metadata_mode ("new"|"missing"|"replace") controls sidecar metadata re-application.
    """
    if _get_status()["running"]:
        logger.info("A library scan is already running - ignoring this request.")
        return

    clear_stop()
    _set_status({**_DEFAULT_STATUS, "running": True, "phase": "scanning"})
    try:
        _invalidate_book_cache()
        db = SessionLocal()
        try:
            # --- Phase 1: file scan ---
            logger.info("Scanning your library for new and changed files…")

            def on_progress(sb, tb, sm, tm, st, tt, sa, ta):
                _set_status(
                    {
                        "scanned_books": sb,
                        "total_books": tb,
                        "scanned_maps": sm,
                        "total_maps": tm,
                        "scanned_tokens": st,
                        "total_tokens": tt,
                        "scanned_audio": sa,
                        "total_audio": ta,
                    }
                )
                logger.debug(
                    f"File scan progress: books={sb}/{tb}, maps={sm}/{tm}, "
                    f"tokens={st}/{tt}, audio={sa}/{ta}"
                )

            stats = scan_library(
                LIBRARY_PATH, DATA_PATH, db,
                on_progress=on_progress, should_stop=is_stop_requested,
                scope_path=scope_path, metadata_mode=metadata_mode,
            )
            new_total = (
                stats.get("new_books", 0)
                + stats.get("new_maps", 0)
                + stats.get("new_tokens", 0)
                + stats.get("new_audio", 0)
            )
            _errors = stats.get("errors", 0)
            _msg = (
                f"Scan finished - found {new_total} new item(s)"
                f", updated {stats.get('updated_books', 0)} book(s)"
            )
            if _errors:
                _msg += f". {_errors} item(s) couldn't be read."
                logger.warning(_msg)
            else:
                logger.info(_msg + ".")
            logger.debug(
                f"File scan end: new_books={stats.get('new_books', 0)}, "
                f"new_maps={stats.get('new_maps', 0)}, new_tokens={stats.get('new_tokens', 0)}, "
                f"new_audio={stats.get('new_audio', 0)}, "
                f"updated_books={stats.get('updated_books', 0)}, "
                f"errors={_errors}"
            )
            _set_status(
                {
                    "new_books": stats.get("new_books", 0),
                    "new_maps": stats.get("new_maps", 0),
                    "new_tokens": stats.get("new_tokens", 0),
                    "new_audio": stats.get("new_audio", 0),
                    "updated_books": stats.get("updated_books", 0),
                    "replaced_books": stats.get("replaced_books", 0),
                    "moved_files": sum(
                        stats.get(f"moved_{k}", 0)
                        for k in ("books", "maps", "tokens", "audio")
                    ),
                }
            )

            if is_stop_requested():
                logger.info("Stopped after scanning files - skipping the rest.")
                return

            # --- Phase 2: PDF indexing ---
            to_index = (
            db.query(Book)
            .filter(
                Book.indexed.is_(False),
                Book.index_failed.is_(False),
                # Every indexable format, not just PDF — an EPUB filtered out
                # here is what left them permanently unsearchable (issue #373).
                Book.mime_type.in_(INDEXABLE_MIMES),
            )
            .all()
        )
            _set_status({"phase": "indexing", "to_index": len(to_index), "indexed": 0})
            logger.info(f"Making {len(to_index)} book(s) searchable…")
            indexed_count = 0
            for book in to_index:
                if is_stop_requested():
                    logger.info("Stopping - leaving the rest for next time.")
                    break
                logger.debug(f"Index start: '{book.filename}' ('{book.title}', id={book.id})")
                try:
                    result = index_book_text(book, DATA_PATH, db, should_stop=is_stop_requested)
                    if result:
                        indexed_count += 1
                        logger.debug(f"Index end: '{book.filename}' - success")
                    else:
                        logger.debug(f"Index end: '{book.filename}' - skipped or no text extracted")
                except Exception as e:
                    logger.error(f"Couldn't read text from '{book.title or book.filename}': {e}")
                    book.index_error = str(e)[:500]
                    book.index_failed = True
                    db.commit()
                _set_status({"indexed": _get_status()["indexed"] + 1})
            logger.info(f"Finished - {indexed_count} of {len(to_index)} book(s) are now searchable.")
        finally:
            db.close()

        # --- Phase 3: deferred OCR of scanned/image-only PDFs ---
        # Runs after the fast phases so text-layer books and other media are
        # already searchable; scanned books grind here without blocking them.
        if not is_stop_requested():
            run_ocr_queue()
    finally:
        # A scan is when replaced files are found and their old renders orphaned,
        # so it is the natural moment to trim the on-disk cache back under its cap.
        from ...services.content_cache import sweep_page_cache

        sweep_page_cache()
        _set_status({"running": False, "phase": None})
