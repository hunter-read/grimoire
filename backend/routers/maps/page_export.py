"""Exporting pages and cut-outs from a PDF map (issue #207).

The same export the book reader offers, for the multi-page map PDFs the map
viewer pages through. Image maps already are the image, so only PDFs qualify.
"""
import os
from pathlib import Path

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_admin
from ...config import get_db
from ...models import GenericMap
from ...services.media.access import assert_media_access
from .._page_export import (
    ExportRequest,
    SaveExportRequest,
    detect_page_shapes,
    export_response,
    page_size,
    save_export,
)
from ...services.media.maps import is_pdf


def _exportable(db: Session, map_id: str, user: CurrentUser) -> GenericMap:
    """The map, if the caller may see it and it is a PDF with pages to export."""
    m = db.query(GenericMap).filter_by(id=map_id).first()
    if not m:
        raise HTTPException(404, "Map not found")
    assert_media_access(db, user, "map", m.id)
    if not is_pdf(m.filepath):
        raise HTTPException(400, "Only PDF maps have pages to export")
    if not os.path.exists(m.filepath):
        if not m.is_missing:
            m.is_missing = True
            db.commit()
        raise HTTPException(404, "File not found on disk")
    return m


def _title(m: GenericMap) -> str:
    return Path(m.filename).stem


def export_map_pages(
    map_id: str,
    body: ExportRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = _exportable(db, map_id, current_user)
    return export_response(m.filepath, _title(m), body)


def save_map_export(
    map_id: str,
    body: SaveExportRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    m = _exportable(db, map_id, current_user)
    return save_export(m.filepath, _title(m), body)


def get_map_page_size(
    map_id: str,
    page_num: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = _exportable(db, map_id, current_user)
    return page_size(m.filepath, page_num)


def detect_map_page_shapes(
    map_id: str,
    page_num: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = _exportable(db, map_id, current_user)
    return detect_page_shapes(m.filepath, page_num)
