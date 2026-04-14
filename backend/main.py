"""Grimoire — Self-hosted TTRPG Library Manager."""
import os
import fcntl
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, APIRouter, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from .config import DATA_PATH, LIBRARY_PATH, SessionLocal, VERSION, logger
from .seed_users import seed_users
from .routers import maps as maps_router
from .routers import tokens as tokens_router
from .auth import get_current_user
from .routers import auth as auth_router
from .routers import users as users_router
from .routers import systems as systems_router
from .routers import books as books_router
from .routers import library as library_router
from .routers import search as search_router
from .routers import favorites as favorites_router
from .routers import bookmarks as bookmarks_router
from .routers import maintenance as maintenance_router
from .routers import settings as settings_router
from .routers import campaigns as campaigns_router
from .routers import logs as logs_router
from .routers import downloads as downloads_router
from .routers.library import run_rescan_sync
from . import scheduler
from . import session_creator

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
            logger.info(f"Scanning library at {LIBRARY_PATH}...")
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

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
_assets_dir = os.path.join(FRONTEND_DIR, "assets")
if os.path.isdir(_assets_dir):
    app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

app.include_router(auth_router.public_router)
app.include_router(library_router.public_router)

api = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])
api.include_router(auth_router.router)
api.include_router(users_router.router)
api.include_router(systems_router.router)
api.include_router(books_router.router)
api.include_router(library_router.router)
api.include_router(search_router.router)
api.include_router(maps_router.router)
api.include_router(tokens_router.router)
api.include_router(favorites_router.router)
api.include_router(bookmarks_router.router)
api.include_router(maintenance_router.router)
api.include_router(settings_router.router)
api.include_router(campaigns_router.router)
api.include_router(logs_router.router)
api.include_router(downloads_router.router)
app.include_router(api)


@app.get("/{full_path:path}")
def serve_frontend(full_path: str, _: Request):
    frontend_real = os.path.realpath(FRONTEND_DIR)
    candidate = os.path.realpath(os.path.join(FRONTEND_DIR, full_path))
    if full_path and candidate.startswith(frontend_real + os.sep) and os.path.isfile(candidate):
        return FileResponse(candidate)
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse({"error": "Frontend not found"}, status_code=500)
