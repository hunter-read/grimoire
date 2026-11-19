"""Library scan-status, rescan, and stats endpoints."""
import sys
import time
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from ...config import (
    LIBRARY_PATH,
    VERSION,
    COMMIT_HASH,
    DISABLE_VERSION_CHECKING,
    get_db,
    logger,
    valkey_client,
)
from ...models import Model3D, GameSystem, Book, GenericMap, Token, Audio
from ...models.game_types import GAME_TYPE_WARGAME
from ...auth import require_admin, require_not_guest, get_current_user, CurrentUser
from ...indexer import resolve_scope
from ...services import access_control, changelog, variants
from ...services.library_scan import runner
from ._schemas import (
    AboutResponse,
    ChangelogResponse,
    LatestReleaseResponse,
    RescanRequest,
    ScanStatusResponse,
    StatsResponse,
    StatusResponse,
)

router = APIRouter(tags=["library"])
# /stats has a tag of its own so an API key can be given the counts a dashboard
# widget needs without also being able to start or cancel a rescan (issue #489).
stats_router = APIRouter(tags=["stats"])


@router.get(
    "/scan-status",
    summary="Scan status",
    description="Returns current scan state: running, phase (scanning|indexing), progress counters, and new-item counts from the last scan.",
    response_model=ScanStatusResponse,
)
def get_scan_status(_: CurrentUser = Depends(require_admin)):
    return runner.get_status()


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
    if runner.scan_in_progress():
        return {"status": "already_running"}
    background_tasks.add_task(
        runner.run_rescan_sync,
        scope_path=req.scope,
        metadata_mode=req.metadata_mode,
    )
    return {"status": "scan_started"}


@router.post(
    "/cancel-scan",
    summary="Cancel running scan",
    description=(
        "Requests a graceful stop of the currently running library scan or indexing job "
        "(`stop_requested`). A scan whose process died - its heartbeat has not moved for "
        "five minutes - is cleared outright instead (`cleared_stale`). Admin role required."
    ),
    response_model=StatusResponse,
)
def cancel_scan(_: CurrentUser = Depends(require_admin)):
    """Stop a running scan, or clear one that is no longer running at all.

    Asking a live scan to stop only sets a flag for its thread to notice. A scan
    whose process died leaves that flag pointing at nothing and the status
    ``running`` until Valkey expires it a day later, refusing every rescan in
    the meantime (issue #524). A status whose heartbeat has gone stale is
    cleared here directly - the only recovery the UI has short of a restart.
    """
    status = runner.get_status()
    if not status["running"]:
        # Without Valkey each worker has its own status, and the startup scan
        # may be running on another one (issue #651).
        if valkey_client() is None and runner.startup_scan_running():
            runner.request_stop()
            return {"status": "stop_requested"}
        return {"status": "not_running"}
    if runner.is_stale(status):
        runner.force_clear()
        logger.warning(
            "Cleared a stuck library scan (no sign of life since %s).", status.get("heartbeat")
        )
        return {"status": "cleared_stale"}
    runner.request_stop()
    return {"status": "stop_requested"}


def _book_bytes(db: Session, scope, *criteria) -> int:
    """Total bytes of the books the caller may see, variants included."""
    # int(): PostgreSQL sums a BIGINT as NUMERIC, which arrives as a Decimal.
    return int(scope(db.query(func.sum(Book.file_size)).filter(*criteria)).scalar() or 0)


def _megabytes(size: int) -> float:
    return round(size / 1048576, 1)


@stats_router.get(
    "/stats",
    summary="Library statistics",
    description=(
        "Returns library counts. Accepts a session, or an `X-API-Key` with the "
        "`stats` permission for external integrations such as Homepage. "
        "Guests are refused: the counts describe the whole library."
    ),
    response_model=StatsResponse,
)
def get_stats(
    user: CurrentUser = Depends(require_not_guest),
    db: Session = Depends(get_db),
):
    # Book counts are scoped to what the caller may actually see (issue #258):
    # a sidebar reading "340 books" over a library showing 320 discloses both
    # that restricted books exist and exactly how many. An API key counts as its
    # owner, so an admin's key sees the full totals.
    access_user = access_control.load_user(db, user)

    def _books(q):
        return access_control.visible_books(db, q, access_user)

    def _systems(*criteria) -> int:
        # Container folders are shelves, not systems, so they are excluded — but
        # the systems nested inside them do count (issues #261/#262). A one-page
        # container carries both flags; its children carry neither. Only the
        # systems this user can see are counted, like the books.
        return (
            access_control.visible_systems(db, db.query(GameSystem), access_user)
            .filter(GameSystem.is_system_agnostic != True)  # noqa: E712
            .filter(GameSystem.is_one_page != True)  # noqa: E712
            .filter(func.coalesce(GameSystem.container_kind, "") == "")
            .filter(*criteria)
            .count()
        )

    def _book_count(*criteria) -> int:
        # Item counts exclude variants: a printer-friendly cut is the same book,
        # and counting it twice would contradict what the library view shows.
        # Bytes are the opposite case — every variant is a real file on the
        # disk, so the sizes deliberately count them all (issues #304/#306).
        return _books(variants.parents_only(db.query(Book).filter(*criteria), Book)).count()

    def _pages(*criteria) -> int:
        return int(
            _books(
                db.query(func.sum(Book.page_count))
                .filter(variants.parent_filter(Book))
                .filter(*criteria)
            ).scalar()
            or 0
        )

    def _variant_count(model) -> int:
        return db.query(model).filter(model.variant_parent_id.isnot(None)).count()

    def _collection_bytes(model) -> int:
        return int(db.query(func.sum(model.file_size)).scalar() or 0)

    ttrpg = Book.game_type != GAME_TYPE_WARGAME
    wargame = Book.game_type == GAME_TYPE_WARGAME
    ttrpg_system = GameSystem.game_type != GAME_TYPE_WARGAME
    wargame_system = GameSystem.game_type == GAME_TYPE_WARGAME

    book_bytes = _book_bytes(db, _books)
    collection_bytes = {
        model: _collection_bytes(model) for model in (GenericMap, Token, Audio, Model3D)
    }
    wargame_books = _book_count(wargame)
    return {
        "game_systems": _systems(),
        "ttrpg_systems": _systems(ttrpg_system),
        "wargame_systems": _systems(wargame_system),
        "books": _book_count(),
        "ttrpg_books": _book_count(ttrpg),
        "wargame_books": wargame_books,
        # The wargame books among them, from the armory/ folder, under their
        # older name. The sidebar shows the Armory only once there is
        # something in it.
        "armory_books": wargame_books,
        "maps": variants.parents_only(db.query(GenericMap), GenericMap).count(),
        "tokens": variants.parents_only(db.query(Token), Token).count(),
        "models": variants.parents_only(db.query(Model3D), Model3D).count(),
        "audio": variants.parents_only(db.query(Audio), Audio).count(),
        # The variants the counts above leave out - each a real file, such as
        # a gridless cut of a map. Books are scoped like the book counts.
        "book_variants": _books(
            db.query(Book).filter(Book.variant_parent_id.isnot(None))
        ).count(),
        "map_variants": _variant_count(GenericMap),
        "token_variants": _variant_count(Token),
        "model_variants": _variant_count(Model3D),
        "audio_variants": _variant_count(Audio),
        "indexed_books": _book_count(Book.indexed == True),  # noqa: E712
        "total_pages": _pages(),
        "ttrpg_pages": _pages(ttrpg),
        "wargame_pages": _pages(wargame),
        # ``total_size_mb`` is books only; ``library_size_mb`` adds every other
        # collection for the whole-library figure (issue #408). The book
        # portions stay access-scoped so a restricted book's bytes stay hidden.
        "total_size_mb": _megabytes(book_bytes),
        "ttrpg_size_mb": _megabytes(_book_bytes(db, _books, ttrpg)),
        "wargame_size_mb": _megabytes(_book_bytes(db, _books, wargame)),
        "maps_size_mb": _megabytes(collection_bytes[GenericMap]),
        "tokens_size_mb": _megabytes(collection_bytes[Token]),
        "models_size_mb": _megabytes(collection_bytes[Model3D]),
        "audio_size_mb": _megabytes(collection_bytes[Audio]),
        "library_size_mb": _megabytes(book_bytes + sum(collection_bytes.values())),
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


@router.get(
    "/changelog",
    summary="Release changelog",
    description=(
        "Returns the parsed contents of CHANGELOG.md for the About dialog, newest "
        "release first. Login required, matching /about - it is build information "
        "rather than public content. `releases` is empty when the running image "
        "ships without a changelog file, which the dialog treats as 'no changelog "
        "to show' rather than an error."
    ),
    response_model=ChangelogResponse,
)
def get_changelog(_: CurrentUser = Depends(get_current_user)):
    return {"releases": changelog.load_changelog()}


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
