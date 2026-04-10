"""Favorites CRUD endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError

from ...config import SessionLocal
from ...auth import get_current_user, CurrentUser
from ...models import Favorite, Book, GenericMap, Token, GameSystem
from ._schemas import FavoriteIn

router = APIRouter()

VALID_TYPES = {"book", "map", "token", "system"}


def list_favorites(user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        rows = db.query(Favorite).filter_by(user_id=user.id).order_by(Favorite.created_at).all()

        book_ids = [r.item_id for r in rows if r.item_type == "book"]
        map_ids = [r.item_id for r in rows if r.item_type == "map"]
        token_ids = [r.item_id for r in rows if r.item_type == "token"]
        system_ids = [r.item_id for r in rows if r.item_type == "system"]

        books = {b.id: b for b in db.query(Book).filter(Book.id.in_(book_ids))}
        maps = {m.id: m for m in db.query(GenericMap).filter(GenericMap.id.in_(map_ids))}
        tokens = {t.id: t for t in db.query(Token).filter(Token.id.in_(token_ids))}
        systems = {s.id: s for s in db.query(GameSystem).filter(GameSystem.id.in_(system_ids))}

        enriched = []
        for r in rows:
            if r.item_type == "book" and r.item_id in books:
                b = books[r.item_id]
                enriched.append(
                    {
                        "item_type": "book",
                        "item_id": b.id,
                        "title": b.title,
                        "category": b.category,
                        "has_thumbnail": b.has_thumbnail,
                        "page_count": b.page_count,
                        "indexed": b.indexed,
                        "index_failed": b.index_failed,
                    }
                )
            elif r.item_type == "map" and r.item_id in maps:
                m = maps[r.item_id]
                enriched.append(
                    {
                        "item_type": "map",
                        "item_id": m.id,
                        "filename": m.filename,
                        "has_thumbnail": m.has_thumbnail,
                        "file_size": m.file_size,
                        "tags": m.tags or [],
                    }
                )
            elif r.item_type == "token" and r.item_id in tokens:
                t = tokens[r.item_id]
                enriched.append(
                    {
                        "item_type": "token",
                        "item_id": t.id,
                        "filename": t.filename,
                        "has_thumbnail": t.has_thumbnail,
                        "file_size": t.file_size,
                        "tags": t.tags or [],
                    }
                )
            elif r.item_type == "system" and r.item_id in systems:
                s = systems[r.item_id]
                enriched.append(
                    {
                        "item_type": "system",
                        "item_id": s.id,
                        "name": s.name,
                        "publishers": s.publishers or [],
                        "cover_book_id": s.cover_book_id,
                    }
                )

        all_ids = [{"item_type": r.item_type, "item_id": r.item_id} for r in rows]
        return {"favorites": all_ids, "items": enriched}
    finally:
        db.close()


def add_favorite(body: FavoriteIn, user: CurrentUser = Depends(get_current_user)):
    if body.item_type not in VALID_TYPES:
        raise HTTPException(400, f"item_type must be one of: {', '.join(VALID_TYPES)}")
    db = SessionLocal()
    try:
        fav = Favorite(user_id=user.id, item_type=body.item_type, item_id=body.item_id)
        db.add(fav)
        db.commit()
        return {"item_type": body.item_type, "item_id": body.item_id}
    except IntegrityError:
        db.rollback()
        return {"item_type": body.item_type, "item_id": body.item_id}  # already exists, idempotent
    finally:
        db.close()


def remove_favorite(item_type: str, item_id: str, user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        db.query(Favorite).filter_by(user_id=user.id, item_type=item_type, item_id=item_id).delete()
        db.commit()
    finally:
        db.close()
