"""Full-text search indexing for individual books.

``index_book_text`` extracts a book's text and inserts it into the FTS index,
queuing image-only PDFs for deferred OCR. Which books are eligible is decided by
the format table (``formats.can_index``) rather than a hard-coded PDF check, so
EPUB and DjVu are indexed alongside PDFs (issue #373) and .txt/.md/.rtf are
decoded directly (issue #200). ``reindex_single_book`` rebuilds one book's index
in place.

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
from . import text_documents
from ._subprocess import (
    PdfExtractionCrashError,
    _commit,
    _run_with_timeout,
)
from .categories import slugify
from .constants import _DB_TIMEOUT
from .formats import TEXT_MIMES, can_index
from .hashing import apply_signature, file_signature, hash_file_signature

logger = logging.getLogger("grimoire.indexer")


def index_book_text(
    book: Book,
    data_path: str,
    session: Session,
    should_stop: Optional[Callable[[], bool]] = None,
) -> bool:
    """Extract and index a book's text for full-text search.

    PDF/EPUB/DjVu text extraction runs in an isolated worker process (see
    ``extract_text_isolated``).  Before extraction the book is marked
    ``index_failed`` and committed, so that even if a native crash escaped the
    isolation and took down the whole server, the book would already be flagged
    and skipped on the next scan instead of re-crashing in an endless loop.  The
    flag is cleared once extraction succeeds.
    """
    if book.indexed or book.index_failed or not can_index(book.mime_type):
        return False

    # Text formats (.txt/.md/.rtf) are decoded and paginated in-process — no
    # PDF machinery, no OCR, no crash-isolation worker needed (issue #200).
    if book.mime_type in TEXT_MIMES:
        return _index_text_document(book, session)

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
        logger.error(f"Text extraction crashed for '{book.filename}': {e} - marking index_failed")
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
                f"'{book.title or book.filename}' is a scanned book with no text - "
                f"queued to read text from later."
            )
            book.ocr_pending = True
            book.ocr_pages_done = 0
            book.ocr_pages_skipped = 0
            book.indexed = False
            book.index_failed = False
            book.index_error = ""
            _commit(session, f"queue ocr '{book.filepath}'")
            return False
        # OCR unavailable (slim image): keep the pre-OCR behaviour — mark
        # image-only and indexed so it isn't retried every scan.
        logger.info(
            f"'{book.title or book.filename}' is a scanned book with no text - "
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
            logger.error(f"DB hang: {e} - rolling back image-only indexed for '{book.filename}'")
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
        logger.error(f"DB hang: {e} - rolling back index for '{book.filename}'")
        session.rollback()
        return False
    logger.info(f"'{book.title or book.filename}' is now searchable ({len(pages)} page(s)).")
    return True


def _index_text_document(book: Book, session: Session) -> bool:
    """Index a .txt/.md/.rtf book into the FTS table (issue #200).

    Much simpler than the PDF path: no isolated worker, no crash-loop guard, and
    no OCR. Decoding a text file cannot segfault MuPDF, so the risk the PDF path
    guards against does not exist here. A file that yields no text is marked
    indexed anyway so the scan does not retry it every pass.
    """
    pages = text_documents.extract_text_pages(book.filepath)
    if not pages:
        logger.info(
            f"'{book.title or book.filename}' has no readable text - "
            f"it won't be searchable."
        )
        book.index_error = "no-text"
        book.indexed = True
        book.index_failed = False
        _commit(session, f"commit empty text doc '{book.filepath}'")
        return True

    for page_data in pages:
        session.execute(
            text(
                "INSERT INTO book_search (book_id, page_number, content) VALUES (:bid, :pnum, :content)"
            ),
            {"bid": book.id, "pnum": page_data["page"], "content": page_data["content"]},
        )
    book.indexed = True
    book.index_failed = False
    book.index_error = ""
    # Keep the stored page count consistent with what we just indexed, so search
    # results can never point past the end of the book.
    book.page_count = len(pages)
    _commit(session, f"commit text index '{book.filepath}'")
    logger.info(f"'{book.title or book.filename}' is now searchable ({len(pages)} page(s)).")
    return True


def refresh_book_file(
    book: Book,
    data_path: str,
    session: Session,
    should_stop: Optional[Callable[[], bool]] = None,
) -> None:
    """Re-read what a book's record knows about its file: size, hash, pages, cover.

    The format-agnostic half of a per-book rescan, for when the bytes under a
    known path changed — a file replaced in place, by hand or by an upload with
    ``on_conflict=replace`` (issue #497). It works for every book format, so a
    replaced comic or image gets a fresh cover and page count too. It touches
    nothing the user edits (title, tags, description), and leaves the search
    index alone; ``reindex_single_book`` adds that for indexable formats.

    Commits nothing itself — the caller decides when the row is written.
    """
    # Drop everything rendered from the previous bytes first. Without it the page
    # count and thumbnail below would be rebuilt while the cached page renders
    # (and the open document handle) still served the old file.
    from ..services.content_cache import invalidate_book_content
    from .constants import _COMIC_ARCHIVE_EXTS, IMAGE_EXTS
    from .formats import can_thumbnail, has_page_count
    from .thumbnails import archive_ext

    invalidate_book_content(book.id, book.filepath, db=session)

    # Record the current contents so a later library scan doesn't see this file as
    # changed all over again — and so a move of it can be recognised. The size and
    # mtime come from the bytes hashed, not a prior stat that a network mount may
    # still answer with the replaced file's cached attributes (issue #496).
    hashed = hash_file_signature(book.filepath, should_stop=should_stop)
    if hashed is not None:
        content_hash, mtime, size = hashed
        apply_signature(book, mtime, size, content_hash)
    else:
        signature = file_signature(book.filepath)
        if signature is not None:
            apply_signature(book, signature[0], signature[1], None)

    # The same format rules a scan registers a book by (``_register_book``).
    arc_ext = archive_ext(book.filepath)
    ext = os.path.splitext(book.filepath)[1].lower()
    is_comic = arc_ext in _COMIC_ARCHIVE_EXTS

    # Refresh page count — the file may have gained or lost pages since last scan.
    if ext in IMAGE_EXTS:
        book.page_count = 1
    elif has_page_count(ext) or is_comic:
        try:
            book.page_count = indexer._book_page_count(book.filepath)
        except Exception as e:
            logger.warning(f"Re-index: could not read page count for '{book.filename}': {e}")

    # Regenerate the cover thumbnail from the (possibly changed) first page.
    if ext in IMAGE_EXTS or can_thumbnail(ext) or is_comic:
        thumb_path = os.path.join(
            data_path,
            "thumbnails",
            "books",
            f"{slugify(book.title)}_{hashlib.md5(book.filepath.encode()).hexdigest()[:8]}.webp",
        )
        if indexer.generate_thumbnail(book.filepath, thumb_path, should_stop=should_stop):
            book.has_thumbnail = True


def reindex_single_book(
    book: Book,
    data_path: str,
    session: Session,
    should_stop: Optional[Callable[[], bool]] = None,
) -> None:
    """Re-read one book from disk and rebuild its search index in place.

    Unlike a re-OCR (which only applies to image-only PDFs), this handles any
    PDF the user has edited externally: it refreshes the page count and cover
    thumbnail if the file's structure changed (``refresh_book_file``), clears
    the old FTS rows, and re-extracts text.  A text-layer PDF is re-indexed from
    its text layer; a file that has become image-only is handed to the
    deferred-OCR queue by ``index_book_text`` just as a fresh scan would.

    Caller is responsible for triggering the OCR-queue drain afterwards (the
    book may be left ``ocr_pending``).  Only indexable formats are re-indexed;
    other types return without change.
    """
    if not can_index(book.mime_type):
        return

    refresh_book_file(book, data_path, session, should_stop=should_stop)
    reset_book_index(book, session)
    index_book_text(book, data_path, session, should_stop=should_stop)


def reset_book_index(book: Book, session: Session) -> None:
    """Drop a book's search rows and mark its text as not yet read, then commit.

    Called when the bytes changed, so nothing read from the old file survives:
    the text may differ by a corrected typo or by every page. The OCR checkpoint
    goes too — resuming at the old ``ocr_pages_done`` would skip the new file's
    first pages and splice the old file's text onto the rest. The per-book
    ``ocr_dpi`` override is kept, since it is a choice about the book, not the file.

    Leaves the book where every scan looks for outstanding work (``indexed``
    false), so if nothing indexes it now, the next scan does.
    """
    session.execute(text("DELETE FROM book_search WHERE book_id = :bid"), {"bid": book.id})
    book.indexed = False
    book.index_failed = False
    book.index_error = ""
    book.ocr_pending = False
    book.ocr_pages_done = 0
    book.ocr_pages_skipped = 0
    _commit(session, f"reset index for '{book.filepath}'")
