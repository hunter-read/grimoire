"""Resolve an image already in Grimoire to raw bytes (issue #286).

Banners, system covers, and audio covers can all be set from an asset the server
already holds instead of a fresh upload from the user's device. Each of those
features stores a *copy* of the chosen bytes in its own directory (option 1 in
issue #286), so `banner_path` / `cover_image` semantics and the GET endpoints
stay exactly as they were, and the result survives the source being deleted or
the library being reorganised.

Everything those features need in common lives here: the closed set of source
types, the per-type byte loader, and the authorisation gate. Callers pass the
requesting user, so the picker can never become a way to read an asset the user
could not already open through the maps/tokens/books views.
"""

import glob
import hashlib
import io
import os
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..config import THUMB_DIR
from ..indexer import archive_ext, slugify
from ..models import Audio, Book, CampaignFile, GenericMap, Token

# Source kinds the picker may reference. "campaign_file" is scoped to one
# campaign and is only offered where a campaign is in context (the banner).
SOURCE_TYPES = ("map", "token", "book", "audio", "campaign_file")

# Image extensions we are willing to read straight off the library. Anything
# else (a PDF map, an archive) resolves through its generated thumbnail instead.
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"}

# Ceiling on a single source read. Library art can be very large; this bounds
# the memory one request can take while still admitting real battle maps.
MAX_SOURCE_BYTES = 60 * 1024 * 1024


def _read(path: str) -> bytes:
    """Read a resolved source file, refusing anything past the size ceiling."""
    try:
        if os.path.getsize(path) > MAX_SOURCE_BYTES:
            raise HTTPException(413, "Source image is too large")
        with open(path, "rb") as f:
            return f.read()
    except HTTPException:
        raise
    except OSError:
        raise HTTPException(404, "Source image could not be read") from None


def _media_thumb_path(kind: str, filename: str, filepath: str) -> str:
    """Rebuild the indexer's thumbnail path for a map or token.

    Thumbnails are written as ``{slugify(stem)}_{md5(filepath)[:8]}.webp`` under
    ``THUMB_DIR/{kind}s`` — mirrors `serve_map_thumbnail`.
    """
    title = Path(filename).stem.replace("_", " ").replace("-", " ")
    fhash = hashlib.md5(filepath.encode()).hexdigest()[:8]
    return os.path.join(THUMB_DIR, f"{kind}s", f"{slugify(title)}_{fhash}.webp")


def _book_thumb_path(book: Book) -> Optional[str]:
    """Locate a book's cover thumbnail, falling back to the hash glob.

    Same two-step lookup the book thumbnail endpoint uses: the filename is
    derived from the title at index time, so a renamed book only matches on the
    path hash.
    """
    fhash = hashlib.md5(book.filepath.encode()).hexdigest()[:8]
    thumb_dir = os.path.join(THUMB_DIR, "books")
    expected = os.path.join(thumb_dir, f"{slugify(book.title)}_{fhash}.webp")
    if os.path.isfile(expected):
        return expected
    matches = glob.glob(os.path.join(thumb_dir, f"*_{fhash}.webp"))
    return matches[0] if matches else None


def _media_bytes(kind: str, item: Any) -> bytes:
    """Bytes for a map or token: the original when it is a plain image, else
    the generated thumbnail (PDF maps and archives have no readable image)."""
    filepath = item.filepath or ""
    ext = Path(filepath).suffix.lower()
    is_plain_image = ext in _IMAGE_EXTS and not archive_ext(item.filename or "")
    if is_plain_image and os.path.isfile(filepath):
        return _read(filepath)
    thumb = _media_thumb_path(kind, item.filename or "", filepath)
    if os.path.isfile(thumb):
        return _read(thumb)
    raise HTTPException(404, "Source image is not available")


def load_source_image(
    db: Session,
    user: Any,
    source_type: str,
    source_id: str,
    *,
    campaign_id: Optional[str] = None,
) -> bytes:
    """Return the raw bytes of an existing Grimoire image, or raise.

    Authorises `user` against the same rules the asset's own content route
    applies, so choosing an image through a picker grants no access the user did
    not already have. `campaign_id` is required for `campaign_file` sources and
    scopes the lookup to that campaign.

    Raises HTTPException(400) for an unknown type, 404 when the asset or its
    image is missing, and 403 when the user may not read it.
    """
    from ..routers._media_access import assert_media_access

    if source_type not in SOURCE_TYPES:
        raise HTTPException(400, f"Unsupported image source: {source_type}")

    if source_type == "campaign_file":
        if not campaign_id:
            raise HTTPException(400, "A campaign is required for a campaign_file source")
        cf = db.query(CampaignFile).filter_by(id=source_id, campaign_id=campaign_id).first()
        if not cf:
            raise HTTPException(404, "File not found")
        if not cf.is_image:
            raise HTTPException(400, "That file is not an image")
        # The caller has already proven it may manage this campaign, which is a
        # superset of being able to read the campaign's own files.
        from ..config import CAMPAIGN_UPLOAD_DIR

        path = os.path.join(CAMPAIGN_UPLOAD_DIR, "files", os.path.basename(cf.stored_path))
        if not os.path.isfile(path):
            raise HTTPException(404, "File not found")
        return _read(path)

    if source_type == "book":
        book = db.query(Book).filter_by(id=source_id).first()
        if not book:
            raise HTTPException(404, "Book not found")
        from ..routers.books._helpers import _assert_book_access

        _assert_book_access(db, book, user)
        thumb = _book_thumb_path(book)
        if not thumb:
            raise HTTPException(404, "That book has no cover thumbnail")
        return _read(thumb)

    if source_type == "audio":
        a = db.query(Audio).filter_by(id=source_id).first()
        if not a:
            raise HTTPException(404, "Audio not found")
        assert_media_access(db, user, "audio", a.id)
        from ..routers.audio.core import _extract_embedded_art, _find_folder_artwork

        cover = _find_folder_artwork(os.path.dirname(a.filepath or ""))
        if cover and os.path.isfile(cover):
            return _read(cover)
        embedded = _extract_embedded_art(a.filepath or "")
        if embedded and embedded[0]:
            return embedded[0]
        raise HTTPException(404, "That track has no artwork")

    model = GenericMap if source_type == "map" else Token
    item = db.query(model).filter_by(id=source_id).first()
    if not item:
        raise HTTPException(404, "Source not found")
    assert_media_access(db, user, source_type, item.id)
    return _media_bytes(source_type, item)


def source_ext(data: bytes) -> str:
    """Extension matching the decoded format of source bytes, defaulting to PNG.

    A source image arrives in whatever format the library holds it in, and the
    stored filename only has to describe these bytes for the serving handler.
    """
    from PIL import Image

    try:
        fmt = (Image.open(io.BytesIO(data)).format or "").upper()
    except Exception:
        fmt = ""
    return {"JPEG": ".jpg", "WEBP": ".webp", "GIF": ".gif", "PNG": ".png"}.get(fmt, ".png")


def validate_image(data: bytes) -> None:
    """Verify bytes really decode as an image (reject disguised files)."""
    from PIL import Image

    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception:
        raise HTTPException(400, "File is not a valid image") from None
