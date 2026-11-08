"""Publication links: from a roster's "Codex: Necrons, p. 82" to a page in the library.

A link is shared - set once by a GM or admin, used by every army citing the
publication - but which books it can open is still each reader's own: a link
to a book the user may not see resolves to nothing for them, and the books
offered or searched for linking are only ones the linker may see.
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from ...models import Book, GameSystem, PublicationLink
from ...models.game_types import GAME_TYPE_WARGAME
from ..access_control import visible_books

#: The most books a title search or a suggestion list returns.
MAX_MATCHES = 10


def system_key(system_name: str) -> str:
    """How a roster's game system name keys its links: trimmed, lower-cased."""
    return (system_name or "").strip().lower()


def publications_in(data: dict[str, Any]) -> list[str]:
    """Every publication an army's list cites, in first-cited order."""
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
    return list(seen)


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
    return {
        link.publication: {
            "book_id": link.book_id,
            "book_title": title or "",
            "page_offset": link.page_offset or 0,
        }
        for link, title in visible_books(db, q, user).all()
    }


def _wargame_books(db: Session, user: Any, game_system_id: Optional[str]) -> Any:
    """A query for the wargame books ``user`` may see, in one system (and its editions) or all."""
    q = db.query(Book.id, Book.title).filter(Book.game_type == GAME_TYPE_WARGAME)
    if game_system_id:
        ids = [game_system_id] + [
            r[0] for r in db.query(GameSystem.id).filter(GameSystem.parent_id == game_system_id)
        ]
        q = q.filter(Book.game_system_id.in_(ids))
    return visible_books(db, q, user)


def suggest(
    db: Session, user: Any, game_system_id: Optional[str], publication: str
) -> list[dict[str, str]]:
    """Library books that may be ``publication``: titles naming it, or named by it.

    Searched within the army's system when it has one, else every wargame book.
    """
    needle = (publication or "").strip().lower()
    if not needle:
        return []
    out = []
    for book_id, title in _wargame_books(db, user, game_system_id).limit(2000):
        lowered = (title or "").lower()
        if needle in lowered or (lowered and lowered in needle):
            out.append({"book_id": book_id, "title": title})
            if len(out) >= MAX_MATCHES:
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
