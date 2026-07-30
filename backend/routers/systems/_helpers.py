"""Shared helpers for the systems router."""
from ...models import Book


def resolve_cover_book_id(db, system) -> str | None:
    """Return the system's cover book id, falling back to an auto-derived cover.

    Most systems don't have an explicit ``cover_book_id`` set, so we pick the
    first core book with a thumbnail (or any book with a thumbnail) — matching
    the cover shown in the systems list.
    """
    cover_book_id = system.cover_book_id
    if not cover_book_id:
        auto = (
            db.query(Book)
            .filter_by(game_system_id=system.id, category="core", has_thumbnail=True)
            .order_by(Book.title)
            .first()
        )
        if not auto:
            auto = (
                db.query(Book)
                .filter_by(game_system_id=system.id, has_thumbnail=True)
                .order_by(Book.title)
                .first()
            )
        if auto:
            cover_book_id = auto.id
    return cover_book_id
