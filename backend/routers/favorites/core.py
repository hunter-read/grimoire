"""Favorites CRUD endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from ...config import get_db
from ...auth import get_current_user, CurrentUser
from ...models import Favorite, Book, GenericMap, Token, Audio, GameSystem
from ...services import access_control, tag_service
from ..systems._helpers import resolve_cover_book_id
from ..systems.covers import has_cover_file
from ._schemas import FavoriteIn

router = APIRouter()

# A "tag" favorite is keyed by the tag's internal string (not a row id).
VALID_TYPES = {"book", "map", "token", "audio", "system", "tag"}


def list_favorites(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Favorite).filter_by(user_id=user.id).order_by(Favorite.created_at).all()
    # The ORM row, not the token payload: grant lookups query against it.
    access_user = access_control.load_user(db, user)

    book_ids = [r.item_id for r in rows if r.item_type == "book"]
    map_ids = [r.item_id for r in rows if r.item_type == "map"]
    token_ids = [r.item_id for r in rows if r.item_type == "token"]
    audio_ids = [r.item_id for r in rows if r.item_type == "audio"]
    system_ids = [r.item_id for r in rows if r.item_type == "system"]
    tag_internals = [r.item_id for r in rows if r.item_type == "tag"]

    # A favourited book that later becomes restricted drops out of the list
    # rather than 404ing when opened (issue #258).
    books = {
        b.id: b
        for b in access_control.visible_books(
            db, db.query(Book).filter(Book.id.in_(book_ids)), access_user
        )
    }
    maps = {m.id: m for m in db.query(GenericMap).filter(GenericMap.id.in_(map_ids))}
    tokens = {t.id: t for t in db.query(Token).filter(Token.id.in_(token_ids))}
    audio = {a.id: a for a in db.query(Audio).filter(Audio.id.in_(audio_ids))}
    systems = {
        s.id: s
        for s in access_control.visible_systems(
            db, db.query(GameSystem).filter(GameSystem.id.in_(system_ids)), access_user
        )
    }
    tag_meta = tag_service.tags_meta_for_internals(db, tag_internals)

    # Shared tags (display strings) for the media types that surface them.
    map_tags = tag_service.display_tags_for_resources(db, "map", map_ids)
    token_tags = tag_service.display_tags_for_resources(db, "token", token_ids)
    audio_tags = tag_service.display_tags_for_resources(db, "audio", audio_ids)

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
                    "tags": map_tags.get(m.id, []),
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
                    "tags": token_tags.get(t.id, []),
                }
            )
        elif r.item_type == "audio" and r.item_id in audio:
            a = audio[r.item_id]
            enriched.append(
                {
                    "item_type": "audio",
                    "item_id": a.id,
                    "filename": a.filename,
                    "title": a.title or "",
                    "duration": a.duration or 0.0,
                    "has_artwork": bool(a.has_artwork),
                    "file_size": a.file_size,
                    "tags": audio_tags.get(a.id, []),
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
                    "cover_book_id": resolve_cover_book_id(db, s),
                    # Container folders (issues #261, #262) own no books, so
                    # `cover_book_id` is always null for them and folder art /
                    # an upload served by GET /systems/{id}/cover is their only
                    # cover source. Without this flag they rendered art-less
                    # here while showing a cover everywhere else.
                    "has_cover": has_cover_file(s),
                    "container_kind": s.container_kind or "",
                }
            )
        elif r.item_type == "tag" and r.item_id in tag_meta:
            meta = tag_meta[r.item_id]
            enriched.append(
                {
                    "item_type": "tag",
                    "item_id": r.item_id,
                    "internal": meta["internal"],
                    "display": meta["display"],
                    "count": meta["count"],
                }
            )

    all_ids = [{"item_type": r.item_type, "item_id": r.item_id} for r in rows]
    return {"favorites": all_ids, "items": enriched}


def add_favorite(
    body: FavoriteIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.item_type not in VALID_TYPES:
        raise HTTPException(400, f"item_type must be one of: {', '.join(VALID_TYPES)}")
    try:
        fav = Favorite(user_id=user.id, item_type=body.item_type, item_id=body.item_id)
        db.add(fav)
        db.commit()
        return {"item_type": body.item_type, "item_id": body.item_id}
    except IntegrityError:
        db.rollback()
        return {"item_type": body.item_type, "item_id": body.item_id}  # already exists, idempotent


def remove_favorite(
    item_type: str,
    item_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.query(Favorite).filter_by(user_id=user.id, item_type=item_type, item_id=item_id).delete()
    db.commit()
