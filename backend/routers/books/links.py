"""A book's links onto other systems' shelves (issue #446).

A link shows one book on a second system's shelf without a second file - see
``services/book_links.py``. Linking changes where a book is listed, never who may
open it: the book's access level still resolves from its own system, so a GM may
link any book they can see onto any shelf they can see.
"""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_gm_or_admin
from ...config import get_db
from ...services import book_links
from ...services.systems import get_visible_system
from .._book_link_schemas import BookSystemLinkCreate
from ._helpers import get_visible_book


def list_book_systems(
    book_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The other systems the book appears in, as far as the caller can see."""
    book = get_visible_book(db, book_id, current_user)
    return book_links.linked_systems(db, book, current_user)


def add_book_system(
    book_id: str,
    data: BookSystemLinkCreate,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Show the book on another system's shelf too. Linking twice is a no-op."""
    book = get_visible_book(db, book_id, current_user)
    if book.variant_parent_id:
        # A version is listed through its main entry, never on a shelf itself.
        raise HTTPException(400, "Link the main version of this book instead")
    system = get_visible_system(db, data.system_id, current_user)
    try:
        book_links.add_link(db, book, system)
    except book_links.BookLinkError as e:
        raise HTTPException(400, str(e)) from e
    db.commit()
    return book_links.linked_systems(db, book, current_user)


def remove_book_system(
    book_id: str,
    system_id: str,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Take the book off another system's shelf. Its own shelf is unaffected."""
    book = get_visible_book(db, book_id, current_user)
    if not book_links.remove_link(db, book.id, system_id):
        raise HTTPException(404, "The book is not linked to that system")
    db.commit()
    return book_links.linked_systems(db, book, current_user)
