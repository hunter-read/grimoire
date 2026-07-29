"""Map CRUD, file-serving, and folder-tagging endpoints."""
import hashlib
import io
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from fastapi.responses import FileResponse, StreamingResponse

from ...config import _PAGE_CACHE_HEADERS, THUMB_DIR, get_db
from ...models import GenericMap, MapFolder
from ...services import tag_service
from ...auth import require_gm_or_admin, get_current_user, CurrentUser
from ...indexer import slugify
from .._media_access import assert_media_access
from ._helpers import _is_pdf, _map_image_info, render_map_pdf_page
from ._schemas import FolderTagsUpdate, MapUpdate

router = APIRouter()


def _folder_path(relative_path: str) -> str:
    """Folder portion of a map's relative_path (drops game system and filename)."""
    return "/".join(Path(relative_path.replace("\\", "/")).parts[1:-1])


def list_maps(
    map_type: Optional[str] = None,
    folder: Optional[str] = None,
    limit: int = Query(100000),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(GenericMap)
    if map_type:
        q = q.filter_by(map_type=map_type)
    q = q.order_by(GenericMap.filename)
    if folder is not None:
        # Folder is derived from relative_path, not a column, so filter in
        # Python. Paginate the filtered result.
        filtered = [m for m in q.all() if _folder_path(m.relative_path) == folder]
        total = len(filtered)
        maps = filtered[offset : offset + limit]
    else:
        total = q.count()
        maps = q.offset(offset).limit(limit).all()
    map_tags = tag_service.display_tags_for_resources(db, "map", [m.id for m in maps])
    return {
        "total": total,
        "maps": [
            {
                "id": m.id,
                "filename": m.filename,
                "relative_path": m.relative_path,
                "description": m.description,
                "tags": map_tags.get(m.id, []),
                "map_type": m.map_type,
                "file_size": m.file_size,
                "has_thumbnail": m.has_thumbnail,
                "is_missing": bool(m.is_missing),
            }
            for m in maps
        ],
    }


def list_map_folders(db: Session = Depends(get_db)):
    folders = db.query(MapFolder).all()
    return {
        "folders": [
            {"path": f.path, "tags": tag_service.folder_display_tags(db, f.tags or [])}
            for f in folders
        ]
    }


def update_map_folder(
    data: FolderTagsUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    # Register catalog rows (display casing lives there) and store internal keys
    # on the folder, so a tags.json rescan can't revert user edits.
    internals = tag_service.register_folder_tags(db, data.tags, category="map")
    folder = db.query(MapFolder).filter_by(path=data.path).first()
    if folder:
        folder.tags = internals
    else:
        db.add(MapFolder(path=data.path, tags=internals))
    db.commit()
    return {"path": data.path, "tags": internals}


def get_map(
    map_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.query(GenericMap).filter_by(id=map_id).first()
    if not m:
        raise HTTPException(404)
    assert_media_access(db, current_user, "map", m.id)
    img_info = _map_image_info(m.filepath, m.relative_path)
    folder_path = _folder_path(m.relative_path)
    folder = db.query(MapFolder).filter_by(path=folder_path).first()
    return {
        "id": m.id,
        "filename": m.filename,
        "relative_path": m.relative_path,
        "folder_path": folder_path,
        "folder_tags": tag_service.folder_display_tags(db, folder.tags if folder else []),
        "description": m.description,
        "tags": tag_service.display_tags_for_resource(db, "map", m.id),
        "map_type": m.map_type,
        "grid_size": m.grid_size,
        "file_size": m.file_size,
        "has_thumbnail": m.has_thumbnail,
        "is_missing": bool(m.is_missing),
        **img_info,
    }


def serve_map_file(
    map_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.query(GenericMap).filter_by(id=map_id).first()
    if not m:
        raise HTTPException(404)
    assert_media_access(db, current_user, "map", m.id)
    if not os.path.exists(m.filepath):
        if not m.is_missing:
            m.is_missing = True
            db.commit()
        raise HTTPException(404, "File not found on disk")
    ext = Path(m.filepath).suffix.lower()
    media = "application/pdf" if ext == ".pdf" else f"image/{ext[1:]}"
    return FileResponse(m.filepath, media_type=media, filename=m.filename)


def serve_map_page(
    map_id: str,
    page_num: int,
    width: int = Query(1600, le=3000),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Render a single page of a PDF map to WebP.

    Image maps have exactly one page and are streamed as-is (page_num must be 1).
    PDF maps are rendered server-side with PyMuPDF and cached, mirroring the book
    page reader but without text extraction.
    """
    m = db.query(GenericMap).filter_by(id=map_id).first()
    if not m:
        raise HTTPException(404)
    assert_media_access(db, current_user, "map", m.id)
    if not os.path.exists(m.filepath):
        if not m.is_missing:
            m.is_missing = True
            db.commit()
        raise HTTPException(404, "File not found on disk")
    filepath = m.filepath

    if not _is_pdf(filepath):
        if page_num != 1:
            raise HTTPException(400, "Image maps have only one page")
        ext = Path(filepath).suffix.lower().lstrip(".")
        media_type = "image/jpeg" if ext == "jpg" else f"image/{ext}"
        return FileResponse(filepath, media_type=media_type, headers=_PAGE_CACHE_HEADERS)

    try:
        img_bytes = render_map_pdf_page(filepath, page_num, width)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(500, "Failed to render page") from None
    return StreamingResponse(
        io.BytesIO(img_bytes), media_type="image/webp", headers=_PAGE_CACHE_HEADERS
    )


def serve_map_thumbnail(
    map_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.query(GenericMap).filter_by(id=map_id).first()
    if not m:
        raise HTTPException(404)
    assert_media_access(db, current_user, "map", m.id)
    title = Path(m.filename).stem.replace("_", " ").replace("-", " ")
    slug = slugify(title)
    fhash = hashlib.md5(m.filepath.encode()).hexdigest()[:8]
    thumb_path = os.path.join(THUMB_DIR, "maps", f"{slug}_{fhash}.webp")
    if os.path.exists(thumb_path):
        return FileResponse(thumb_path, media_type="image/webp")
    raise HTTPException(404)


def update_map(
    map_id: str,
    data: MapUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    m = db.query(GenericMap).filter_by(id=map_id).first()
    if not m:
        raise HTTPException(404)
    payload = data.model_dump(exclude_none=True)
    tag_service.sync_tags_from_payload(db, "map", m.id, payload)
    payload.pop("tags", None)  # tags live in the shared-tag tables, not a column
    for field, value in payload.items():
        setattr(m, field, value)
    db.commit()
    return {"status": "ok"}
