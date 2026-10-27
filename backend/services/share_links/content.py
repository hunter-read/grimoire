"""What a share link serves, and whether its creator may still serve it.

One place maps each shareable type to its table, its access check and its file,
so the public route, the management API and the owner's list all agree. The
access checks are the same ones the logged-in file routes use - the book access
level and explicit-content gate, the media explicit-content gate - applied to
the link's *creator*: a link can never hand out something its creator could not
open themselves today.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser
from ...indexer import archive_ext, archive_mime, is_vtt_data, slugify
from ...indexer.models3d import model_mime
from ...models import Audio, Book, GenericMap, Model3D, Token
from ...services.media.access import assert_media_access
from ...services.media.audio import AUDIO_MIME

_TABLES: dict[str, Any] = {
    "book": Book,
    "map": GenericMap,
    "token": Token,
    "audio": Audio,
    "model": Model3D,
}

# The API key permission each type is read under, for a link made with a key.
AREAS: dict[str, str] = {
    "book": "books",
    "map": "maps",
    "token": "tokens",
    "audio": "audio",
    "model": "models",
}

# A rendered PDF map page, as wide as the largest the map viewer asks for.
_PDF_MAP_WIDTH = 3000


@dataclass
class SharedFile:
    """The bytes a link serves: a path on disk, or content built in memory."""

    media_type: str
    path: Optional[str] = None
    content: Optional[bytes] = None


def load_record(db: Session, resource_type: str, resource_id: str) -> Any:
    """The item a link points at, or None if the type is unknown or it is gone."""
    table = _TABLES.get(resource_type)
    if table is None:
        return None
    return db.query(table).filter_by(id=resource_id).first()


def as_current_user(user: Any) -> CurrentUser:
    """A ``CurrentUser`` for an ORM ``User``, so the request-time checks apply."""
    return CurrentUser(id=user.id, username=user.username, role=user.role)


def assert_readable(db: Session, user: CurrentUser, resource_type: str, record: Any) -> None:
    """Raise 403 unless ``user`` may read ``record``'s content.

    Exactly the check the item's own ``/file`` route makes.
    """
    if resource_type == "book":
        from ...services.books.access import assert_book_access

        assert_book_access(db, record, user)
        return
    explicit = bool(getattr(record, "is_explicit", False)) if resource_type in (
        "token",
        "model",
    ) else False
    assert_media_access(db, user, resource_type, record.id, is_explicit=explicit)


def can_read(db: Session, user: Any, resource_type: str, record: Any) -> bool:
    """Whether the ORM ``User`` ``user`` can read ``record`` and it is on disk."""
    if user is None or record is None:
        return False
    try:
        assert_readable(db, as_current_user(user), resource_type, record)
    except HTTPException:
        return False
    return os.path.exists(record.filepath)


def display_name(resource_type: str, record: Any) -> str:
    """How the item is named to someone opening the link."""
    if record is None:
        return ""
    title = getattr(record, "title", None)
    if resource_type in ("book", "audio") and title:
        return str(title)
    return str(Path(record.filename).stem)


def _map_kind(record: Any) -> str:
    """``pdf``, ``vtt``, ``archive`` or ``file`` - what a map link serves."""
    if archive_ext(record.filename):
        return "archive"
    if Path(record.filepath).suffix.lower() == ".pdf":
        return "pdf"
    if is_vtt_data(record.filename):
        return "vtt"
    return "file"


def served_filename(resource_type: str, record: Any) -> str:
    """The filename a link's direct URL ends in, with the served extension.

    A PDF map serves its first page as WebP, and a ``.uvtt`` its embedded
    picture, so their links end in the extension of what actually arrives -
    some tools choose a decoder from the URL alone.
    """
    stem = slugify(Path(record.filename).stem) or resource_type
    ext = Path(record.filename).suffix.lower()
    if resource_type == "map":
        kind = _map_kind(record)
        if kind == "pdf":
            ext = ".webp"
        elif kind == "vtt":
            ext = _vtt_extension(record.filepath)
    return f"{stem}{ext}"


def _vtt_extension(filepath: str) -> str:
    from ...services.media.maps import sniff_image_mime, vtt_image_bytes

    try:
        mime = sniff_image_mime(vtt_image_bytes(filepath))
    except (ValueError, OSError):
        return ".png"
    return {"image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}.get(mime, ".png")


def served_media_type(resource_type: str, record: Any) -> str:
    """The content type a link serves, without building the content.

    The share page asks before anything is fetched; rendering a PDF map or
    decoding a ``.uvtt`` just to name its type would waste the work.
    """
    if resource_type == "map" and not archive_ext(record.filename):
        kind = _map_kind(record)
        if kind == "pdf":
            return "image/webp"
        if kind == "vtt":
            ext = Path(served_filename(resource_type, record)).suffix
            return {".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}.get(
                ext, "image/png"
            )
    if not os.path.exists(record.filepath):
        return "application/octet-stream"
    return shared_file(resource_type, record).media_type


def media_kind(resource_type: str, record: Any, mime: str) -> str:
    """How the share page should present the item: image, audio, video, pdf, model or file."""
    if resource_type == "model" and not archive_ext(record.filename):
        return "model"
    for kind in ("image", "audio", "video"):
        if mime.startswith(f"{kind}/"):
            return kind
    if mime == "application/pdf":
        return "pdf"
    return "file"


def shared_file(resource_type: str, record: Any) -> SharedFile:
    """What to serve for an item. 404s when its file is missing or unreadable."""
    if not os.path.exists(record.filepath):
        raise HTTPException(404, "Not found")
    arc = archive_ext(record.filename)
    if arc:
        return SharedFile(media_type=archive_mime(arc), path=record.filepath)

    if resource_type == "book":
        return SharedFile(media_type=record.mime_type or "application/pdf", path=record.filepath)

    if resource_type == "map":
        from ...services.media.maps import (
            map_media_type,
            sniff_image_mime,
            render_map_pdf_page,
            vtt_image_bytes,
        )

        kind = _map_kind(record)
        try:
            if kind == "pdf":
                raw = render_map_pdf_page(record.filepath, 1, _PDF_MAP_WIDTH)
                return SharedFile(media_type="image/webp", content=raw)
            if kind == "vtt":
                raw = vtt_image_bytes(record.filepath)
                return SharedFile(media_type=sniff_image_mime(raw), content=raw)
        except Exception:  # an unreadable PDF or envelope serves nothing
            raise HTTPException(404, "Not found") from None
        return SharedFile(media_type=map_media_type(record.filepath), path=record.filepath)

    if resource_type == "audio":
        ext = Path(record.filepath).suffix.lower()
        return SharedFile(
            media_type=AUDIO_MIME.get(ext, "application/octet-stream"), path=record.filepath
        )

    if resource_type == "model":
        return SharedFile(media_type=model_mime(record.filepath), path=record.filepath)

    # token
    ext = Path(record.filepath).suffix.lower().lstrip(".")
    media = {"jpg": "image/jpeg", "svg": "image/svg+xml"}.get(ext, f"image/{ext}")
    return SharedFile(media_type=media, path=record.filepath)


# --- Link variants -------------------------------------------------------------
# A variant serves a derived form of the item (issue #551). The access rules are
# the item's own either way; only what is served differs.

VARIANTS = ("otfbm",)


def link_media_type(link: Any, record: Any) -> str:
    """The content type a link serves, honouring its variant."""
    if link.variant == "otfbm":
        return "image/png" if (link.filename or "").endswith(".png") else "image/jpeg"
    return served_media_type(link.resource_type, record)


def link_file(link: Any, record: Any) -> SharedFile:
    """What a link serves, honouring its variant. 404s rather than 400s: to
    someone holding a link, a map that can no longer be resized is gone."""
    if link.variant == "otfbm":
        from ..media.map_export import otfbm_background

        try:
            _plan, raw, ext = otfbm_background(record, (link.variant_options or {}).get("cell"))
        except HTTPException:
            raise HTTPException(404, "Not found") from None
        return SharedFile(media_type="image/png" if ext == "png" else "image/jpeg", content=raw)
    return shared_file(link.resource_type, record)
