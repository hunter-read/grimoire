"""Fetching book metadata from installed add-ons (issue #203).

Mirrors the game-system flow and shares its helpers. Read-only: these endpoints
report what a source offers next to what the book already has, and never write.
Applying goes through ``PATCH /api/books/{id}``.
"""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_gm_or_admin
from ...config import get_db
from ...models import Book
from ...services import access_control
from .._metadata_lookup import fetch, list_sources, search
from ._schemas import MetadataFetch, MetadataSearch

TARGET = "book"


def _get_book(db: Session, book_id: str, user=None) -> Book:
    """Resolve a book, hiding one the caller may not see (issue #258).

    These routes are gm/admin-only, but "GM" is exactly the role an admin-only
    book is withheld from, so a GM must not be able to confirm one exists by
    asking what metadata sources it has. 404 for the same reason the read routes
    use it: a restricted book stays indistinguishable from a missing one.
    """
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    if user is not None and not access_control.can_access_book(
        db, access_control.load_user(db, user), book
    ):
        raise HTTPException(404, "Book not found")
    return book


def list_metadata_sources(
    book_id: str,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Add-ons currently able to supply metadata for books."""
    _get_book(db, book_id, current_user)
    return list_sources(db, TARGET)


def search_metadata(
    book_id: str,
    data: MetadataSearch,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Ranked candidates for this book from one source.

    An empty query defaults to the book's title.
    """
    book = _get_book(db, book_id, current_user)
    return search(db, data.source_id, data.query, fallback=book.title)


def fetch_metadata(
    book_id: str,
    data: MetadataFetch,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Fetch one candidate's fields and diff them against the book.

    Writes nothing. Applying is a separate, explicit PATCH.
    """
    book = _get_book(db, book_id, current_user)
    return fetch(
        db, book, "book", data.source_id, data.identity, data.query, data.paste
    )
