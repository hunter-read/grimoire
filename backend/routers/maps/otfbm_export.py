"""OTFBM export routes and the cached background they serve (issue #551).

The sizing rules live in ``otfbm.py``; this module applies them to a library
map. The background is cached on disk because it is not a one-off download:
a share link made from it is fetched by OTFBM on every render of the map -
every token moved in a play-by-post game - and resizing a large battlemap each
time would be wasted work.

Setting a map up for OTFBM is offered only to users who may create share
links: the point of it is a background OTFBM can fetch, which is a share link.
"""
import hashlib
import io
import os
from pathlib import Path
from typing import Optional

from fastapi import Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import PAGE_CACHE_DIR, get_db, logger
from ...indexer import is_vtt_data, slugify
from ...models import GenericMap, User
from ...services import share_links as share_policy
from ._helpers import _sniff_image_mime, vtt_image_bytes
from .core import _export_grid, _has_single_raster, _load_accessible_map
from .otfbm import MAX_CELL, MIN_CELL, plan_otfbm, render_otfbm_image


def otfbm_filename(m: GenericMap, plan: dict, ext: str) -> str:
    """``<slug>-<W>x<H>c<cell>.<ext>``, after the convention shared OTFBM maps
    use, so the file says how to set it up wherever it ends up."""
    stem = slugify(Path(m.filename).stem) or "map"
    return f"{stem}-{plan['width']}x{plan['height']}c{plan['cell']}.{ext}"


def otfbm_plan(m: GenericMap, cell: Optional[int]) -> dict:
    """The OTFBM setup for a map. 400 for a map with no single picture."""
    if not _has_single_raster(m):
        raise HTTPException(400, "Only image maps can be exported for OTFBM")
    info, grid = _export_grid(m, is_vtt_data(m.filename))
    return plan_otfbm(grid, info["pixel_width"], info["pixel_height"], cell)


def otfbm_background(m: GenericMap, cell: Optional[int]) -> tuple[dict, bytes, str]:
    """``(plan, image bytes, extension)`` for a map's OTFBM background.

    Cached on disk, keyed on the file's mtime and the planned sizes, so a
    replaced file or a corrected grid renders afresh. The key is built from DB
    values only, never request input.
    """
    plan = otfbm_plan(m, cell)
    try:
        mtime = int(os.path.getmtime(m.filepath))
    except OSError:
        mtime = 0
    key = (
        f"{m.filepath}:{mtime}:{plan['image_width']}x{plan['image_height']}:"
        f"{plan['width']}x{plan['height']}c{plan['cell']}"
    )
    cache_path = os.path.join(
        PAGE_CACHE_DIR, f"otfbm_{hashlib.sha1(key.encode()).hexdigest()[:16]}.img"
    )
    if os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            raw = f.read()
        return plan, raw, "png" if _sniff_image_mime(raw) == "image/png" else "jpg"

    try:
        source = io.BytesIO(vtt_image_bytes(m.filepath)) if is_vtt_data(m.filename) else m.filepath
        raw, ext = render_otfbm_image(source, plan["image_width"], plan["image_height"])
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    try:
        with open(cache_path, "wb") as f:
            f.write(raw)
    except OSError as e:  # a full or read-only cache must not fail the export
        logger.warning(f"Could not cache OTFBM background: {e}")
    return plan, raw, ext


def _sharer_map(map_id: str, current_user: CurrentUser, db: Session) -> GenericMap:
    """A map the caller may see, for a caller who may create share links."""
    user = db.query(User).filter_by(id=current_user.id).first()
    if not share_policy.user_can_share(db, user):
        raise HTTPException(403, "Setting a map up for OTFBM needs permission to create share links")
    return _load_accessible_map(map_id, current_user, db)


def get_map_otfbm(
    map_id: str,
    cell: Optional[int] = Query(None, ge=MIN_CELL, le=MAX_CELL),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The OTFBM setup for a map: map size, cell size, image size.

    Cheap - nothing is decoded beyond what the detail page already measures -
    so the export dialog can re-ask as the user changes the cell size. Unlike
    the Universal VTT export, a raster linked to a real .uvtt is fine here:
    OTFBM has no walls or lights, so the linked file has nothing ours lacks.
    """
    return otfbm_plan(_sharer_map(map_id, current_user, db), cell)


def export_map_otfbm_image(
    map_id: str,
    cell: Optional[int] = Query(None, ge=MIN_CELL, le=MAX_CELL),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The map resized so each cell is ``cell`` pixels, as a download.

    Nothing is written into the library.
    """
    m = _sharer_map(map_id, current_user, db)
    plan, raw, ext = otfbm_background(m, cell)
    return Response(
        content=raw,
        media_type="image/png" if ext == "png" else "image/jpeg",
        headers={
            "Content-Disposition": f'attachment; filename="{otfbm_filename(m, plan, ext)}"'
        },
    )
