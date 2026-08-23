"""Game system endpoint handlers."""
from typing import Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_gm_or_admin
from ...config import get_db
from ...models import Book, BookFolder, GameSystem, User
from ...services import bulk_service, tag_service, variants
from .._bulk_schemas import BulkAddTags
from ._helpers import resolve_cover_book_id
from ._schemas import BookFolderUpdate, GameSystemBulkUpdate, GameSystemUpdate
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
    parent_id: Optional[str] = Query(None),
    include_children: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter_by(id=current_user.id).first()
    can_see_explicit = (
        bool(user.allow_explicit) if user and user.allow_explicit is not None else True
    )

    # Per-system book count + total page count in one grouped query. Variants
    # are excluded so the card's count matches the number of rows the detail
    # view actually renders (issues #304, #306).
    agg_q = db.query(
        Book.game_system_id,
        func.count(Book.id),
        func.coalesce(func.sum(Book.page_count), 0),
    ).filter(variants.parent_filter(Book))
    if not can_see_explicit:
        agg_q = agg_q.filter(Book.is_explicit != True)  # noqa: E712
    agg = {
        gsid: (count, pages)
        for gsid, count, pages in agg_q.group_by(Book.game_system_id).all()
    }

    systems = db.query(GameSystem).all()
    # Number of child systems per container, for the container's card.
    child_counts = {
        pid: count
        for pid, count in db.query(GameSystem.parent_id, func.count(GameSystem.id))
        .filter(GameSystem.parent_id.isnot(None))
        .group_by(GameSystem.parent_id)
        .all()
    }
    system_tags = tag_service.display_tags_for_resources(db, "system", [s.id for s in systems])
    result = []
    for s in systems:
        # Container children are browsed through their container, so they stay
        # out of the top-level listing unless explicitly asked for (issues
        # #261/#262). ``parent_id`` selects one container's children.
        if parent_id:
            if s.parent_id != parent_id:
                continue
        elif s.parent_id and not include_children:
            continue
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
            serialize_system_summary(
                s,
                book_count,
                int(total_pages or 0),
                cover_book_id,
                tags=system_tags.get(s.id, []),
                child_count=child_counts.get(s.id, 0),
            )
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

    book_q = variants.parents_only(
        db.query(Book).filter_by(game_system_id=system.id), Book
    )
    if not can_see_explicit:
        book_q = book_q.filter(Book.is_explicit != True)
    books = book_q.all()

    # Cover resolution ignores the sort/filter args (must be stable). Containers
    # never borrow a child's book as their cover — see resolve_cover_book_id.
    cover_book_id = system.cover_book_id
    if not cover_book_id and not system.container_kind:
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

    # Container folders hold systems rather than (only) books — return those
    # children so the detail view can render them as systems (issues #261/#262).
    children = _serialize_children(db, system, can_see_explicit)

    system_tags = tag_service.display_tags_for_resource(db, "system", system.id)
    book_tags = tag_service.display_tags_for_resources(db, "book", [b.id for b in books])
    summary = serialize_system_summary(
        system,
        book_count=len(books),
        total_page_count=sum(b.page_count or 0 for b in books),
        cover_book_id=cover_book_id,
        tags=system_tags,
        child_count=len(children),
    )
    summary["books"] = [serialize_book(b, tags=book_tags.get(b.id, [])) for b in books]
    summary["children"] = children
    return summary


def _serialize_children(
    db: Session, system: GameSystem, can_see_explicit: bool
) -> list[dict]:
    """Serialize a container's child systems, newest-style summary rows.

    Returns an empty list for ordinary systems, so the field is always present
    and the caller never has to branch on ``container_kind``.
    """
    if not system.container_kind:
        return []
    child_q = db.query(GameSystem).filter(GameSystem.parent_id == system.id)
    if not can_see_explicit:
        child_q = child_q.filter(GameSystem.is_explicit != True)  # noqa: E712
    children = child_q.all()
    if not children:
        return []

    agg_q = db.query(
        Book.game_system_id,
        func.count(Book.id),
        func.coalesce(func.sum(Book.page_count), 0),
    ).filter(
        Book.game_system_id.in_([c.id for c in children]),
        variants.parent_filter(Book),
    )
    if not can_see_explicit:
        agg_q = agg_q.filter(Book.is_explicit != True)  # noqa: E712
    agg = {
        gsid: (count, pages)
        for gsid, count, pages in agg_q.group_by(Book.game_system_id).all()
    }
    child_tags = tag_service.display_tags_for_resources(db, "system", [c.id for c in children])
    rows = []
    for c in children:
        book_count, total_pages = agg.get(c.id, (0, 0))
        rows.append(
            serialize_system_summary(
                c,
                book_count,
                int(total_pages or 0),
                resolve_cover_book_id(db, c),
                tags=child_tags.get(c.id, []),
            )
        )
    return sorted(rows, key=lambda r: r["name"].lower())


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


def _require_owned_folder_path(db: Session, system_id: str, path: str) -> None:
    """404 unless the system exists, 400 unless ``path`` addresses a folder in it.

    A ``BookFolder.path`` is ``{system_id}/{category}/{subfolder…}``, so a path
    that isn't prefixed with this system's id belongs to a different system (or
    to no system at all) and must not be writable through this route.
    """
    if not db.query(GameSystem).filter_by(id=system_id).first():
        raise HTTPException(404, "System not found")
    cleaned = (path or "").strip().replace("\\", "/")
    if not cleaned.startswith(f"{system_id}/") or len(cleaned.split("/")) < 3:
        raise HTTPException(
            400, "path must be '{system_id}/{category}/{subfolder...}' for this system"
        )


def list_book_folders(
    system_id: str,
    _: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system:
        raise HTTPException(404, "System not found")
    folders = db.query(BookFolder).filter(BookFolder.path.like(f"{system_id}/%")).all()
    return {
        "folders": [
            {"path": f.path, "tags": tag_service.folder_display_tags(db, f.tags or [])}
            for f in folders
        ]
    }


def update_book_folder(
    system_id: str,
    data: BookFolderUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),  # noqa: ARG001,
    db: Session = Depends(get_db),
):
    # ``data.path`` alone used to pick the row, so a path belonging to another
    # system (or to none) silently created a row the matching GET — which filters
    # on ``{system_id}/`` — could never return (issue #357).
    _require_owned_folder_path(db, system_id, data.path)
    internals = tag_service.upsert_folder_tags(
        db, BookFolder, data.path, data.tags, category="book"
    )
    db.commit()
    return {"path": data.path, "tags": internals}


def delete_book_folder(
    system_id: str,
    path: str,
    _: CurrentUser = Depends(require_gm_or_admin),  # noqa: ARG001,
    db: Session = Depends(get_db),
):
    """Remove a book folder row outright (issue #357).

    Clearing a folder's tags leaves the row behind, so a row written under a
    mistaken path could previously be emptied but never removed.
    """
    _require_owned_folder_path(db, system_id, path)
    folder = db.query(BookFolder).filter_by(path=path).first()
    if not folder:
        raise HTTPException(404, "Book folder not found")
    db.delete(folder)
    db.commit()
    return {"status": "deleted"}


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
    try:
        _apply_rename(db, system, payload)
    except bulk_service.BulkItemError as exc:
        # ``name`` is unique, so report a clash as a conflict rather than letting
        # the commit fail with an opaque 500.
        raise HTTPException(409, str(exc)) from exc
    bulk_service.apply_updates(db, "system", system, payload)
    db.commit()
    return {"status": "ok"}


def _apply_rename(db: Session, system: GameSystem, payload: dict) -> None:
    """Mark a rename sticky, rejecting a name already taken by another system.

    A rename is sticky: the scanner derives default names from folder structure
    (e.g. "Dungeons & Dragons 2e") and must not clobber a user's correction
    ("Advanced Dungeons & Dragons") on the next rescan (issues #261/#262).

    Raises :class:`bulk_service.BulkItemError` on a clash so the bulk endpoint can
    report it per item while the single-item handler turns it into a 409.
    """
    new_name = payload.get("name")
    if new_name is None or new_name == system.name:
        return
    clash = (
        db.query(GameSystem)
        .filter(GameSystem.name == new_name, GameSystem.id != system.id)
        .first()
    )
    if clash:
        raise bulk_service.BulkItemError(f"A system named '{new_name}' already exists")
    system.name_is_custom = True


def bulk_update_systems(
    data: GameSystemBulkUpdate,  # type: ignore[valid-type]
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Apply per-system edits for a whole selection in one transaction (issue #270).

    A name clash fails only its own item (reported in ``errors``); the rest of the
    batch still applies.
    """
    return bulk_service.run_bulk_update(
        db,
        "system",
        list(data.items),  # type: ignore[attr-defined]
        payload_for=lambda item: item.model_dump(exclude_none=True, exclude={"id"}),
        validate=_apply_rename,
        not_found_detail="System not found",
    )


def bulk_add_system_tags(
    data: BulkAddTags,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Additively tag a whole selection of systems in one transaction."""
    return bulk_service.run_bulk_add_tags(
        db, "system", data.ids, data.tags, not_found_detail="System not found"
    )
