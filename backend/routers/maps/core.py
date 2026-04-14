"""Map CRUD, file-serving, and folder-tagging endpoints."""
import hashlib
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from ...config import SessionLocal, THUMB_DIR
from ...models import GenericMap, MapFolder
from ...auth import require_gm_or_admin, CurrentUser
from ...indexer import slugify
from ._helpers import _map_image_info
from ._schemas import FolderTagsUpdate, MapUpdate

router = APIRouter()


def list_maps(
    map_type: Optional[str] = None,
    limit: int = Query(100000),
    offset: int = 0,
):
    db = SessionLocal()
    try:
        q = db.query(GenericMap)
        if map_type:
            q = q.filter_by(map_type=map_type)
        total = q.count()
        maps = q.order_by(GenericMap.filename).offset(offset).limit(limit).all()
        return {
            "total": total,
            "maps": [
                {
                    "id": m.id,
                    "filename": m.filename,
                    "relative_path": m.relative_path,
                    "description": m.description,
                    "tags": m.tags or [],
                    "map_type": m.map_type,
                    "file_size": m.file_size,
                    "has_thumbnail": m.has_thumbnail,
                    "is_missing": bool(m.is_missing),
                }
                for m in maps
            ],
        }
    finally:
        db.close()


def list_map_folders():
    db = SessionLocal()
    try:
        folders = db.query(MapFolder).all()
        return {"folders": [{"path": f.path, "tags": f.tags or []} for f in folders]}
    finally:
        db.close()


def update_map_folder(data: FolderTagsUpdate, _: CurrentUser = Depends(require_gm_or_admin)):
    db = SessionLocal()
    try:
        folder = db.query(MapFolder).filter_by(path=data.path).first()
        if folder:
            folder.tags = data.tags
        else:
            db.add(MapFolder(path=data.path, tags=data.tags))
        db.commit()
        return {"path": data.path, "tags": data.tags}
    finally:
        db.close()


def get_map(map_id: str):
    db = SessionLocal()
    try:
        m = db.query(GenericMap).filter_by(id=map_id).first()
        if not m:
            raise HTTPException(404)
        img_info = _map_image_info(m.filepath, m.relative_path)
        folder_path = "/".join(Path(m.relative_path).parts[1:-1])
        folder = db.query(MapFolder).filter_by(path=folder_path).first()
        return {
            "id": m.id,
            "filename": m.filename,
            "relative_path": m.relative_path,
            "folder_path": folder_path,
            "folder_tags": folder.tags if folder else [],
            "description": m.description,
            "tags": m.tags or [],
            "map_type": m.map_type,
            "grid_size": m.grid_size,
            "file_size": m.file_size,
            "has_thumbnail": m.has_thumbnail,
            "is_missing": bool(m.is_missing),
            **img_info,
        }
    finally:
        db.close()


def serve_map_file(map_id: str):
    db = SessionLocal()
    try:
        m = db.query(GenericMap).filter_by(id=map_id).first()
        if not m:
            raise HTTPException(404)
        if not os.path.exists(m.filepath):
            if not m.is_missing:
                m.is_missing = True
                db.commit()
            raise HTTPException(404, "File not found on disk")
        ext = Path(m.filepath).suffix.lower()
        media = "application/pdf" if ext == ".pdf" else f"image/{ext[1:]}"
        return FileResponse(m.filepath, media_type=media, filename=m.filename)
    finally:
        db.close()


def serve_map_thumbnail(map_id: str):
    db = SessionLocal()
    try:
        m = db.query(GenericMap).filter_by(id=map_id).first()
        if not m:
            raise HTTPException(404)
        title = Path(m.filename).stem.replace("_", " ").replace("-", " ")
        slug = slugify(title)
        fhash = hashlib.md5(m.filepath.encode()).hexdigest()[:8]
        thumb_path = os.path.join(THUMB_DIR, "maps", f"{slug}_{fhash}.webp")
        if os.path.exists(thumb_path):
            return FileResponse(thumb_path, media_type="image/webp")
        raise HTTPException(404)
    finally:
        db.close()


def update_map(map_id: str, data: MapUpdate, _: CurrentUser = Depends(require_gm_or_admin)):
    db = SessionLocal()
    try:
        m = db.query(GenericMap).filter_by(id=map_id).first()
        if not m:
            raise HTTPException(404)
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(m, field, value)
        db.commit()
        return {"status": "ok"}
    finally:
        db.close()
