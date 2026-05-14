"""Book page rendering, TOC, and text-extraction endpoint handlers."""
import hashlib
import io
import os
from pathlib import Path

from fastapi import HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import text as sql_text

import fitz  # type: ignore[import-untyped]
from PIL import Image  # type: ignore[import-untyped]

from ...config import _PAGE_CACHE_HEADERS, PAGE_CACHE_DIR, SessionLocal, _valkey, logger
from ...models import Book
from ._helpers import _cached_book_info, _get_pdf_doc


def get_book_toc(book_id: str):
    db = SessionLocal()
    try:
        book = db.query(Book).filter_by(id=book_id).first()
        if not book or book.mime_type != "application/pdf":
            raise HTTPException(404)
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
    finally:
        db.close()


def serve_book_page(book_id: str, page_num: int, width: int = Query(1200, le=3000)):
    book_info = _cached_book_info(book_id)
    if not book_info:
        raise HTTPException(404)
    filepath, mime_type = book_info[0], book_info[1]

    if mime_type.startswith("image/"):
        if page_num != 1:
            raise HTTPException(400, "Image files have only one page")
        if not os.path.exists(filepath):
            db = SessionLocal()
            try:
                book = db.query(Book).filter_by(id=book_id).first()
                if book and not book.is_missing:
                    book.is_missing = True
                    db.commit()
            finally:
                db.close()
            raise HTTPException(404, "File not found on disk")
        ext = Path(filepath).suffix.lower().lstrip(".")
        media_type = f"image/{ext}" if ext not in ("jpg",) else "image/jpeg"
        return FileResponse(filepath, media_type=media_type, headers=_PAGE_CACHE_HEADERS)

    if mime_type != "application/pdf":
        raise HTTPException(404)

    valkey_key = f"page:{book_id}:{page_num}:{width}"

    if _valkey is not None:
        try:
            cached = _valkey.get(valkey_key)
            if cached:
                return StreamingResponse(
                    io.BytesIO(cached), media_type="image/webp", headers=_PAGE_CACHE_HEADERS
                )
        except Exception as e:
            logger.warning(f"Valkey get error: {e}")

    # Derive cache filename from the DB-sourced filepath (never user input)
    # so no tainted data touches the filesystem path.
    file_hash = hashlib.sha1(filepath.encode()).hexdigest()[:16]
    cache_path = os.path.join(PAGE_CACHE_DIR, f"{file_hash}_{page_num}_{width}.webp")
    if os.path.exists(cache_path):
        if _valkey is not None:
            try:
                with open(cache_path, "rb") as f:
                    _valkey.set(valkey_key, f.read())
            except Exception as e:
                logger.warning(f"Valkey set error: {e}")
        return FileResponse(cache_path, media_type="image/webp", headers=_PAGE_CACHE_HEADERS)

    if not os.path.exists(filepath):
        db = SessionLocal()
        try:
            book = db.query(Book).filter_by(id=book_id).first()
            if book and not book.is_missing:
                book.is_missing = True
                db.commit()
        finally:
            db.close()
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

    if _valkey is not None:
        try:
            _valkey.set(valkey_key, img_bytes)
        except Exception as e:
            logger.warning(f"Valkey set error: {e}")
            with open(cache_path, "wb") as f:
                f.write(img_bytes)
    else:
        with open(cache_path, "wb") as f:
            f.write(img_bytes)

    return StreamingResponse(
        io.BytesIO(img_bytes), media_type="image/webp", headers=_PAGE_CACHE_HEADERS
    )


def get_page_text(book_id: str, page_num: int):
    book_info = _cached_book_info(book_id)
    if not book_info or not book_info[1].startswith("application/"):
        raise HTTPException(404)

    db = SessionLocal()
    try:
        row = db.execute(
            sql_text(
                "SELECT content FROM book_search WHERE book_id = :bid AND page_number = :pnum LIMIT 1"
            ),
            {"bid": book_id, "pnum": page_num},
        ).fetchone()
    finally:
        db.close()
    if row is not None:
        return {"text": row[0] or ""}

    filepath = book_info[0]
    if not os.path.exists(filepath):
        raise HTTPException(404, "File not found on disk")
    doc = _get_pdf_doc(filepath)
    if page_num < 1 or page_num > len(doc):
        raise HTTPException(400, f"Page must be between 1 and {len(doc)}")
    return {"text": doc[page_num - 1].get_text("text").strip()}


def get_page_words(book_id: str, page_num: int):
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
