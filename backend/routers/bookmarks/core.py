"""Bookmark CRUD endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...config import get_db
from ...models import Bookmark
from ...auth import get_current_user, CurrentUser
from ._helpers import _serialize
from ._schemas import BookmarkCreate, BookmarkUpdate

router = APIRouter()


def list_bookmarks(
    book_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Bookmark)
        .filter_by(user_id=user.id, book_id=book_id)
        .order_by(Bookmark.page_number, Bookmark.created_at)
        .all()
    )
    return [_serialize(b) for b in rows]


def create_bookmark(
    data: BookmarkCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bm = Bookmark(
        user_id=user.id,
        book_id=data.book_id,
        page_number=data.page_number,
        label=data.label or "",
        notes=data.notes or "",
        selected_text=data.selected_text or None,
    )
    db.add(bm)
    db.commit()
    db.refresh(bm)
    return _serialize(bm)


def update_bookmark(
    bookmark_id: str,
    data: BookmarkUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bm = db.query(Bookmark).filter_by(id=bookmark_id, user_id=user.id).first()
    if not bm:
        raise HTTPException(404, "Bookmark not found")
    bm.label = data.label
    if data.notes is not None:
        bm.notes = data.notes
    db.commit()
    return _serialize(bm)


def delete_bookmark(
    bookmark_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bm = db.query(Bookmark).filter_by(id=bookmark_id, user_id=user.id).first()
    if not bm:
        raise HTTPException(404, "Bookmark not found")
    db.delete(bm)
    db.commit()
    return {"status": "ok"}
