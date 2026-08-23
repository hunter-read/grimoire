"""Audio CRUD, file-serving, and folder-tagging endpoints."""
import os
from pathlib import Path

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session
from fastapi.responses import FileResponse, Response

from ...config import get_db
from ...models import Audio, AudioFolder
from ...services import bulk_service, tag_service, variants
from ...auth import require_gm_or_admin, get_current_user, CurrentUser
from ...indexer import _extract_embedded_art, _find_folder_artwork, archive_ext, archive_mime
from .._bulk_schemas import BulkAddTags, BulkFolderTags
from .._media_access import assert_media_access
from ._schemas import AudioBulkUpdate, AudioUpdate, FolderTagsUpdate

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
        # True only for a cover set through the UI (issue #286) — lets the editor
        # offer "remove cover" without mistaking folder/embedded art for one.
        "has_cover": bool(a.cover_image),
        "file_size": a.file_size,
        "is_missing": bool(a.is_missing),
        "is_archive": bool(archive_ext(a.filename)),
    }


def list_audio(
    limit: int = Query(100000),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = variants.parents_only(db.query(Audio), Audio)
    total = q.count()
    tracks = q.order_by(Audio.filename).offset(offset).limit(limit).all()
    audio_tags = tag_service.display_tags_for_resources(db, "audio", [a.id for a in tracks])
    vcounts = variants.variant_counts(db, Audio, [a.id for a in tracks])
    return {
        "total": total,
        "audio": [
            {
                **_serialize(a, tags=audio_tags.get(a.id, [])),
                "variant_count": vcounts.get(a.id, 0),
            }
            for a in tracks
        ],
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
    internals = tag_service.upsert_folder_tags(
        db, AudioFolder, data.path, data.tags, category="audio"
    )
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
    variant_parent, siblings = variants.family_for(db, Audio, a)
    return {
        **_serialize(a, tags=tag_service.display_tags_for_resource(db, "audio", a.id)),
        "folder_path": folder_path,
        "folder_tags": tag_service.folder_display_tags(db, folder.tags if folder else []),
        "variant_parent_id": a.variant_parent_id,
        "variant_kind": a.variant_kind or "",
        "variant_label": a.variant_label or "",
        "variant_main_id": variant_parent.id,
        "variants": [variants.serialize_variant(v) for v in siblings],
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
    arc_ext = archive_ext(a.filename)
    if arc_ext:
        media = archive_mime(arc_ext)
    else:
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
    # A cover set through the UI wins: it is the only one of the three the user
    # actually chose (issue #286). Then folder art, then embedded album art.
    from .covers import resolve_cover_file

    chosen = resolve_cover_file(a)
    if chosen:
        ext = Path(chosen).suffix.lower().lstrip(".")
        return FileResponse(chosen, media_type=f"image/{'jpeg' if ext == 'jpg' else ext}")
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
    bulk_service.apply_updates(db, "audio", a, data.model_dump(exclude_none=True))
    db.commit()
    return {"status": "ok"}


def bulk_update_audio(
    data: AudioBulkUpdate,  # type: ignore[valid-type]
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Apply per-track edits for a whole selection in one transaction (issue #270)."""
    return bulk_service.run_bulk_update(
        db,
        "audio",
        list(data.items),  # type: ignore[attr-defined]
        payload_for=lambda item: item.model_dump(exclude_none=True, exclude={"id"}),
        not_found_detail="Audio not found",
    )


def bulk_add_audio_tags(
    data: BulkAddTags,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Additively tag a whole selection of audio tracks in one transaction."""
    return bulk_service.run_bulk_add_tags(
        db, "audio", data.ids, data.tags, not_found_detail="Audio not found"
    )


def bulk_update_audio_folders(
    data: BulkFolderTags,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Set tags on many audio folders in one transaction."""
    folders = []
    for entry in data.folders:
        internals = tag_service.upsert_folder_tags(
            db, AudioFolder, entry.path, entry.tags, category="audio"
        )
        folders.append({"path": entry.path, "tags": internals})
    db.commit()
    return {"folders": folders}
