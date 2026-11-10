"""Books shown on a second system's shelf (issue #446).

A link puts one book on another system's shelf without a second file or row -
see ``models/book_links.py``. This module answers the two questions everything
else asks about links: which books stand on a system's shelf (:func:`on_shelf`),
and which other systems a book appears in (:func:`linked_systems`).

Only the shelf grows. The book keeps one home, the system its folder gives it,
and everything shown about it on the linked shelf - category, tags, access
level, cover - is read from that one row, so a link can never show a book to
anyone who could not already open it.
"""
from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.orm import Query, Session

from ..models import Book, BookSystemLink, GameSystem
from ..models.game_types import GAME_TYPE_TTRPG
from .systems import visible_systems_by_id


class BookLinkError(Exception):
    """A link was refused. Routers map this to a 400."""


def linked_ids(system_id: str) -> Any:
    """``SELECT book_id`` of the books linked onto ``system_id``'s shelf."""
    return select(BookSystemLink.book_id).where(BookSystemLink.game_system_id == system_id)


def on_shelf(system_id: str) -> ColumnElement[bool]:
    """Books standing on ``system_id``'s shelf: its own, and those linked onto it."""
    return or_(Book.game_system_id == system_id, Book.id.in_(linked_ids(system_id)))


def is_linked_here(system_id: str) -> ColumnElement[bool]:
    """Books on ``system_id``'s shelf through a link rather than their folder."""
    return and_(
        or_(Book.game_system_id.is_(None), Book.game_system_id != system_id),
        Book.id.in_(linked_ids(system_id)),
    )


def on_any_shelf(system_ids: Iterable[str]) -> ColumnElement[bool]:
    """Books standing on the shelf of any of ``system_ids``."""
    ids = list(system_ids)
    linked = select(BookSystemLink.book_id).where(BookSystemLink.game_system_id.in_(ids))
    return or_(Book.game_system_id.in_(ids), Book.id.in_(linked))


def linked_counts(q: Query, system_ids: Iterable[str]) -> dict[str, tuple[int, int]]:
    """``{system_id: (books, pages)}`` linked onto each system, through ``q``.

    ``q`` is a ``Book`` query already narrowed to what the user may see (access
    level, explicit content, variants), so a linked book counts exactly where it
    would show. A link to the book's own system is not counted twice.
    """
    ids = list(system_ids)
    if not ids:
        return {}
    rows = (
        q.join(BookSystemLink, BookSystemLink.book_id == Book.id)
        .filter(
            BookSystemLink.game_system_id.in_(ids),
            or_(Book.game_system_id.is_(None), Book.game_system_id != BookSystemLink.game_system_id),
        )
        .with_entities(
            BookSystemLink.game_system_id,
            func.count(Book.id),
            func.coalesce(func.sum(Book.page_count), 0),
        )
        .group_by(BookSystemLink.game_system_id)
        .all()
    )
    return {sid: (int(count), int(pages or 0)) for sid, count, pages in rows}


def add_counts(
    own: dict[str, tuple[int, int]], linked: dict[str, tuple[int, int]]
) -> dict[str, tuple[int, int]]:
    """``own`` and ``linked`` per-system ``(books, pages)`` summed."""
    out = dict(own)
    for sid, (count, pages) in linked.items():
        have = out.get(sid, (0, 0))
        out[sid] = (have[0] + count, int(have[1] or 0) + pages)
    return out


def linked_system_ids(db: Session, book_ids: Iterable[str]) -> dict[str, list[str]]:
    """``{book_id: [system_id, ...]}`` for each book's links, in one query."""
    ids = list(book_ids)
    if not ids:
        return {}
    out: dict[str, list[str]] = {}
    rows = (
        db.query(BookSystemLink.book_id, BookSystemLink.game_system_id)
        .filter(BookSystemLink.book_id.in_(ids))
        .all()
    )
    for book_id, system_id in rows:
        out.setdefault(book_id, []).append(system_id)
    return out


def serialize_system(system: GameSystem) -> dict[str, Any]:
    """The little a book needs to name a system it appears in."""
    return {
        "id": system.id,
        "name": system.name,
        "game_type": system.game_type or GAME_TYPE_TTRPG,
        "is_one_page": bool(system.is_one_page),
    }


def linked_systems(db: Session, book: Book, current_user: Any) -> list[dict[str, Any]]:
    """The other systems ``book`` appears in, as far as ``current_user`` can see.

    A link naming a system hidden from the reader is left out, as the book's
    own system is when it is hidden. A link to the book's own system (left by a
    move that took the book there) is not another place it appears.
    """
    ids = [
        sid
        for sid in linked_system_ids(db, [book.id]).get(book.id, [])
        if sid != book.game_system_id
    ]
    visible = visible_systems_by_id(db, ids, current_user)
    return sorted(
        (serialize_system(s) for s in visible.values()), key=lambda s: s["name"].lower()
    )


def add_link(db: Session, book: Book, system: GameSystem) -> bool:
    """Put ``book`` on ``system``'s shelf. Not committed.

    True when a link was created, False when it already existed. Raises
    :class:`BookLinkError` for a link that would mean nothing: to the book's own
    system, or across the library and the armory, whose shelves never mix.
    """
    if system.id == book.game_system_id:
        raise BookLinkError("The book is already on this system's shelf")
    if (system.game_type or GAME_TYPE_TTRPG) != (book.game_type or GAME_TYPE_TTRPG):
        raise BookLinkError(
            "A role-playing book can only be linked to a role-playing system, "
            "and a wargame book to a wargame"
        )
    exists = (
        db.query(BookSystemLink)
        .filter_by(book_id=book.id, game_system_id=system.id)
        .first()
    )
    if exists is not None:
        return False
    db.add(BookSystemLink(book_id=book.id, game_system_id=system.id))
    return True


def remove_link(db: Session, book_id: str, system_id: str) -> bool:
    """Take ``book_id`` off ``system_id``'s shelf. Not committed. True if it was on it."""
    removed = (
        db.query(BookSystemLink)
        .filter_by(book_id=book_id, game_system_id=system_id)
        .delete(synchronize_session=False)
    )
    return bool(removed)



def homes_for(
    db: Session, books: Iterable[Book], shelf_id: str, current_user: Any
) -> dict[str, dict[str, Any]]:
    """For each book on ``shelf_id`` through a link, where it really lives.

    ``{book_id: {"linked": True, "system": <system or None>}}``, with only the
    linked books as keys: a book in its own folder has nothing to say. The
    home system is named only when ``current_user`` may see it - a book can be
    open inside a restricted system, and its shelf mark must not name that.
    """
    linked = [b for b in books if b.game_system_id != shelf_id]
    if not linked:
        return {}
    visible = visible_systems_by_id(db, [b.game_system_id for b in linked], current_user)
    out: dict[str, dict[str, Any]] = {}
    for book in linked:
        home = visible.get(book.game_system_id or "")
        out[book.id] = {"linked": True, "system": serialize_system(home) if home else None}
    return out
