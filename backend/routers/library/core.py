"""Library scan-status, rescan, and stats endpoints."""
import sys
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header, Request
from sqlalchemy.orm import Session
from sqlalchemy import func

from ...config import LIBRARY_PATH, VERSION, COMMIT_HASH, get_db
from ...models import GameSystem, Book, GenericMap, Token, Audio
from ...auth import require_admin, optional_get_current_user, get_current_user, CurrentUser
from ...indexer import resolve_scope
from ...security import AUTH_RATE_LIMIT, limiter
from ..settings import get_stats_api_key
from . import _helpers
from ._schemas import RescanRequest

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
    description=(
        "Triggers a background rescan, adding new files and indexing unindexed PDFs. "
        "Optionally scope to a subtree (`scope`, e.g. \"books/D&D 5e/adventure\") and "
        "re-apply sidecar metadata (`metadata_mode`: new|missing|replace). Admin role required."
    ),
)
def rescan_library(
    background_tasks: BackgroundTasks,
    body: Optional[RescanRequest] = None,
    _: CurrentUser = Depends(require_admin),
):
    req = body or RescanRequest()
    if req.scope:
        try:
            resolve_scope(LIBRARY_PATH, req.scope)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    if _helpers._get_status()["running"]:
        return {"status": "already_running"}
    background_tasks.add_task(
        _helpers.run_rescan_sync,
        scope_path=req.scope,
        metadata_mode=req.metadata_mode,
    )
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
    description="Returns library counts. Accepts either a valid JWT (Authorization: Bearer) or a configured X-API-Key header for external integrations.",
)
@limiter.limit(AUTH_RATE_LIMIT)
def get_stats(
    request: Request,
    x_api_key: Optional[str] = Header(default=None),
    user=Depends(optional_get_current_user),
    db: Session = Depends(get_db),
):
    if user is None:
        stored_key = get_stats_api_key(db)
        if not stored_key or x_api_key != stored_key:
            raise HTTPException(401, "Authentication required")
    return {
        "game_systems": db.query(GameSystem)
        .filter(GameSystem.is_system_agnostic != True)  # noqa: E712
        .count(),
        "books": db.query(Book).count(),
        "maps": db.query(GenericMap).count(),
        "tokens": db.query(Token).count(),
        "audio": db.query(Audio).count(),
        "indexed_books": db.query(Book).filter_by(indexed=True).count(),
        "total_pages": db.query(func.sum(Book.page_count)).scalar() or 0,
        "total_size_mb": round((db.query(func.sum(Book.file_size)).scalar() or 0) / 1048576, 1),
    }


@router.get(
    "/about",
    summary="Build information",
    description=(
        "Returns the app version, commit hash, and Python version for the About "
        "dialog. Login required — deliberately not exposed on the API-key-gated "
        "/stats endpoint so build details aren't leaked to external integrations."
    ),
)
def get_about(_: CurrentUser = Depends(get_current_user)):
    return {
        "version": VERSION,
        "commit_hash": COMMIT_HASH,
        "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
    }
