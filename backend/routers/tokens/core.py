"""Token CRUD, file-serving, and folder-tagging endpoints."""
import hashlib
import os
from pathlib import Path

from PIL import Image as PILImage  # type: ignore[import-untyped]

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from fastapi.responses import FileResponse, Response

from ...config import _THUMBNAIL_CACHE_HEADERS, THUMB_DIR, get_db
from ...models import Token, TokenFolder
from ...services import bulk_service, tag_service, variants
from ...services.content_cache import content_token
from ...file_cache import etag_matches
from ...auth import require_gm_or_admin, get_current_user, CurrentUser
from ...indexer import archive_ext, archive_mime, slugify
from .._bulk_schemas import BulkAddTags, BulkFolderTags
from .._media_access import assert_media_access
from ._helpers import _allow_explicit
from ._schemas import FolderTagsUpdate, TokenBulkUpdate, TokenUpdate

router = APIRouter()


def list_tokens(
    limit: int = Query(100000),
    offset: int = 0,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    can_see_explicit = _allow_explicit(db, current_user.id)
    q = variants.parents_only(db.query(Token), Token)
    if not can_see_explicit:
        q = q.filter(Token.is_explicit != True)
    total = q.count()
    tokens = q.order_by(Token.filename).offset(offset).limit(limit).all()
    token_tags = tag_service.display_tags_for_resources(db, "token", [t.id for t in tokens])
    vcounts = variants.variant_counts(db, Token, [t.id for t in tokens])
    vkinds = variants.variant_kinds(db, Token, [t.id for t in tokens])
    return {
        "total": total,
        "tokens": [
            {
                "id": t.id,
                "filename": t.filename,
                "relative_path": t.relative_path,
                "description": t.description,
                "tags": token_tags.get(t.id, []),
                "file_size": t.file_size,
                "has_thumbnail": t.has_thumbnail,
                "is_explicit": bool(t.is_explicit),
                "is_missing": bool(t.is_missing),
                "variant_count": vcounts.get(t.id, 0),
                "variant_kinds": vkinds.get(t.id, []),
                "is_archive": bool(archive_ext(t.filename)),
            }
            for t in tokens
        ],
    }


def list_token_folders(db: Session = Depends(get_db)):
    folders = db.query(TokenFolder).all()
    return {
        "folders": [
            {"path": f.path, "tags": tag_service.folder_display_tags(db, f.tags or [])}
            for f in folders
        ]
    }


def update_token_folder(
    data: FolderTagsUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    internals = tag_service.upsert_folder_tags(
        db, TokenFolder, data.path, data.tags, category="token"
    )
    db.commit()
    return {"path": data.path, "tags": internals}


def get_token(
    token_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.query(Token).filter_by(id=token_id).first()
    if not t:
        raise HTTPException(404)
    assert_media_access(db, current_user, "token", t.id, is_explicit=bool(t.is_explicit))
    folder_path = "/".join(Path(t.relative_path).parts[1:-1])
    folder = db.query(TokenFolder).filter_by(path=folder_path).first()

    is_archive = bool(archive_ext(t.filename))
    if is_archive:
        # Archives are opaque blobs — there is no image to measure.
        pixel_width, pixel_height = None, None
    else:
        try:
            img = PILImage.open(t.filepath)
            pixel_width, pixel_height = img.size
            img.close()
        except Exception:
            pixel_width, pixel_height = None, None

    variant_parent, siblings = variants.family_for(db, Token, t)
    return {
        "id": t.id,
        "filename": t.filename,
        "relative_path": t.relative_path,
        "folder_path": folder_path,
        "folder_tags": tag_service.folder_display_tags(db, folder.tags if folder else []),
        "description": t.description,
        "tags": tag_service.display_tags_for_resource(db, "token", t.id),
        "file_size": t.file_size,
        "has_thumbnail": t.has_thumbnail,
        "is_explicit": bool(t.is_explicit),
        "is_missing": bool(t.is_missing),
        "is_archive": is_archive,
        "pixel_width": pixel_width,
        "pixel_height": pixel_height,
        "variant_parent_id": t.variant_parent_id,
        "variant_kind": t.variant_kind or "",
        "variant_label": t.variant_label or "",
        "variant_main_id": variant_parent.id,
        "variants": [variants.serialize_variant(v) for v in siblings],
    }


def serve_token_file(
    token_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.query(Token).filter_by(id=token_id).first()
    if not t:
        raise HTTPException(404)
    assert_media_access(db, current_user, "token", t.id, is_explicit=bool(t.is_explicit))
    if not os.path.exists(t.filepath):
        if not t.is_missing:
            t.is_missing = True
            db.commit()
        raise HTTPException(404, "File not found on disk")
    arc_ext = archive_ext(t.filename)
    if arc_ext:
        media = archive_mime(arc_ext)
    else:
        ext = Path(t.filepath).suffix.lower()
        media = f"image/{ext[1:]}"
    return FileResponse(t.filepath, media_type=media, filename=t.filename)


def serve_token_thumbnail(
    token_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.query(Token).filter_by(id=token_id).first()
    if not t:
        raise HTTPException(404)
    assert_media_access(db, current_user, "token", t.id, is_explicit=bool(t.is_explicit))
    # See the note on maps' thumbnail route: a token grid is denser still, so an
    # uncached response is the dominant cost of opening the page.
    etag = f'"{content_token(t.content_hash, t.filepath)}"'
    if etag_matches(request, etag):
        return Response(status_code=304, headers={"ETag": etag, **_THUMBNAIL_CACHE_HEADERS})
    headers = {**_THUMBNAIL_CACHE_HEADERS, "ETag": etag}
    title = Path(t.filename).stem.replace("_", " ").replace("-", " ")
    slug = slugify(title)
    fhash = hashlib.md5(t.filepath.encode()).hexdigest()[:8]
    thumb_path = os.path.join(THUMB_DIR, "tokens", f"{slug}_{fhash}.webp")
    if os.path.exists(thumb_path):
        return FileResponse(thumb_path, media_type="image/webp", headers=headers)
    raise HTTPException(404)


def update_token(
    token_id: str,
    data: TokenUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    t = db.query(Token).filter_by(id=token_id).first()
    if not t:
        raise HTTPException(404)
    bulk_service.apply_updates(db, "token", t, data.model_dump(exclude_none=True))
    db.commit()
    return {"status": "ok"}


def bulk_update_tokens(
    data: TokenBulkUpdate,  # type: ignore[valid-type]
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Apply per-token edits for a whole selection in one transaction (issue #270).

    Replaces the frontend's N-way PATCH fan-out, which raced on tag creation and
    returned intermittent 500s.
    """
    return bulk_service.run_bulk_update(
        db,
        "token",
        list(data.items),  # type: ignore[attr-defined]
        payload_for=lambda item: item.model_dump(exclude_none=True, exclude={"id"}),
        not_found_detail="Token not found",
    )


def bulk_add_token_tags(
    data: BulkAddTags,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Additively tag a whole selection of tokens in one transaction."""
    return bulk_service.run_bulk_add_tags(
        db, "token", data.ids, data.tags, not_found_detail="Token not found"
    )


def bulk_update_token_folders(
    data: BulkFolderTags,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Set tags on many token folders in one transaction."""
    folders = []
    for entry in data.folders:
        internals = tag_service.upsert_folder_tags(
            db, TokenFolder, entry.path, entry.tags, category="token"
        )
        folders.append({"path": entry.path, "tags": internals})
    db.commit()
    return {"folders": folders}
