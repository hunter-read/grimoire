"""Library scan-status, rescan, and stats endpoints."""
import sys
import time
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header, Request
from sqlalchemy.orm import Session
from sqlalchemy import func

from ...config import (
    LIBRARY_PATH,
    VERSION,
    COMMIT_HASH,
    DISABLE_VERSION_CHECKING,
    get_db,
)
from ...models import GameSystem, Book, GenericMap, Token, Audio
from ...auth import require_admin, optional_get_current_user, get_current_user, CurrentUser
from ...indexer import resolve_scope
from ...security import AUTH_RATE_LIMIT, limiter
from ...services import access_control, variants
from ..settings import get_stats_api_key
from . import _helpers
from ._schemas import (
    AboutResponse,
    LatestReleaseResponse,
    RescanRequest,
    ScanStatusResponse,
    StatsResponse,
    StatusResponse,
)

router = APIRouter(tags=["library"])
public_router = APIRouter(prefix="/api", tags=["library"])


@router.get(
    "/scan-status",
    summary="Scan status",
    description="Returns current scan state: running, phase (scanning|indexing), progress counters, and new-item counts from the last scan.",
    response_model=ScanStatusResponse,
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
    response_model=StatusResponse,
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
    response_model=StatusResponse,
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
    response_model=StatsResponse,
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

    # Book counts are scoped to what the caller may actually see (issue #258):
    # a sidebar reading "340 books" over a library showing 320 discloses both
    # that restricted books exist and exactly how many. The API-key path has no
    # user and is an admin-configured integration, so it keeps the full totals.
    def _books(q):
        if user is None:
            return q
        return access_control.visible_books(db, q, access_control.load_user(db, user))

    return {
        # Container folders are shelves, not systems, so they are excluded — but
        # the systems nested inside them do count (issues #261/#262). A one-page
        # container carries both flags; its children carry neither.
        "game_systems": db.query(GameSystem)
        .filter(GameSystem.is_system_agnostic != True)  # noqa: E712
        .filter(GameSystem.is_one_page != True)  # noqa: E712
        .filter(func.coalesce(GameSystem.container_kind, "") == "")
        .count(),
        # Item counts exclude variants: a printer-friendly cut is the same book,
        # and counting it twice would contradict what the library view shows.
        # Bytes are the opposite case — every variant is a real file on the
        # disk, so total_size_mb deliberately counts them all (issues #304/#306).
        "books": _books(variants.parents_only(db.query(Book), Book)).count(),
        "maps": variants.parents_only(db.query(GenericMap), GenericMap).count(),
        "tokens": variants.parents_only(db.query(Token), Token).count(),
        "audio": variants.parents_only(db.query(Audio), Audio).count(),
        "indexed_books": _books(
            variants.parents_only(db.query(Book).filter_by(indexed=True), Book)
        ).count(),
        "total_pages": _books(
            db.query(func.sum(Book.page_count)).filter(variants.parent_filter(Book))
        ).scalar()
        or 0,
        "total_size_mb": round(
            (_books(db.query(func.sum(Book.file_size))).scalar() or 0) / 1048576, 1
        ),
    }


@router.get(
    "/about",
    summary="Build information",
    description=(
        "Returns the app version, commit hash, and Python version for the About "
        "dialog. Login required - deliberately not exposed on the API-key-gated "
        "/stats endpoint so build details aren't leaked to external integrations."
    ),
    response_model=AboutResponse,
)
def get_about(_: CurrentUser = Depends(get_current_user)):
    return {
        "version": VERSION,
        "commit_hash": COMMIT_HASH,
        "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
    }


GITHUB_REPO = "hunter-read/grimoire"
_LATEST_RELEASE_TTL = 3600  # seconds
# (fetched_at, latest_version) — module-level cache so we proxy GitHub at most
# once an hour regardless of how many clients poll.
_latest_release_cache: tuple[float, Optional[str]] = (0.0, None)


def _fetch_latest_release() -> Optional[str]:
    """Return the newest release tag (without a leading ``v``), or ``None``.

    Proxies GitHub's releases API server-side so the browser makes only a
    same-origin request — third-party request blockers can't break the update
    check. Any failure (network, rate limit, no releases) yields ``None``.
    """
    if DISABLE_VERSION_CHECKING:
        return None
    global _latest_release_cache
    now = time.monotonic()
    fetched_at, cached = _latest_release_cache
    if cached is not None and now - fetched_at < _LATEST_RELEASE_TTL:
        return cached
    latest: Optional[str] = None
    try:
        resp = httpx.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest",
            headers={"Accept": "application/vnd.github+json"},
            timeout=5.0,
        )
        if resp.status_code == 200:
            tag = resp.json().get("tag_name")
            if isinstance(tag, str) and tag:
                latest = tag.lstrip("v")
    except httpx.HTTPError:
        latest = None
    _latest_release_cache = (now, latest)
    return latest


@router.get(
    "/latest-release",
    summary="Latest published release",
    description=(
        "Returns the latest GitHub release version for the update-available check. "
        "Proxied server-side (and cached) so the browser makes a same-origin request "
        "that privacy browsers and request blockers won't block. Login required."
    ),
    response_model=LatestReleaseResponse,
)
def get_latest_release(_: CurrentUser = Depends(get_current_user)):
    return {"latest_version": _fetch_latest_release()}
