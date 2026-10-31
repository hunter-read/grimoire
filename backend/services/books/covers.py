"""A cover uploaded for one book, in place of its generated thumbnail.

A book's cover is normally a render of its first page, made by the scanner and
kept under ``THUMB_DIR/books/``. That fails for some books: a fixed-layout EPUB
renders blank, and a PDF whose first page is a wraparound dust jacket or a
rotated scan makes a poor cover. An admin can upload a replacement, which is
stored here and wins everywhere the book's cover is used - the thumbnail route
(and so every grid), OPDS, the image picker, the exported sidecar cover, and the
cover sent to Grimoire Codex DB.

Custom covers live in their own directory, ``DATA_PATH/book_covers/``, rather
than beside the thumbnails: everything under ``thumbnails/`` is derived and a
scan may regenerate or delete it, while these were chosen by a person and no
scan can rebuild them. They are included in backups for the same reason.

Each file is named ``{book_id}_{digest}.webp``, where the digest is of the
stored bytes. The name is what ``Book.cover_image`` holds, so the digest is
known without touching the disk and serves as the cover's version: it goes into
the thumbnail's ETag and the cache-busting ``v`` the UI appends, which is how a
browser holding the old cover (cached ``immutable``) comes to ask for the new one.
"""
import glob
import hashlib
import io
import os
import tempfile
import time
from typing import Optional

from sqlalchemy.orm import Session

from ...config import BOOK_COVER_DIR, THUMB_DIR, logger
from ...indexer import slugify
from ...models import Book
from ..upload_images import UPLOAD_IMAGE_FORMATS, open_upload_image

# Large enough to be a good cover on a catalogue page - it matches the width the
# Grimoire Codex DB cover push renders a first page at - and small enough that a
# grid of them stays light. Taller images are bounded at twice the width.
COVER_MAX_WIDTH = 900
COVER_MAX_HEIGHT = COVER_MAX_WIDTH * 2
_WEBP_QUALITY = 85
# Files younger than this are left alone by the orphan sweep: an upload writes
# its file before the row naming it is committed.
_PRUNE_GRACE_SECONDS = 300


class CoverImageError(ValueError):
    """The bytes given for a cover are not an image that can be used."""


def custom_cover_path(book: Book) -> Optional[str]:
    """On-disk path of the book's uploaded cover, or None when it has none."""
    name = book.cover_image or ""
    if not name:
        return None
    # Stored as a bare filename; never join a stored path segment as-is.
    candidate = os.path.join(BOOK_COVER_DIR, os.path.basename(name))
    return candidate if os.path.isfile(candidate) else None


def has_custom_cover(book: Book) -> bool:
    """Whether a cover has been uploaded for the book (from the row; no disk read)."""
    return bool(book.cover_image)


def cover_version(book: Book) -> Optional[str]:
    """Short token that changes whenever the custom cover does; None without one.

    Read from the stored filename, so it costs no disk access and a list view can
    send it for every row.
    """
    name = os.path.basename(book.cover_image or "")
    if not name:
        return None
    stem = os.path.splitext(name)[0]
    return stem.rsplit("_", 1)[-1]


def generated_thumbnail_path(book: Book) -> Optional[str]:
    """The thumbnail the scanner generated for the book, or None.

    Thumbnails are written at index time as ``{slugify(title)}_{fhash}.webp``.
    Rebuilding that name is far cheaper than a glob over a large thumbnail
    directory, so the glob on the path hash is only the fallback for a book whose
    title has changed since it was indexed.
    """
    fhash = hashlib.md5(book.filepath.encode()).hexdigest()[:8]
    thumb_dir = os.path.join(THUMB_DIR, "books")
    expected = os.path.join(thumb_dir, f"{slugify(book.title)}_{fhash}.webp")
    if os.path.isfile(expected):
        return expected
    matches = glob.glob(os.path.join(thumb_dir, f"*_{fhash}.webp"))
    return matches[0] if matches else None


def book_cover_path(book: Book) -> Optional[str]:
    """The image to show as the book's cover: its custom cover, else its thumbnail."""
    return custom_cover_path(book) or generated_thumbnail_path(book)


def encode_cover(data: bytes, formats: Optional[tuple[str, ...]] = UPLOAD_IMAGE_FORMATS) -> bytes:
    """Re-encode image bytes as a cover-sized WebP.

    Re-encoding rather than storing the upload as-is gives every consumer one
    format (the thumbnail route serves WebP), applies a photo's EXIF rotation,
    drops its metadata, and keeps an oversized image from being served to every
    grid. Raises :class:`CoverImageError` when the bytes do not decode as an image
    in ``formats`` (``None`` for any format Pillow reads), or are too large to.
    """
    from PIL import Image, ImageOps

    try:
        with open_upload_image(data, formats) as source:
            source.load()
            img = ImageOps.exif_transpose(source) or source
            has_alpha = img.mode in ("RGBA", "LA") or (
                img.mode == "P" and "transparency" in img.info
            )
            img = img.convert("RGBA" if has_alpha else "RGB")
        img.thumbnail((COVER_MAX_WIDTH, COVER_MAX_HEIGHT))
        out = io.BytesIO()
        img.save(out, "WEBP", quality=_WEBP_QUALITY)
        return out.getvalue()
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as exc:
        raise CoverImageError("File is not a valid image") from exc


def _write_atomic(path: str, data: bytes) -> None:
    """Write ``data`` to ``path`` so a reader never sees a half-written cover."""
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".upload-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def remove_cover_files(book_id: str, keep: Optional[str] = None) -> int:
    """Delete every stored cover file for ``book_id`` except ``keep``; return how many."""
    if not book_id or not os.path.isdir(BOOK_COVER_DIR):
        return 0
    removed = 0
    for name in os.listdir(BOOK_COVER_DIR):
        if name == keep or name.split("_", 1)[0] != book_id:
            continue
        try:
            os.remove(os.path.join(BOOK_COVER_DIR, name))
            removed += 1
        except OSError as e:
            logger.warning("Failed to remove book cover %s: %s", name, e)
    return removed


def store_cover(
    book: Book, data: bytes, formats: Optional[tuple[str, ...]] = UPLOAD_IMAGE_FORMATS
) -> str:
    """Encode and store a custom cover for ``book`` and point the row at it.

    The caller commits. The new file is written before the old one is removed,
    so the book always has a cover file to serve while the swap happens.
    """
    encoded = encode_cover(data, formats)
    digest = hashlib.sha256(encoded).hexdigest()[:12]
    filename = f"{book.id}_{digest}.webp"
    os.makedirs(BOOK_COVER_DIR, exist_ok=True)
    _write_atomic(os.path.join(BOOK_COVER_DIR, filename), encoded)
    remove_cover_files(book.id, keep=filename)
    book.cover_image = filename
    return filename


def clear_cover(book: Book) -> None:
    """Remove the book's custom cover; its generated thumbnail takes over. The caller commits."""
    remove_cover_files(book.id)
    book.cover_image = ""


def prune_orphan_covers(db: Session) -> int:
    """Delete stored covers no book names any more; return how many went.

    Most delete paths remove a book's cover with the row, but a system deleted
    with its books cascades through the ORM and never passes through them, so
    the library cleanup collects whatever is left here.
    """
    if not os.path.isdir(BOOK_COVER_DIR):
        return 0
    in_use = {
        name
        for (name,) in db.query(Book.cover_image).filter(Book.cover_image != "").all()
        if name
    }
    cutoff = time.time() - _PRUNE_GRACE_SECONDS
    removed = 0
    for name in os.listdir(BOOK_COVER_DIR):
        if name in in_use:
            continue
        path = os.path.join(BOOK_COVER_DIR, name)
        try:
            if not os.path.isfile(path) or os.path.getmtime(path) > cutoff:
                continue
            os.remove(path)
            removed += 1
        except OSError as e:
            logger.warning("Failed to remove orphaned book cover %s: %s", name, e)
    if removed:
        logger.info("Cleanup: removed %d orphaned book cover(s)", removed)
    return removed
