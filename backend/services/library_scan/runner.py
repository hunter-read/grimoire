"""Library rescans, the deferred OCR and model-thumbnail queues, and the scan status they share."""
import os

from ... import config
from ...config import SessionLocal, LIBRARY_PATH, DATA_PATH, logger
from ...models import Book, Model3D
from ...indexer import scan_library, index_book_text, ocr_book
from ...indexer.formats import INDEXABLE_MIMES
from ..books.documents import invalidate_book_cache
from ..jobs import Job
from .claims import claim_book, release_book

DEFAULT_STATUS: dict = {
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
    "total_models": 0,
    "scanned_models": 0,
    "new_books": 0,
    "new_maps": 0,
    "new_tokens": 0,
    "new_audio": 0,
    "new_models": 0,
    "updated_books": 0,
    # Books whose contents changed under an unchanged path (re-indexed in place),
    # and files recognised as moved rather than deleted-and-re-added (issue #284).
    "replaced_books": 0,
    "moved_files": 0,
    "indexed": 0,
    "to_index": 0,
    # Progress of the steps after the walk (phases "reconciling" and "pruning"),
    # which used to sit silently at 100% for as long as they took (issue #748).
    "step_done": 0,
    "step_total": 0,
    # Deferred-OCR queue progress (phase "ocr"). total_ocr = books queued,
    # ocr_done = books finished, ocr_current = filename in flight.
    "total_ocr": 0,
    "ocr_done": 0,
    "ocr_current": None,
    # Deferred model-thumbnail queue progress (phase "thumbnails"). Same shape as
    # the OCR counters above: queued / finished / filename in flight.
    "total_thumbs": 0,
    "thumbs_done": 0,
    "thumbs_current": None,
    # "reindex" while the run is the replace-upload re-index queue's drain
    # (issue #657), which accepts further replace uploads; None for every other run.
    "kind": None,
    # A Re-OCR asked for a drain while another job held the run. Internal: the
    # running drain, or whoever finishes the run, reads the queue again for it
    # (see trigger_ocr_queue). Kept in the shared status so it reaches the
    # worker that holds the run when there are several.
    "ocr_requested": False,
}

# The scan's status, stop flag and heartbeat. Without Valkey the stop flag is
# DATA_PATH/.scan.stop, which every worker can see (issue #651): an in-process
# flag alone only reached the worker that took the POST, and with WORKERS > 1
# that is often not the one holding .scan.lock and running the startup scan.
SCAN_JOB = Job("scan", DEFAULT_STATUS)

request_stop = SCAN_JOB.request_stop
clear_stop = SCAN_JOB.clear_stop
is_stop_requested = SCAN_JOB.is_stop_requested
is_stale = SCAN_JOB.is_stale
get_status = SCAN_JOB.status
set_status = SCAN_JOB.update
_start_heartbeat = SCAN_JOB.start_heartbeat
force_clear = SCAN_JOB.force_clear


def startup_scan_running() -> bool:
    """Whether some worker still holds ``.scan.lock`` for its startup scan."""
    return SCAN_JOB.lock_held()


def scan_in_progress() -> bool:
    """Whether a library scan is really running - a stale status does not count."""
    status = get_status()
    return bool(status.get("running")) and not is_stale(status)


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

    Returns "busy" without reading the book while a replace upload is writing
    its file (issue #657) - the replace resets the book and queues it to be
    indexed again, which re-queues it for OCR if it still needs it.
    """
    if not claim_book(book_id):
        return "busy"
    db = SessionLocal()
    try:
        book = db.get(Book, book_id)
        if not book or not book.ocr_pending:
            return "done"
        set_status({"ocr_current": book.filename})
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
        release_book(book_id)


def _ocr_unless_stopped(book_id: str) -> str:
    """``_ocr_one_book``, or "not started" once a stop has been requested.

    For the concurrent drain (issue #651): ``pool.map`` hands every pending book
    to the pool up front, so without this a stop only ended the books already in
    flight and every queued one still started after it.
    """
    if is_stop_requested():
        return "not started"
    return _ocr_one_book(book_id)


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

    def _pending() -> list[str]:
        db = SessionLocal()
        try:
            return [
                b.id
                for b in db.query(Book)
                # OCR remains PDF-only: it rasterises pages of scanned PDFs.
                .filter_by(ocr_pending=True, mime_type="application/pdf")
                .order_by(Book.ocr_pages_done.desc())  # finish nearly-done books first
                .all()
            ]
        finally:
            db.close()

    pending_ids = _pending()
    if not pending_ids:
        # Logged rather than returning in silence. An empty queue and a queue
        # that is never called look identical from the outside, and telling them
        # apart is the whole diagnosis when a book has no text.
        logger.debug("OCR queue: nothing pending.")
        return 0

    set_status(
        {"running": True, "phase": "ocr", "total_ocr": len(pending_ids), "ocr_done": 0}
    )
    logger.info(
        f"Reading text from {len(pending_ids)} scanned book(s) - this can take a while."
    )
    completed = 0
    attempted: set[str] = set()
    try:
        # Re-check the queue between passes. A book queued while this drain is
        # running is invisible to the snapshot it started from, and
        # trigger_ocr_queue declines to start a second drain while this one
        # holds the phase - so without this the newly-queued book waits for a
        # restart or the next library scan (issue #688).
        #
        # `attempted` is what makes it terminate: a book left pending on purpose
        # - a stop part-way through, or one that fails and stays queued for the
        # next run - is not retried here in a loop.
        while True:
            batch = [b for b in pending_ids if b not in attempted]
            if not batch:
                break
            attempted.update(batch)
            logger.debug(f"OCR queue: {len(batch)} book(s) to OCR (concurrency={concurrency})")
            if concurrency <= 1:
                stopped = False
                for book_id in batch:
                    if is_stop_requested():
                        logger.info("Stopping - leaving the rest for next time.")
                        stopped = True
                        break
                    if _ocr_one_book(book_id) == "done":
                        completed += 1
                    set_status({"ocr_done": get_status()["ocr_done"] + 1})
                if stopped:
                    break
            else:
                from concurrent.futures import ThreadPoolExecutor

                stopped = False
                with ThreadPoolExecutor(max_workers=concurrency) as pool:
                    for result in pool.map(_ocr_unless_stopped, batch):
                        if result == "not started":
                            if not stopped:
                                logger.info("Stopping - leaving the rest for next time.")
                                stopped = True
                            continue
                        if result == "done":
                            completed += 1
                        set_status({"ocr_done": get_status()["ocr_done"] + 1})
                if stopped:
                    break
            pending_ids = _pending()
            if _take_ocr_request():
                # Someone asked for these since: a book re-queued after this run
                # read it is read again, rather than waiting for the next run.
                attempted.difference_update(pending_ids)
            newly = [b for b in pending_ids if b not in attempted]
            if newly:
                logger.info(
                    f"{len(newly)} more scanned book(s) were queued while this ran - "
                    f"reading those too."
                )
                set_status({"total_ocr": len(attempted) + len(newly)})
        logger.info(f"Finished reading text from {completed} of {len(attempted)} scanned book(s).")
    finally:
        set_status({"ocr_current": None})
    return completed


# Per-model budget for the deferred thumbnail queue. Far longer than the
# scan-time budget because this runs after the fast phases, on files already
# known to be heavy.
#
# 300s. Streaming made the renderer fast enough to raise MAX_TRIANGLES to 20M,
# and a mesh that size measures ~57s on a fast desktop — so 180s looked like
# three times the worst case. It is not, because the multiplier that matters is
# not safety margin against the mesh, it is the speed ratio against the *host*.
# Grimoire's typical home is a NAS or a mini-PC, frequently 3-5x slower per core
# than a development machine, and this rasteriser is single-threaded pure Python
# with no SIMD to fall back on. At 4x slower the largest allowed mesh needs
# ~230s and a real 716 MB / 14M-triangle mini needs ~160s, both of which 180s
# cuts off part-way.
#
# The symptom is the silent one — no preview, no error, and the flag cleared so
# it is never retried — which is exactly what makes an over-tight budget worse
# than a slow scan. This is a guard against a pathological file, not a
# performance target: nothing waits on it, it runs after the fast phases are
# done, and a healthy mesh never comes close to it. Buying headroom for slow
# hardware costs nothing on fast hardware.
MODEL_THUMBNAIL_TIMEOUT = 300


def _thumbnail_one_model(model_id: str) -> str:
    """Render one queued model. Returns "done" / "skipped" / "error".

    Mirrors ``_ocr_one_book``: each model gets a fresh session, and an unexpected
    exception is contained here rather than allowed to stall the drain. A failure
    clears the pending flag so one unreadable mesh is not retried on every scan
    forever.
    """
    db = SessionLocal()
    try:
        model = db.query(Model3D).filter_by(id=model_id).first()
        if not model or not model.thumbnail_pending:
            return "skipped"
        set_status({"thumbs_current": model.filename})

        from ...indexer import generate_thumbnail
        from ...indexer._context import _title_from_filename, thumb_path_for

        # Built by the same helper the scanner uses, not re-derived here: the
        # filename encodes a slug and a path hash, and a second spelling of that
        # rule would write files the serving route cannot find.
        thumb_path = thumb_path_for(
            os.path.join(DATA_PATH, "thumbnails"),
            "models",
            _title_from_filename(model.filename),
            model.filepath,
        )
        ok = generate_thumbnail(
            model.filepath,
            thumb_path,
            size=(300, 300),
            should_stop=is_stop_requested,
            timeout=MODEL_THUMBNAIL_TIMEOUT,
        )
        # A stop leaves the flag set so the next run picks the model back up;
        # a genuine failure clears it so we do not retry it forever.
        if is_stop_requested() and not ok:
            return "skipped"
        model.has_thumbnail = bool(ok)
        model.thumbnail_pending = False
        db.commit()
        return "done" if ok else "error"
    except Exception as e:  # noqa: BLE001 - one bad mesh must not stall the drain
        logger.error(f"Thumbnail queue: failed on model {model_id}: {e}")
        try:
            model = db.query(Model3D).filter_by(id=model_id).first()
            if model:
                model.thumbnail_pending = False
                db.commit()
        except Exception:
            db.rollback()
        return "error"
    finally:
        db.close()


def run_model_thumbnail_queue() -> int:
    """Render the meshes the scan was too busy to rasterise (thumbnail_pending=1).

    The visual counterpart of the deferred-OCR queue, and deferred for the same
    reason: the work is CPU-bound, per-file cost varies by orders of magnitude,
    and none of it should sit between the user and a finished library walk.

    Resumable: a stop leaves the flag set, so the next scan — or the startup
    recovery pass — picks up exactly the models that never got their turn.
    """
    db = SessionLocal()
    try:
        pending_ids = [
            m.id
            for m in db.query(Model3D)
            .filter_by(thumbnail_pending=True)
            # Lightest first: a queue interrupted half way should have produced
            # as many thumbnails as it could, not one giant scan.
            .order_by(Model3D.triangle_count.asc())
            .all()
        ]
    finally:
        db.close()

    if not pending_ids:
        # Logged rather than returning in silence. An empty queue and a queue
        # that is never called look identical from the outside, and telling them
        # apart is the whole diagnosis when a model has no preview.
        logger.debug("Model preview queue: nothing pending.")
        return 0

    set_status(
        {
            "running": True,
            "phase": "thumbnails",
            "total_thumbs": len(pending_ids),
            "thumbs_done": 0,
        }
    )
    logger.info(f"Rendering previews for {len(pending_ids)} large model(s).")
    completed = 0
    try:
        for model_id in pending_ids:
            if is_stop_requested():
                logger.info("Stopping - leaving the rest for next time.")
                break
            if _thumbnail_one_model(model_id) == "done":
                completed += 1
            set_status({"thumbs_done": get_status()["thumbs_done"] + 1})
        logger.info(
            f"Finished rendering {completed} of {len(pending_ids)} large model preview(s)."
        )
    finally:
        set_status({"thumbs_current": None})
    return completed


def _take_ocr_request() -> bool:
    """Whether a drain was asked for while another job held the run; clears the ask."""
    if not get_status().get("ocr_requested"):
        return False
    set_status({"ocr_requested": False})
    return True


def follow_up_ocr_request() -> None:
    """Drain the OCR queue if a Re-OCR asked for it while the finished run held it.

    Called by every job that clears the running flag once it has. A request that
    arrived after that job's own drain last read the queue would otherwise wait
    for the next scan.
    """
    if get_status().get("ocr_requested") and not scan_in_progress():
        trigger_ocr_queue()


def trigger_ocr_queue() -> None:
    """Drain the OCR queue now (on-demand, e.g. after a per-book re-OCR request).

    Unlike the startup scan this has no delay of its own. While another job
    holds the run it leaves a request in the status instead (issue #688): a
    drain in progress reads the queue again for it before finishing, and a job
    finishing calls follow_up_ocr_request. The run is checked again after the
    request is left, so a job that finished in between is not missed. Clears the
    running/phase flags on completion when this call owns the OCR phase, and
    goes round again if a request arrived after its drain last read the queue.
    """
    while True:
        if scan_in_progress():
            set_status({"ocr_requested": True})
            if scan_in_progress():
                return
        set_status({"ocr_requested": False})
        heartbeat = _start_heartbeat()
        try:
            run_ocr_queue()
        finally:
            if get_status()["phase"] == "ocr":
                set_status({"running": False, "phase": None})
            heartbeat.set()
        if not get_status().get("ocr_requested"):
            return


def rescan_single_book(book_id: str) -> None:
    """Re-read one book from disk and rebuild its index (background task).

    The per-book counterpart to run_rescan_sync: refreshes page count/thumbnail,
    rebuilds the FTS index for a text-layer PDF, or re-queues an image-only PDF
    for OCR. The book goes on the same queue as replace uploads (issue #657), so
    a rescan during their re-index joins it rather than being dropped, and a
    replace of another book is not refused while this one is read.

    No-ops while any other job runs - a library scan re-reads changed files on
    its own, and the user can re-trigger once it finishes. Progress is
    observable via GET /scan-status.
    """
    from . import reindex_queue

    if scan_in_progress() and not reindex_queue.reindex_running():
        logger.info("A library scan is already running - skipping this single-book re-index.")
        return
    reindex_queue.queue_reindex(book_id, refresh_file=True)
    reindex_queue.drain_reindex_queue()


def run_rescan_sync(scope_path: str | None = None, metadata_mode: str = "new") -> None:
    """Library rescan — scans disk and indexes PDFs.

    Guards against concurrent calls: if a rescan is already running this call
    returns immediately.  Updates scan status (via Valkey when available, or
    in-process dict) so GET /scan-status reflects progress in real time across
    all workers.

    scope_path restricts the scan to a single subtree (e.g. "books/D&D 5e/adventure");
    metadata_mode ("new"|"missing"|"replace") controls sidecar metadata re-application.
    """
    if scan_in_progress():
        logger.info("A library scan is already running - ignoring this request.")
        return
    if get_status()["running"]:
        # The previous scan's process died before it could clear its status
        # (issue #524). Nothing is competing with this one, so start anyway.
        logger.warning("The previous library scan was left stuck; starting a new one anyway.")

    clear_stop()
    set_status({**DEFAULT_STATUS, "running": True, "phase": "scanning"})
    heartbeat = _start_heartbeat()
    try:
        invalidate_book_cache()
        db = SessionLocal()
        try:
            # --- Phase 1: file scan ---
            logger.info("Scanning your library for new and changed files…")

            def on_progress(
                sb: int, tb: int, sm: int, tm: int, st: int, tt: int, sa: int, ta: int,
                smo: int = 0, tmo: int = 0,
            ) -> None:
                set_status(
                    {
                        "scanned_books": sb,
                        "total_books": tb,
                        "scanned_maps": sm,
                        "total_maps": tm,
                        "scanned_tokens": st,
                        "total_tokens": tt,
                        "scanned_audio": sa,
                        "total_audio": ta,
                        "scanned_models": smo,
                        "total_models": tmo,
                    }
                )
                logger.debug(
                    f"File scan progress: books={sb}/{tb}, maps={sm}/{tm}, "
                    f"tokens={st}/{tt}, audio={sa}/{ta}, models={smo}/{tmo}"
                )

            def on_phase(phase: str, done: int, total: int) -> None:
                set_status({"phase": phase, "step_done": done, "step_total": total})

            stats = scan_library(
                LIBRARY_PATH, DATA_PATH, db,
                on_progress=on_progress, should_stop=is_stop_requested,
                scope_path=scope_path, metadata_mode=metadata_mode, on_phase=on_phase,
            )
            new_total = (
                stats.get("new_books", 0)
                + stats.get("new_maps", 0)
                + stats.get("new_tokens", 0)
                + stats.get("new_audio", 0)
                + stats.get("new_models", 0)
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
                f"new_models={stats.get('new_models', 0)}, "
                f"updated_books={stats.get('updated_books', 0)}, "
                f"errors={_errors}"
            )
            set_status(
                {
                    "new_books": stats.get("new_books", 0),
                    "new_maps": stats.get("new_maps", 0),
                    "new_tokens": stats.get("new_tokens", 0),
                    "new_audio": stats.get("new_audio", 0),
                    "new_models": stats.get("new_models", 0),
                    "updated_books": stats.get("updated_books", 0),
                    "replaced_books": stats.get("replaced_books", 0),
                    "moved_files": sum(
                        stats.get(f"moved_{k}", 0)
                        for k in ("books", "maps", "tokens", "audio", "models")
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
            set_status({"phase": "indexing", "to_index": len(to_index), "indexed": 0})
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
                set_status({"indexed": get_status()["indexed"] + 1})
            logger.info(f"Finished - {indexed_count} of {len(to_index)} book(s) are now searchable.")
        finally:
            db.close()

        # --- Phase 3: deferred model previews ---
        # The meshes the walk flagged rather than rasterised. This runs here, in
        # run_rescan_sync, because this is the only worker startup and the
        # rescan endpoint actually call: draining the queue anywhere else means
        # a model flagged thumbnail_pending is never picked up by anything, and
        # the failure is silent — the scan reports success, and the model simply
        # never grows a preview.
        #
        # Before OCR, not after: thumbnails are bounded per file and finish in
        # minutes, while OCR of a scanned library can run for hours, and a user
        # watching a rescan should get their model previews without waiting it
        # out.
        if not is_stop_requested():
            try:
                run_model_thumbnail_queue()
            finally:
                if get_status()["phase"] == "thumbnails":
                    set_status({"running": True, "phase": None})

        # --- Phase 4: deferred OCR of scanned/image-only PDFs ---
        # Runs after the fast phases so text-layer books and other media are
        # already searchable; scanned books grind here without blocking them.
        if not is_stop_requested():
            run_ocr_queue()
    finally:
        # A scan is when replaced files are found and their old renders orphaned,
        # so it is the natural moment to trim the on-disk cache back under its cap.
        from ..content_cache import sweep_page_cache

        sweep_page_cache()
        set_status({"running": False, "phase": None})
        heartbeat.set()
    follow_up_ocr_request()
