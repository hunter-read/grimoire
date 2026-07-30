"""Enrichment helpers for the tags API: turn (type, id) refs into display items."""
from sqlalchemy.orm import Session

from ...models import Audio, Book, GameSystem, GenericMap, Token, User
from ..systems._helpers import resolve_cover_book_id


def can_see_explicit(db: Session, user_id: str) -> bool:
    user = db.query(User).filter_by(id=user_id).first()
    return bool(user.allow_explicit) if user and user.allow_explicit is not None else True


def enrich_tagged_items(
    db: Session, refs: list[dict], *, see_explicit: bool
) -> list[dict]:
    """Enrich ``[{resource_type, resource_id}]`` refs into display items.

    Mirrors the favorites enrichment shape so the Tags page can reuse the same
    cards. Explicit systems/books/tokens are dropped for users who can't see
    them. Missing rows (stale links) are skipped.
    """
    book_ids = [r["resource_id"] for r in refs if r["resource_type"] == "book"]
    map_ids = [r["resource_id"] for r in refs if r["resource_type"] == "map"]
    token_ids = [r["resource_id"] for r in refs if r["resource_type"] == "token"]
    audio_ids = [r["resource_id"] for r in refs if r["resource_type"] == "audio"]
    system_ids = [r["resource_id"] for r in refs if r["resource_type"] == "system"]

    books = {b.id: b for b in db.query(Book).filter(Book.id.in_(book_ids))}
    maps = {m.id: m for m in db.query(GenericMap).filter(GenericMap.id.in_(map_ids))}
    tokens = {t.id: t for t in db.query(Token).filter(Token.id.in_(token_ids))}
    audio = {a.id: a for a in db.query(Audio).filter(Audio.id.in_(audio_ids))}
    systems = {s.id: s for s in db.query(GameSystem).filter(GameSystem.id.in_(system_ids))}

    items: list[dict] = []
    for r in refs:
        rid, rtype = r["resource_id"], r["resource_type"]
        if rtype == "book" and rid in books:
            b = books[rid]
            if b.is_explicit and not see_explicit:
                continue
            items.append(
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
        elif rtype == "map" and rid in maps:
            m = maps[rid]
            items.append(
                {
                    "item_type": "map",
                    "item_id": m.id,
                    "filename": m.filename,
                    "has_thumbnail": m.has_thumbnail,
                    "file_size": m.file_size,
                }
            )
        elif rtype == "token" and rid in tokens:
            t = tokens[rid]
            if t.is_explicit and not see_explicit:
                continue
            items.append(
                {
                    "item_type": "token",
                    "item_id": t.id,
                    "filename": t.filename,
                    "has_thumbnail": t.has_thumbnail,
                    "file_size": t.file_size,
                }
            )
        elif rtype == "audio" and rid in audio:
            a = audio[rid]
            items.append(
                {
                    "item_type": "audio",
                    "item_id": a.id,
                    "filename": a.filename,
                    "title": a.title or "",
                    "duration": a.duration or 0.0,
                    "has_artwork": bool(a.has_artwork),
                    "file_size": a.file_size,
                }
            )
        elif rtype == "system" and rid in systems:
            s = systems[rid]
            if s.is_explicit and not see_explicit:
                continue
            items.append(
                {
                    "item_type": "system",
                    "item_id": s.id,
                    "name": s.name,
                    "publishers": s.publishers or [],
                    "cover_book_id": resolve_cover_book_id(db, s),
                }
            )
    return items
