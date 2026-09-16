"""Creating and refreshing a single ``Book`` row.

Split out of ``books.py`` (which was 865 lines) so the tree walk there stays
about folder structure and this stays about one file's record.

``_register_book`` is the single insert/update point for a ``Book``. It owns the
change-detection rules — an unchanged signature short-circuits before hashing,
a changed hash under an unchanged path is a *replacement* rather than a new
book — so no caller has to re-derive when a rescan is allowed to skip work.

Patch-safety: ``generate_thumbnail`` and ``_fitz_open_with_timeout`` are stubbed
by tests via ``patch("backend.indexer.…")`` and so are called through the
package namespace (``indexer.NAME``).
"""
import logging
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.exc import IntegrityError

from backend import indexer  # package namespace, for patch-sensitive calls
from . import comics, text_documents
from ._context import _ScanContext, _title_from_filename
from ._subprocess import _run_with_timeout
from .categories import agnostic_category, guess_category
from .constants import (
    IMAGE_EXTS,
    TEXT_DOC_EXTS,
    UNCATEGORIZED,
    _COMIC_ARCHIVE_EXTS,
    _DB_TIMEOUT,
)
from .formats import apply_reflow_layout, can_thumbnail, has_page_count, mime_for_ext
from .hashing import (
    apply_signature,
    changed_content,
    file_signature,
    hash_file,
    signature_matches,
)
from .metadata import _apply_opf_to_book, _find_opf_meta
from .thumbnails import archive_ext, archive_mime
from ..models import Book, GameSystem
from ..services import tag_service

logger = logging.getLogger("grimoire.indexer")


def _derive_category(
    system_category_off: bool,
    is_special_collection: bool,
    relative_path: str,
    system_depth: int,
) -> str:
    """The category slug for a book, given how its owning system infers them."""
    if system_category_off:
        return UNCATEGORIZED
    if is_special_collection:
        return agnostic_category(relative_path)
    return guess_category(relative_path, system_depth)


def _refresh_signature(ctx: _ScanContext, record: Any, filepath: str) -> tuple[bool, bool]:
    """Update ``record``'s stat signature/hash. Returns ``(contents_changed, wrote)``.

    The cheap gate that keeps rescans affordable. When ``(mtime, size)`` still
    matches what we stored, this returns immediately having read no file content
    and written nothing — the common case for every file in the library on every
    scan, and the reason a rescan stays as fast as it is today.

    Only a stat mismatch (or a row that has never been hashed) triggers a read, and
    only a *differing digest* counts as a change: a touched-but-identical file, or a
    network mount reporting a coarse mtime, costs one hash and nothing more.

    A first-time backfill reports ``changed=False``. Rows created before content
    hashing existed have no stored digest, and treating that as a change would
    re-render the entire library on the first scan after upgrading.
    """
    signature = file_signature(filepath)
    if signature is None:
        return False, False
    mtime, size = signature
    if signature_matches(record, mtime, size):
        return False, False

    new_hash = hash_file(filepath, should_stop=ctx.should_stop)
    changed = changed_content(record, new_hash)
    apply_signature(record, mtime, size, new_hash)
    return changed, True


def _handle_replaced_book(ctx: _ScanContext, book: Book, filepath: str, filename: str) -> None:
    """Reset a book whose file was replaced in place so the scan rebuilds it.

    Everything derived from the old bytes is dropped (page renders, open handle,
    search rows, thumbnail), then the completeness flags the scan keys off are
    cleared so the normal thumbnail / page-count / indexing phases regenerate it.
    Without the reset the file would keep its stale page count and cover, because
    those phases only run when their flag says the work is outstanding.
    """
    from ..services.content_cache import invalidate_book_content

    logger.info(f"Contents changed on disk, re-indexing: {filename}")
    thumb_path = ctx.thumb_path("books", book.title, filepath) if book.has_thumbnail else None
    invalidate_book_content(book.id, filepath, db=ctx.session, thumb_path=thumb_path)

    book.has_thumbnail = False
    book.page_count = 0
    book.indexed = False
    book.index_failed = False
    book.index_error = ""
    book.scan_failed = False
    book.ocr_pending = False
    book.ocr_pages_done = 0
    ctx.stats["replaced_books"] = ctx.stats.get("replaced_books", 0) + 1


def _register_book(
    ctx: _ScanContext,
    existing: Optional[Book],
    system: GameSystem,
    system_name: str,
    system_category_off: bool,
    is_special_collection: bool,
    root: str,
    filename: str,
    filepath: str,
    relative_path: str,
    ext: str,
    arc_ext: str,
    system_depth: int = 2,
) -> tuple[Optional[Book], bool, bool]:
    """Insert or resume a single book row.

    Returns ``(book, needs_thumbnail, needs_page_count)``; ``book`` is None when
    the file should be skipped (already complete, stat failure, or a DB error).
    """
    session = ctx.session
    stats = ctx.stats
    if existing:
        # A book's owning system can change without the file moving: turning a
        # folder into a container (issues #261/#262) re-homes its contents from
        # the container row onto the new per-game child systems. Books are keyed
        # by filepath, so without this they would stay attached to the old system
        # and simply vanish from the UI.
        if existing.game_system_id != system.id:
            logger.info(
                f"Re-homing '{filename}' from its previous system to '{system_name}'"
            )
            existing.game_system_id = system.id
            existing.category = _derive_category(
                system_category_off, is_special_collection, relative_path, system_depth
            )
            try:
                _run_with_timeout(
                    session.commit, _DB_TIMEOUT, f"commit re-home '{filepath}'"
                )
                stats["updated_books"] += 1
            except (TimeoutError, IntegrityError) as e:
                logger.error(f"DB error re-homing '{filename}': {e}")
                session.rollback()
        # Re-apply sidecar metadata to already-indexed books when
        # requested (modes "missing"/"replace") — see _apply_opf_to_book.
        if ctx.metadata_mode in ("missing", "replace"):
            opf_meta = _find_opf_meta(root, filename)
            changed = _apply_opf_to_book(existing, opf_meta, ctx.metadata_mode)
            # OPF ``tags`` are shared tags (issue #235), applied via the service.
            # In "missing" mode only fill when the book has no tags yet.
            opf_tags = opf_meta.get("tags")
            if opf_tags:
                current = tag_service.display_tags_for_resource(session, "book", existing.id)
                if ctx.metadata_mode == "replace" or not current:
                    tag_service.set_resource_tags(session, "book", existing.id, opf_tags)
                    changed = True
            if changed:
                logger.debug(f"Refreshing metadata for '{filename}' (mode={ctx.metadata_mode})")
                try:
                    _run_with_timeout(
                        session.commit,
                        _DB_TIMEOUT,
                        f"commit metadata refresh '{filepath}'",
                    )
                    stats["updated_books"] += 1
                except (TimeoutError, IntegrityError) as e:
                    logger.error(f"DB hang refreshing metadata for '{filename}': {e}")
                    session.rollback()
        # Detect an in-place replacement before the completeness checks below:
        # those only ask whether work is *outstanding*, so a fully-indexed book
        # whose bytes were swapped would otherwise be skipped forever.
        replaced, wrote_signature = _refresh_signature(ctx, existing, filepath)
        if replaced:
            _handle_replaced_book(ctx, existing, filepath, filename)
        if wrote_signature:
            try:
                _run_with_timeout(
                    session.commit, _DB_TIMEOUT, f"commit signature '{filepath}'"
                )
            except (TimeoutError, IntegrityError) as e:
                logger.error(f"DB error saving file signature for '{filename}': {e}")
                session.rollback()

        if existing.scan_failed and not replaced:
            logger.debug(f"Already registered, skipping: {filename}")
            return None, False, False
        # Non-comic archives stay opaque. Asking the format table here is what
        # backfills books registered before their format was supported: an EPUB
        # scanned by an older build sits at has_thumbnail=0/page_count=0 and
        # picks both up on the next rescan (issues #180/#200/#373).
        thumbnailable = ext in IMAGE_EXTS or can_thumbnail(ext) or arc_ext in _COMIC_ARCHIVE_EXTS
        countable = has_page_count(ext) or arc_ext in _COMIC_ARCHIVE_EXTS
        needs_thumbnail = thumbnailable and not existing.has_thumbnail
        needs_page_count = countable and existing.page_count == 0 and not existing.index_error
        if ext in IMAGE_EXTS and existing.page_count == 0:
            existing.page_count = 1
        if not needs_thumbnail and not needs_page_count:
            logger.debug(f"Already registered, skipping: {filename}")
            return None, False, False
        logger.debug(f"Resuming incomplete scan for: {filename}")
        return existing, needs_thumbnail, needs_page_count

    category = _derive_category(
        system_category_off, is_special_collection, relative_path, system_depth
    )
    title = _title_from_filename(filename)

    signature = file_signature(filepath)
    if signature is None:
        logger.warning(f"Cannot stat file, skipping: {filepath}")
        return None, False, False
    file_mtime, file_size = signature
    # Hash new files once, here. This is the only unconditional read, and it pays
    # for both halves of the feature: later scans compare against it to spot an
    # in-place replacement, and _reconcile_missing matches on it to recognise a
    # file that was moved rather than deleted (issue #284).
    content_hash = hash_file(filepath, should_stop=ctx.should_stop)

    # Check sibling <stem>.opf first, then Calibre's metadata.opf in the same dir.
    opf_meta = _find_opf_meta(root, filename)
    if opf_meta:
        logger.debug(f"Applying OPF metadata to '{filename}'")

    book = Book(
        game_system_id=system.id,
        title=opf_meta.get("title", title),
        filename=filename,
        filepath=filepath,
        relative_path=relative_path,
        category=category,
        file_size=file_size,
        file_mtime=file_mtime,
        content_hash=content_hash,
        # Extensions with a known book format (PDF/EPUB/DjVu/text/comic) get
        # their canonical MIME from the format table. Before this, only ".pdf"
        # was special-cased and an .epub fell through to the image branch as
        # "image/epub", which is what routed it away from indexing (issue #373).
        mime_type=(
            format_mime
            if (format_mime := mime_for_ext(ext))
            else archive_mime(arc_ext)
            if arc_ext
            else f"image/{ext[1:]}"
        ),
        authors=opf_meta.get("authors"),
        description=opf_meta.get("description"),
        publisher=opf_meta.get("publisher"),
        year=opf_meta.get("year"),
        isbn=opf_meta.get("isbn", ""),
    )

    # Commit the book record first so that if a subsequent
    # hang kills the worker, the file is already in the DB and
    # won't be re-processed on the next startup scan.
    session.add(book)
    logger.debug(f"DB: committing new book '{filename}'")
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit book '{filepath}'")
        ctx.inserted_ids.add(book.id)
        # OPF ``subjects`` become shared tags on the book (issue #235).
        opf_tags = opf_meta.get("tags")
        if opf_tags:
            tag_service.set_resource_tags(session, "book", book.id, opf_tags)
            session.commit()
        stats["new_books"] += 1
        logger.info(f"Added book: {title} ({category}) in {system_name}")
    except TimeoutError as e:
        logger.error(f"DB hang: {e} - rolling back '{filename}'")
        session.rollback()
        stats["errors"] += 1
        return None, False, False
    except IntegrityError:
        session.rollback()
        logger.debug(f"Book already exists, skipping: {filepath}")
        return None, False, False
    # Non-comic archives stay opaque: no cover, no page count. Everything else
    # asks the format table rather than testing for ".pdf" (issues #180/#200/#373).
    needs_thumbnail = ext in IMAGE_EXTS or can_thumbnail(ext) or arc_ext in _COMIC_ARCHIVE_EXTS
    needs_page_count = has_page_count(ext) or arc_ext in _COMIC_ARCHIVE_EXTS
    if ext in IMAGE_EXTS:
        book.page_count = 1
    return book, needs_thumbnail, needs_page_count


def _do_book_thumbnail(
    ctx: _ScanContext, book: Book, filepath: str, filename: str, thumb_path: str
) -> None:
    session = ctx.session
    # Set scan_failed before the potentially-hanging operation.
    # If the worker is killed mid-hang this flag persists, preventing
    # the file from being retried on the next scan. A clean cancel
    # clears it below so the file is resumed normally next time.
    book.scan_failed = True
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit scan_failed '{filepath}'")
    except (TimeoutError, IntegrityError) as e:
        logger.error(f"DB hang writing scan_failed for '{filename}': {e}")
        session.rollback()
    logger.debug(f"Generating thumbnail: {filepath}")
    if indexer.generate_thumbnail(filepath, thumb_path, should_stop=ctx.should_stop):
        book.has_thumbnail = True
    if ctx.stop_requested():
        # Cancelled — clear the flag so the file is resumed next scan.
        book.scan_failed = False
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit thumbnail '{filepath}'")
    except (TimeoutError, IntegrityError) as e:
        logger.error(f"DB hang saving thumbnail for '{filename}': {e}")
        session.rollback()


def _do_book_page_count(ctx: _ScanContext, book: Book, filepath: str, filename: str) -> None:
    session = ctx.session
    stats = ctx.stats
    if not book.scan_failed:
        book.scan_failed = True
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit scan_failed '{filepath}'")
        except (TimeoutError, IntegrityError) as e:
            logger.error(f"DB hang writing scan_failed for '{filename}': {e}")
            session.rollback()
    logger.debug(f"Reading page count: {filepath}")
    ext = Path(filepath).suffix.lower()
    arc_ext = archive_ext(filepath)
    try:
        if arc_ext in _COMIC_ARCHIVE_EXTS:
            # A comic's "pages" are the image members inside the archive.
            book.page_count = comics.page_count(filepath, arc_ext)
        elif ext in TEXT_DOC_EXTS:
            # Text formats have no intrinsic pages; the count is whatever the
            # shared pagination produces, so it matches the reader exactly.
            book.page_count = text_documents.text_page_count(filepath)
        else:
            doc = indexer._fitz_open_with_timeout(filepath, should_stop=ctx.should_stop)
            # EPUB is reflowable: len(doc) is meaningless until it is laid out,
            # and must use the same box the reader does (issue #373).
            apply_reflow_layout(doc)
            book.page_count = len(doc)
            doc.close()
        logger.debug(f"Page count: {book.page_count} pages in '{filename}'")
        book.scan_failed = False
        _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit page_count '{filepath}'")
    except Exception as e:
        if ctx.stop_requested():
            # Cancelled — clear the flag so the file is resumed next scan.
            book.scan_failed = False
        else:
            logger.error(f"Could not read page count for '{filename}': {e}")
            book.index_error = str(e)[:500]
            stats["errors"] += 1
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit scan_failed '{filepath}'")
        except (TimeoutError, IntegrityError) as e2:
            logger.error(f"DB hang saving index_error for '{filename}': {e2}")
            session.rollback()
