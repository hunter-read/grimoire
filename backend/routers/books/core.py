"""Core book CRUD and file-serving endpoint handlers."""
import glob
import hashlib
import os
from typing import Optional

from fastapi import BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from fastapi.responses import FileResponse, Response
from sqlalchemy import text

from ...auth import CurrentUser, get_current_user, require_gm_or_admin
from ...config import _PAGE_CACHE_HEADERS, THUMB_DIR, get_db
from ...security import SAME_ORIGIN_FRAME_HEADERS

from ...file_cache import etag_matches
from ...indexer import slugify
from ...indexer.formats import can_index
from ...metadata import export as sidecar_export
from ...metadata import settings as sidecar_settings
from ...models import Book, GameSystem
from ...services import bulk_service, library_fs, tag_service, variants
from ...services.content_cache import content_token
from .._bulk_schemas import BulkAddTags
from ._helpers import _allow_explicit, _assert_book_access, _invalidate_book_cache
from ._schemas import BookBulkUpdate, BookUpdate

# OCR DPI bounds, mirroring backend.config._read_ocr_dpi clamping.
_OCR_DPI_MIN = 72
_OCR_DPI_MAX = 600


def _refresh_sidecars(db: Session, book_ids: list[str]) -> None:
    """Update sidecars for books whose metadata just changed (issue #300).

    Called after the bulk services have committed. Skips the query entirely when
    export is off, which is the default and the common case.
    """
    if not book_ids or not sidecar_settings.export_enabled(db):
        return
    for book in db.query(Book).filter(Book.id.in_(book_ids)).all():
        sidecar_export.refresh_existing_safe(db, book)


def list_books(
    system_id: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    can_see_explicit = _allow_explicit(db, current_user.id)
    # Variants (printer-friendly cuts, older versions) collapse into their parent
    # entry, so the browse list shows one row per book (issues #304, #306). They
    # stay reachable by id, which is what the version picker opens.
    q = variants.parents_only(db.query(Book), Book)
    if system_id:
        q = q.filter_by(game_system_id=system_id)
    if category:
        q = q.filter_by(category=category)
    if not can_see_explicit:
        q = q.filter(Book.is_explicit != True)
    total = q.count()
    books = q.order_by(Book.title).offset(offset).limit(limit).all()
    # One grouped query for the whole page rather than one per row, so the
    # "has other versions" badge costs nothing per book.
    vcounts = variants.variant_counts(db, Book, [b.id for b in books])
    return {
        "total": total,
        "books": [
            {
                "id": b.id,
                "title": b.title,
                "filename": b.filename,
                "relative_path": b.relative_path,
                "category": b.category,
                "page_count": b.page_count,
                "file_size": b.file_size,
                "mime_type": b.mime_type,
                "game_system_id": b.game_system_id,
                "has_thumbnail": b.has_thumbnail,
                "indexed": b.indexed,
                "index_failed": b.index_failed,
                "ocr_indexed": b.index_error == "ocr",
                "is_explicit": bool(b.is_explicit),
                "is_missing": bool(b.is_missing),
                "variant_count": vcounts.get(b.id, 0),
            }
            for b in books
        ],
    }


def get_book(
    book_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    if book.is_explicit and not _allow_explicit(db, current_user.id):
        raise HTTPException(403, "Explicit content is disabled for your account")
    system = (
        db.query(GameSystem).filter_by(id=book.game_system_id).first()
        if book.game_system_id
        else None
    )
    variant_parent, siblings = variants.family_for(db, Book, book)
    return {
        "id": book.id,
        "title": book.title,
        "filename": book.filename,
        "relative_path": book.relative_path,
        "category": book.category,
        "description": book.description,
        "page_count": book.page_count,
        "file_size": book.file_size,
        "authors": book.authors or [],
        "artists": book.artists or [],
        "genres": book.genres or [],
        "publisher": book.publisher,
        "publisher_url": book.publisher_url,
        "urls": book.urls or [],
        "isbn": book.isbn or "",
        "version": book.version or "",
        "language": book.language or "",
        "license": book.license or "",
        "year": book.year,
        "month": book.month,
        "day": book.day,
        "tags": tag_service.display_tags_for_resource(db, "book", book.id),
        "indexed": book.indexed,
        "index_failed": book.index_failed,
        "ocr_indexed": book.index_error == "ocr",
        "ocr_pending": bool(book.ocr_pending),
        "ocr_dpi": book.ocr_dpi,
        "is_missing": bool(book.is_missing),
        "mime_type": book.mime_type,
        "has_thumbnail": book.has_thumbnail,
        "is_explicit": bool(book.is_explicit),
        "content_token": content_token(book.content_hash, book.filepath),
        # The whole variant family, resolved from whichever end was requested, so
        # the reader's version picker renders without a second round trip. A book
        # with no variants gets its own single-entry family.
        "variant_parent_id": book.variant_parent_id,
        "variant_kind": book.variant_kind or "",
        "variant_label": book.variant_label or "",
        "variant_main_id": variant_parent.id,
        "variants": [variants.serialize_variant(v) for v in siblings],
        "game_system": {"id": system.id, "name": system.name, "slug": system.slug}
        if system
        else None,
    }


def update_book(
    book_id: str,
    data: BookUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    previous_category = book.category
    # Tags live in the shared-tag tables, not a column on the book (issue #235);
    # apply_updates routes them through the tag service for us.
    bulk_service.apply_updates(db, "book", book, data.model_dump(exclude_none=True))
    # A category change moves the file into the matching folder, because the
    # folder is what the next rescan reads: leaving the file put would let the
    # scan overwrite the edit with the old category. Best-effort by design — a
    # read-only library records the change without moving anything.
    if book.category and book.category != previous_category:
        library_fs.relocate_book_for_category(db, book, book.category)
    db.commit()
    # Refresh sidecars this book already has (issue #300). After the commit, so a
    # rollback can never leave a sidecar describing metadata that was not saved,
    # and never creating a file — sidecars appear only from an explicit backfill.
    sidecar_export.refresh_existing_safe(db, book)
    return {"status": "ok"}


def bulk_update_books(
    data: BookBulkUpdate,  # type: ignore[valid-type]
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Apply per-book edits for a whole selection in one transaction (issue #270)."""
    items = list(data.items)  # type: ignore[attr-defined]
    # Captured before the update, so a category change can be told from a payload
    # that merely restates the category the book already had.
    before = {
        b.id: b.category
        for b in db.query(Book).filter(Book.id.in_([i.id for i in items] or [""])).all()
    }
    result = bulk_service.run_bulk_update(
        db,
        "book",
        items,
        payload_for=lambda item: item.model_dump(exclude_none=True, exclude={"id"}),
        not_found_detail="Book not found",
    )
    _relocate_recategorised(db, result["updated"], before)
    _refresh_sidecars(db, result["updated"])
    return result


def _relocate_recategorised(db: Session, book_ids: list[str], before: dict[str, str]) -> None:
    """Move every book whose category actually changed into its new folder.

    Runs after the bulk service has committed, so a relocation failure cannot
    roll back metadata the user successfully saved. Each move commits on its own
    for the same reason: one book in a selection of forty landing in an
    unwritable folder must not undo the other thirty-nine.
    """
    if not book_ids:
        return
    for book in db.query(Book).filter(Book.id.in_(book_ids)).all():
        if book.category and book.category != before.get(book.id):
            library_fs.relocate_book_for_category(db, book, book.category)
    db.commit()


def bulk_add_book_tags(
    data: BulkAddTags,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Additively tag a whole selection of books in one transaction."""
    result = bulk_service.run_bulk_add_tags(
        db, "book", data.ids, data.tags, not_found_detail="Book not found"
    )
    _refresh_sidecars(db, result["updated"])
    return result


def reindex_book(
    book_id: str,
    background_tasks: BackgroundTasks,
    ocr_dpi: Optional[int] = Query(
        None,
        ge=_OCR_DPI_MIN,
        le=_OCR_DPI_MAX,
        description="Optional OCR resolution override (DPI, 72–600) for this book. "
        "Omit to use the global OCR_DPI default.",
    ),
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Re-run OCR on a single scanned book, optionally at a higher DPI.

    Clears the book's existing search index and re-queues it for OCR from page 1.
    A higher ``ocr_dpi`` re-reads a specific book more sharply than the library
    default, without re-OCRing the whole library. Only applies to OCR-sourced
    (image-only) PDFs; books with a real text layer have nothing to re-OCR.

    The OCR itself runs in the background; poll ``GET /api/scan-status`` (phase
    ``ocr``) for progress.
    """
    from ..library._helpers import trigger_ocr_queue

    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    if book.mime_type != "application/pdf":
        raise HTTPException(400, "Only PDF books can be OCR'd")
    if not os.path.exists(book.filepath):
        raise HTTPException(404, "File not found on disk")
    # Re-OCR only makes sense for image-only books (no embedded text layer).
    # A book indexed from its own text layer (index_error == "") would gain
    # nothing and OCRing it would duplicate content.
    if book.index_error not in ("ocr", "image-only"):
        raise HTTPException(
            400, "This book has an embedded text layer; OCR does not apply to it."
        )

    # Drop the old search rows so the re-OCR starts from a clean index.
    db.execute(text("DELETE FROM book_search WHERE book_id = :bid"), {"bid": book.id})
    book.ocr_dpi = ocr_dpi  # None => global default
    book.ocr_pending = True
    book.ocr_pages_done = 0
    book.indexed = False
    book.index_failed = False
    book.index_error = ""
    db.commit()
    _invalidate_book_cache()

    background_tasks.add_task(trigger_ocr_queue)
    return {"status": "reindex_queued", "ocr_dpi": ocr_dpi}


def rescan_book(
    book_id: str,
    background_tasks: BackgroundTasks,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Re-read a single book from disk and rebuild its search index.

    The general per-book re-index: unlike the OCR-only ``/reindex`` path, this
    works for any indexable book a user has edited externally — PDF, EPUB, DjVu,
    or a text document. A text-layer PDF is re-extracted and its FTS rows
    rebuilt; an image-only PDF is re-queued for OCR. The page count and cover
    thumbnail are refreshed if the file changed.

    The work runs in the background; poll ``GET /api/scan-status`` for progress.
    No-ops (leaving the request for the running scan) if a library scan is
    already in progress.
    """
    from ..library._helpers import rescan_single_book

    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    # Any indexable format can be re-read, not just PDF (issues #200/#373).
    if not can_index(book.mime_type):
        raise HTTPException(400, "This book's format cannot be re-indexed")
    if not os.path.exists(book.filepath):
        raise HTTPException(404, "File not found on disk")

    background_tasks.add_task(rescan_single_book, book_id)
    return {"status": "rescan_queued"}


def serve_book_file(
    book_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    _assert_book_access(db, book, current_user)
    if not os.path.exists(book.filepath):
        if not book.is_missing:
            book.is_missing = True
            db.commit()
        raise HTTPException(404, "File not found on disk")
    return FileResponse(
        book.filepath,
        media_type=book.mime_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": f'inline; filename="{book.filename}"',
            # The reader embeds this file in a same-origin <iframe> (PDF mode).
            # Override the global frame-ancestors 'none' so Firefox doesn't
            # block the frame, while keeping cross-origin framing denied.
            **SAME_ORIGIN_FRAME_HEADERS,
        },
    )


def serve_book_thumbnail(
    request: Request,
    book_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404)
    _assert_book_access(db, book, current_user)
    # Thumbnails are written at index time as "{slugify(title)}_{fhash}.webp"
    # (see indexer.generate_thumbnail call sites). On a large library the
    # per-request glob over tens of thousands of files is costly and this
    # endpoint is hit once per visible cover, so reconstruct the expected
    # filename and serve it directly. Fall back to the glob only when the
    # title has drifted from what it was at index time (renamed book).
    fhash = hashlib.md5(book.filepath.encode()).hexdigest()[:8]
    thumb_dir = os.path.join(THUMB_DIR, "books")
    # The thumbnail *filename* stays path-derived (that is what the indexer
    # writes), so it alone cannot tell a replaced cover from the original. The
    # ETag carries the content token instead, which is what lets a client holding
    # the previous cover find out it is stale — the response is marked immutable.
    etag = f'"{content_token(book.content_hash, book.filepath)}"'
    if etag_matches(request, etag):
        return Response(status_code=304, headers={"ETag": etag, **_PAGE_CACHE_HEADERS})
    headers = {**_PAGE_CACHE_HEADERS, "ETag": etag}
    expected = os.path.join(thumb_dir, f"{slugify(book.title)}_{fhash}.webp")
    if os.path.isfile(expected):
        return FileResponse(expected, media_type="image/webp", headers=headers)
    matches = glob.glob(os.path.join(thumb_dir, f"*_{fhash}.webp"))
    if matches:
        return FileResponse(matches[0], media_type="image/webp", headers=headers)
    raise HTTPException(404, "No thumbnail available")
