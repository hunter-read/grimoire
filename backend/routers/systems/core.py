"""Game system endpoint handlers."""
from typing import Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_gm_or_admin
from ...config import get_db
from ...models import Book, BookFolder, GameSystem, User
from ._helpers import resolve_cover_book_id
from ._schemas import BookFolderUpdate, GameSystemUpdate
from ._serializers import serialize_book, serialize_system_summary

# Sort keys accepted by list_systems. Value is the summary dict key to sort on.
_SYSTEM_SORT_KEYS = {"name", "book_count", "page_count", "year"}
# Sort keys accepted for a system's books (get_system).
_BOOK_SORT_KEYS = {"title", "page_count", "year"}


def _has_value(field, wanted: str) -> bool:
    """Case-insensitive membership test against a stringy/list JSON field."""
    if field is None:
        return False
    wanted = wanted.strip().lower()
    if isinstance(field, list):
        return any(str(v).strip().lower() == wanted for v in field)
    return str(field).strip().lower() == wanted


def list_systems(
    sort: str = Query("name"),
    order: str = Query("asc"),
    genre: Optional[str] = Query(None),
    family: Optional[str] = Query(None),
    parent_system: Optional[str] = Query(None),
    edition: Optional[str] = Query(None),
    license: Optional[str] = Query(None),
    explicit: Optional[bool] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter_by(id=current_user.id).first()
    can_see_explicit = (
        bool(user.allow_explicit) if user and user.allow_explicit is not None else True
    )

    # Per-system book count + total page count in one grouped query.
    agg_q = db.query(
        Book.game_system_id,
        func.count(Book.id),
        func.coalesce(func.sum(Book.page_count), 0),
    )
    if not can_see_explicit:
        agg_q = agg_q.filter(Book.is_explicit != True)  # noqa: E712
    agg = {
        gsid: (count, pages)
        for gsid, count, pages in agg_q.group_by(Book.game_system_id).all()
    }

    systems = db.query(GameSystem).all()
    result = []
    for s in systems:
        if s.is_explicit and not can_see_explicit:
            continue
        if explicit is not None and bool(s.is_explicit) != explicit:
            continue
        if genre and not _has_value(s.genres, genre):
            continue
        if family and not _has_value(s.system_family, family):
            continue
        if parent_system and not _has_value(s.parent_system, parent_system):
            continue
        if edition and not _has_value(s.edition, edition):
            continue
        if license and not _has_value(s.license, license):
            continue
        book_count, total_pages = agg.get(s.id, (0, 0))
        cover_book_id = resolve_cover_book_id(db, s)
        result.append(
            serialize_system_summary(s, book_count, int(total_pages or 0), cover_book_id)
        )

    result = _sort_systems(result, sort, order)
    return result


def _sort_systems(rows: list[dict], sort: str, order: str) -> list[dict]:
    """Sort serialized system rows by the requested key (name default)."""
    key = sort if sort in _SYSTEM_SORT_KEYS else "name"
    reverse = order == "desc"
    if key == "name":
        return sorted(rows, key=lambda r: r["name"].lower(), reverse=reverse)
    if key == "page_count":
        return sorted(rows, key=lambda r: r["total_page_count"], reverse=reverse)
    if key == "year":
        # Systems with no year sort last regardless of direction.
        return sorted(
            rows,
            key=lambda r: (r["year"] is None, r["year"] or 0),
            reverse=reverse,
        )
    return sorted(rows, key=lambda r: r[key], reverse=reverse)


def get_system(
    system_id: str,
    book_sort: str = Query("category"),
    book_order: str = Query("asc"),
    explicit: Optional[bool] = Query(None),
    genre: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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
    books = book_q.all()

    # Cover resolution ignores the sort/filter args (must be stable).
    cover_book_id = system.cover_book_id
    if not cover_book_id:
        auto = next((b for b in books if b.category == "core" and b.has_thumbnail), None)
        if not auto:
            auto = next((b for b in books if b.has_thumbnail), None)
        if auto:
            cover_book_id = auto.id

    # Filter then sort the returned book list.
    if explicit is not None:
        books = [b for b in books if bool(b.is_explicit) == explicit]
    if category:
        books = [b for b in books if b.category == category]
    if genre:
        books = [b for b in books if _has_value(b.genres, genre)]
    books = _sort_books(books, book_sort, book_order)

    summary = serialize_system_summary(
        system,
        book_count=len(books),
        total_page_count=sum(b.page_count or 0 for b in books),
        cover_book_id=cover_book_id,
    )
    summary["books"] = [serialize_book(b) for b in books]
    return summary


def _sort_books(books: list[Book], sort: str, order: str) -> list[Book]:
    """Sort ORM Book rows by the requested key (category+title default)."""
    reverse = order == "desc"
    key = sort if sort in _BOOK_SORT_KEYS else "category"
    if key == "title":
        return sorted(books, key=lambda b: b.title.lower(), reverse=reverse)
    if key == "page_count":
        return sorted(books, key=lambda b: b.page_count or 0, reverse=reverse)
    if key == "year":
        return sorted(
            books,
            key=lambda b: (b.year is None, b.year or 0, b.title.lower()),
            reverse=reverse,
        )
    # Default: group by category, then title (both ascending, ignoring order).
    return sorted(books, key=lambda b: (b.category, b.title.lower()))


def list_book_folders(
    system_id: str,
    _: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system:
        raise HTTPException(404, "System not found")
    folders = db.query(BookFolder).filter(BookFolder.path.like(f"{system_id}/%")).all()
    return {"folders": [{"path": f.path, "tags": f.tags or []} for f in folders]}


def update_book_folder(
    system_id: str,
    data: BookFolderUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),  # noqa: ARG001,
    db: Session = Depends(get_db),
):
    folder = db.query(BookFolder).filter_by(path=data.path).first()
    if folder:
        folder.tags = data.tags
    else:
        db.add(BookFolder(path=data.path, tags=data.tags))
    db.commit()
    return {"path": data.path, "tags": data.tags}


def update_system(
    system_id: str,
    data: GameSystemUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system:
        raise HTTPException(404, "System not found")
    # model_dump serializes nested Pydantic models (publishers, urls,
    # character_builder_urls) to plain dicts, which SQLAlchemy stores as JSON.
    payload = data.model_dump(exclude_none=True)
    for field, value in payload.items():
        setattr(system, field, value)
    db.commit()
    return {"status": "ok"}
