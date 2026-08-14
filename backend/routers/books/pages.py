"""Book page rendering, TOC, and text-extraction endpoint handlers."""
import io
import os
from pathlib import Path

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy import text as sql_text

import fitz  # type: ignore[import-untyped]
from PIL import Image  # type: ignore[import-untyped]

from ...auth import CurrentUser, get_current_user
from ...config import (
    _PAGE_CACHE_HEADERS,
    PAGE_CACHE_DIR,
    _valkey,
    get_db,
    logger,
    valkey_cache_set,
)
from ...file_cache import etag_matches
from ...models import Book
from ...services.content_cache import content_token, page_cache_prefix
from ._helpers import (
    _assert_book_access,
    _cached_book_info,
    _get_pdf_doc,
    note_page_render,
)


def _authorize_book(db: Session, book_id: str, user) -> None:
    """Look the book up and enforce read access before serving its content.

    Shared by the page/TOC/text/words routes, which otherwise serve content by
    bare id with no per-book authorisation. 404s a missing book so we don't leak
    which ids exist to a caller that couldn't read them anyway.
    """
    book = db.query(Book).filter_by(id=book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    _assert_book_access(db, book, user)


def get_book_toc(
    book_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    book = db.query(Book).filter_by(id=book_id).first()
    if not book or book.mime_type != "application/pdf":
        raise HTTPException(404)
    _assert_book_access(db, book, current_user)
    doc = fitz.open(book.filepath)
    raw = doc.get_toc(simple=True)
    doc.close()

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
    width: int = Query(1200, le=3000),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _authorize_book(db, book_id, current_user)
    book_info = _cached_book_info(book_id)
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

    if mime_type.startswith("image/"):
        if page_num != 1:
            raise HTTPException(400, "Image files have only one page")
        if not os.path.exists(filepath):
            book = db.query(Book).filter_by(id=book_id).first()
            if book and not book.is_missing:
                book.is_missing = True
                db.commit()
            raise HTTPException(404, "File not found on disk")
        ext = Path(filepath).suffix.lower().lstrip(".")
        media_type = f"image/{ext}" if ext not in ("jpg",) else "image/jpeg"
        return FileResponse(filepath, media_type=media_type, headers=cache_headers)

    if mime_type != "application/pdf":
        raise HTTPException(404)

    # The content token is part of the key: a replaced file renders under a new
    # key rather than hitting the previous file's entry.
    valkey_key = f"page:{book_id}:{token}:{page_num}:{width}"

    if _valkey is not None:
        try:
            cached = _valkey.get(valkey_key)
            if cached:
                return StreamingResponse(
                    io.BytesIO(cached), media_type="image/webp", headers=cache_headers
                )
        except Exception as e:
            logger.warning(f"Valkey get error: {e}")

    # Derive cache filename from the DB-sourced filepath (never user input)
    # so no tainted data touches the filesystem path.
    file_hash = page_cache_prefix(filepath)
    cache_path = os.path.join(PAGE_CACHE_DIR, f"{file_hash}_{token}_{page_num}_{width}.webp")
    if os.path.exists(cache_path):
        if _valkey is not None:
            try:
                with open(cache_path, "rb") as f:
                    valkey_cache_set(valkey_key, f.read())
            except OSError as e:
                logger.warning(f"Page cache read error: {e}")
        return FileResponse(cache_path, media_type="image/webp", headers=cache_headers)

    if not os.path.exists(filepath):
        book = db.query(Book).filter_by(id=book_id).first()
        if book and not book.is_missing:
            book.is_missing = True
            db.commit()
        raise HTTPException(404, "File not found on disk")
    doc = _get_pdf_doc(filepath)
    if page_num < 1 or page_num > len(doc):
        raise HTTPException(400, f"Page must be between 1 and {len(doc)}")
    page = doc[page_num - 1]
    zoom = width / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    buf = io.BytesIO()
    Image.frombytes("RGB", (pix.width, pix.height), pix.samples).save(
        buf, format="webp", quality=85, method=0
    )
    img_bytes = buf.getvalue()
    # Drop the pixmap before reclaiming so its buffer is part of what's freed.
    del pix
    note_page_render()

    # Fall back to the disk cache when Valkey is absent or the write failed, so
    # a Valkey outage degrades to the on-disk path instead of losing the render.
    if not valkey_cache_set(valkey_key, img_bytes):
        with open(cache_path, "wb") as f:
            f.write(img_bytes)

    return StreamingResponse(
        io.BytesIO(img_bytes), media_type="image/webp", headers=cache_headers
    )


def get_page_text(
    book_id: str,
    page_num: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _authorize_book(db, book_id, current_user)
    book_info = _cached_book_info(book_id)
    if not book_info or not book_info[1].startswith("application/"):
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
    doc = _get_pdf_doc(filepath)
    if page_num < 1 or page_num > len(doc):
        raise HTTPException(400, f"Page must be between 1 and {len(doc)}")
    return {"text": doc[page_num - 1].get_text("text").strip()}


def get_page_words(
    book_id: str,
    page_num: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _authorize_book(db, book_id, current_user)
    book_info = _cached_book_info(book_id)
    if not book_info or not book_info[1].startswith("application/"):
        return {"width": 0, "height": 0, "words": []}

    filepath = book_info[0]
    if not os.path.exists(filepath):
        raise HTTPException(404, "File not found on disk")
    doc = _get_pdf_doc(filepath)
    if page_num < 1 or page_num > len(doc):
        raise HTTPException(400, f"Page must be between 1 and {len(doc)}")

    page = doc[page_num - 1]
    rect = page.rect
    raw_words = page.get_text("words")
    return {
        "width": rect.width,
        "height": rect.height,
        "words": [
            {"x0": w[0], "y0": w[1], "x1": w[2], "y1": w[3], "text": w[4]} for w in raw_words
        ],
    }
