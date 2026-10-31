"""A book's custom cover - upload, set from an existing image, and remove.

The cover itself is stored and resolved by ``services.books.covers``; these
handlers mirror the system cover routes (``routers/systems/covers.py``): the
same roles, accepted types, size limit and validation. Once set, the custom
cover is what ``GET /books/{id}/thumbnail`` serves, and so what every grid,
OPDS feed and Grimoire Codex DB push shows for the book.
"""
from typing import Optional

from fastapi import Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_gm_or_admin
from ...config import get_db
from ...metadata import export as sidecar_export
from ...models import Book
from ...services.books import covers as book_covers
from ...services.upload_images import UPLOAD_IMAGE_FORMATS
from ._helpers import get_visible_book
from ._schemas import BookCoverSourceIn

_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_MAX_COVER_BYTES = 10 * 1024 * 1024  # 10 MB


def _cover_response(book: Book) -> dict:
    return {
        "cover_image": book.cover_image or "",
        "has_custom_cover": book_covers.has_custom_cover(book),
        "cover_version": book_covers.cover_version(book),
        # As in the book payloads: whether the book now has any cover to show.
        "has_thumbnail": bool(book.has_thumbnail or book.cover_image),
    }


def _apply(db: Session, book: Book, data: bytes, formats: Optional[tuple[str, ...]]) -> dict:
    """Store ``data`` as the book's cover, commit, and refresh an exported cover."""
    try:
        book_covers.store_cover(book, data, formats)
    except book_covers.CoverImageError:
        raise HTTPException(400, "File is not a valid image") from None
    db.commit()
    # A `.cover.jpg` sidecar the book already has is rewritten to match. After the
    # commit, as for a metadata edit, and it never fails the request.
    sidecar_export.refresh_existing_safe(db, book)
    return _cover_response(book)


def upload_book_cover(
    book_id: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Store an uploaded image as the book's cover, in place of its generated thumbnail."""
    book = get_visible_book(db, book_id, current_user)
    if file.content_type not in _IMAGE_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")
    data = file.file.read(_MAX_COVER_BYTES + 1)
    if len(data) > _MAX_COVER_BYTES:
        raise HTTPException(413, "File is too large")
    if not data:
        raise HTTPException(400, "Empty file")
    return _apply(db, book, data, UPLOAD_IMAGE_FORMATS)


def set_book_cover_from_source(
    book_id: str,
    body: BookCoverSourceIn,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Set the book's cover from an image Grimoire already holds.

    The picker path that complements the device upload, exactly as for system
    covers: the bytes are copied in, so the cover survives the source going away.
    """
    from ...services.image_source import load_source_image, source_formats

    book = get_visible_book(db, book_id, current_user)
    data = load_source_image(db, current_user, body.source_type, body.source_id)
    return _apply(db, book, data, source_formats(body.source_type))


def delete_book_cover(
    book_id: str,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Remove the custom cover; the generated thumbnail is shown again."""
    book = get_visible_book(db, book_id, current_user)
    book_covers.clear_cover(book)
    db.commit()
    sidecar_export.refresh_existing_safe(db, book)
    return _cover_response(book)
