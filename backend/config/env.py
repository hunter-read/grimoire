"""Every environment variable the backend reads, with its default, in one place.

Each is read once, at import, through ``_raw`` - which also records its name in
``NAMES``, so ``test_env_docs.py`` can check ``docs/configuration.md`` against
this module. Reading settings is all importing this does: no file, database or
network I/O (issue #585), so the isolated worker processes and one-off scripts
can import it freely. Problems found while parsing are queued and logged by
``backend.config.startup()``.

Modules elsewhere read these through ``backend.config``, never ``os.environ``.
The exceptions, each because it runs where this module must not be imported or
because the variable is not a Grimoire setting:

* ``container_entrypoint.py`` runs as root before the app exists, to apply
  ``PUID``/``PGID`` and drop privileges; ``WORKERS`` is read by uvicorn's own
  command line in the image.
* ``addon_worker.scrub_environment`` and ``pdf_worker`` edit the environment a
  child process inherits rather than read a setting.
* ``scripts/`` are developer tooling (coverage gate, schema export).
"""
import datetime
import logging
import os
import sys
import urllib.parse
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# Every variable read below, recorded by _raw.
NAMES: set[str] = set()


def _raw(name: str) -> Optional[str]:
    """``os.environ[name]``, or None when unset. The one place the environment is read."""
    NAMES.add(name)
    return os.environ.get(name)


def _str_env(name: str, default: str) -> str:
    raw = _raw(name)
    return default if raw is None else raw


def _bool_env(name: str) -> Optional[bool]:
    """True for "true" (any case), False for anything else, None when unset."""
    raw = _raw(name)
    if raw is None:
        return None
    return raw.strip().lower() == "true"


def _int_env(name: str) -> Optional[int]:
    """Read a non-negative int env var. Unset or unparseable yields None, which
    leaves the corresponding DB setting in charge."""
    raw = _raw(name)
    if raw is None or not raw.strip():
        return None
    try:
        return max(0, int(raw.strip()))
    except ValueError:
        return None


def _seconds_env(name: str, default: int, minimum: int) -> int:
    raw = (_raw(name) or "").strip()
    try:
        return max(minimum, int(raw)) if raw else default
    except ValueError:
        return default


# Configuration problems found while parsing, logged by startup() rather than at
# import: a worker process importing this module would otherwise repeat every
# warning each time one is spawned.
_deferred_warnings: list[tuple[str, tuple]] = []


def _defer_warning(msg: str, *args: Any) -> None:
    _deferred_warnings.append((msg, args))


def _log_warning(msg: str, *args: Any) -> None:
    logging.getLogger("grimoire").warning(msg, *args)


# The repo root, three levels up from this file (backend/config/env.py).
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Ships in the repo, so it is present in a git checkout and in the source
# tarball GitHub attaches to a release. Kept in step with the tag by a guard in
# the release workflow.
_VERSION_FILE = os.path.join(_ROOT, "VERSION")


def _version_from_file() -> str:
    """The release number from the ``VERSION`` file, or ``""`` if unreadable."""
    try:
        with open(_VERSION_FILE, encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


# The Docker image bakes APP_VERSION in at build time. Everything else - a
# source checkout, a release tarball run under systemd - has no such env var,
# so fall back to the file that ships alongside the code. "unknown" is the last
# resort deliberately: a version-shaped fallback like "1.0.0" names a release
# that did exist, so a failed lookup would be indistinguishable from an ancient
# install (issue #457). Resolved on first use (see __getattr__ at the bottom),
# so importing config reads no file.
VERSION: str
NAMES.add("APP_VERSION")  # read then, by __getattr__
COMMIT_HASH = _str_env("COMMIT_HASH", "")
OPDS_ENABLED = _str_env("OPDS_ENABLED", "false").lower() == "true"
# Who may open the interactive API docs (/api/docs, /api/redoc) and the schema
# behind them (/api/openapi.json): "signed-in" (the default; a browser's
# session cookie is enough), "public", or "off". Type generation is unaffected:
# backend/scripts/export_openapi.py builds the schema from the app itself.
_API_DOCS_MODES = ("signed-in", "public", "off")
API_DOCS = _str_env("API_DOCS", "signed-in").strip().lower()
if API_DOCS not in _API_DOCS_MODES:
    _defer_warning(
        f"API_DOCS={API_DOCS!r} is not one of {', '.join(_API_DOCS_MODES)}; using signed-in."
    )
    API_DOCS = "signed-in"
# The MCP server at /mcp, for AI assistants (Claude Code, ...). Off by default;
# when on, it authenticates with API keys, so API_KEYS_ENABLED must be on too.
MCP_ENABLED = _str_env("MCP_ENABLED", "false").lower() == "true"
# Extra host names (comma-separated, optionally with :port or :*) that MCP
# clients may reach /mcp under, besides loopback and BASE_URL's host. The
# Host header is checked against them, against DNS rebinding.
MCP_ALLOWED_HOSTS = [
    h.strip().lower() for h in _str_env("MCP_ALLOWED_HOSTS", "").split(",") if h.strip()
]
# Public base URL of this instance (e.g. "https://grimoire.example.com").
# Used to build absolute links in OPDS feeds and anywhere a fully-qualified URL is needed.
BASE_URL = _str_env("BASE_URL", "http://localhost:9481").rstrip("/")

LIBRARY_PATH = _str_env("LIBRARY_PATH", "./library")
DATA_PATH = _str_env("DATA_PATH", "./data")

VALKEY_URL = _str_env("VALKEY_URL", "")

# OCR: image-only PDFs (scanned pages with no embedded text layer) can be run
# through Tesseract so their text is added to the full-text index. The default
# image bundles Tesseract + English; the `-slim` image omits it and degrades
# gracefully (image-only PDFs stay unindexed). OCR is auto-disabled when the
# tesseract binary is absent, so no config is needed to turn it off on slim.
#   OCR_ENABLED   — "false" force-disables OCR even when tesseract is present.
#   OCR_LANGUAGES — Tesseract language codes, e.g. "eng" or "eng+deu+fra".
#                   Extra languages need their tessdata files present (bundle
#                   them by mounting a tessdata dir and setting TESSDATA_PREFIX).
#   OCR_CONCURRENCY — number of scanned books OCR'd in parallel by the deferred
#                     OCR worker. Defaults to 1 (serial) to keep small self-hosted
#                     boxes responsive; raise it on multi-core hosts with spare CPU.
#                     Setting it to 0 disables OCR entirely (same effect as
#                     OCR_ENABLED=false) — a runtime off switch for users hitting
#                     repeated OCR errors or OOMs, without pulling the slim image.
#   OCR_PAGE_TIMEOUT — per-page OCR budget in seconds (see _read_ocr_page_timeout).
OCR_ENABLED = _str_env("OCR_ENABLED", "true").lower() == "true"
OCR_LANGUAGES = _str_env("OCR_LANGUAGES", "eng").strip() or "eng"

# Set false to skip the library scan that otherwise runs on every start (issue
# #651). A scan already skips unchanged files, but on a very large library even
# checking each one takes a while, and restarts for an image update or an env
# change rarely mean new files. New files then wait for a manual or scheduled
# rescan, and so do queued OCR and model previews.
def _read_startup_scan() -> bool:
    return _str_env("STARTUP_SCAN", "true").strip().lower() != "false"


STARTUP_SCAN = _read_startup_scan()

# Set true to disable the "update available" check that proxies GitHub's
# releases API. When disabled, /api/latest-release always returns null and no
# outbound request to GitHub is ever made.
DISABLE_VERSION_CHECKING = (
    _str_env("DISABLE_VERSION_CHECKING", "false").lower() == "true"
)


def _apply_configured_umask(warn: Callable[..., None] = _log_warning) -> None:
    """Set the process umask from ``UMASK``/``GRIMOIRE_UMASK`` when either is set.

    Grimoire is not always started from a shell that can set a umask — a bare
    ``docker run``, Kubernetes overriding the command, or a source install all
    land here with whatever umask they inherited (issue #428:
    k8s gives no easy way to set a process umask). Applying it in-process makes
    the variable mean the same thing however Grimoire was launched.

    Values are octal with or without a leading ``0o``/``0``, matching how umask
    is written everywhere else (``022``, ``002``, ``000``). An unparseable or
    out-of-range value is ignored with a warning rather than guessed at, so a
    typo leaves the inherited umask rather than silently widening permissions.
    """
    umask, alias = _raw("UMASK"), _raw("GRIMOIRE_UMASK")
    raw = (umask or alias or "").strip()
    if not raw:
        return
    try:
        value = int(raw, 8)
    except ValueError:
        warn("UMASK=%r is not an octal number (expected e.g. 022 or 002) - ignoring it.", raw)
        return
    if not 0 <= value <= 0o777:
        warn("UMASK=%r is out of range (expected 000-777) - ignoring it.", raw)
        return
    os.umask(value)


def _read_umask() -> int:
    """The process umask, read once at import.

    ``os.umask`` is a set-and-return with no pure getter, so reading it means
    setting it and putting it back. That is a process-global mutation and it is
    not thread-safe, which is exactly why this runs once at import — before any
    worker threads exist — rather than per file write.
    """
    current = os.umask(0o022)
    os.umask(current)
    return current


# Applied here rather than in startup(): it is process state, not I/O, and it
# has to be in force before anything - a script, a worker - writes a file.
_apply_configured_umask(_defer_warning)
UMASK = _read_umask()

# Mode for files Grimoire creates *inside the library*, where other tools and
# other users are expected to reach them (issue #387: sidecars landed 0600 and
# locked out Syncthing and Unraid's share user). 0666 before umask matches what
# a plain ``open()`` would produce, so these files get the same permissions as
# an uploaded one and the container's UMASK actually governs them.
LIBRARY_FILE_MODE = 0o666 & ~UMASK


def _read_ocr_concurrency() -> int:
    """Parallel-OCR worker count. 0 = OCR disabled; negatives clamp to 0; bad
    values fall back to the serial default of 1."""
    try:
        return max(0, int(_str_env("OCR_CONCURRENCY", "1")))
    except ValueError:
        return 1


OCR_CONCURRENCY = _read_ocr_concurrency()


#   OCR_DPI — resolution at which scanned pages are rasterized before OCR.
#             Rendering is the memory/CPU-heavy half of OCR; higher = more
#             accurate but slower and more RAM per page. Default 150.
def _read_ocr_dpi() -> float:
    try:
        dpi = float(_str_env("OCR_DPI", "150"))
    except ValueError:
        dpi = 150.0
    return max(72.0, min(dpi, 600.0))


OCR_DPI = _read_ocr_dpi()


# How much of a book its own text layer must cover before Grimoire believes the
# book really has one (issue #685).
#
# A scan sometimes carries a few text-bearing pages - a web enhancement bundled
# into the back, a digitally-set cover or appendix - and those were enough to
# make the indexer treat the whole book as text and never OCR it, leaving the
# other 95% unsearchable with no way to ask for it.
#
# 0 restores the old behaviour exactly (only a book with no text at all is
# OCR'd); 1 sends anything short of complete coverage to OCR.
def _read_ocr_min_text_coverage() -> float:
    try:
        value = float(_str_env("OCR_MIN_TEXT_COVERAGE", "0.5"))
    except ValueError:
        return 0.5
    return min(1.0, max(0.0, value))


OCR_MIN_TEXT_COVERAGE = _read_ocr_min_text_coverage()


# How much text a page must carry before it counts as a text page at all.
#
# Coverage above is measured in pages, so a page holding nothing but a running
# header or a folio counted the same as a full page of prose. A scan with its
# chapter title stamped on every page therefore scored complete coverage while
# almost none of it was searchable, and because the book looked covered it was
# never queued for OCR and Re-OCR was not offered for it either.
#
# Judging a page by how much text it carries separates the two: a header is
# tens of characters, a page of prose is thousands.
#
# 0 restores the old behaviour exactly (any text at all makes a text page).
def _read_ocr_min_page_chars() -> int:
    try:
        value = int(_str_env("OCR_MIN_PAGE_CHARS", "100"))
    except ValueError:
        return 100
    return max(0, value)


OCR_MIN_PAGE_CHARS = _read_ocr_min_page_chars()


#   MAX_IMAGE_PIXELS — ceiling for how large an image may be before Pillow
#             refuses to decode it as a possible decompression bomb. Pillow
#             warns above this and raises above twice it; its own default
#             (~89 MP) is sized for untrusted web uploads.
#
#             A library is not a web form. A 60x60in battlemap scanned at
#             300 DPI is 18000x18000 = 324 MP and entirely legitimate, and maps
#             that size index with no thumbnail and only an error in the log.
#             The decode is also far cheaper than the ceiling assumes, because
#             ``Image.thumbnail`` calls ``draft`` and a JPEG is decoded at a
#             reduced scale: a 324 MP map measures about 2s and 42 MB, not the
#             ~1 GB a full decode would cost.
#
#             Unset (0) leaves Pillow's own default untouched, so nothing
#             changes for anyone who does not set it. Set it only if you have
#             images this large and trust their source: PNG gets no ``draft``
#             benefit and would decode in full, and uploaded files reach the
#             same thumbnail path.
def _read_max_image_pixels() -> int:
    """Pixel ceiling for thumbnail decoding, or 0 to leave Pillow's default.

    Floored at 1 MP when set, so a stray small value cannot silently turn every
    thumbnail in the library into a decompression-bomb error.
    """
    try:
        value = int(_str_env("MAX_IMAGE_PIXELS", "0"))
    except ValueError:
        return 0
    return 0 if value <= 0 else max(1_000_000, value)


MAX_IMAGE_PIXELS = _read_max_image_pixels()


#   OCR_PAGE_TIMEOUT — wall-clock budget for OCR'ing a single page, in seconds.
#             A page that exceeds it is abandoned and the book continues to the
#             next one, so a pathological page can't stall a book forever. The
#             default suits typical hardware, but OCR cost is driven by page
#             *complexity* far more than page size: a dense, noisy scan can take
#             minutes on a low-power CPU where an ordinary page takes seconds
#             (issue #450). On such hardware the budget is what separates "slow
#             but fine" from "abandoned", so it is tunable rather than fixed.
#             Raising it costs nothing when pages finish early — it is a
#             ceiling, not a delay. 0 means no limit: a wedged page then blocks
#             its book's OCR indefinitely, so it is for operators who would
#             rather wait than lose text.
def _read_ocr_page_timeout() -> float:
    try:
        return max(0.0, float(_str_env("OCR_PAGE_TIMEOUT", "120")))
    except ValueError:
        return 120.0


OCR_PAGE_TIMEOUT = _read_ocr_page_timeout()


#   PAGE_RECLAIM_INTERVAL — how many page rasterizations to run between memory
#             reclaims. MuPDF is a C library: pixmaps and the images it decodes
#             to build them are allocated outside Python's heap, so gc.collect()
#             and even doc.close() free none of it. A single illustrated page can
#             decode >190MB of raw RGB (a 1.8MB JPEG becomes 32MB), and MuPDF's
#             store is process-global, so RSS climbs and then never falls back.
#             Reclaiming needs both halves: TOOLS.store_shrink() to release
#             MuPDF's C-side store, then malloc_trim() to hand the freed glibc
#             arenas back to the OS. Measured on a 300MB illustrated rulebook,
#             reclaiming every 10 renders cut peak RSS 396->264MB and the
#             settled floor 377->66MB for ~4% render time. 0 disables it.
def _read_page_reclaim_interval() -> int:
    try:
        return max(0, int(_str_env("PAGE_RECLAIM_INTERVAL", "10")))
    except ValueError:
        return 10


PAGE_RECLAIM_INTERVAL = _read_page_reclaim_interval()


#   PAGE_IDLE_RELEASE — seconds without any page render after which the reader's
#             open PDF handles are closed and the reclaim above runs once more.
#             The every-N reclaim never fires for a short session (open a book,
#             read two pages, leave), so without this the decoded images and up
#             to ten open documents stay resident until someone reads again.
#             Documents reopen on the next render. 0 disables it.
def _read_page_idle_release() -> int:
    try:
        return max(0, int(_str_env("PAGE_IDLE_RELEASE", "300")))
    except ValueError:
        return 300


PAGE_IDLE_RELEASE = _read_page_idle_release()


#   RENDER_WORKERS — how many processes render PDF, EPUB and DjVu pages (issue
#             #615). Rendering runs outside the app process so a file that
#             crashes MuPDF fails that one request instead of stopping the
#             server, and a book's pages always go to the same worker. More
#             than one lets renders of different books run in parallel, since
#             PyMuPDF holds the GIL while it rasterises. Workers start on the
#             first render and stop after PAGE_IDLE_RELEASE seconds without one,
#             which hands all of their memory back. 0 renders inside the app
#             process, as before: no crash isolation, but no extra process.
def _read_render_workers() -> int:
    try:
        return max(0, int(_str_env("RENDER_WORKERS", "1")))
    except ValueError:
        return 1


RENDER_WORKERS = _read_render_workers()


#   RENDER_QUEUE_LIMIT — how many page and tile renders may be running or
#             waiting at once in each app process (issue #701). Every one holds
#             a request thread until its render is done, and the threads are
#             shared with the whole API, so an unbounded burst (a big book
#             opened, a zoom) left nothing to answer anything else. A render
#             over the limit is answered 503 with Retry-After at once and the
#             reader asks again. Pages already rendered are never refused.
def _read_render_queue_limit() -> int:
    try:
        return max(1, int(_str_env("RENDER_QUEUE_LIMIT", "16")))
    except ValueError:
        return 16


RENDER_QUEUE_LIMIT = _read_render_queue_limit()


#   PAGE_CACHE_TTL — seconds a rendered page stays in Valkey. Rendered pages are
#             a regenerable cache, not durable data: without an expiry they
#             accumulate until Valkey hits maxmemory and starts evicting under
#             pressure (or OOMs, if no eviction policy is set). Defaults to 7
#             days; 0 means no expiry (the old behaviour).
def _read_page_cache_ttl() -> int:
    try:
        return max(0, int(_str_env("PAGE_CACHE_TTL", str(7 * 24 * 3600))))
    except ValueError:
        return 7 * 24 * 3600


PAGE_CACHE_TTL = _read_page_cache_ttl()


#   PAGE_CACHE_MAX_MB — size ceiling for the on-disk page cache. This directory
#             had no TTL, no cap, and nothing that ever deleted from it, so it
#             grew without bound. Now that cache filenames carry a content hash,
#             a replaced file's old renders become unreachable garbage, making a
#             sweep the only thing that reclaims them. Defaults to 2 GiB; 0
#             disables the sweep (unbounded, the old behaviour).
def _read_page_cache_max_mb() -> int:
    try:
        return max(0, int(_str_env("PAGE_CACHE_MAX_MB", "2048")))
    except ValueError:
        return 2048


PAGE_CACHE_MAX_MB = _read_page_cache_max_mb()

# When true, the server runs in demo mode: non-admin users (player/gm) cannot
# perform any action on their account settings page (changing display name,
# email, preferences, password, OPDS tokens, or deleting their account), and
# every hour all campaigns owned by non-admin accounts are deleted. Admin
# accounts are unaffected and retain full access. Intended for public demo
# deployments.
ENABLE_DEMO_MODE = _str_env("ENABLE_DEMO_MODE", "false").lower() == "true"

# Optional override for password authentication. When the env var is set,
# it pins the value and the admin UI shows a read-only state. When unset,
# the corresponding DB setting (password_auth_enabled) is used.
ALLOW_PASSWORD_AUTHENTICATION_ENV: Optional[bool] = _bool_env("ALLOW_PASSWORD_AUTHENTICATION")


# Optional override for guest invite codes. When set, it pins the value and the
# admin UI shows a read-only state. When unset, the DB setting
# (guest_access_enabled) is used.
GUEST_ACCESS_ENABLED_ENV: Optional[bool] = _bool_env("GUEST_ACCESS_ENABLED")

# API keys for the whole instance (issue #489). On unless set to "false", which
# turns them off for everyone, admins included: keys stop authenticating, the
# /api/api-keys endpoints refuse, and the UI hides them.
API_KEYS_ENABLED: bool = _bool_env("API_KEYS_ENABLED") is not False

# Share links for the whole instance (issue #541): public, revocable URLs for a
# single library item. On unless set to "false", which turns them off for
# everyone: every existing link stops resolving (404), creating one is refused,
# and the UI hides the share menus. Links are kept, so turning it back on
# restores them.
SHARE_LINKS_ENABLED: bool = _bool_env("SHARE_LINKS_ENABLED") is not False


#   CORS_ALLOWED_ORIGINS — comma-separated origins (scheme://host[:port]) whose
#             pages may call the API from the browser, e.g. a Foundry VTT module
#             (issue #502). Unset means no CORS headers at all, as before.
#             Entries must be exact origins: a wildcard, a path, or anything
#             that is not http(s) is ignored with a warning, so a typo cannot
#             open the API to every site. A trailing slash is tolerated, since
#             that is how an origin usually gets pasted from the address bar.
def _read_cors_allowed_origins(warn: Callable[..., None] = _log_warning) -> list[str]:
    """The configured CORS origins, normalized, in order, without duplicates."""
    origins: list[str] = []
    for entry in (_raw("CORS_ALLOWED_ORIGINS") or "").split(","):
        raw = entry.strip()
        if not raw:
            continue
        parsed = urllib.parse.urlsplit(raw.rstrip("/"))
        if (
            parsed.scheme.lower() not in ("http", "https")
            or not parsed.hostname
            or "*" in parsed.netloc
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username is not None
        ):
            warn(
                "CORS_ALLOWED_ORIGINS entry %r is not an origin like "
                "https://foundry.example.com - ignoring it.",
                raw,
            )
            continue
        origin = f"{parsed.scheme}://{parsed.netloc}".lower()
        if origin not in origins:
            origins.append(origin)
    return origins


CORS_ALLOWED_ORIGINS = _read_cors_allowed_origins(_defer_warning)


# ---------------------------------------------------------------------------
# Backups (issue #338)
# ---------------------------------------------------------------------------
# A backup is a single timestamped .zip holding a consistent snapshot of the
# SQLite database plus the user-authored files under DATA_PATH that no rescan
# could rebuild (campaign uploads, system and audio covers, branding). It deliberately
# does NOT include the library itself — that is mounted read-only and is the
# operator's to back up — nor the regenerable caches (thumbnails, page_cache).
#
# Each of these settings can be pinned by an environment variable. When
# one is set it wins over the DB value and the admin UI renders that field
# read-only, matching how password auth and OIDC are locked.
#
#   BACKUP_DIR — where backups are written. Defaults to DATA_PATH/backups.
#                Pointing this at a mount outside DATA_PATH is supported (and
#                encouraged); backups are never nested inside a backup.
#   BACKUP_SCHEDULE — "off" | "hourly" | "daily" | "weekly". Human-readable on
#                purpose: the UI offers the same four, not a cron expression.
#   BACKUP_RETENTION_COUNT — keep at most N backups. 0 = unlimited.
#   BACKUP_RETENTION_GB — keep at most N GB of backups total. 0 = unlimited.
#
# Retention prunes oldest-first and always leaves at least one backup standing,
# so a single archive larger than the GB budget is kept rather than deleted into
# nothing. Pruning runs *after* a new backup is written, so the configured
# ceiling can be exceeded for the duration of the run — sizing headroom for one
# extra archive is expected.
BACKUP_DIR_ENV: Optional[str] = _raw("BACKUP_DIR") or None
BACKUP_DIR = BACKUP_DIR_ENV or os.path.join(DATA_PATH, "backups")

_BACKUP_SCHEDULE_RAW = _raw("BACKUP_SCHEDULE")
BACKUP_SCHEDULE_ENV: Optional[str] = (
    _BACKUP_SCHEDULE_RAW.strip().lower() if _BACKUP_SCHEDULE_RAW else None
)


BACKUP_RETENTION_COUNT_ENV: Optional[int] = _int_env("BACKUP_RETENTION_COUNT")
BACKUP_RETENTION_GB_ENV: Optional[int] = _int_env("BACKUP_RETENTION_GB")


# Single kill-switch for every install that reaches out to a community
# repository: wiki note templates, metadata add-ons, and themes. When true,
# Grimoire makes no outbound request for any of them and the browse/install
# endpoints refuse.
#
# Authoring and *upload* stay available in all three cases, so a locked-down or
# air-gapped server keeps the features — it just stops fetching. External
# installs are enabled by default.
#
# Replaces WIKI_TEMPLATES_DOWNLOAD_DISABLED, which covered templates alone.
DISABLE_EXTERNAL_ADD_ON_INSTALL: bool = _bool_env("DISABLE_EXTERNAL_ADD_ON_INSTALL") or False

# Access tokens for private add-on index sources (issue #642): a JSON object
# mapping an index URL to a token, or to {"token": "...", "header": "..."}.
# A pinned source's token cannot be changed in Settings > Add-ons. Read at call
# time by ``addons.credentials``; see docs/addons.md.
ADDON_INDEX_CREDENTIALS: str = _str_env("ADDON_INDEX_CREDENTIALS", "")


# Optional override for folder-name category inference. When set, it pins the
# value and the admin UI shows a read-only state. When unset, the DB setting
# (disable_folder_category_inference) is used. true = inference disabled.
DISABLE_FOLDER_CATEGORY_INFERENCE_ENV: Optional[bool] = _bool_env(
    "DISABLE_FOLDER_CATEGORY_INFERENCE"
)


# Watching the library for changes (issue #670). Each pins its setting and
# locks it in the admin UI when set; unset leaves the DB setting in charge.
#   LIBRARY_WATCH       true/false - rescan by itself when files change.
#   LIBRARY_WATCH_MODE  auto | events | poll - how changes are noticed. "auto"
#                       polls on network shares (NFS, SMB, FUSE), where the
#                       kernel never hears about changes made from another
#                       machine, and uses filesystem events everywhere else.
LIBRARY_WATCH_ENV: Optional[bool] = _bool_env("LIBRARY_WATCH")
LIBRARY_WATCH_MODES = ("auto", "events", "poll")
_LIBRARY_WATCH_MODE_RAW = (_raw("LIBRARY_WATCH_MODE") or "").strip().lower()
LIBRARY_WATCH_MODE_ENV: Optional[str] = (
    _LIBRARY_WATCH_MODE_RAW if _LIBRARY_WATCH_MODE_RAW in LIBRARY_WATCH_MODES else None
)


# How long the library has to stay quiet before a detected change is scanned,
# so a folder still being copied is scanned once, when it is finished.
LIBRARY_WATCH_DELAY: int = _seconds_env("LIBRARY_WATCH_DELAY", 10, 1)
# In poll mode, how often the library is checked. Each check lists every folder
# and stats every file, so a large library on a slow share wants this longer.
LIBRARY_WATCH_POLL_INTERVAL: int = _seconds_env("LIBRARY_WATCH_POLL_INTERVAL", 120, 5)


# OIDC env-var pins. When set, each individual field is locked and the UI
# renders it read-only. Each env var is independent — pinning the issuer URL
# does not require pinning the client secret, etc.
OIDC_ENV: dict = {
    "oidc_enabled": _bool_env("OIDC_ENABLED"),
    "oidc_issuer_url": _raw("OIDC_ISSUER_URL"),
    "oidc_token_issuer": _raw("OIDC_TOKEN_ISSUER"),
    "oidc_authorization_endpoint": _raw("OIDC_AUTHORIZATION_ENDPOINT"),
    "oidc_token_endpoint": _raw("OIDC_TOKEN_ENDPOINT"),
    "oidc_userinfo_endpoint": _raw("OIDC_USERINFO_ENDPOINT"),
    "oidc_jwks_uri": _raw("OIDC_JWKS_URI"),
    "oidc_end_session_endpoint": _raw("OIDC_END_SESSION_ENDPOINT"),
    "oidc_client_id": _raw("OIDC_CLIENT_ID"),
    "oidc_client_secret": _raw("OIDC_CLIENT_SECRET"),
    "oidc_signing_alg": _raw("OIDC_SIGNING_ALG"),
    "oidc_button_text": _raw("OIDC_BUTTON_TEXT"),
    # Login-button appearance (issue #377). Colors are CSS hex values; the icon
    # is a path to an image file inside the container, normalized like an upload.
    "oidc_button_bg_color": _raw("OIDC_BUTTON_BG_COLOR"),
    "oidc_button_text_color": _raw("OIDC_BUTTON_TEXT_COLOR"),
    "oidc_button_border_color": _raw("OIDC_BUTTON_BORDER_COLOR"),
    "oidc_button_radius": _raw("OIDC_BUTTON_RADIUS"),
    "oidc_button_icon": _raw("OIDC_BUTTON_ICON"),
    "oidc_groups_claim": _raw("OIDC_GROUPS_CLAIM"),
    # The group that grants each role, matched by exact name (case-insensitive).
    "oidc_admin_group": _raw("OIDC_ADMIN_GROUP"),
    "oidc_gm_group": _raw("OIDC_GM_GROUP"),
    "oidc_player_group": _raw("OIDC_PLAYER_GROUP"),
    "oidc_permissions_claim": _raw("OIDC_PERMISSIONS_CLAIM"),
    "oidc_match_by": _raw("OIDC_MATCH_BY"),
    "oidc_auto_launch": _bool_env("OIDC_AUTO_LAUNCH"),
    "oidc_auto_register": _bool_env("OIDC_AUTO_REGISTER"),
}

# Timezone for all log timestamps (console output and the in-app log viewer).
# Set the standard TZ env var to an IANA zone name such as "America/Toronto"
# or "Europe/Berlin". Defaults to UTC. An unknown or unavailable zone name
# falls back to UTC with a warning rather than crashing.
def _resolve_log_timezone() -> datetime.tzinfo:
    name = (_raw("TZ") or "").strip()
    if not name or name.upper() == "UTC":
        return datetime.timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        _defer_warning(
            "Unknown timezone %r (from TZ); logging in UTC instead. "
            "Use an IANA zone name like 'America/Toronto'.",
            name,
        )
        return datetime.timezone.utc


LOG_TIMEZONE = _resolve_log_timezone()

# Console log level (default: info). The in-memory ring buffer always captures
# DEBUG+ so the /api/logs endpoint can serve debug logs regardless of it.
LOG_LEVEL: int = getattr(logging, _str_env("LOG_LEVEL", "info").upper(), logging.INFO)


# ---------------------------------------------------------------------------
# Sign-in and sessions
# ---------------------------------------------------------------------------

# The JWT signing key, when set. ``auth.SECRET_KEY`` resolves the key actually
# used on first use: this, or one generated and kept under DATA_PATH.
SECRET_KEY_ENV: Optional[str] = _raw("SECRET_KEY")


def _positive_int_env(name: str, default: int, minimum: int = 1) -> int:
    """A positive int, falling back on junk values with a (deferred) warning."""
    raw = (_raw(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        _defer_warning("%s=%r is not an integer - using the default of %d", name, raw, default)
        return default
    if value < minimum:
        _defer_warning("%s=%d is below the minimum of %d - using %d", name, value, minimum, minimum)
        return minimum
    return value


# How long an access token is valid. This is also the worst-case window between
# revoking a session and the last access token going dead, so it is deliberately
# short. Configurable because self-hosters on a trusted LAN may prefer fewer
# refreshes over a tighter revocation window.
ACCESS_TOKEN_EXPIRE_MINUTES = _positive_int_env("ACCESS_TOKEN_EXPIRE_MINUTES", 30)

# How long a session can live without any activity before the refresh token
# expires and the user must log in again. Matches the old JWT lifetime, so a
# normally-active user sees no behaviour change from before this feature.
REFRESH_TOKEN_EXPIRE_DAYS = _positive_int_env("REFRESH_TOKEN_EXPIRE_DAYS", 30)

DEFAULT_PASSWORD_MIN_LENGTH = 12
DEFAULT_SHARE_LINK_PASSWORD_MIN_LENGTH = 8


def _min_length_env(name: str, default: int) -> int:
    raw = _raw(name)
    if raw is None or not raw.strip():
        return default
    try:
        return max(1, int(raw.strip()))
    except ValueError:
        _defer_warning(
            "A minimum-length setting for passwords is not a whole number - using "
            "its default."
        )
        return default


# Minimum lengths for new passwords (see backend/passwords.py).
PASSWORD_MIN_LENGTH = _min_length_env("PASSWORD_MIN_LENGTH", DEFAULT_PASSWORD_MIN_LENGTH)
SHARE_LINK_PASSWORD_MIN_LENGTH = _min_length_env(
    "SHARE_LINK_PASSWORD_MIN_LENGTH", DEFAULT_SHARE_LINK_PASSWORD_MIN_LENGTH
)


# ---------------------------------------------------------------------------
# Rate limiting and reverse proxies (see backend/security.py)
# ---------------------------------------------------------------------------

# Per-IP limit applied to the auth endpoints. The default is generous enough for
# legitimate retyping-your-password use but shuts down automated credential
# stuffing. Format is a slowapi/limits string.
AUTH_RATE_LIMIT = _str_env("AUTH_RATE_LIMIT", "10/minute")

# Failed sign-ins and share-link unlocks counted per account and per link,
# whatever address they come from.
ACCOUNT_RATE_LIMIT = _str_env("ACCOUNT_RATE_LIMIT", "20/hour")

# Off by default under pytest so the many auth-touching tests don't trip the
# limit; the dedicated rate-limit test re-enables it explicitly. Detected via
# sys.modules because this module is imported at collection time, before any
# individual test sets PYTEST_CURRENT_TEST.
UNDER_PYTEST = "pytest" in sys.modules
RATE_LIMIT_ENABLED = (
    _str_env("RATE_LIMIT_ENABLED", "false" if UNDER_PYTEST else "true").strip().lower() == "true"
)

# Trust a reverse proxy's X-Forwarded-For header. Default on so clients behind a
# proxy don't all share the proxy's single IP bucket. Set to "false" to ignore the
# header entirely and always key on the connecting address.
TRUST_FORWARDED_FOR = _str_env("TRUST_FORWARDED_FOR", "true").strip().lower() != "false"

# Which connecting addresses count as a reverse proxy whose X-Forwarded-For is
# read (comma-separated addresses or CIDR ranges). The default is loopback and
# the range Docker gives its bridge networks, so a proxy or tunnel on the same
# host or in the same Compose project - nginx, Traefik, Caddy, Cloudflare
# Tunnel, `tailscale serve` - needs no setting.
#
# It is deliberately no wider: any client connecting from a trusted range can
# name its own address in the header. A proxy anywhere else - another machine on
# the LAN, a Kubernetes ingress, a Podman network, a VPS - is added here.
DEFAULT_TRUSTED_PROXIES = "127.0.0.0/8,::1,172.16.0.0/12"
TRUSTED_PROXIES = _str_env("TRUSTED_PROXIES", DEFAULT_TRUSTED_PROXIES)


# ---------------------------------------------------------------------------
# Grimoire Codex DB (see backend/codex/settings.py)
# ---------------------------------------------------------------------------

def _read_codex_db_api_token() -> str:
    """The token, or "" when unset or blank."""
    return (_raw("GRIMOIRE_CODEX_DB_API_TOKEN") or "").strip()


# The API token; setting it is what turns the integration on.
CODEX_DB_API_TOKEN: str = _read_codex_db_api_token()
# Pins for the Codex settings, by setting key; None leaves the DB value in charge.
CODEX_DB_ENV: dict[str, Optional[str]] = {
    "codex_url": _raw("GRIMOIRE_CODEX_DB_URL"),
    "codex_send_hashes": _raw("GRIMOIRE_CODEX_DB_SEND_HASHES"),
    "codex_sync_collection": _raw("GRIMOIRE_CODEX_DB_SYNC_COLLECTION"),
}


# Where the Dockerfile installs the purpose-built decode-only ffmpeg used for
# video thumbnails. Overridable so a dev machine can point at a system ffmpeg.
FFMPEG_BINARY = _str_env("FFMPEG_BINARY", "/usr/local/bin/ffmpeg")


def under_test_run() -> bool:
    """Whether a pytest test is running now (pytest sets PYTEST_CURRENT_TEST per test).

    Read at call time, unlike everything above: the variable changes from test
    to test. The app's lifespan uses it to leave out the schedulers and the
    library watcher.
    """
    return bool(_raw("PYTEST_CURRENT_TEST"))


def __getattr__(name: str) -> Any:
    """Module attributes resolved on first use, so importing config reads no file."""
    if name == "VERSION":
        version = _raw("APP_VERSION") or _version_from_file() or "unknown"
        globals()["VERSION"] = version
        return version
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
