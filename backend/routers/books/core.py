"""Core book CRUD and file-serving endpoint handlers."""
import glob
import hashlib
import os
from typing import Optional

from fastapi import BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from fastapi.responses import FileResponse
from sqlalchemy import text

from ...auth import CurrentUser, get_current_user, require_gm_or_admin
from ...config import _PAGE_CACHE_HEADERS, THUMB_DIR, get_db
from ...security import SAME_ORIGIN_FRAME_HEADERS

from ...indexer import slugify
from ...models import Book, GameSystem
from ._helpers import _allow_explicit, _assert_book_access, _invalidate_book_cache
from ._schemas import BookUpdate

# OCR DPI bounds, mirroring backend.config._read_ocr_dpi clamping.
_OCR_DPI_MIN = 72
_OCR_DPI_MAX = 600


def list_books(
    system_id: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    can_see_explicit = _allow_explicit(db, current_user.id)
    q = db.query(Book)
    if system_id:
        q = q.filter_by(game_system_id=system_id)
    if category:
        q = q.filter_by(category=category)
    if not can_see_explicit:
        q = q.filter(Book.is_explicit != True)
    total = q.count()
    books = q.order_by(Book.title).offset(offset).limit(limit).all()
    return {
        "total": total,
        "books": [
            {
                "id": b.id,
                "title": b.title,
                "filename": b.filename,
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
    return {
        "id": book.id,
        "title": book.title,
        "filename": book.filename,
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
        "tags": book.tags or [],
        "indexed": book.indexed,
        "index_failed": book.index_failed,
        "ocr_indexed": book.index_error == "ocr",
        "ocr_pending": bool(book.ocr_pending),
        "ocr_dpi": book.ocr_dpi,
        "is_missing": bool(book.is_missing),
        "mime_type": book.mime_type,
        "has_thumbnail": book.has_thumbnail,
        "is_explicit": bool(book.is_explicit),
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
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(book, field, value)
    db.commit()
    return {"status": "ok"}


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
    works for any PDF a user has edited externally. A text-layer PDF is
    re-extracted and its FTS rows rebuilt; an image-only PDF is re-queued for
    OCR. The page count and cover thumbnail are refreshed if the file changed.

    The work runs in the background; poll ``GET /api/scan-status`` for progress.
    No-ops (leaving the request for the running scan) if a library scan is
    already in progress.
    """
    from ..library._helpers import rescan_single_book

    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    if book.mime_type != "application/pdf":
        raise HTTPException(400, "Only PDF books can be re-indexed")
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
    expected = os.path.join(thumb_dir, f"{slugify(book.title)}_{fhash}.webp")
    if os.path.isfile(expected):
        return FileResponse(expected, media_type="image/webp", headers=_PAGE_CACHE_HEADERS)
    matches = glob.glob(os.path.join(thumb_dir, f"*_{fhash}.webp"))
    if matches:
        return FileResponse(matches[0], media_type="image/webp", headers=_PAGE_CACHE_HEADERS)
    raise HTTPException(404, "No thumbnail available")
