"""Shared helpers for book edit endpoints."""
from pathlib import Path

from fastapi import HTTPException

from ...models import Book
from ...models.access import rank
from ...services import access_control, library_fs


def get_visible_book(db, book_id: str, user) -> Book:
    """The book for a GM/admin edit, or 404 when it is missing or hidden from ``user``.

    Edits reach only the books the editor can see, so a book outside their
    access answers exactly like an id that does not exist.
    """
    book = db.query(Book).filter_by(id=book_id).first()
    if not book or not access_control.can_access_book(
        db, access_control.load_user(db, user), book
    ):
        raise HTTPException(404, "Book not found")
    return book


def keeps_access_level(db, book: Book, payload: dict, user) -> bool:
    """Whether an edit leaves ``book`` at least as restricted as it was.

    A new category can carry a different default level, so recategorising is
    also a way of changing who sees the book. Only admins choose who sees what;
    anyone else may move a book only to a level that is the same or stricter.
    """
    if getattr(user, "role", None) == "admin":
        return True
    category = payload.get("category")
    if category is None or category == book.category:
        return True
    before = access_control.resolve_level(db, book)
    # A detached stand-in, so the current row is not touched before the edit is
    # allowed.
    moved = Book(
        access_level=book.access_level,
        game_system_id=book.game_system_id,
        category=category,
        relative_path=_moved_relative_path(db, book),
    )
    return rank(access_control.resolve_level(db, moved)) >= rank(before)


def _moved_relative_path(db, book: Book) -> str:
    """Where a recategorised book is judged to land, for its folder rules (issue #772).

    A category change moves the file to another folder under its system, which
    can take it out from under a folder rule. The exact destination is decided
    after the check, so the stand-in sits at the system folder itself: every
    destination is beneath it, so the rules covering it are ones the book keeps
    wherever it lands. With no system folder it is judged with no folder at all.
    Both err towards refusing, never towards letting a book out of a rule.
    """
    if not book.filepath:
        return ""
    try:
        root = library_fs.system_root_for(db, Path(book.filepath))
        return f"{library_fs.to_relative(root)}/{book.filename}" if root is not None else ""
    except ValueError:  # a file outside the library
        return ""


# Shared by the single and bulk book edits so both refuse with the same words.
LEVEL_KEPT_DETAIL = "Only admins can make a book visible to more people"

