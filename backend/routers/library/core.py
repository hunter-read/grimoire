"""Library scan-status, rescan, and stats endpoints."""
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header
from sqlalchemy import func

from ...config import SessionLocal, VERSION
from ...models import GameSystem, Book, GenericMap, Token
from ...auth import require_admin, optional_get_current_user, CurrentUser
from ..settings import get_stats_api_key
from . import _helpers

router = APIRouter(tags=["library"])
public_router = APIRouter(prefix="/api", tags=["library"])


@router.get(
    "/scan-status",
    summary="Scan status",
    description="Returns current scan state: running, phase (scanning|indexing), progress counters, and new-item counts from the last scan.",
)
def get_scan_status(_: CurrentUser = Depends(require_admin)):
    return _helpers._get_status()


@router.post(
    "/rescan",
    summary="Rescan and reindex library",
    description="Triggers a background rescan of the library directory, adding new files and indexing unindexed PDFs. Admin role required.",
)
def rescan_library(
    background_tasks: BackgroundTasks, _: CurrentUser = Depends(require_admin)
):
    if _helpers._scan_status["running"]:
        return {"status": "already_running"}
    background_tasks.add_task(_helpers.run_rescan_sync)
    return {"status": "scan_started"}


@router.post(
    "/cancel-scan",
    summary="Cancel running scan",
    description="Requests a graceful stop of the currently running library scan or indexing job. Admin role required.",
)
def cancel_scan(_: CurrentUser = Depends(require_admin)):
    if not _helpers._get_status()["running"]:
        return {"status": "not_running"}
    _helpers.request_stop()
    return {"status": "stop_requested"}


@public_router.get(
    "/stats",
    summary="Library statistics",
    description="Returns library counts and version. Accepts either a valid JWT (Authorization: Bearer) or a configured X-API-Key header for external integrations.",
)
def get_stats(
    x_api_key: Optional[str] = Header(default=None),
    user=Depends(optional_get_current_user),
):
    db = SessionLocal()
    try:
        if user is None:
            stored_key = get_stats_api_key(db)
            if not stored_key or x_api_key != stored_key:
                raise HTTPException(401, "Authentication required")
        return {
            "game_systems": db.query(GameSystem).count(),
            "books": db.query(Book).count(),
            "maps": db.query(GenericMap).count(),
            "tokens": db.query(Token).count(),
            "indexed_books": db.query(Book).filter_by(indexed=True).count(),
            "total_pages": db.query(func.sum(Book.page_count)).scalar() or 0,
            "total_size_mb": round((db.query(func.sum(Book.file_size)).scalar() or 0) / 1048576, 1),
            "version": VERSION,
        }
    finally:
        db.close()
