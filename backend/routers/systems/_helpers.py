"""Shared helpers for the systems router."""
from ...models import Book
from ...services import variants


def resolve_cover_book_id(db, system) -> str | None:
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
    """
    if system.container_kind:
        return system.cover_book_id or None
    cover_book_id = system.cover_book_id
    if not cover_book_id:
        auto = (
            variants.parents_only(
                db.query(Book).filter_by(
                    game_system_id=system.id, category="core", has_thumbnail=True
                ),
                Book,
            )
            .order_by(Book.title)
            .first()
        )
        if not auto:
            auto = (
                variants.parents_only(
                    db.query(Book).filter_by(game_system_id=system.id, has_thumbnail=True),
                    Book,
                )
                .order_by(Book.title)
                .first()
            )
        if auto:
            cover_book_id = auto.id
    return cover_book_id
