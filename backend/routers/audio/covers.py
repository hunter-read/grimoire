"""Audio cover art set through the UI (issue #286).

A track's artwork used to come only from a ``cover.*`` image sitting beside it
in the library or from an embedded ID3/Vorbis tag — neither of which a user can
change from inside Grimoire. This adds a third source, stored under
``DATA_PATH/audio_covers/`` and keyed by track id, which takes precedence over
both because it is the only one the user actually chose.

An uploaded cover can come from the user's device or from an image the server
already holds (a library map, a token, a book cover), via
``services.image_source``. Removing it falls straight back to folder/embedded
art, which is untouched.
"""

import os

from fastapi import Depends, File, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_gm_or_admin
from ...config import AUDIO_COVER_DIR, get_db, logger
from ...file_cache import cached_file_response
from ...models import Audio
from ...services.image_source import load_source_image, source_ext, validate_image
from ._schemas import AudioCoverSourceIn

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
}


def _get_audio_or_404(db: Session, audio_id: str) -> Audio:
    a = db.query(Audio).filter_by(id=audio_id).first()
    if not a:
        raise HTTPException(404, "Audio not found")
    return a


def resolve_cover_file(track: Audio) -> str | None:
    """On-disk path of a track's uploaded cover, or None.

    Only covers set through the UI — folder and embedded art are resolved by
    ``core.serve_audio_artwork``, which calls this first.
    """
    name = track.cover_image or ""
    if not name:
        return None
    # Stored as a bare filename; never join a user-controlled path segment.
    candidate = os.path.join(AUDIO_COVER_DIR, os.path.basename(name))
    return candidate if os.path.isfile(candidate) else None


def _remove_existing(stem: str) -> None:
    """Delete any prior cover for this track regardless of stored extension."""
    if not os.path.isdir(AUDIO_COVER_DIR):
        return
    for name in os.listdir(AUDIO_COVER_DIR):
        if name.rsplit(".", 1)[0] == stem:
            try:
                os.remove(os.path.join(AUDIO_COVER_DIR, name))
            except OSError as e:
                logger.warning("Failed to remove prior audio cover %s: %s", name, e)


def _store_cover(track: Audio, data: bytes, ext: str) -> str:
    """Write cover bytes for a track and point the row at them."""
    _remove_existing(track.id)
    filename = f"{track.id}{ext}"
    os.makedirs(AUDIO_COVER_DIR, exist_ok=True)
    with open(os.path.join(AUDIO_COVER_DIR, filename), "wb") as f:
        f.write(data)
    track.cover_image = filename
    # The list views gate the artwork request on this flag, so a track that had
    # no art before must start reporting some now.
    track.has_artwork = True
    return filename


def upload_audio_cover(
    audio_id: str,
    file: UploadFile = File(...),
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Store a cover image uploaded from the user's device for a track."""
    track = _get_audio_or_404(db, audio_id)
    if file.content_type not in _IMAGE_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")
    data = file.file.read(_MAX_COVER_BYTES + 1)
    if len(data) > _MAX_COVER_BYTES:
        raise HTTPException(413, "File is too large")
    if not data:
        raise HTTPException(400, "Empty file")
    validate_image(data)

    filename = _store_cover(track, data, _IMAGE_TYPES[file.content_type])
    db.commit()
    return {"cover_image": filename}


def set_audio_cover_from_source(
    audio_id: str,
    body: AudioCoverSourceIn,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Set a track's cover from an image Grimoire already holds (issue #286)."""
    track = _get_audio_or_404(db, audio_id)
    data = load_source_image(db, current_user, body.source_type, body.source_id)
    validate_image(data)
    filename = _store_cover(track, data, source_ext(data))
    db.commit()
    return {"cover_image": filename}


def delete_audio_cover(
    audio_id: str,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Remove the set cover. Folder and embedded art are untouched and take over."""
    from ...indexer import _extract_embedded_art, _find_folder_artwork

    track = _get_audio_or_404(db, audio_id)
    _remove_existing(track.id)
    track.cover_image = ""
    # `has_artwork` must go back to describing what is actually left, or the UI
    # keeps requesting artwork that now 404s.
    folder = _find_folder_artwork(os.path.dirname(track.filepath or ""))
    track.has_artwork = bool(
        (folder and os.path.isfile(folder)) or _extract_embedded_art(track.filepath or "")
    )
    db.commit()
    return {"status": "ok"}


def serve_audio_cover(
    audio_id: str,
    request: Request,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Serve only the *set* cover, for the editor's preview. 404 when there is none.

    Players read artwork through ``/audio/{id}/artwork``, which resolves the full
    precedence chain; this one deliberately does not, so the editor can tell
    "a cover was set here" apart from "the folder happens to have one".
    """
    track = _get_audio_or_404(db, audio_id)
    path = resolve_cover_file(track)
    if not path:
        raise HTTPException(404, "No cover image")
    ext = os.path.splitext(path)[1].lower()
    return cached_file_response(
        request, path, media_type=_MEDIA_TYPES.get(ext, "application/octet-stream")
    )
