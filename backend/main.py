"""Grimoire — Self-hosted TTRPG Library Manager."""
import fcntl
import os
import threading
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from slowapi import _rate_limit_exceeded_handler

from . import scheduler, session_creator
from .auth import get_current_user
from .security import RateLimitExceeded, SecurityHeadersMiddleware, limiter
from .config import (
    DATA_PATH,
    LIBRARY_PATH,
    OPDS_ENABLED,
    SessionLocal,
    VERSION,
    _valkey,
    logger,
)
from .routers import (
    audio as audio_router,
    auth as auth_router,
    bookmarks as bookmarks_router,
    books as books_router,
    campaigns as campaigns_router,
    downloads as downloads_router,
    export as export_router,
    favorites as favorites_router,
    library as library_router,
    logs as logs_router,
    maintenance as maintenance_router,
    maps as maps_router,
    oidc as oidc_router,
    opds as opds_router,
    search as search_router,
    settings as settings_router,
    systems as systems_router,
    tokens as tokens_router,
    users as users_router,
)
from .routers.library import run_rescan_sync
from .seed_users import seed_users

_DESCRIPTION = """
**Grimoire** is a self-hosted TTRPG library manager. All endpoints except
`/api/auth/status`, `/api/auth/setup`, and `/api/auth/login` require a valid
JWT passed as `Authorization: Bearer <token>`, or as a `?token=` query
parameter (required for browser-embedded images and file downloads).

Roles:
- **admin** — full access including user management
- **gm** — can edit metadata, rescan, and manage maps/books
- **player** — read-only access
"""

_TAGS = [
    {
        "name": "auth",
        "description": "Authentication — first-run setup, login, and token validation.",
    },
    {"name": "users", "description": "User management. **Admin only.**"},
    {"name": "library", "description": "Library-wide statistics and rescanning."},
    {
        "name": "systems",
        "description": "Game system catalog — browse and edit game system metadata.",
    },
    {
        "name": "books",
        "description": "Book catalog — browse, read, download, and edit book metadata.",
    },
    {"name": "maps", "description": "Map gallery — browse, tag, and download battle maps."},
    {"name": "audio", "description": "Audio library — browse, tag, stream, and download tracks."},
    {"name": "search", "description": "Full-text search across all indexed book pages."},
    {
        "name": "campaigns",
        "description": "Campaign management — sessions, members, resources, and scheduling.",
    },
    {"name": "settings", "description": "Application settings. **Admin only.**"},
    {"name": "maintenance", "description": "Admin housekeeping tasks."},
    {"name": "logs", "description": "Application log retrieval. **Admin only.**"},
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Only one worker should run the startup scan; others skip via file lock.
    lock_path = os.path.join(DATA_PATH, ".scan.lock")
    lock_file = open(lock_path, "w")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        logger.info("Startup scan already running in another worker, skipping.")
        lock_file.close()
        yield
        return

    def do_scan():
        from .routers.library._helpers import clear_stop, _set_status, _DEFAULT_STATUS
        # Clear any stale scan state left in Valkey from a previous crashed/frozen run.
        clear_stop()
        _set_status({**_DEFAULT_STATUS})
        try:
            # If OCR is available, re-queue any books previously skipped as
            # image-only so this scan runs them through OCR.
            from . import ocr

            db = SessionLocal()
            try:
                ocr.requeue_image_only_books(db)
            except Exception as e:
                logger.error(f"Couldn't queue scanned books for text recognition: {e}")
            finally:
                db.close()

            logger.info("Scanning your library…")
            logger.debug(f"Library path: {LIBRARY_PATH}")
            run_rescan_sync()
        finally:
            fcntl.flock(lock_file, fcntl.LOCK_UN)
            lock_file.close()

    threading.Thread(target=do_scan, daemon=True).start()

    db = SessionLocal()
    try:
        seed_users(db, DATA_PATH)
    finally:
        db.close()

    from . import wiki_category_migration, wiki_migration

    db = SessionLocal()
    try:
        # Roll legacy session notes into pages first, then convert the flat
        # note-categories (including any "Session Notes" one just created) into
        # nested parent pages.
        wiki_migration.migrate(db)
        wiki_category_migration.migrate(db)
    except Exception as e:
        logger.error(f"Wiki migration error: {e}")
    finally:
        db.close()

    if not os.getenv("PYTEST_CURRENT_TEST"):
        db = SessionLocal()
        try:
            scheduler.apply(db)
        finally:
            db.close()
        session_creator.start()

    yield


app = FastAPI(
    title="Grimoire",
    version=VERSION,
    description=_DESCRIPTION,
    openapi_tags=_TAGS,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# Rate limiting on auth endpoints (see backend/security.py) and security
# headers on every response.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SecurityHeadersMiddleware)

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
_assets_dir = os.path.join(FRONTEND_DIR, "assets")
if os.path.isdir(_assets_dir):
    app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

# --- Public (unauthenticated) routes -----------------------------------------
@app.get("/api/health", tags=["maintenance"], summary="Liveness/readiness probe")
def health():
    """Unauthenticated readiness probe used by the container HEALTHCHECK.

    Verifies the app can reach its dependencies: the database (always) and the
    Valkey/Redis page cache (only when configured). Returns HTTP 200 with a
    per-check status when everything is reachable, and HTTP 503 otherwise so
    orchestrators mark a wedged container unhealthy rather than "up".
    """
    checks = {}
    healthy = True

    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        checks["database"] = "error"
        healthy = False
    finally:
        db.close()

    if _valkey is not None:
        try:
            _valkey.ping()
            checks["valkey"] = "ok"
        except Exception:
            checks["valkey"] = "error"
            healthy = False

    body = {"status": "ok" if healthy else "unhealthy", "checks": checks}
    return JSONResponse(body, status_code=200 if healthy else 503)


app.include_router(auth_router.public_router)
app.include_router(oidc_router.public_router)
app.include_router(library_router.public_router)
if OPDS_ENABLED:
    app.include_router(opds_router.router)

# --- Authenticated /api/* routes ---------------------------------------------
api = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])
api.include_router(auth_router.router)
api.include_router(oidc_router.router)
api.include_router(users_router.router)
api.include_router(systems_router.router)
api.include_router(books_router.router)
api.include_router(maps_router.router)
api.include_router(tokens_router.router)
api.include_router(audio_router.router)
api.include_router(library_router.router)
api.include_router(search_router.router)
api.include_router(campaigns_router.router)
api.include_router(favorites_router.router)
api.include_router(bookmarks_router.router)
api.include_router(downloads_router.router)
api.include_router(export_router.router)
api.include_router(settings_router.router)
api.include_router(maintenance_router.router)
api.include_router(logs_router.router)
app.include_router(api)


@app.get("/{full_path:path}")
def serve_frontend(full_path: str, _: Request):
    frontend_real = os.path.realpath(FRONTEND_DIR)
    candidate = os.path.realpath(os.path.join(FRONTEND_DIR, full_path))
    if full_path and candidate.startswith(frontend_real + os.sep) and os.path.isfile(candidate):
        return FileResponse(candidate)
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(
            index_path,
            headers={"Cache-Control": "no-store"},
        )
    return JSONResponse({"error": "Frontend not found"}, status_code=500)
