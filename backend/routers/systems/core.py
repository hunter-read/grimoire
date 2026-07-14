"""Game system endpoint handlers."""
from fastapi import Depends, HTTPException

from ...auth import CurrentUser, get_current_user, require_gm_or_admin
from ...config import SessionLocal
from ...models import Book, BookFolder, GameSystem, User
from ._helpers import resolve_cover_book_id
from ._schemas import BookFolderUpdate, GameSystemUpdate


def list_systems(current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=current_user.id).first()
        can_see_explicit = (
            bool(user.allow_explicit) if user and user.allow_explicit is not None else True
        )

        systems = db.query(GameSystem).order_by(GameSystem.name).all()
        result = []
        for s in systems:
            if s.is_explicit and not can_see_explicit:
                continue
            book_q = db.query(Book).filter_by(game_system_id=s.id)
            if not can_see_explicit:
                book_q = book_q.filter(Book.is_explicit != True)
            book_count = book_q.count()
            cover_book_id = resolve_cover_book_id(db, s)
            result.append(
                {
                    "id": s.id,
                    "name": s.name,
                    "slug": s.slug,
                    "description": s.description,
                    "publishers": s.publishers or [],
                    "character_builder_url": s.character_builder_url,
                    "tags": s.tags or [],
                    "genre": s.genre,
                    "book_count": book_count,
                    "cover_image": s.cover_image,
                    "cover_book_id": cover_book_id,
                    "is_explicit": bool(s.is_explicit),
                    "is_system_agnostic": bool(s.is_system_agnostic),
                }
            )
        return result
    finally:
        db.close()


def get_system(system_id: str, current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        system = db.query(GameSystem).filter_by(id=system_id).first()
        if not system:
            raise HTTPException(404, "System not found")

        user = db.query(User).filter_by(id=current_user.id).first()
        can_see_explicit = (
            bool(user.allow_explicit) if user and user.allow_explicit is not None else True
        )

        if system.is_explicit and not can_see_explicit:
            raise HTTPException(404, "System not found")

        book_q = db.query(Book).filter_by(game_system_id=system.id)
        if not can_see_explicit:
            book_q = book_q.filter(Book.is_explicit != True)
        books = book_q.order_by(Book.category, Book.title).all()

        cover_book_id = system.cover_book_id
        if not cover_book_id:
            auto = next((b for b in books if b.category == "core" and b.has_thumbnail), None)
            if not auto:
                auto = next((b for b in books if b.has_thumbnail), None)
            if auto:
                cover_book_id = auto.id
        return {
            "id": system.id,
            "name": system.name,
            "slug": system.slug,
            "description": system.description,
            "publishers": system.publishers or [],
            "character_builder_url": system.character_builder_url,
            "tags": system.tags or [],
            "genre": system.genre,
            "cover_image": system.cover_image,
            "cover_book_id": cover_book_id,
            "is_explicit": bool(system.is_explicit),
            "is_system_agnostic": bool(system.is_system_agnostic),
            "books": [
                {
                    "id": b.id,
                    "title": b.title,
                    "filename": b.filename,
                    "category": b.category,
                    "description": b.description,
                    "page_count": b.page_count,
                    "file_size": b.file_size,
                    "authors": b.authors or [],
                    "publisher": b.publisher,
                    "publisher_url": b.publisher_url,
                    "year": b.year,
                    "indexed": b.indexed,
                    "index_failed": b.index_failed,
                    "index_error": b.index_error,
                    "ocr_indexed": b.index_error == "ocr",
                    "ocr_dpi": b.ocr_dpi,
                    "has_thumbnail": b.has_thumbnail,
                    "tags": b.tags or [],
                    "is_explicit": bool(b.is_explicit),
                    "is_missing": bool(b.is_missing),
                    "relative_path": b.relative_path,
                }
                for b in books
            ],
        }
    finally:
        db.close()


def list_book_folders(system_id: str, _: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        system = db.query(GameSystem).filter_by(id=system_id).first()
        if not system:
            raise HTTPException(404, "System not found")
        folders = db.query(BookFolder).filter(BookFolder.path.like(f"{system_id}/%")).all()
        return {"folders": [{"path": f.path, "tags": f.tags or []} for f in folders]}
    finally:
        db.close()


def update_book_folder(
    system_id: str,
    data: BookFolderUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),  # noqa: ARG001
):
    db = SessionLocal()
    try:
        folder = db.query(BookFolder).filter_by(path=data.path).first()
        if folder:
            folder.tags = data.tags
        else:
            db.add(BookFolder(path=data.path, tags=data.tags))
        db.commit()
        return {"path": data.path, "tags": data.tags}
    finally:
        db.close()


def update_system(
    system_id: str,
    data: GameSystemUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
):
    db = SessionLocal()
    try:
        system = db.query(GameSystem).filter_by(id=system_id).first()
        if not system:
            raise HTTPException(404, "System not found")
        payload = data.model_dump(exclude_none=True)
        if "publishers" in payload:
            payload["publishers"] = [p if isinstance(p, dict) else p for p in payload["publishers"]]
        for field, value in payload.items():
            setattr(system, field, value)
        db.commit()
        return {"status": "ok"}
    finally:
        db.close()
