"""Map CRUD, file-serving, and folder-tagging endpoints."""
import hashlib
import io
import os
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_, true
from sqlalchemy.orm import Session
from fastapi.responses import FileResponse, Response, StreamingResponse

from ...config import (
    _MEDIA_FILE_CACHE_HEADERS,
    _PAGE_CACHE_HEADERS,
    _THUMBNAIL_CACHE_HEADERS,
    THUMB_DIR,
    get_db,
    logger,
)
from ...models import GenericMap, MapFolder
from ...services import bulk_service, tag_service, variants
from ...services.content_cache import content_token
from ...file_cache import etag_matches
from ...auth import require_gm_or_admin, get_current_user, CurrentUser
from ...indexer import MAP_OPAQUE_EXTS, archive_ext, archive_mime, is_vtt_data, slugify
from .._bulk_schemas import BulkAddTags, BulkFolderTags
from .._media_access import assert_media_access
from ._helpers import (
    _VTT_MIME,
    _is_pdf,
    _map_image_info,
    _map_media_type,
    _sniff_image_mime,
    render_map_pdf_page,
    render_map_preview,
    vtt_image_bytes,
    vtt_metadata,
)
from ._schemas import FolderTagsUpdate, MapBulkUpdate, MapUpdate

router = APIRouter()


def _folder_path(relative_path: str) -> str:
    """Folder portion of a map's relative_path (drops game system and filename)."""
    return "/".join(Path(relative_path.replace("\\", "/")).parts[1:-1])


def _folder_prefix_filter(model: Any, folder: str) -> Any:
    """SQL clause narrowing to rows whose relative_path could sit in ``folder``.

    A relative_path is ``<system>/<folder…>/<file>``, so a row in ``folder`` has
    it somewhere after the first segment. This is a cheap superset — it also
    admits deeper descendants and any folder whose name merely starts with the
    same text — which is why callers keep the exact :func:`_folder_path` check.
    The empty (root) folder has no prefix to match on, so it is not narrowed.

    ``escape="!"`` keeps a literal %, _ or ! in a real folder name from acting as
    a LIKE wildcard. A backslash is not escaped and the escape character is not
    one: :func:`_folder_path` normalises separators, so the folder string itself
    never contains a backslash — only the stored path does, which is why the
    Windows-separator variant is matched separately.
    """
    if not folder:
        return true()
    escaped = folder.replace("!", "!!").replace("%", "!%").replace("_", "!_")
    win = escaped.replace("/", "\\")
    return or_(
        model.relative_path.like(f"%/{escaped}/%", escape="!"),
        model.relative_path.like(f"%\\{win}\\%", escape="!"),
    )


def list_maps(
    map_type: Optional[str] = None,
    folder: Optional[str] = None,
    limit: int = Query(100000),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    # Applied before the folder branch below — a variant must never reach the
    # list (issues #304, #306).
    q = variants.parents_only(db.query(GenericMap), GenericMap)
    if map_type:
        q = q.filter_by(map_type=map_type)
    q = q.order_by(GenericMap.filename)
    if folder is not None:
        # Folder is derived from relative_path rather than stored as a column, so
        # it cannot be compared directly. Narrowing on the path prefix in SQL
        # first means only that folder's subtree is materialised, instead of the
        # whole table (which on a large library was the cost of opening a
        # folder); the exact per-row check below still decides membership, since
        # the prefix also matches deeper descendants and sibling folders sharing
        # a name prefix.
        q = q.filter(_folder_prefix_filter(GenericMap, folder))
        filtered = [m for m in q.all() if _folder_path(m.relative_path) == folder]
        total = len(filtered)
        maps = filtered[offset : offset + limit]
    else:
        total = q.count()
        maps = q.offset(offset).limit(limit).all()
    map_tags = tag_service.display_tags_for_resources(db, "map", [m.id for m in maps])
    vcounts = variants.variant_counts(db, GenericMap, [m.id for m in maps])
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
                "is_archive": bool(archive_ext(m.filename)),
                "variant_count": vcounts.get(m.id, 0),
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
    internals = tag_service.upsert_folder_tags(db, MapFolder, data.path, data.tags, category="map")
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
    variant_parent, siblings = variants.family_for(db, GenericMap, m)
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
        "is_archive": bool(archive_ext(m.filename)),
        "variant_parent_id": m.variant_parent_id,
        "variant_kind": m.variant_kind or "",
        "variant_label": m.variant_label or "",
        "variant_main_id": variant_parent.id,
        "variants": [variants.serialize_variant(v) for v in siblings],
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
    arc_ext = archive_ext(m.filename)
    if arc_ext:
        media = archive_mime(arc_ext)
    else:
        media = _map_media_type(m.filepath)
    # Videos and VTT data are viewed in place, so they must not arrive with a
    # Content-Disposition that makes the browser download them instead. Only the
    # download-oriented formats keep the filename= attachment hint.
    inline = media.startswith("video/") or media == _VTT_MIME
    return FileResponse(
        m.filepath,
        media_type=media,
        filename=None if inline else m.filename,
        headers=dict(_MEDIA_FILE_CACHE_HEADERS),
    )


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

    # Archives have no renderable pages — the client downloads them instead.
    if archive_ext(m.filename):
        raise HTTPException(400, "Archives have no viewable pages")

    if not _is_pdf(filepath):
        if page_num != 1:
            raise HTTPException(400, "Image maps have only one page")
        ext = Path(filepath).suffix.lower()
        # Videos and VTT data have no rendered page — the viewer plays/parses the
        # original via /file rather than asking for a raster.
        if ext in MAP_OPAQUE_EXTS:
            raise HTTPException(400, "This map format has no viewable pages")
        # Serve a downscaled WebP rather than the original. A 50MB battlemap took
        # seconds to appear when the browser had to pull the whole file; the
        # preview is a few hundred KB and caches like a PDF page render. SVG is
        # vector (already small, and Pillow cannot rasterise it), so it streams
        # as-is.
        if ext != ".svg":
            try:
                return StreamingResponse(
                    io.BytesIO(render_map_preview(filepath, width)),
                    media_type="image/webp",
                    headers=_PAGE_CACHE_HEADERS,
                )
            except Exception:
                # A format Pillow cannot decode still has a usable original.
                logger.warning(f"Map preview render failed, serving original: {filepath}")
        return FileResponse(
            filepath, media_type=_map_media_type(filepath), headers=_PAGE_CACHE_HEADERS
        )

    try:
        img_bytes = render_map_pdf_page(filepath, page_num, width)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(500, "Failed to render page") from None
    return StreamingResponse(
        io.BytesIO(img_bytes), media_type="image/webp", headers=_PAGE_CACHE_HEADERS
    )


def _load_accessible_map(map_id: str, current_user: CurrentUser, db: Session) -> GenericMap:
    """Fetch a map the caller may see, 404ing on missing rows and missing files."""
    m = db.query(GenericMap).filter_by(id=map_id).first()
    if not m:
        raise HTTPException(404)
    assert_media_access(db, current_user, "map", m.id)
    if not os.path.exists(m.filepath):
        if not m.is_missing:
            m.is_missing = True
            db.commit()
        raise HTTPException(404, "File not found on disk")
    return m


def serve_map_vtt_image(
    map_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Serve the battlemap image embedded in a Universal VTT file.

    The .uvtt envelope carries the picture as base64, so handing the raw file to
    the browser would mean shipping (and decoding) a string a third larger than
    the image. This decodes server-side and returns an ordinary image response.
    """
    m = _load_accessible_map(map_id, current_user, db)
    if not is_vtt_data(m.filename):
        raise HTTPException(400, "Not a Universal VTT map")
    try:
        raw = vtt_image_bytes(m.filepath)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    return StreamingResponse(
        io.BytesIO(raw), media_type=_sniff_image_mime(raw), headers=_PAGE_CACHE_HEADERS
    )


def get_map_vtt_data(
    map_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Grid, wall, portal, and light counts parsed from a Universal VTT file."""
    m = _load_accessible_map(map_id, current_user, db)
    if not is_vtt_data(m.filename):
        raise HTTPException(400, "Not a Universal VTT map")
    try:
        return vtt_metadata(m.filepath)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


def serve_map_thumbnail(
    map_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.query(GenericMap).filter_by(id=map_id).first()
    if not m:
        raise HTTPException(404)
    assert_media_access(db, current_user, "map", m.id)
    # A gallery of thousands of maps hits this route once per visible card, so an
    # uncached response means the whole grid is re-downloaded on every visit and
    # every scroll back. The ETag carries the content token (not the path-derived
    # filename, which cannot tell a replaced image from the original), so a client
    # holding a stale thumbnail still finds out — mirroring books' cover route.
    etag = f'"{content_token(m.content_hash, m.filepath)}"'
    if etag_matches(request, etag):
        return Response(status_code=304, headers={"ETag": etag, **_THUMBNAIL_CACHE_HEADERS})
    headers = {**_THUMBNAIL_CACHE_HEADERS, "ETag": etag}
    title = Path(m.filename).stem.replace("_", " ").replace("-", " ")
    slug = slugify(title)
    fhash = hashlib.md5(m.filepath.encode()).hexdigest()[:8]
    thumb_path = os.path.join(THUMB_DIR, "maps", f"{slug}_{fhash}.webp")
    if os.path.exists(thumb_path):
        return FileResponse(thumb_path, media_type="image/webp", headers=headers)
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
    bulk_service.apply_updates(db, "map", m, data.model_dump(exclude_none=True))
    db.commit()
    return {"status": "ok"}


def bulk_update_maps(
    data: MapBulkUpdate,  # type: ignore[valid-type]
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Apply per-map edits for a whole selection in one transaction (issue #270)."""
    return bulk_service.run_bulk_update(
        db,
        "map",
        list(data.items),  # type: ignore[attr-defined]
        payload_for=lambda item: item.model_dump(exclude_none=True, exclude={"id"}),
        not_found_detail="Map not found",
    )


def bulk_add_map_tags(
    data: BulkAddTags,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Additively tag a whole selection of maps in one transaction."""
    return bulk_service.run_bulk_add_tags(
        db, "map", data.ids, data.tags, not_found_detail="Map not found"
    )


def bulk_update_map_folders(
    data: BulkFolderTags,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Set tags on many map folders in one transaction."""
    folders = []
    for entry in data.folders:
        internals = tag_service.upsert_folder_tags(
            db, MapFolder, entry.path, entry.tags, category="map"
        )
        folders.append({"path": entry.path, "tags": internals})
    db.commit()
    return {"folders": folders}
