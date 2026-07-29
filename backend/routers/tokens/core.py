"""Token CRUD, file-serving, and folder-tagging endpoints."""
import hashlib
import os
from pathlib import Path

from PIL import Image as PILImage  # type: ignore[import-untyped]

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from fastapi.responses import FileResponse

from ...config import THUMB_DIR, get_db
from ...models import Token, TokenFolder
from ...services import tag_service
from ...auth import require_gm_or_admin, get_current_user, CurrentUser
from ...indexer import slugify
from .._media_access import assert_media_access
from ._helpers import _allow_explicit
from ._schemas import FolderTagsUpdate, TokenUpdate

router = APIRouter()


def list_tokens(
    limit: int = Query(100000),
    offset: int = 0,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    can_see_explicit = _allow_explicit(db, current_user.id)
    q = db.query(Token)
    if not can_see_explicit:
        q = q.filter(Token.is_explicit != True)
    total = q.count()
    tokens = q.order_by(Token.filename).offset(offset).limit(limit).all()
    token_tags = tag_service.display_tags_for_resources(db, "token", [t.id for t in tokens])
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
            }
            for t in tokens
        ],
    }


def list_token_folders(db: Session = Depends(get_db)):
    folders = db.query(TokenFolder).all()
    return {"folders": [{"path": f.path, "tags": f.tags or []} for f in folders]}


def update_token_folder(
    data: FolderTagsUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    folder = db.query(TokenFolder).filter_by(path=data.path).first()
    if folder:
        folder.tags = data.tags
    else:
        db.add(TokenFolder(path=data.path, tags=data.tags))
    db.commit()
    return {"path": data.path, "tags": data.tags}


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

    try:
        img = PILImage.open(t.filepath)
        pixel_width, pixel_height = img.size
        img.close()
    except Exception:
        pixel_width, pixel_height = None, None

    return {
        "id": t.id,
        "filename": t.filename,
        "relative_path": t.relative_path,
        "folder_path": folder_path,
        "folder_tags": folder.tags if folder else [],
        "description": t.description,
        "tags": tag_service.display_tags_for_resource(db, "token", t.id),
        "file_size": t.file_size,
        "has_thumbnail": t.has_thumbnail,
        "is_explicit": bool(t.is_explicit),
        "is_missing": bool(t.is_missing),
        "pixel_width": pixel_width,
        "pixel_height": pixel_height,
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
    ext = Path(t.filepath).suffix.lower()
    media = f"image/{ext[1:]}"
    return FileResponse(t.filepath, media_type=media, filename=t.filename)


def serve_token_thumbnail(
    token_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.query(Token).filter_by(id=token_id).first()
    if not t:
        raise HTTPException(404)
    assert_media_access(db, current_user, "token", t.id, is_explicit=bool(t.is_explicit))
    title = Path(t.filename).stem.replace("_", " ").replace("-", " ")
    slug = slugify(title)
    fhash = hashlib.md5(t.filepath.encode()).hexdigest()[:8]
    thumb_path = os.path.join(THUMB_DIR, "tokens", f"{slug}_{fhash}.webp")
    if os.path.exists(thumb_path):
        return FileResponse(thumb_path, media_type="image/webp")
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
    payload = data.model_dump(exclude_none=True)
    tag_service.sync_tags_from_payload(db, "token", t.id, payload)
    payload.pop("tags", None)  # tags live in the shared-tag tables, not a column
    for field, value in payload.items():
        setattr(t, field, value)
    db.commit()
    return {"status": "ok"}
