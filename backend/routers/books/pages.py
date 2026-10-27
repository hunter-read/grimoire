"""Book page rendering, TOC, and text-extraction endpoint handlers."""
import os
from pathlib import Path

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from fastapi.responses import Response
from sqlalchemy import text as sql_text


from .._user_files import serve_user_file
from ...auth import CurrentUser, get_current_user
from ...config import _PAGE_CACHE_HEADERS, PAGE_CACHE_DIR, get_db
from ...file_cache import etag_matches
from ...indexer import comics, text_documents
from ...indexer.formats import (
    TEXT_MIMES,
    can_index,
    is_comic_path,
    is_fitz_mime,
)
from ...indexer.thumbnails import archive_ext
from ...models import Book
from ...services.content_cache import content_token, page_cache_prefix
from ...render import pool as render_pool
from ...render.ops import MIN_RENDER_WIDTH
from ...services.books.access import assert_book_access
from ...services.books.documents import cached_book_info
from ._render_cache import serve_cached_render
from .._render_errors import render_errors


def _mark_missing(db: Session, book_id: str) -> None:
    """Flag a book whose file has vanished from disk, so the UI can show it."""
    book = db.query(Book).filter_by(id=book_id).first()
    if book and not book.is_missing:
        book.is_missing = True
        db.commit()


def _authorize_book(db: Session, book_id: str, user) -> None:
    """Look the book up and enforce read access before serving its content.

    Shared by the page/TOC/text/words routes, which otherwise serve content by
    bare id with no per-book authorisation. 404s a missing book so we don't leak
    which ids exist to a caller that couldn't read them anyway.
    """
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    assert_book_access(db, book, user)


def get_book_toc(
    book_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    book = db.query(Book).filter_by(id=book_id).first()
    # EPUB carries a real TOC (its spine/nav document) and PyMuPDF exposes it
    # through the same API as a PDF outline (issue #373).
    if not book or not is_fitz_mime(book.mime_type):
        raise HTTPException(404)
    assert_book_access(db, book, current_user)
    # Not `get_toc` directly: MuPDF drops the whole outline over one bookmark
    # it can't resolve, which left books with a perfectly usable TOC showing none
    # (see render/outline.py). Read in a render worker, like the pages.
    with render_errors("The table of contents could not be read"):
        raw = render_pool.document_toc(book.filepath)

    def build_tree(items, min_level):
        result = []
        i = 0
        while i < len(items):
            level, title, page = items[i]
            if level < min_level:
                break
            if level == min_level:
                node = {"title": title, "page": page, "level": level, "children": []}
                j = i + 1
                while j < len(items) and items[j][0] > min_level:
                    j += 1
                node["children"] = build_tree(items[i + 1 : j], min_level + 1)
                result.append(node)
                i = j
            else:
                i += 1
        return result

    min_lvl = min((r[0] for r in raw), default=1)
    return {"toc": build_tree(raw, min_lvl)}


def serve_book_page(
    request: Request,
    book_id: str,
    page_num: int,
    width: int = Query(1200, ge=MIN_RENDER_WIDTH, le=3000),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _authorize_book(db, book_id, current_user)
    book_info = cached_book_info(book_id)
    if not book_info:
        raise HTTPException(404)
    filepath, mime_type = book_info[0], book_info[1]
    # Token over the file's *contents*, so replacing the PDF changes every cache
    # key and ETag derived from it. Falls back to a path digest for rows the
    # scanner has not hashed yet, preserving the previous behaviour for them.
    token = content_token(book_info[3] if len(book_info) > 3 else None, filepath)
    etag = f'"{token}-{page_num}-{width}"'
    if etag_matches(request, etag):
        return Response(status_code=304, headers={"ETag": etag, **_PAGE_CACHE_HEADERS})
    cache_headers = {**_PAGE_CACHE_HEADERS, "ETag": etag}

    # DjVu carries an image/* MIME type but is a multi-page document PyMuPDF
    # renders page by page, so it must not be short-circuited here (issue #373).
    if mime_type.startswith("image/") and not is_fitz_mime(mime_type):
        if page_num != 1:
            raise HTTPException(400, "Image files have only one page")
        if not os.path.exists(filepath):
            _mark_missing(db, book_id)
            raise HTTPException(404, "File not found on disk")
        ext = Path(filepath).suffix.lower().lstrip(".")
        media_type = f"image/{ext}" if ext not in ("jpg",) else "image/jpeg"
        return serve_user_file(filepath, media_type, headers=cache_headers)

    # A comic archive's page is an image member inside the archive; serve it
    # directly rather than rendering it (issue #180).
    if is_comic_path(filepath):
        if not os.path.exists(filepath):
            _mark_missing(db, book_id)
            raise HTTPException(404, "File not found on disk")
        page = comics.read_page(filepath, archive_ext(filepath), page_num)
        if page is None:
            raise HTTPException(404, "Page not found in archive")
        data, page_media_type = page
        return Response(content=data, media_type=page_media_type, headers=cache_headers)

    if not is_fitz_mime(mime_type):
        raise HTTPException(404)

    # The content token is part of the key: a replaced file renders under a new
    # key rather than hitting the previous file's entry. The cache filename is
    # derived from the DB-sourced filepath (never user input), so no tainted
    # data touches the filesystem path.
    valkey_key = f"page:{book_id}:{token}:{page_num}:{width}"
    file_hash = page_cache_prefix(filepath)
    cache_path = os.path.join(PAGE_CACHE_DIR, f"{file_hash}_{token}_{page_num}_{width}.webp")

    def render() -> bytes:
        if not os.path.exists(filepath):
            _mark_missing(db, book_id)
            raise HTTPException(404, "File not found on disk")
        with render_errors():
            return render_pool.render_page(filepath, page_num, width)

    return serve_cached_render(valkey_key, cache_path, cache_headers, render)


def get_page_text(
    book_id: str,
    page_num: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _authorize_book(db, book_id, current_user)
    book_info = cached_book_info(book_id)
    # Ask the format table rather than testing for an "application/" MIME
    # prefix: text/plain and text/markdown books carry readable text too, and
    # the prefix check silently excluded them (issues #200/#373).
    if not book_info or not can_index(book_info[1]):
        raise HTTPException(404)

    row = db.execute(
        sql_text(
            "SELECT content FROM book_search WHERE book_id = :bid AND page_number = :pnum LIMIT 1"
        ),
        {"bid": book_id, "pnum": page_num},
    ).fetchone()
    if row is not None:
        return {"text": row[0] or ""}

    filepath = book_info[0]
    if not os.path.exists(filepath):
        raise HTTPException(404, "File not found on disk")
    # A text document has no rendered page to read back from — its text lives
    # only in the FTS rows checked above, or in the file itself (issue #200).
    if book_info[1] in TEXT_MIMES:
        pages = text_documents.extract_text_pages(filepath)
        if page_num < 1 or page_num > len(pages):
            raise HTTPException(400, f"Page must be between 1 and {len(pages)}")
        return {"text": pages[page_num - 1]["content"]}
    if not is_fitz_mime(book_info[1]):
        raise HTTPException(404)
    with render_errors("This page's text could not be read"):
        return {"text": render_pool.page_text(filepath, page_num)}


def get_page_words(
    book_id: str,
    page_num: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _authorize_book(db, book_id, current_user)
    book_info = cached_book_info(book_id)
    # Word boxes exist only for rendered documents; anything else gets an empty
    # overlay rather than an error.
    if not book_info or not is_fitz_mime(book_info[1]):
        return {"width": 0, "height": 0, "words": []}

    filepath = book_info[0]
    if not os.path.exists(filepath):
        raise HTTPException(404, "File not found on disk")
    # Word boxes only exist for rendered documents. Text books and comics have
    # no page geometry, so they get an empty overlay rather than a 500.
    if not is_fitz_mime(book_info[1]):
        return {"width": 0, "height": 0, "words": []}
    with render_errors("This page's words could not be read"):
        return render_pool.page_words(filepath, page_num)
