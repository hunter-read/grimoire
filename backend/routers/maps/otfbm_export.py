"""OTFBM export routes (issue #551).

The sizing rules live in ``services/media/otfbm.py`` and the cached background
in ``services/media/map_export.py``, which share links serve too. The background
is cached on disk because it is not a one-off download: a share link made from it
is fetched by OTFBM on every render of the map - every token moved in a
play-by-post game - and resizing a large battlemap each time would be wasted work.

Setting a map up for OTFBM is offered only to users who may create share
links: the point of it is a background OTFBM can fetch, which is a share link.
"""
from typing import Optional

from fastapi import Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ...http_headers import content_disposition
from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import GenericMap, User
from ...services import share_links as share_policy
from ...services.media.map_export import otfbm_background, otfbm_filename, otfbm_plan
from ...services.media.otfbm import MAX_CELL, MIN_CELL
from .core import _load_accessible_map


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
            "Content-Disposition": content_disposition(otfbm_filename(m, plan, ext))
        },
    )
