"""Zoom tiles: one square of a page rendered at a high zoom (issue #574).

A whole page can only be rendered so large before the image itself becomes the
problem: at 8x a 1600px page would be 12800px wide, a ~600 MB pixmap. Past the
point where the whole-page render stops being sharp, the reader instead asks
for the squares of the page that are on screen. Each is TILE_SIZE pixels at
most, so a tile costs the same few MB whatever the zoom.

``width`` is the width the *whole* page would be at this zoom; ``col``/``row``
pick a TILE_SIZE square of that virtual image, counted from the top left. Tiles
on the right and bottom edges are cut to what is left of the page.
"""
import os

from fastapi import Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import _PAGE_CACHE_HEADERS, PAGE_CACHE_DIR, get_db
from ...file_cache import etag_matches
from ...indexer.formats import is_fitz_mime
from ...services.content_cache import content_token, page_cache_prefix
from ...render import pool as render_pool
from ...render.ops import TILE_SIZE, tile_clip, tile_grid  # noqa: F401  re-exported
from ._helpers import _cached_book_info
from ._render_cache import render_errors, serve_cached_render
from .pages import _authorize_book, _mark_missing

# Virtual page widths come in steps of this, so a page has a bounded number of
# tile sets to cache rather than one per pixel of window width.
WIDTH_STEP = 256
MIN_WIDTH = WIDTH_STEP
MAX_WIDTH = 16384


def serve_book_page_tile(
    request: Request,
    book_id: str,
    page_num: int,
    width: int = Query(..., ge=MIN_WIDTH, le=MAX_WIDTH),
    col: int = Query(..., ge=0),
    row: int = Query(..., ge=0),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if width % WIDTH_STEP:
        raise HTTPException(400, f"width must be a multiple of {WIDTH_STEP}")
    _authorize_book(db, book_id, current_user)
    book_info = _cached_book_info(book_id)
    if not book_info:
        raise HTTPException(404)
    filepath, mime_type = book_info[0], book_info[1]
    # Images and comic pages are served as their original files, already at
    # full resolution; only rendered documents (PDF, EPUB, DjVu) have tiles.
    if not is_fitz_mime(mime_type):
        raise HTTPException(404, "Zoom tiles exist only for rendered document pages")

    token = content_token(book_info[3] if len(book_info) > 3 else None, filepath)
    etag = f'"{token}-{page_num}-{width}-t{col}-{row}"'
    if etag_matches(request, etag):
        return Response(status_code=304, headers={"ETag": etag, **_PAGE_CACHE_HEADERS})
    headers = {**_PAGE_CACHE_HEADERS, "ETag": etag}

    valkey_key = f"page:{book_id}:{token}:{page_num}:{width}:t{col}:{row}"
    file_hash = page_cache_prefix(filepath)
    cache_path = os.path.join(
        PAGE_CACHE_DIR, f"{file_hash}_{token}_{page_num}_{width}_t{col}_{row}.webp"
    )

    def render() -> bytes:
        if not os.path.exists(filepath):
            _mark_missing(db, book_id)
            raise HTTPException(404, "File not found on disk")
        with render_errors("This tile could not be rendered"):
            return render_pool.render_tile(filepath, page_num, width, col, row)

    return serve_cached_render(valkey_key, cache_path, headers, render)
