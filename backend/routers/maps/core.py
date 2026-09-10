"""Map CRUD, file-serving, and folder-tagging endpoints."""
import hashlib
import io
import json
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
    PAGE_CACHE_DIR,
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
from ._schemas import FolderTagsUpdate, MapBulkUpdate, MapUpdate, VttAuthoringUpdate
from .uvtt import build_uvtt, check_grid_plausible, resolve_grid
from .vtt_authoring import VttDataError, doc_counts, normalize_vtt_data

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
    # Ordered by path, not filename: the gallery groups by folder and sorts the
    # folders by name, so ordering the query this way makes the first page the
    # first folders as they will actually be displayed. Paging by filename
    # instead scattered each page across the whole tree, and every later page
    # then inserted rows *above* what the user was already looking at.
    q = q.order_by(GenericMap.relative_path)
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
    vkinds = variants.variant_kinds(db, GenericMap, [m.id for m in maps])
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
                "variant_kinds": vkinds.get(m.id, []),
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
    img_info = _map_image_info(
        m.filepath, m.relative_path, (m.grid_width, m.grid_height, m.grid_px)
    )
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
        "grid_width": m.grid_width,
        "grid_height": m.grid_height,
        "grid_px": m.grid_px,
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


def export_map_uvtt(
    map_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Export a raster map as a Universal VTT file (issue #125).

    Carries the image, the grid, and whatever walls, doors and lights the GM
    authored in the editor (issues #126/#127) -- empty arrays when nothing has
    been. The grid is the user's manual override when set, otherwise the
    detected one, otherwise a default.

    The file is assembled here and returned as a download. Nothing is written
    into the library: the source image is never modified and no sidecar .uvtt
    appears beside it.

    The result is cached on disk: re-encoding a 5700x7700 battlemap to WebP and
    base64 is real work, and a download that gets retried should not pay it
    twice. Keyed on mtime, so replacing the file on disk invalidates the export.
    """
    m = _load_accessible_map(map_id, current_user, db)
    if not os.path.exists(m.filepath):
        raise HTTPException(404, "File not found on disk")
    # Raster only. A PDF, video, archive or an existing .uvtt has nothing to
    # export here — the last one is already in the target format.
    opaque = Path(m.filepath).suffix.lower() in MAP_OPAQUE_EXTS
    if _is_pdf(m.filepath) or archive_ext(m.filename) or opaque:
        raise HTTPException(400, "Only image maps can be exported to Universal VTT")

    # A map already linked to a real Universal VTT file has nothing to gain from
    # this export: the linked file carries walls, doors and lights, and ours
    # would carry none of them. What makes them a pair is the variant link, not
    # the filename -- the duplicate manager lets a user link two files whatever
    # they are called -- so check the family. `variant_kind` is the signal when
    # the link was categorised; a link made without one falls back to the
    # sibling's extension.
    _, siblings = variants.family_for(db, GenericMap, m)
    if any(
        s.id != m.id and (s.variant_kind == "universal-vtt" or is_vtt_data(s.filename))
        for s in siblings
    ):
        raise HTTPException(400, "This map is already linked to a Universal VTT file")

    info = _map_image_info(m.filepath, m.relative_path, (m.grid_width, m.grid_height, m.grid_px))
    if not info.get("pixel_width"):
        raise HTTPException(400, "Map image could not be read")
    grid = resolve_grid(m, info)

    try:
        mtime = int(os.path.getmtime(m.filepath))
    except OSError:
        mtime = 0
    # Hash the DB-sourced filepath plus the grid, never user input, so no
    # tainted data reaches the filesystem path.
    # The authored geometry is part of the identity of the export: editing a
    # wall must not serve the previously cached file. Hashed as its canonical
    # JSON so the key stays a fixed length whatever the map holds.
    doc_key = hashlib.sha1(
        json.dumps(m.vtt_data or {}, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()[:16]
    key = f"{m.filepath}:{mtime}:{grid['width']}x{grid['height']}@{grid['px']}:{doc_key}"
    cache_path = os.path.join(
        PAGE_CACHE_DIR, f"uvtt_{hashlib.sha1(key.encode()).hexdigest()[:16]}.uvtt"
    )
    if os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            payload = f.read()
    else:
        payload = json.dumps(build_uvtt(m.filepath, grid, m.vtt_data)).encode("utf-8")
        try:
            with open(cache_path, "wb") as f:
                f.write(payload)
        except OSError as e:  # a full or read-only cache must not fail the export
            logger.warning(f"Could not cache UVTT export: {e}")

    # Slugify the stem only, then append the extension: slugify strips the dot,
    # so slugifying the whole filename would yield "the-villageuvtt" -- no
    # extension at all, which the browser then saves as a .json.
    name = f"{slugify(Path(m.filename).stem) or 'map'}.uvtt"
    return Response(
        content=payload,
        # Not application/json: this is a file to save, not an API payload, and
        # a JSON content type makes the browser offer it as .json.
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


def get_map_authoring(
    map_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The authored walls/portals/lights for a map, for the editor to load.

    Returns the resolved grid alongside the geometry so the editor can draw its
    overlay without a second request, and reports the pixels_per_grid the
    geometry was *authored* at. When that disagrees with the map's current grid,
    the stored coordinates no longer line up with the image -- the editor warns
    rather than silently redrawing walls in the wrong place.
    """
    m = _load_accessible_map(map_id, current_user, db)
    info = _map_image_info(m.filepath, m.relative_path, (m.grid_width, m.grid_height, m.grid_px))
    grid = resolve_grid(m, info)
    doc = m.vtt_data or None
    return {
        "map_id": m.id,
        "filename": m.filename,
        "pixel_width": info.get("pixel_width"),
        "pixel_height": info.get("pixel_height"),
        "grid": {
            "width": grid["width"],
            "height": grid["height"],
            "cell_px": grid["px"],
            "source": grid["source"],
        },
        "data": doc,
        **doc_counts(doc),
    }


def update_map_authoring(
    map_id: str,
    payload: VttAuthoringUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Replace a map's authored Universal VTT geometry.

    A whole-document PUT rather than per-feature routes: the editor holds the
    entire drawing in memory and one atomic replace is what "save" means there.

    Nothing is written to the library -- this only updates the map row. The
    .uvtt itself is built on demand by the export endpoint, so the user's own
    files are never modified and no sidecar appears beside them.
    """
    m = db.query(GenericMap).filter_by(id=map_id).first()
    if not m:
        raise HTTPException(404)
    try:
        doc = normalize_vtt_data(payload.data.model_dump() if payload.data else None)
    except VttDataError as e:
        raise HTTPException(400, str(e)) from None
    m.vtt_data = doc
    db.commit()
    return {"status": "ok", **doc_counts(doc)}


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
    payload = data.model_dump(exclude_none=True)
    # A grid field sent explicitly as 0 means "drop the override and go back to
    # detection". The validator normalises that 0 to None, which exclude_none
    # would then swallow, so the clear is re-applied from the raw request fields.
    sent = data.model_fields_set
    for field in ("grid_width", "grid_height", "grid_px"):
        if field in sent and getattr(data, field) is None:
            payload[field] = None
    bulk_service.apply_updates(db, "map", m, payload)
    db.commit()

    # Advisory only: an implausible grid is still saved, because some maps
    # genuinely have one. The UI surfaces this as a confirmable notice.
    warning = None
    if m.grid_width and m.grid_height:
        info = _map_image_info(m.filepath, m.relative_path)
        warning = check_grid_plausible(
            info.get("pixel_width"), info.get("pixel_height"), m.grid_width, m.grid_height
        )
    return {"status": "ok", "grid_warning": warning}


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
