"""Publication links: from a roster's "Codex: Necrons, p. 82" to a page in the library.

A link is shared - set once by a GM or admin, used by every army citing the
publication - but which books it can open is still each reader's own: a link
to a book the user may not see resolves to nothing for them, and the books
offered or searched for linking are only ones the linker may see. A league's
guest sees a link only to a book one of their leagues shares with them, and is
offered no books at all.
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from ...models import Book, GameSystem, PublicationLink
from ...models.game_types import GAME_TYPE_WARGAME
from ..access_control import visible_books
from ..campaigns.access import user_can_access_resource
from . import guests
from .battlescribe import MAX_PUBLICATIONS

#: The most books a title search or a suggestion list returns.
MAX_MATCHES = 10
#: The most library books weighed as suggestions for an army's publications.
MAX_CANDIDATES = 2000


def system_key(system_name: str) -> str:
    """How a roster's game system name keys its links: trimmed, lower-cased."""
    return (system_name or "").strip().lower()


def publications_in(data: dict[str, Any]) -> list[str]:
    """The publications an army's list cites, in first-cited order.

    No more than :data:`MAX_PUBLICATIONS`, the most a roster may cite: a list
    stored before that limit can hold more, and each one is looked up.
    """
    seen: dict[str, None] = {}

    def visit(item: dict[str, Any]) -> None:
        for source in (item, *(item.get("profiles") or []), *(item.get("rules") or [])):
            pub = source.get("publication") or ""
            if pub:
                seen.setdefault(pub, None)
        for child in item.get("children") or []:
            visit(child)

    def visit_force(force: dict[str, Any]) -> None:
        for unit in force.get("units") or []:
            visit(unit)
        for nested in force.get("forces") or []:
            visit_force(nested)

    for force in data.get("forces") or []:
        visit_force(force)
    return list(seen)[:MAX_PUBLICATIONS]


def resolve(
    db: Session, user: Any, system_name: str, publications: Iterable[str]
) -> dict[str, dict[str, Any]]:
    """``{publication: {book_id, book_title, page_offset}}`` for the linked ones ``user`` may read."""
    wanted = list(publications)
    if not wanted:
        return {}
    q = (
        db.query(PublicationLink, Book.title)
        .join(Book, Book.id == PublicationLink.book_id)
        .filter(
            PublicationLink.system_name == system_key(system_name),
            PublicationLink.publication.in_(wanted),
        )
    )
    rows = visible_books(db, q, user).all()
    if guests.is_guest(user):
        rows = [
            (link, title)
            for link, title in rows
            if user_can_access_resource(db, user.id, "book", link.book_id)
        ]
    return {
        link.publication: {
            "book_id": link.book_id,
            "book_title": title or "",
            "page_offset": link.page_offset or 0,
        }
        for link, title in rows
    }


def _wargame_books(db: Session, user: Any, game_system_id: Optional[str]) -> Any:
    """A query for the wargame books ``user`` may see, in one system (and its editions) or all.

    None for a guest, who is never offered a book to link.
    """
    q = db.query(Book.id, Book.title).filter(Book.game_type == GAME_TYPE_WARGAME)
    if guests.is_guest(user):
        return q.filter(Book.id.is_(None))
    if game_system_id:
        ids = [game_system_id] + [
            r[0] for r in db.query(GameSystem.id).filter(GameSystem.parent_id == game_system_id)
        ]
        q = q.filter(Book.game_system_id.in_(ids))
    return visible_books(db, q, user)


def suggest(
    db: Session, user: Any, game_system_id: Optional[str], publications: Iterable[str]
) -> dict[str, list[dict[str, str]]]:
    """For each of ``publications``, library books that may be it: titles naming it, or named by it.

    Searched within the army's system when it has one, else every wargame book;
    the books are read once, whatever the number of publications. Suggestions
    serve whoever links a publication, so a guest gets none.
    """
    wanted = list(publications)
    out: dict[str, list[dict[str, str]]] = {pub: [] for pub in wanted}
    needles = {pub: (pub or "").strip().lower() for pub in out}
    if guests.is_guest(user) or not any(needles.values()):
        return out
    books = [
        (book_id, title, (title or "").lower())
        for book_id, title in _wargame_books(db, user, game_system_id).limit(MAX_CANDIDATES)
    ]
    for pub, needle in needles.items():
        if not needle:
            continue
        matches = out[pub]
        for book_id, title, lowered in books:
            if needle in lowered or (lowered and lowered in needle):
                matches.append({"book_id": book_id, "title": title})
                if len(matches) >= MAX_MATCHES:
                    break
    return out


def search_books(db: Session, user: Any, query: str) -> list[dict[str, str]]:
    """Wargame books whose title contains ``query``, ignoring case, by title."""
    needle = (query or "").strip()
    if len(needle) < 2:
        return []
    escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    rows = (
        _wargame_books(db, user, None)
        .filter(Book.title.ilike(f"%{escaped}%", escape="\\"))
        .order_by(Book.title)
        .limit(MAX_MATCHES)
        .all()
    )
    return [{"book_id": book_id, "title": title} for book_id, title in rows]


def readable_book(db: Session, user: Any, book_id: str) -> Optional[Book]:
    """The book ``book_id`` names, if ``user`` may see it - the only books a link may open."""
    if guests.is_guest(user):
        return None
    book: Optional[Book] = visible_books(db, db.query(Book).filter(Book.id == book_id), user).first()
    return book


def set_link(
    db: Session, user: Any, system_name: str, publication: str, book_id: str, page_offset: int
) -> PublicationLink:
    """Create or move the link for ``publication`` in ``system_name``. Does not commit."""
    key = system_key(system_name)
    link = db.query(PublicationLink).filter_by(system_name=key, publication=publication).first()
    if link is None:
        link = PublicationLink(system_name=key, publication=publication, created_by=user.id)
        db.add(link)
    link.book_id = book_id
    link.page_offset = page_offset
    return link


def remove_link(db: Session, system_name: str, publication: str) -> None:
    """Remove the link for ``publication`` in ``system_name``, if there is one. Does not commit."""
    db.query(PublicationLink).filter_by(
        system_name=system_key(system_name), publication=publication
    ).delete(synchronize_session=False)
