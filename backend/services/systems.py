"""Which game systems a user may see, and the cover each one shows them.

Shared by the systems, campaigns, favorites, tags and Codex routers.
"""
from typing import Any, Iterable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import Book, GameSystem, User
from . import access_control, tag_service, variants


def system_browsable(db: Session, system: GameSystem, current_user: Any) -> bool:
    """Whether ``current_user`` may see ``system`` at all.

    Applies both the access level and the user's explicit-content setting, the
    same rules the system's own detail page uses.
    """
    return system.id in browsable_system_ids(db, [system], current_user)


def browsable_system_ids(db: Session, systems: Iterable[GameSystem], current_user: Any) -> set[str]:
    """The ids of ``systems`` that ``system_browsable`` would allow.

    A fixed number of queries however many systems are asked about, for lists
    that check one per row (issue #707).
    """
    user = db.query(User).filter_by(id=current_user.id).first()
    see_explicit = bool(user.allow_explicit) if user and user.allow_explicit is not None else True
    candidates = [s for s in systems if see_explicit or not s.is_explicit]
    return access_control.accessible_system_ids(db, user or current_user, candidates)


def visible_systems_by_id(
    db: Session, system_ids: Iterable[str | None], current_user: Any
) -> dict[str, GameSystem]:
    """The systems among ``system_ids`` that ``current_user`` may see, by id.

    A book can be open inside a system its reader may not see. Anything that
    describes the book names its system only from this map, so a hidden one is
    left out - as the system's own page, the campaign views and the resource
    picker leave it out.
    """
    wanted = {system_id for system_id in system_ids if system_id}
    if not wanted:
        return {}
    systems = db.query(GameSystem).filter(GameSystem.id.in_(wanted)).all()
    allowed = browsable_system_ids(db, systems, current_user)
    return {system.id: system for system in systems if system.id in allowed}


def visible_book_system(db: Session, book: Book, current_user: Any) -> GameSystem | None:
    """``book``'s game system, or None when it has none or ``current_user`` cannot see it."""
    return visible_systems_by_id(db, [book.game_system_id], current_user).get(
        book.game_system_id or ""
    )


def path_without_hidden_system(relative_path: str, depth: int) -> str:
    """``relative_path`` with the folders that name a hidden system cut out.

    A book path is ``books/{containers…}/{System}/{categoryDir}/…/file``, the
    category dir at index ``depth`` (see ``tag_service.system_category_depth``).
    The system's folder, and any container folders above it, name what the
    reader may not see, so only the collection dir and everything from the
    category dir on are kept. A file sitting straight in a container (a loose
    one-page game) keeps just its filename.
    """
    parts = (relative_path or "").replace("\\", "/").split("/")
    if len(parts) < 3:
        return relative_path
    return "/".join([parts[0], *parts[min(depth, len(parts) - 1) :]])


def book_relative_path(
    db: Session, book: Book, system: GameSystem | None, depth: int | None = None
) -> str:
    """The ``relative_path`` to show for ``book``, given its visible ``system``.

    ``system`` is what ``visible_book_system`` returned: None for a book whose
    system is hidden from the reader, and then the path loses the folders that
    would name it. ``depth`` saves a lookup when the caller already has it.
    """
    if system is not None or not book.game_system_id:
        return book.relative_path
    if depth is None:
        depth = tag_service.system_category_depth(db, book.game_system_id)
    return path_without_hidden_system(book.relative_path, depth)


def load_browsable_system(db: Session, system_id: str, current_user: Any) -> GameSystem:
    """The system, or 404 when it is missing or hidden from this user.

    See ``system_browsable`` for the rules.
    """
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system or not system_browsable(db, system, current_user):
        raise HTTPException(404, "System not found")
    return system


def get_visible_system(db: Session, system_id: str, user: Any) -> GameSystem:
    """The system for a GM/admin edit, or 404 when it is missing or hidden from ``user``.

    Edits reach only the systems the editor can see, so one outside their access
    answers exactly like an id that does not exist.
    """
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system or not access_control.can_access_system(
        db, access_control.load_user(db, user), system
    ):
        raise HTTPException(404, "System not found")
    return system


def visible_cover_id(db: Session, cover_book_id: str | None, user: Any) -> str | None:
    """``cover_book_id``, or None when it names a book ``user`` cannot see."""
    if not cover_book_id or access_control.sees_everything(user):
        return cover_book_id or None
    book = db.query(Book.id).filter(Book.id == cover_book_id)
    if access_control.visible_books(db, book, user).first() is not None:
        return cover_book_id
    # A dangling id is left as it was; only a book the user can't see is dropped.
    return cover_book_id if book.first() is None else None


def resolve_cover_book_id(db: Session, system: GameSystem, user: Any) -> str | None:
    """Return the system's cover book id, falling back to an auto-derived cover.

    Most systems don't have an explicit ``cover_book_id`` set, so we pick the
    first core book with a thumbnail (or any book with a thumbnail) — matching
    the cover shown in the systems list.

    Container folders (issues #261/#262) are shelves of systems, so one of their
    children's books is not a meaningful cover for them: an arbitrary game's
    front page would stand in for the whole collection. They show folder art or
    an uploaded image, or nothing.

    Variants are skipped: a printer-friendly or black-and-white cut is a poor
    stand-in for the whole game, and its parent is right there with the same
    artwork (issues #304, #306).

    Both the explicit and the automatic cover come only from books ``user`` can
    see, so the cover never shows one they could not open.
    """
    cover_book_id = visible_cover_id(db, system.cover_book_id, user)
    if system.container_kind:
        return cover_book_id
    if not cover_book_id:
        auto = (
            access_control.visible_books(
                db,
                variants.parents_only(
                    db.query(Book).filter_by(
                        game_system_id=system.id, category="core", has_thumbnail=True
                    ),
                    Book,
                ),
                user,
            )
            .order_by(Book.title)
            .first()
        )
        if not auto:
            auto = (
                access_control.visible_books(
                    db,
                    variants.parents_only(
                        db.query(Book).filter_by(game_system_id=system.id, has_thumbnail=True),
                        Book,
                    ),
                    user,
                )
                .order_by(Book.title)
                .first()
            )
        if auto:
            cover_book_id = auto.id
    return cover_book_id
