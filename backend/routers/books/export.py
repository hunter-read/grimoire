"""Exporting a book's pages and cut-outs (issue #207).

Anyone who can read a book can export from it - they can already download the
whole file. Saving the export back into the library writes to disk, so it is
admin-only like every other library write, and refused on a read-only mount.
"""
import os
from pathlib import Path

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_admin
from ...config import get_db
from ...indexer.formats import is_fitz_mime
from ...models import Book
from .._page_export import (
    ExportRequest,
    SaveExportRequest,
    detect_page_shapes,
    export_response,
    page_size,
    save_export,
)
from ...services.books.access import assert_book_access


def _exportable(db: Session, book_id: str, user: CurrentUser) -> Book:
    """The book, if the caller may read it and it has pages to export."""
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    assert_book_access(db, book, user)
    if not is_fitz_mime(book.mime_type):
        raise HTTPException(400, "This kind of file has no pages to export")
    if not os.path.exists(book.filepath):
        if not book.is_missing:
            book.is_missing = True
            db.commit()
        raise HTTPException(404, "File not found on disk")
    return book


def _title(book: Book) -> str:
    return book.title or Path(book.filename or "export").stem


def export_book(
    book_id: str,
    body: ExportRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    book = _exportable(db, book_id, current_user)
    return export_response(book.filepath, _title(book), body)


def save_book_export(
    book_id: str,
    body: SaveExportRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    book = _exportable(db, book_id, current_user)
    return save_export(book.filepath, _title(book), body)


def get_book_page_size(
    book_id: str,
    page_num: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    book = _exportable(db, book_id, current_user)
    return page_size(book.filepath, page_num)


def detect_book_page_shapes(
    book_id: str,
    page_num: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    book = _exportable(db, book_id, current_user)
    return detect_page_shapes(book.filepath, page_num)
