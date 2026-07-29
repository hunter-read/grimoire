"""Audio CRUD, file-serving, and folder-tagging endpoints."""
import os
from pathlib import Path

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session
from fastapi.responses import FileResponse, Response

from ...config import get_db
from ...models import Audio, AudioFolder
from ...services import tag_service
from ...auth import require_gm_or_admin, get_current_user, CurrentUser
from ...indexer import _extract_embedded_art, _find_folder_artwork
from .._media_access import assert_media_access
from ._schemas import AudioUpdate, FolderTagsUpdate

# Map audio extensions to the mimetype the browser <audio> element expects.
_AUDIO_MIME = {
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
}


def _serialize(a: Audio, tags: list[str] | None = None) -> dict:
    return {
        "id": a.id,
        "filename": a.filename,
        "relative_path": a.relative_path,
        "description": a.description,
        "tags": tags if tags is not None else [],
        "duration": a.duration or 0.0,
        "title": a.title or "",
        "artist": a.artist or "",
        "album": a.album or "",
        "has_artwork": bool(a.has_artwork),
        "file_size": a.file_size,
        "is_missing": bool(a.is_missing),
    }


def list_audio(
    limit: int = Query(100000),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(Audio)
    total = q.count()
    tracks = q.order_by(Audio.filename).offset(offset).limit(limit).all()
    audio_tags = tag_service.display_tags_for_resources(db, "audio", [a.id for a in tracks])
    return {
        "total": total,
        "audio": [_serialize(a, tags=audio_tags.get(a.id, [])) for a in tracks],
    }


def list_audio_folders(db: Session = Depends(get_db)):
    folders = db.query(AudioFolder).all()
    return {
        "folders": [
            {"path": f.path, "tags": tag_service.folder_display_tags(db, f.tags or [])}
            for f in folders
        ]
    }


def update_audio_folder(
    data: FolderTagsUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    internals = tag_service.register_folder_tags(db, data.tags, category="audio")
    folder = db.query(AudioFolder).filter_by(path=data.path).first()
    if folder:
        folder.tags = internals
    else:
        db.add(AudioFolder(path=data.path, tags=internals))
    db.commit()
    return {"path": data.path, "tags": internals}


def get_audio(
    audio_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    a = db.query(Audio).filter_by(id=audio_id).first()
    if not a:
        raise HTTPException(404)
    assert_media_access(db, current_user, "audio", a.id)
    folder_path = "/".join(Path(a.relative_path).parts[1:-1])
    folder = db.query(AudioFolder).filter_by(path=folder_path).first()
    return {
        **_serialize(a, tags=tag_service.display_tags_for_resource(db, "audio", a.id)),
        "folder_path": folder_path,
        "folder_tags": tag_service.folder_display_tags(db, folder.tags if folder else []),
    }


def serve_audio_file(
    audio_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    a = db.query(Audio).filter_by(id=audio_id).first()
    if not a:
        raise HTTPException(404)
    assert_media_access(db, current_user, "audio", a.id)
    if not os.path.exists(a.filepath):
        if not a.is_missing:
            a.is_missing = True
            db.commit()
        raise HTTPException(404, "File not found on disk")
    ext = Path(a.filepath).suffix.lower()
    media = _AUDIO_MIME.get(ext, "application/octet-stream")
    # FileResponse honours HTTP Range requests, so browsers can seek/stream.
    return FileResponse(a.filepath, media_type=media, filename=a.filename)


def serve_audio_artwork(
    audio_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    a = db.query(Audio).filter_by(id=audio_id).first()
    if not a:
        raise HTTPException(404)
    assert_media_access(db, current_user, "audio", a.id)
    # Prefer a folder cover image, then fall back to embedded album art.
    cover = _find_folder_artwork(os.path.dirname(a.filepath))
    if cover and os.path.exists(cover):
        ext = Path(cover).suffix.lower().lstrip(".")
        return FileResponse(cover, media_type=f"image/{ext}")
    embedded = _extract_embedded_art(a.filepath)
    if embedded:
        data, mime = embedded
        return Response(content=data, media_type=mime or "image/jpeg")
    raise HTTPException(404)


def update_audio(
    audio_id: str,
    data: AudioUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    a = db.query(Audio).filter_by(id=audio_id).first()
    if not a:
        raise HTTPException(404)
    payload = data.model_dump(exclude_none=True)
    tag_service.sync_tags_from_payload(db, "audio", a.id, payload)
    payload.pop("tags", None)  # tags live in the shared-tag tables, not a column
    for field, value in payload.items():
        setattr(a, field, value)
    db.commit()
    return {"status": "ok"}
