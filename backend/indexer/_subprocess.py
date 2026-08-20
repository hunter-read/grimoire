"""Isolated PDF text extraction and deferred-OCR execution.

Everything that runs work under a timeout or in a spawned child process:
in-thread timeouts, isolated PDF text extraction, per-page OCR, and the
page-by-page ``ocr_book`` driver.

Patch-safety: the intra-cluster calls that tests stub via
``patch.object(indexer, "…")`` (``_book_page_count``,
``ocr_book_page_isolated_wrapper``, ``ocr_page_isolated``) are invoked through
the package namespace (``indexer.NAME``) so the patches take effect regardless
of module boundaries.
"""
import os
import pickle
import logging
import tempfile
import threading
from typing import Any, Callable, Optional

import fitz  # PyMuPDF
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import indexer  # package namespace, for patch-sensitive calls
from .. import config, ocr
from ..models import Book
from .constants import (
    _DB_TIMEOUT,
    _EXTRACT_TIMEOUT,
    _FITZ_TIMEOUT,
    _MP_CONTEXT,
    _OCR_PAGE_TIMEOUT,
)

logger = logging.getLogger("grimoire.indexer")


class PdfExtractionCrashError(Exception):
    """The isolated extraction worker died (segfault, OOM-kill, or timeout).

    Raised by ``extract_text_isolated`` when the child process terminates
    without producing a result — e.g. a native crash inside MuPDF or an
    out-of-memory kill on a low-RAM host.  The caller marks the book failed so
    the file is skipped instead of crashing the server and re-looping the scan.
    """


def _run_with_timeout(fn: Callable[[], Any], timeout: int, label: str) -> Any:
    """Run fn() in a daemon thread.  Returns its result, or raises TimeoutError if it
    does not complete within `timeout` seconds.  `label` is used in log/error messages."""
    result = [None]
    exc = [None]

    def _worker() -> None:
        try:
            result[0] = fn()
        except Exception as e:
            exc[0] = e

    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    t.join(timeout)
    if t.is_alive():
        raise TimeoutError(f"DB operation timed out after {timeout}s: {label}")
    if exc[0] is not None:
        raise exc[0]
    return result[0]


def _fitz_open_with_timeout(
    filepath: str,
    timeout: int = _FITZ_TIMEOUT,
    should_stop: Optional[Callable[[], bool]] = None,
) -> "fitz.Document":
    """Open a PDF with fitz, raising TimeoutError if it hangs beyond `timeout` seconds.

    If `should_stop` callable is provided, the wait is interrupted early when it
    returns True, raising TimeoutError so the caller can exit cleanly.
    """
    result = [None]
    exc = [None]

    def _open() -> None:
        try:
            result[0] = fitz.open(filepath)
        except Exception as e:
            exc[0] = e

    t = threading.Thread(target=_open, daemon=True)
    t.start()
    deadline = timeout
    poll_interval = 0.5  # check stop flag every 500ms
    elapsed = 0.0
    while t.is_alive() and elapsed < deadline:
        t.join(poll_interval)
        elapsed += poll_interval
        if should_stop and should_stop():
            raise TimeoutError(f"fitz.open() aborted by stop request for {filepath}")
    if t.is_alive():
        raise TimeoutError(f"fitz.open() timed out after {timeout}s for {filepath}")
    if exc[0] is not None:
        raise exc[0]
    return result[0]


def extract_text_from_pdf(
    filepath: str,
    should_stop: Optional[Callable[[], bool]] = None,
    text_only: bool = False,
) -> tuple[list[dict], bool]:
    """Extract text from all pages of a PDF.

    Returns ``(pages, used_ocr)`` where ``pages`` is a list of
    ``{page, content}`` dicts and ``used_ocr`` is True if any page's text came
    from OCR rather than an embedded text layer.

    Pages with an embedded text layer are read directly. Pages with no embedded
    text are OCR'd when OCR is available (default image); otherwise they are
    skipped, so a PDF with no extractable text yields an empty list — the
    caller then marks it ``image-only``.

    When ``text_only`` is True, OCR is skipped: image-only pages are left out and
    the book is queued for deferred OCR by the caller instead of being OCR'd
    inline (which could stall the scan for hours on a large scanned book).
    """
    pages = []
    used_ocr = False
    ocr_on = False if text_only else ocr.ocr_available()
    try:
        doc = _fitz_open_with_timeout(filepath, should_stop=should_stop)
        for i, page in enumerate(doc):
            if should_stop and should_stop():
                break
            page_text = page.get_text().strip()
            if page_text:
                pages.append({"page": i + 1, "content": page_text})
            elif ocr_on:
                scale = config.OCR_DPI / 72.0
                pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                ocr_text = ocr.ocr_pixmap(pix, should_stop=should_stop)
                if ocr_text:
                    pages.append({"page": i + 1, "content": ocr_text})
                    used_ocr = True
        doc.close()
    except Exception as e:
        logger.error(f"Text extraction failed for {filepath}: {e}")
    return pages, used_ocr


def extract_text_isolated(
    filepath: str,
    should_stop: Optional[Callable[[], bool]] = None,
    text_only: bool = False,
) -> tuple[list[dict], bool]:
    """Extract text from a PDF in a separate process, isolating native crashes.

    Returns ``(pages, used_ocr)`` exactly like ``extract_text_from_pdf``.  The
    extraction runs in a spawned child process; if that process dies without
    producing a result — a segfault inside MuPDF, an out-of-memory kill, or
    exceeding ``_EXTRACT_TIMEOUT`` — this raises ``PdfExtractionCrashError`` so
    the caller can mark the book failed and continue, instead of the whole
    worker crashing and re-looping the scan on restart.

    A cooperative ``should_stop`` cancels by terminating the child and raising
    TimeoutError, matching the abort semantics of the rest of the indexer.

    With ``text_only`` the child skips OCR (fast scan phase); image-only books
    return empty ``pages`` and are queued for deferred OCR by the caller.
    """
    from .. import pdf_worker

    fd, result_path = tempfile.mkstemp(prefix="grimoire_extract_", suffix=".pkl")
    os.close(fd)
    proc = _MP_CONTEXT.Process(target=pdf_worker.main, args=(filepath, result_path, text_only))
    try:
        proc.start()
        poll_interval = 0.5
        elapsed = 0.0
        while proc.is_alive() and elapsed < _EXTRACT_TIMEOUT:
            proc.join(poll_interval)
            elapsed += poll_interval
            if should_stop and should_stop():
                proc.terminate()
                proc.join()
                raise TimeoutError(f"Text extraction aborted by stop request for {filepath}")

        if proc.is_alive():
            logger.error(f"Text extraction timed out after {_EXTRACT_TIMEOUT}s for {filepath}")
            proc.terminate()
            proc.join()
            raise PdfExtractionCrashError(f"extraction timed out after {_EXTRACT_TIMEOUT}s")

        # Child exited.  A clean run left a result file; a crash (negative
        # exitcode = killed by signal, or nonzero without a result) did not.
        if os.path.getsize(result_path) == 0:
            code = proc.exitcode
            reason = (
                f"killed by signal {-code}"
                if code is not None and code < 0
                else f"exited with code {code}"
            )
            logger.error(f"Text extraction worker crashed ({reason}) for {filepath}")
            raise PdfExtractionCrashError(f"extraction worker {reason}")

        with open(result_path, "rb") as fh:
            return pickle.load(fh)
    finally:
        if proc.is_alive():
            proc.terminate()
            proc.join()
        try:
            os.unlink(result_path)
        except OSError as e:
            # Temp result file may already be gone; only worth a debug note.
            logger.debug("Failed to remove temp result file %s: %s", result_path, e)


def ocr_page_isolated(
    filepath: str,
    page_index: int,
    should_stop: Optional[Callable[[], bool]] = None,
    dpi: int | None = None,
) -> str:
    """OCR a single page in a spawned child, bounded by ``_OCR_PAGE_TIMEOUT``.

    Returns the recognised text ("" on timeout, crash, cancel, or empty result —
    never raises).  Isolation means a native OCR/MuPDF crash or a wedged page
    kills only this throwaway process; the caller checkpoints the page as done
    and moves on rather than losing the whole book or crashing the server.

    ``dpi`` overrides the rasterization resolution (per-book re-OCR); None uses
    the global ``OCR_DPI`` default.
    """
    from .. import pdf_worker

    fd, result_path = tempfile.mkstemp(prefix="grimoire_ocr_", suffix=".pkl")
    os.close(fd)
    proc = _MP_CONTEXT.Process(
        target=pdf_worker.ocr_page_main,
        args=(filepath, page_index, ocr.effective_languages(), result_path, dpi),
    )
    try:
        proc.start()
        poll_interval = 0.5
        elapsed = 0.0
        while proc.is_alive() and elapsed < _OCR_PAGE_TIMEOUT:
            proc.join(poll_interval)
            elapsed += poll_interval
            if should_stop and should_stop():
                proc.terminate()
                proc.join()
                return ""
        if proc.is_alive():
            logger.error(
                f"OCR page {page_index + 1} timed out after {_OCR_PAGE_TIMEOUT}s for {filepath}"
            )
            proc.terminate()
            proc.join()
            return ""
        if os.path.getsize(result_path) == 0:
            logger.error(
                f"OCR page {page_index + 1} worker crashed (exit {proc.exitcode}) for {filepath}"
            )
            return ""
        with open(result_path, "rb") as fh:
            return pickle.load(fh)
    finally:
        if proc.is_alive():
            proc.terminate()
            proc.join()
        try:
            os.unlink(result_path)
        except OSError as e:
            logger.debug("Failed to remove temp OCR result file %s: %s", result_path, e)


def ocr_book(
    book: Book,
    session: Session,
    should_stop: Optional[Callable[[], bool]] = None,
    on_page: Optional[Callable[..., None]] = None,
) -> str:
    """OCR one queued book page-by-page, checkpointing progress as it goes.

    Resumes from ``book.ocr_pages_done``: pages at or below that index were
    already OCR'd and committed to the FTS index in a prior run, so a restart or
    crash never loses work and never re-does a page.  Each recognised page is
    inserted into ``book_search`` and ``ocr_pages_done`` is advanced and
    committed before moving on, so the whole-book 30-min wall no longer applies —
    a multi-hour scanned book makes steady, durable progress.

    Returns one of: ``"done"`` (all pages processed, book indexed), ``"stopped"``
    (cancelled via ``should_stop`` — resumable), or ``"error"`` (page count
    unreadable).  ``on_page(done, total)`` is called after each page for live
    status.
    """
    try:
        page_count = indexer._book_page_count(book.filepath)
    except Exception as e:
        logger.error(f"OCR: cannot open '{book.filename}' to count pages: {e}")
        book.ocr_pending = False
        book.index_failed = True
        book.index_error = f"ocr open failed: {e}"[:500]
        _commit(session, f"ocr open-failed '{book.filepath}'")
        return "error"

    start = book.ocr_pages_done or 0
    dpi = book.ocr_dpi  # per-book override; None => global OCR_DPI default
    _where = f" (from page {start + 1})" if start else ""
    logger.info(
        f"Reading text from '{book.title or book.filename}' - {page_count} page(s){_where}…"
    )
    logger.debug(
        f"OCR: '{book.filename}' - {page_count} page(s), resuming at page {start + 1}"
        + (f" (dpi={dpi})" if dpi else "")
    )
    for i in range(start, page_count):
        if should_stop and should_stop():
            logger.debug(f"OCR: stop requested during '{book.filename}' at page {i + 1}")
            return "stopped"

        text_out = indexer.ocr_book_page_isolated_wrapper(
            book.filepath, i, should_stop, dpi=dpi
        )

        # A page cancelled mid-flight comes back empty; treat that as a stop, not a
        # processed page, so it isn't silently skipped forever on resume. Checked
        # here (not just at the top) because the OCR call can take up to the
        # per-page timeout, during which a stop may have been requested.
        if should_stop and should_stop():
            logger.debug(f"OCR: stop requested during '{book.filename}' at page {i + 1}")
            return "stopped"

        if text_out:
            session.execute(
                text(
                    "INSERT INTO book_search (book_id, page_number, content) "
                    "VALUES (:bid, :pnum, :content)"
                ),
                {"bid": book.id, "pnum": i + 1, "content": text_out},
            )
        # Advance the checkpoint whether the page yielded text, was legitimately
        # blank, or was abandoned (crash/timeout in the isolated worker — already
        # logged there). The page is counted as processed exactly once and never
        # re-OCR'd on resume, so a single pathological page can't stall or loop the
        # book forever. Committed per page so a crash right after loses at most the
        # page in flight.
        book.ocr_pages_done = i + 1
        _commit(session, f"ocr page {i + 1} '{book.filepath}'")
        if on_page:
            on_page(i + 1, page_count)

    # All pages processed: the book is now fully indexed.  ``index_error='ocr'``
    # badges it in the UI as OCR-sourced (same convention as inline OCR).
    book.ocr_pending = False
    book.indexed = True
    book.index_failed = False
    book.index_error = "ocr"
    _commit(session, f"ocr done '{book.filepath}'")
    logger.info(f"Finished reading '{book.title or book.filename}' - it's now searchable.")
    return "done"


# Indirection so tests can stub the isolated call without spawning subprocesses.
def ocr_book_page_isolated_wrapper(
    filepath: str,
    page_index: int,
    should_stop: Optional[Callable[[], bool]] = None,
    dpi: int | None = None,
) -> str:
    return indexer.ocr_page_isolated(filepath, page_index, should_stop=should_stop, dpi=dpi)


def _book_page_count(filepath: str) -> int:
    doc = _fitz_open_with_timeout(filepath)
    try:
        return doc.page_count
    finally:
        doc.close()


def _commit(session: Session, label: str) -> None:
    """Commit with the standard indexer timeout guard; roll back on hang."""
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, label)
    except (TimeoutError, IntegrityError) as e:
        logger.error(f"DB hang on commit ({label}): {e}")
        session.rollback()
