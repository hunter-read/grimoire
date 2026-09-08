"""3D model CRUD, file-serving, and folder-tagging endpoints."""
import hashlib
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_gm_or_admin
from ...config import _THUMBNAIL_CACHE_HEADERS, THUMB_DIR, get_db
from ...file_cache import etag_matches
from ...indexer import archive_ext, archive_mime, slugify
from ...indexer.models3d import (
    model_mime,
    viewer_available,
    viewer_loader,
    viewer_oversized,
)
from ...models import Model3D, Model3DFolder
from ...services import bulk_service, tag_service, variants
from ...services.content_cache import content_token
from .._bulk_schemas import BulkAddTags, BulkFolderTags
from .._media_access import assert_media_access
from ._helpers import _allow_explicit
from ._schemas import FolderTagsUpdate, Model3DBulkUpdate, Model3DUpdate

router = APIRouter()


def list_models(
    limit: int = Query(100000),
    offset: int = 0,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    can_see_explicit = _allow_explicit(db, current_user.id)
    q = variants.parents_only(db.query(Model3D), Model3D)
    if not can_see_explicit:
        q = q.filter(Model3D.is_explicit != True)
    total = q.count()
    rows = q.order_by(Model3D.filename).offset(offset).limit(limit).all()
    model_tags = tag_service.display_tags_for_resources(db, "model", [m.id for m in rows])
    vcounts = variants.variant_counts(db, Model3D, [m.id for m in rows])
    vkinds = variants.variant_kinds(db, Model3D, [m.id for m in rows])
    return {
        "total": total,
        "models": [
            {
                "id": m.id,
                "filename": m.filename,
                "relative_path": m.relative_path,
                "description": m.description,
                "tags": model_tags.get(m.id, []),
                "file_size": m.file_size,
                "triangle_count": m.triangle_count,
                "has_thumbnail": m.has_thumbnail,
                "is_explicit": bool(m.is_explicit),
                "is_missing": bool(m.is_missing),
                "variant_count": vcounts.get(m.id, 0),
                "variant_kinds": vkinds.get(m.id, []),
                "is_archive": bool(archive_ext(m.filename)),
                # Tri-state flattened to two booleans — see the note on Model3DOut.
                "is_presupported": m.is_supported is True,
                "is_unsupported": m.is_supported is False,
            }
            for m in rows
        ],
    }


def list_model_folders(db: Session = Depends(get_db)):
    folders = db.query(Model3DFolder).all()
    return {
        "folders": [
            {"path": f.path, "tags": tag_service.folder_display_tags(db, f.tags or [])}
            for f in folders
        ]
    }


def update_model_folder(
    data: FolderTagsUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    internals = tag_service.upsert_folder_tags(
        db, Model3DFolder, data.path, data.tags, category="model"
    )
    db.commit()
    return {"path": data.path, "tags": internals}


def get_model(
    model_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.query(Model3D).filter_by(id=model_id).first()
    if not m:
        raise HTTPException(404)
    assert_media_access(db, current_user, "model", m.id, is_explicit=bool(m.is_explicit))
    folder_path = "/".join(Path(m.relative_path).parts[1:-1])
    folder = db.query(Model3DFolder).filter_by(path=folder_path).first()

    is_archive = bool(archive_ext(m.filename))
    variant_parent, siblings = variants.family_for(db, Model3D, m)
    return {
        "id": m.id,
        "filename": m.filename,
        "relative_path": m.relative_path,
        "folder_path": folder_path,
        "folder_tags": tag_service.folder_display_tags(db, folder.tags if folder else []),
        "description": m.description,
        "tags": tag_service.display_tags_for_resource(db, "model", m.id),
        "file_size": m.file_size,
        "triangle_count": m.triangle_count,
        "has_thumbnail": m.has_thumbnail,
        "is_explicit": bool(m.is_explicit),
        "is_missing": bool(m.is_missing),
        "is_archive": is_archive,
        "is_supported": m.is_supported,
        "is_presupported": m.is_supported is True,
        "is_unsupported": m.is_supported is False,
        # An archive in the models tree is an opaque blob, so it never gets a
        # viewer even when its name happens to end in a mesh extension.
        "viewer_loader": "" if is_archive else viewer_loader(m.filepath),
        "viewer_available": (
            False if is_archive else viewer_available(m.filepath, m.file_size)
        ),
        "viewer_oversized": (
            False if is_archive else viewer_oversized(m.filepath, m.file_size)
        ),
        "variant_parent_id": m.variant_parent_id,
        "variant_kind": m.variant_kind or "",
        "variant_label": m.variant_label or "",
        "variant_main_id": variant_parent.id,
        "variants": [variants.serialize_variant(v) for v in siblings],
    }


def serve_model_file(
    model_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.query(Model3D).filter_by(id=model_id).first()
    if not m:
        raise HTTPException(404)
    assert_media_access(db, current_user, "model", m.id, is_explicit=bool(m.is_explicit))
    if not os.path.exists(m.filepath):
        if not m.is_missing:
            m.is_missing = True
            db.commit()
        raise HTTPException(404, "File not found on disk")
    arc_ext = archive_ext(m.filename)
    media = archive_mime(arc_ext) if arc_ext else model_mime(m.filepath)
    return FileResponse(m.filepath, media_type=media, filename=m.filename)


def serve_model_thumbnail(
    model_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.query(Model3D).filter_by(id=model_id).first()
    if not m:
        raise HTTPException(404)
    assert_media_access(db, current_user, "model", m.id, is_explicit=bool(m.is_explicit))
    # Same reasoning as the token grid: one request per visible card, so an
    # uncached response dominates the cost of opening the gallery.
    etag = f'"{content_token(m.content_hash, m.filepath)}"'
    if etag_matches(request, etag):
        return Response(status_code=304, headers={"ETag": etag, **_THUMBNAIL_CACHE_HEADERS})
    headers = {**_THUMBNAIL_CACHE_HEADERS, "ETag": etag}
    title = Path(m.filename).stem.replace("_", " ").replace("-", " ")
    slug = slugify(title)
    fhash = hashlib.md5(m.filepath.encode()).hexdigest()[:8]
    thumb_path = os.path.join(THUMB_DIR, "models", f"{slug}_{fhash}.webp")
    if os.path.exists(thumb_path):
        return FileResponse(thumb_path, media_type="image/webp", headers=headers)
    raise HTTPException(404)


def update_model(
    model_id: str,
    data: Model3DUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    m = db.query(Model3D).filter_by(id=model_id).first()
    if not m:
        raise HTTPException(404)
    bulk_service.apply_updates(db, "model", m, data.model_dump(exclude_none=True))
    db.commit()
    return {"status": "ok"}


def bulk_update_models(
    data: Model3DBulkUpdate,  # type: ignore[valid-type]
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Apply per-model edits for a whole selection in one transaction (issue #270)."""
    return bulk_service.run_bulk_update(
        db,
        "model",
        list(data.items),  # type: ignore[attr-defined]
        payload_for=lambda item: item.model_dump(exclude_none=True, exclude={"id"}),
        not_found_detail="Model not found",
    )


def bulk_add_model_tags(
    data: BulkAddTags,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Additively tag a whole selection of models in one transaction."""
    return bulk_service.run_bulk_add_tags(
        db, "model", data.ids, data.tags, not_found_detail="Model not found"
    )


def bulk_update_model_folders(
    data: BulkFolderTags,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Set tags on many model folders in one transaction."""
    folders = []
    for entry in data.folders:
        internals = tag_service.upsert_folder_tags(
            db, Model3DFolder, entry.path, entry.tags, category="model"
        )
        folders.append({"path": entry.path, "tags": internals})
    db.commit()
    return {"folders": folders}
