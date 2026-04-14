"""Core book CRUD and file-serving endpoints."""
import hashlib
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from ...config import SessionLocal, THUMB_DIR, _PAGE_CACHE_HEADERS
from ...models import GameSystem, Book
from ...auth import require_gm_or_admin, get_current_user, CurrentUser
from ...indexer import slugify
from ._helpers import _allow_explicit
from ._schemas import BookUpdate

router = APIRouter()


@router.get(
    "",
    summary="List books",
    description="Returns a paginated list of books. Filter by `system_id` or `category`.",
)
def list_books(
    system_id: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
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
                    "game_system_id": b.game_system_id,
                    "has_thumbnail": b.has_thumbnail,
                    "indexed": b.indexed,
                    "index_failed": b.index_failed,
                    "is_explicit": bool(b.is_explicit),
                    "is_missing": bool(b.is_missing),
                }
                for b in books
            ],
        }
    finally:
        db.close()


@router.get(
    "/{book_id}",
    summary="Get a book",
    description="Returns full metadata for a book including its associated game system.",
)
def get_book(book_id: str, current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
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
            "publisher": book.publisher,
            "publisher_url": book.publisher_url,
            "year": book.year,
            "indexed": book.indexed,
            "index_failed": book.index_failed,
            "is_missing": bool(book.is_missing),
            "mime_type": book.mime_type,
            "has_thumbnail": book.has_thumbnail,
            "is_explicit": bool(book.is_explicit),
            "game_system": {"id": system.id, "name": system.name, "slug": system.slug}
            if system
            else None,
        }
    finally:
        db.close()


@router.patch(
    "/{book_id}",
    summary="Update book metadata",
    description="Updates editable fields on a book (title, authors, description, etc.). GM or admin role required.",
)
def update_book(book_id: str, data: BookUpdate, _: CurrentUser = Depends(require_gm_or_admin)):
    db = SessionLocal()
    try:
        book = db.query(Book).filter_by(id=book_id).first()
        if not book:
            raise HTTPException(404, "Book not found")
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(book, field, value)
        db.commit()
        return {"status": "ok"}
    finally:
        db.close()


@router.get(
    "/{book_id}/file",
    summary="Download book file",
    description="Streams the raw book file (PDF or other format). Accepts `?token=` for browser-embedded downloads.",
)
def serve_book_file(book_id: str):
    db = SessionLocal()
    try:
        book = db.query(Book).filter_by(id=book_id).first()
        if not book:
            raise HTTPException(404, "Book not found")
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
            },
        )
    finally:
        db.close()


@router.get(
    "/{book_id}/thumbnail",
    summary="Book cover thumbnail",
    description="Returns the pregenerated WebP cover thumbnail for a book. 404 if not yet generated.",
)
def serve_book_thumbnail(book_id: str):
    db = SessionLocal()
    try:
        book = db.query(Book).filter_by(id=book_id).first()
        if not book:
            raise HTTPException(404)
        slug = slugify(book.title)
        fhash = hashlib.md5(book.filepath.encode()).hexdigest()[:8]
        thumb_path = os.path.join(THUMB_DIR, "books", f"{slug}_{fhash}.webp")
        if os.path.exists(thumb_path):
            return FileResponse(thumb_path, media_type="image/webp", headers=_PAGE_CACHE_HEADERS)
        raise HTTPException(404, "No thumbnail available")
    finally:
        db.close()
