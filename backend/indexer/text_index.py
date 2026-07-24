"""Full-text search indexing for individual books.

``index_book_text`` extracts a PDF's text (in an isolated worker) and inserts it
into the FTS index, queuing image-only PDFs for deferred OCR.
``reindex_single_book`` rebuilds one book's index in place.

Patch-safety: ``extract_text_isolated``, ``generate_thumbnail``, and
``_book_page_count`` are stubbed by tests via ``patch.object(indexer, "…")`` /
``patch("backend.indexer.…")``, so they are invoked through the package
namespace (``indexer.NAME``).
"""
import os
import hashlib
import logging
from typing import Callable, Optional

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import indexer  # package namespace, for patch-sensitive calls
from .. import ocr
from ..models import Book
from ._subprocess import (
    PdfExtractionCrashError,
    _commit,
    _run_with_timeout,
)
from .categories import slugify
from .constants import _DB_TIMEOUT

logger = logging.getLogger("grimoire.indexer")


def index_book_text(
    book: Book,
    data_path: str,
    session: Session,
    should_stop: Optional[Callable[[], bool]] = None,
) -> bool:
    """Extract and index text from a PDF for full-text search.

    Text extraction runs in an isolated worker process (see
    ``extract_text_isolated``).  Before extraction the book is marked
    ``index_failed`` and committed, so that even if a native crash escaped the
    isolation and took down the whole server, the book would already be flagged
    and skipped on the next scan instead of re-crashing in an endless loop.  The
    flag is cleared once extraction succeeds.
    """
    if book.indexed or book.index_failed or book.mime_type != "application/pdf":
        return False

    # Crash-loop guard: persist "attempt in progress" before the risky call so a
    # process-killing crash (segfault / OOM) can't cause this file to be retried
    # forever.  Committed up front; cleared on success below.
    book.index_failed = True
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit index attempt '{book.filepath}'")
    except (TimeoutError, IntegrityError) as e:
        logger.error(f"DB hang marking index attempt for '{book.filename}': {e}")
        session.rollback()

    logger.debug(f"Indexing: extracting text from '{book.filepath}'")
    try:
        # text_only: never OCR inline. Image-only books come back with no pages
        # and are queued for the deferred-OCR worker below, so a large scanned
        # book can't stall the scan for hours or hit the whole-book timeout.
        pages, used_ocr = indexer.extract_text_isolated(
            book.filepath, should_stop=should_stop, text_only=True
        )
    except PdfExtractionCrashError as e:
        logger.error(f"Text extraction crashed for '{book.filename}': {e} — marking index_failed")
        book.index_error = f"extraction crashed: {e}"[:500]
        book.index_failed = True
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit index_failed '{book.filepath}'")
        except (TimeoutError, IntegrityError) as e2:
            logger.error(f"DB hang saving index_failed for '{book.filename}': {e2}")
            session.rollback()
        return False
    except TimeoutError:
        # Cancelled via should_stop — clear the attempt marker so the file is
        # resumed on the next scan rather than being left permanently failed.
        book.index_failed = False
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit index cancel '{book.filepath}'")
        except (TimeoutError, IntegrityError):
            session.rollback()
        return False

    if not pages:
        if ocr.ocr_available():
            # Scanned/image-only PDF: hand it to the deferred-OCR queue instead
            # of OCRing inline. Left not-indexed with ocr_pending set so the OCR
            # worker (and startup recovery) picks it up; index_failed cleared so
            # it isn't mistaken for a hard failure.
            logger.info(
                f"'{book.title or book.filename}' is a scanned book with no text — "
                f"queued to read text from later."
            )
            book.ocr_pending = True
            book.ocr_pages_done = 0
            book.indexed = False
            book.index_failed = False
            book.index_error = ""
            _commit(session, f"queue ocr '{book.filepath}'")
            return False
        # OCR unavailable (slim image): keep the pre-OCR behaviour — mark
        # image-only and indexed so it isn't retried every scan.
        logger.info(
            f"'{book.title or book.filename}' is a scanned book with no text — "
            f"it won't be searchable (text recognition is off)."
        )
        book.index_error = "image-only"
        book.indexed = True
        book.index_failed = False
        logger.debug(f"DB: committing image-only indexed for '{book.filename}'")
        try:
            _run_with_timeout(
                session.commit, _DB_TIMEOUT, f"commit image-only indexed '{book.filepath}'"
            )
        except TimeoutError as e:
            logger.error(f"DB hang: {e} — rolling back image-only indexed for '{book.filename}'")
            session.rollback()
        return True

    logger.debug(f"Indexing: inserting {len(pages)} pages for '{book.filename}' into search index")
    for page_data in pages:
        session.execute(
            text(
                "INSERT INTO book_search (book_id, page_number, content) VALUES (:bid, :pnum, :content)"
            ),
            {"bid": book.id, "pnum": page_data["page"], "content": page_data["content"]},
        )

    book.indexed = True
    book.index_failed = False  # clear the crash-loop guard set before extraction
    # "ocr" marks books whose text was (at least partly) recognised via OCR, so
    # the UI can badge them and startup re-queue can target them. Empty = native.
    book.index_error = "ocr" if used_ocr else ""
    logger.debug(f"DB: committing index for '{book.filename}'")
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit index '{book.filepath}'")
    except TimeoutError as e:
        logger.error(f"DB hang: {e} — rolling back index for '{book.filename}'")
        session.rollback()
        return False
    logger.info(f"'{book.title or book.filename}' is now searchable ({len(pages)} page(s)).")
    return True


def reindex_single_book(
    book: Book,
    data_path: str,
    session: Session,
    should_stop: Optional[Callable[[], bool]] = None,
) -> None:
    """Re-read one book from disk and rebuild its search index in place.

    Unlike a re-OCR (which only applies to image-only PDFs), this handles any
    PDF the user has edited externally: it refreshes the page count and cover
    thumbnail if the file's structure changed, clears the old FTS rows, and
    re-extracts text.  A text-layer PDF is re-indexed from its text layer; a
    file that has become image-only is handed to the deferred-OCR queue by
    ``index_book_text`` just as a fresh scan would.

    Caller is responsible for triggering the OCR-queue drain afterwards (the
    book may be left ``ocr_pending``).  Only PDFs are re-indexable; other types
    return without change.
    """
    if book.mime_type != "application/pdf":
        return

    # Refresh page count — the file may have gained or lost pages since last scan.
    try:
        book.page_count = indexer._book_page_count(book.filepath)
    except Exception as e:
        logger.warning(f"Re-index: could not read page count for '{book.filename}': {e}")

    # Regenerate the cover thumbnail from the (possibly changed) first page.
    thumb_path = os.path.join(
        data_path,
        "thumbnails",
        "books",
        f"{slugify(book.title)}_{hashlib.md5(book.filepath.encode()).hexdigest()[:8]}.webp",
    )
    if indexer.generate_thumbnail(book.filepath, thumb_path, should_stop=should_stop):
        book.has_thumbnail = True

    # Drop the old search rows so the re-index starts from a clean slate, and
    # reset the index flags so index_book_text re-processes the book (it early-
    # returns on already-indexed books).
    session.execute(text("DELETE FROM book_search WHERE book_id = :bid"), {"bid": book.id})
    book.indexed = False
    book.index_failed = False
    book.index_error = ""
    book.ocr_pending = False
    book.ocr_pages_done = 0
    _commit(session, f"reset index for '{book.filepath}'")

    index_book_text(book, data_path, session, should_stop=should_stop)
