"""System cover art — serve, upload, and delete.

A system's cover resolves through three sources, in precedence order:

1. ``folder_cover_path`` — a ``cover.*``/``folder.*`` image sitting at the
   system's folder root, found by the scanner. Library-managed, so it wins.
2. ``cover_image`` — an image uploaded through the UI, stored under
   ``DATA_PATH/system_covers/``.
3. A book thumbnail from inside the system (handled by ``resolve_cover_book_id``).

The first two are served by ``serve_system_cover`` here; the third is a plain
book-thumbnail URL the client builds from ``cover_book_id``. Container folders
(issues #261/#262) hold no books of their own, so 1 and 2 are the only way they
get art — which is why upload matters for them specifically.
"""
import io
import os

from fastapi import Depends, File, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_gm_or_admin
from ...config import LIBRARY_PATH, SYSTEM_COVER_DIR, get_db, logger
from ...file_cache import cached_file_response
from ...models import GameSystem
from ._schemas import SystemCoverSourceIn

_IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_MAX_COVER_BYTES = 10 * 1024 * 1024  # 10 MB

_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".svg": "image/svg+xml",
}


def _get_system_or_404(db: Session, system_id: str) -> GameSystem:
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system:
        raise HTTPException(404, "System not found")
    return system


def resolve_cover_file(system: GameSystem) -> str | None:
    """Return the on-disk path of the system's cover image, or None.

    Folder art (scanner-found, library-managed) takes precedence over an
    uploaded cover, matching the precedence documented on the model.
    """
    folder_rel = system.folder_cover_path or ""
    if folder_rel:
        # Stored library-relative so it survives the library dir being moved.
        root = os.path.abspath(LIBRARY_PATH)
        candidate = os.path.abspath(os.path.join(root, folder_rel))
        # Defence in depth: a stored path must never escape the library root.
        within = os.path.commonpath([root, candidate]) == root
        if within and os.path.isfile(candidate):
            return candidate
    uploaded = system.cover_image or ""
    if uploaded:
        # Stored as a bare filename; never join user-controlled path segments.
        candidate = os.path.join(SYSTEM_COVER_DIR, os.path.basename(uploaded))
        if os.path.isfile(candidate):
            return candidate
    return None


def has_cover_file(system: GameSystem) -> bool:
    """Whether a folder or uploaded cover image exists for this system."""
    return resolve_cover_file(system) is not None


def serve_system_cover(
    system_id: str,
    request: Request,
    _: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Serve the system's folder or uploaded cover image. 404 when it has neither."""
    system = _get_system_or_404(db, system_id)
    path = resolve_cover_file(system)
    if not path:
        raise HTTPException(404, "No cover image")
    ext = os.path.splitext(path)[1].lower()
    return cached_file_response(
        request, path, media_type=_MEDIA_TYPES.get(ext, "application/octet-stream")
    )


def _validate_image(data: bytes) -> None:
    """Verify the bytes really decode as an image (reject disguised files)."""
    from PIL import Image

    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception:
        raise HTTPException(400, "File is not a valid image")


def _remove_existing(stem: str) -> None:
    """Delete any prior upload for this system regardless of stored extension."""
    if not os.path.isdir(SYSTEM_COVER_DIR):
        return
    for name in os.listdir(SYSTEM_COVER_DIR):
        if name.rsplit(".", 1)[0] == stem:
            try:
                os.remove(os.path.join(SYSTEM_COVER_DIR, name))
            except OSError as e:
                logger.warning("Failed to remove prior system cover %s: %s", name, e)


def upload_system_cover(
    system_id: str,
    file: UploadFile = File(...),
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Store an uploaded cover image for a system.

    Useful for any system, and the only practical option for a container folder,
    which holds no books to derive a thumbnail from. A ``cover.*`` file in the
    system's library folder still wins over this.
    """
    system = _get_system_or_404(db, system_id)
    if file.content_type not in _IMAGE_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")
    data = file.file.read(_MAX_COVER_BYTES + 1)
    if len(data) > _MAX_COVER_BYTES:
        raise HTTPException(413, "File is too large")
    if not data:
        raise HTTPException(400, "Empty file")
    _validate_image(data)

    filename = _store_system_cover(system, data, _IMAGE_TYPES[file.content_type])
    db.commit()
    return {"cover_image": filename}


def _store_system_cover(system: GameSystem, data: bytes, ext: str) -> str:
    """Write cover bytes for a system and point the row at them."""
    _remove_existing(system.id)
    filename = f"{system.id}{ext}"
    os.makedirs(SYSTEM_COVER_DIR, exist_ok=True)
    with open(os.path.join(SYSTEM_COVER_DIR, filename), "wb") as f:
        f.write(data)
    system.cover_image = filename
    return filename


def set_system_cover_from_source(
    system_id: str,
    body: SystemCoverSourceIn,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Set a system cover from an image Grimoire already holds (issue #286).

    Copies the chosen bytes in exactly as an upload does, so the precedence
    rules above are untouched: a folder ``cover.*`` still wins over this.
    Especially useful for a container folder, which has no books of its own to
    take a thumbnail from.
    """
    from ...services.image_source import load_source_image, source_ext, validate_image

    system = _get_system_or_404(db, system_id)
    data = load_source_image(db, current_user, body.source_type, body.source_id)
    validate_image(data)
    filename = _store_system_cover(system, data, source_ext(data))
    db.commit()
    return {"cover_image": filename}


def delete_system_cover(
    system_id: str,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Remove the uploaded cover. Folder art, being library-managed, is untouched."""
    system = _get_system_or_404(db, system_id)
    _remove_existing(system.id)
    system.cover_image = ""
    db.commit()
    return {"status": "ok"}
