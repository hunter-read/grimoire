"""The per-book re-index queue: replace uploads and single-book rescans (issue #657).

Replacing a book's file by upload re-reads the cheap parts (hash, pages, cover)
before responding and leaves the search text for the background. Each replace
used to start its own single-book re-index, and since only one background job
runs at a time, the next replace in a batch found the previous one's re-index
running and was refused with a 409.

Now a replace queues its book here instead, and one worker drains the queue:
every book replaced while it runs is picked up by the same run, after the books
ahead of it. A replace is still refused while a library scan or any other
background job runs, and while the worker is busy with that very book (see
``claims``); otherwise it never waits on the queue.

A single-book rescan (``POST /api/books/:id/rescan``) goes on the same queue,
flagged to re-read the file first, so it neither blocks replaces nor is
dropped because a replace's re-index happens to be running.

The queue lives in Valkey when it is available, and in-process otherwise. It
does not need to survive a restart: a replaced book is left unindexed, and every
scan indexes unindexed books.
"""
import threading
from typing import Optional

from ...config import DATA_PATH, SessionLocal, logger, valkey_client, valkey_errors
from ...indexer import index_book_text, reindex_single_book
from ...models import Book
from ..books.documents import invalidate_book_cache
from . import runner
from .claims import claim_book, release_book

# The scan status ``kind`` of a run draining this queue. A replace upload is
# accepted while one is running; any other running job refuses it.
REINDEX_KIND = "reindex"

_QUEUE_KEY = "grimoire:reindex_queue"
# Queued books whose file must be re-read (hash, pages, cover) before the text.
_REFRESH_KEY = "grimoire:reindex_refresh"
_QUEUE_TTL_SECONDS = 86400

_queue: set[str] = set()
_refresh: set[str] = set()
_queue_lock = threading.Lock()


def queue_reindex(book_id: str, refresh_file: bool = False) -> None:
    """Queue a book for the drain to index. Queuing a book twice indexes it once.

    ``refresh_file`` re-reads the file itself first, for a rescan of a file
    edited outside Grimoire. A replace upload has done that already.
    """
    if (client := valkey_client()) is not None:
        try:
            if refresh_file:
                client.sadd(_REFRESH_KEY, book_id)
                client.expire(_REFRESH_KEY, _QUEUE_TTL_SECONDS)
            client.sadd(_QUEUE_KEY, book_id)
            client.expire(_QUEUE_KEY, _QUEUE_TTL_SECONDS)
            return
        except valkey_errors() as e:
            logger.warning("Valkey sadd(reindex) failed, using in-process queue: %s", e)
    with _queue_lock:
        if refresh_file:
            _refresh.add(book_id)
        _queue.add(book_id)


def _take_refresh(book_id: str) -> bool:
    """Whether a popped book was queued to re-read its file, clearing the flag."""
    taken = False
    if (client := valkey_client()) is not None:
        try:
            taken = bool(client.srem(_REFRESH_KEY, book_id))
        except valkey_errors() as e:
            logger.warning("Valkey srem(reindex) failed, using in-process queue: %s", e)
    with _queue_lock:
        if book_id in _refresh:
            _refresh.discard(book_id)
            taken = True
    return taken


def _pop_queued() -> Optional[str]:
    if (client := valkey_client()) is not None:
        try:
            raw = client.spop(_QUEUE_KEY)
            if raw is not None:
                return raw.decode() if isinstance(raw, bytes) else str(raw)
        except valkey_errors() as e:
            logger.warning("Valkey spop(reindex) failed, using in-process queue: %s", e)
    with _queue_lock:
        return _queue.pop() if _queue else None


def queued_count() -> int:
    """How many books are waiting to be indexed."""
    # Both stores count: a Valkey hiccup during ``queue_reindex`` leaves that book
    # in-process even after Valkey recovers, and ``_pop_queued`` drains both.
    count = 0
    if (client := valkey_client()) is not None:
        try:
            count = int(client.scard(_QUEUE_KEY))
        except valkey_errors() as e:
            logger.warning("Valkey scard(reindex) failed, using in-process queue: %s", e)
    with _queue_lock:
        return count + len(_queue)


def reindex_running() -> bool:
    """Whether the live background job is this queue's drain."""
    return runner.scan_in_progress() and runner.get_status().get("kind") == REINDEX_KIND


def drain_reindex_queue() -> None:
    """Index every queued book, including ones queued while this runs (background task).

    Returns at once when a job is already running. If it is another drain, that
    drain picks up whatever was queued. If it is something else, the book stays
    unindexed and the next drain or scan indexes it.

    A drain re-checks the queue after it clears its status. A replace queues its
    book before its own drain checks for a running one, so a book left to this
    drain after its last pop is always seen by that re-check.
    """
    while queued_count():
        if runner.scan_in_progress():
            return
        if not _drain_once():
            return


def _drain_once() -> bool:
    """One run of the drain, as a scan-status job. False when it was stopped."""
    runner.clear_stop()
    runner.set_status(
        {
            **runner.DEFAULT_STATUS,
            "running": True,
            "phase": "indexing",
            "kind": REINDEX_KIND,
            "to_index": queued_count(),
            "indexed": 0,
        }
    )
    heartbeat = runner._start_heartbeat()
    try:
        indexed = 0
        while not runner.is_stop_requested():
            book_id = _pop_queued()
            if book_id is None:
                # Image-only books were left ocr_pending by the index - read them
                # now. Books replaced during the OCR are queued for another round.
                runner.run_ocr_queue()
                if not queued_count():
                    break
                runner.set_status({"phase": "indexing"})
                continue
            _index_queued_book(book_id)
            indexed += 1
            runner.set_status({"indexed": indexed, "to_index": indexed + queued_count()})
    finally:
        runner.set_status({"running": False, "phase": None, "kind": None})
        heartbeat.set()
    runner.follow_up_ocr_request()
    return not runner.is_stop_requested()


def _index_queued_book(book_id: str) -> None:
    """Index one queued book's text, unless someone else has it or already did."""
    refresh_file = _take_refresh(book_id)
    if not claim_book(book_id):
        # A replace is writing this book's file right now, and queues it again
        # once the new file has been read - which also covers a rescan's re-read.
        return
    try:
        db = SessionLocal()
        try:
            book = db.get(Book, book_id)
            if book is None:
                logger.warning(f"Re-index: book {book_id} no longer exists - skipping.")
                return
            # Already indexed by a scan since a replace queued it. A rescan asked
            # for its file to be read again, so it goes ahead regardless.
            if not refresh_file and (book.indexed or book.ocr_pending or book.index_failed):
                return
            logger.info(f"Re-reading '{book.title or book.filename}' from disk…")
            try:
                if refresh_file:
                    reindex_single_book(
                        book, DATA_PATH, db, should_stop=runner.is_stop_requested
                    )
                    # The (path, hash) lookup still holds the file's old hash.
                    invalidate_book_cache()
                else:
                    index_book_text(book, DATA_PATH, db, should_stop=runner.is_stop_requested)
            except Exception as e:
                logger.error(f"Re-index failed for '{book.title or book.filename}': {e}")
                db.rollback()
                failed = db.get(Book, book_id)
                if failed:
                    failed.index_error = str(e)[:500]
                    failed.index_failed = True
                    db.commit()
        finally:
            db.close()
    finally:
        release_book(book_id)
