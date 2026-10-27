"""The cover image a book or system sends to Grimoire Codex DB.

A book's cover is its first page, rendered larger than the 300px library
thumbnail so it is worth showing on a catalogue page; formats PyMuPDF cannot
render (comics, images, audio) send their thumbnail. A system sends the cover
it shows in the library: its folder art or uploaded image, else the cover of
the book standing in for it.

Grimoire Codex DB takes PNG, JPEG, WebP, GIF and AVIF up to 5 MB, so anything
else (or anything larger) is re-encoded as WebP first.
"""
import hashlib
import io
import os
from typing import Optional, Union

from PIL import Image
from sqlalchemy.orm import Session

from ...config import logger
from ...indexer.formats import is_fitz_mime
from ...models import Book, GameSystem
from ...render import pool as render_pool
from ...render.ops import PageOutOfRange, RenderError
from ..books.core import book_thumbnail_path
from ...services.systems import resolve_cover_book_id
from ..systems.covers import resolve_cover_file

# Wide enough for a sharp catalogue cover, small enough to stay well under the upload limit.
COVER_WIDTH = 900
_MAX_BYTES = 4 * 1024 * 1024
_ACCEPTED = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
}


class Cover:
    """Image bytes ready to upload, with the hash Grimoire Codex DB will key them by."""

    def __init__(self, data: bytes, content_type: str) -> None:
        self.data = data
        self.content_type = content_type
        self.sha256 = hashlib.sha256(data).hexdigest()


def _read(path: str) -> Optional[Cover]:
    """``path`` as an uploadable image, re-encoded as WebP when it has to be."""
    ext = os.path.splitext(path)[1].lower()
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError:
        return None
    if ext in _ACCEPTED and len(data) <= _MAX_BYTES:
        return Cover(data, _ACCEPTED[ext])
    try:
        with Image.open(io.BytesIO(data)) as source:
            img = source.convert("RGBA" if source.mode in ("RGBA", "LA", "P") else "RGB")
        img.thumbnail((COVER_WIDTH * 2, COVER_WIDTH * 3))
        out = io.BytesIO()
        img.save(out, "WEBP", quality=85)
    except (OSError, ValueError, Image.DecompressionBombError):
        # SVG and anything else Pillow cannot read: no cover rather than a broken one.
        return None
    return Cover(out.getvalue(), "image/webp")


def _book_cover(book: Book) -> Optional[Cover]:
    if book.filepath and is_fitz_mime(book.mime_type) and os.path.isfile(book.filepath):
        try:
            return Cover(render_pool.render_page(book.filepath, 1, COVER_WIDTH, count=False), "image/webp")
        except (PageOutOfRange, RenderError) as exc:
            logger.warning("Could not render a Codex cover for book %s: %s", book.id, exc)
    thumb = book_thumbnail_path(book)
    return _read(thumb) if thumb else None


def local_cover(db: Session, resource: Union[Book, GameSystem], user: object) -> Optional[Cover]:
    """The cover ``resource`` would send, or None when it has none."""
    if isinstance(resource, Book):
        return _book_cover(resource)
    path = resolve_cover_file(resource)
    if path:
        return _read(path)
    book_id = resolve_cover_book_id(db, resource, user)
    book = db.get(Book, book_id) if book_id else None
    return _book_cover(book) if book else None
