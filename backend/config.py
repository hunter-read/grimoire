"""Shared configuration, database, and cache setup for Grimoire."""
import os
import logging
import collections
import threading
import datetime
from typing import Iterator, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from .models import init_db

VERSION = os.environ.get("APP_VERSION", "1.0.0")
COMMIT_HASH = os.environ.get("COMMIT_HASH", "")
OPDS_ENABLED = os.environ.get("OPDS_ENABLED", "false").lower() == "true"
# Public base URL of this instance (e.g. "https://grimoire.example.com").
# Used to build absolute links in OPDS feeds and anywhere a fully-qualified URL is needed.
BASE_URL = os.environ.get("BASE_URL", "http://localhost:9481").rstrip("/")

LIBRARY_PATH = os.environ.get("LIBRARY_PATH", "./library")
DATA_PATH = os.environ.get("DATA_PATH", "./data")
DB_PATH = os.path.join(DATA_PATH, "grimoire.db")
THUMB_DIR = os.path.join(DATA_PATH, "thumbnails")
PAGE_CACHE_DIR = os.path.join(DATA_PATH, "page_cache")
CAMPAIGN_UPLOAD_DIR = os.path.join(DATA_PATH, "campaign_uploads")
SYSTEM_COVER_DIR = os.path.join(DATA_PATH, "system_covers")
AUDIO_COVER_DIR = os.path.join(DATA_PATH, "audio_covers")
VALKEY_URL = os.environ.get("VALKEY_URL", "")

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
OCR_ENABLED = os.environ.get("OCR_ENABLED", "true").lower() == "true"
OCR_LANGUAGES = os.environ.get("OCR_LANGUAGES", "eng").strip() or "eng"

# Set true to disable the "update available" check that proxies GitHub's
# releases API. When disabled, /api/latest-release always returns null and no
# outbound request to GitHub is ever made.
DISABLE_VERSION_CHECKING = (
    os.environ.get("DISABLE_VERSION_CHECKING", "false").lower() == "true"
)


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
        return max(0, int(os.environ.get("OCR_CONCURRENCY", "1")))
    except ValueError:
        return 1


OCR_CONCURRENCY = _read_ocr_concurrency()


#   OCR_DPI — resolution at which scanned pages are rasterized before OCR.
#             Rendering is the memory/CPU-heavy half of OCR; higher = more
#             accurate but slower and more RAM per page. Default 150.
def _read_ocr_dpi() -> float:
    try:
        dpi = float(os.environ.get("OCR_DPI", "150"))
    except ValueError:
        dpi = 150.0
    return max(72.0, min(dpi, 600.0))


OCR_DPI = _read_ocr_dpi()


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
        return max(0, int(os.environ.get("PAGE_RECLAIM_INTERVAL", "10")))
    except ValueError:
        return 10


PAGE_RECLAIM_INTERVAL = _read_page_reclaim_interval()


#   PAGE_CACHE_TTL — seconds a rendered page stays in Valkey. Rendered pages are
#             a regenerable cache, not durable data: without an expiry they
#             accumulate until Valkey hits maxmemory and starts evicting under
#             pressure (or OOMs, if no eviction policy is set). Defaults to 7
#             days; 0 means no expiry (the old behaviour).
def _read_page_cache_ttl() -> int:
    try:
        return max(0, int(os.environ.get("PAGE_CACHE_TTL", str(7 * 24 * 3600))))
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
        return max(0, int(os.environ.get("PAGE_CACHE_MAX_MB", "2048")))
    except ValueError:
        return 2048


PAGE_CACHE_MAX_MB = _read_page_cache_max_mb()

# Rendered pages are content-addressed (the cache key includes a digest of the
# file's bytes), so a given URL's body can never change — hence "immutable".
# Replacing the file changes the token and therefore the URL.
_PAGE_CACHE_HEADERS = {"Cache-Control": "max-age=31536000, immutable"}

# Original media files (a 50MB battlemap, an animated .webm) are served straight
# off disk at their full size, and unlike rendered pages their URL is not
# content-addressed — replacing the file on disk reuses the same URL. So they
# get a short private TTL rather than "immutable": long enough that paging back
# and forth through a folder does not re-download what was just fetched, short
# enough that a replaced file shows up quickly and the browser cache is not
# holding hundreds of megabytes of originals.
_MEDIA_FILE_CACHE_HEADERS = {"Cache-Control": "private, max-age=300"}

# Media thumbnails (map/token grid cards). Unlike rendered pages these are NOT
# content-addressed — the URL is /maps/{id}/thumbnail and stays the same when the
# underlying image is replaced — so they must not be "immutable", or a browser
# would never re-check and a replaced map would show its old thumbnail forever.
# "no-cache" still caches the bytes; it just requires a revalidation, which the
# ETag then answers with a cheap 304. They are also access-controlled (guests see
# only what is shared with them; tokens can be flagged explicit), so the entry is
# "private" — a shared proxy must never hand one user's thumbnail to another.
_THUMBNAIL_CACHE_HEADERS = {"Cache-Control": "private, no-cache"}

# Optional override for password authentication. When the env var is set,
# it pins the value and the admin UI shows a read-only state. When unset,
# the corresponding DB setting (password_auth_enabled) is used.
_ALLOW_PASSWORD_AUTH_RAW = os.environ.get("ALLOW_PASSWORD_AUTHENTICATION")
ALLOW_PASSWORD_AUTHENTICATION_ENV: Optional[bool] = (
    _ALLOW_PASSWORD_AUTH_RAW.lower() == "true"
    if _ALLOW_PASSWORD_AUTH_RAW is not None
    else None
)


def _bool_env(name: str) -> Optional[bool]:
    raw = os.environ.get(name)
    if raw is None:
        return None
    return raw.strip().lower() == "true"


# Optional override for guest invite codes. When set, it pins the value and the
# admin UI shows a read-only state. When unset, the DB setting
# (guest_access_enabled) is used.
GUEST_ACCESS_ENABLED_ENV: Optional[bool] = _bool_env("GUEST_ACCESS_ENABLED")


# ---------------------------------------------------------------------------
# Backups (issue #338)
# ---------------------------------------------------------------------------
# A backup is a single timestamped .zip holding a consistent snapshot of the
# SQLite database plus the user-authored files under DATA_PATH that no rescan
# could rebuild (campaign uploads, system covers, audio covers). It deliberately
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
BACKUP_DIR_ENV: Optional[str] = os.environ.get("BACKUP_DIR") or None
BACKUP_DIR = BACKUP_DIR_ENV or os.path.join(DATA_PATH, "backups")

_BACKUP_SCHEDULE_RAW = os.environ.get("BACKUP_SCHEDULE")
BACKUP_SCHEDULE_ENV: Optional[str] = (
    _BACKUP_SCHEDULE_RAW.strip().lower() if _BACKUP_SCHEDULE_RAW else None
)


def _int_env(name: str) -> Optional[int]:
    """Read a non-negative int env var. Unset or unparseable yields None, which
    leaves the corresponding DB setting in charge."""
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return None
    try:
        return max(0, int(raw.strip()))
    except ValueError:
        return None


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

# Where the template browser fetches its catalogue from. An operator can point
# this at a fork or a private mirror; the UI keeps the default and hides the
# override behind a toggle, so the common case is one click.
DEFAULT_WIKI_TEMPLATE_INDEX_URL = (
    "https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/"
    "templates/index.json"
)

# Where the theme browser fetches its catalogue from. Same repository as
# add-ons and templates, under `themes/`; an operator can point it at a fork.
DEFAULT_THEME_INDEX_URL = (
    "https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/"
    "themes/index.json"
)


# Optional override for folder-name category inference. When set, it pins the
# value and the admin UI shows a read-only state. When unset, the DB setting
# (disable_folder_category_inference) is used. true = inference disabled.
DISABLE_FOLDER_CATEGORY_INFERENCE_ENV: Optional[bool] = _bool_env(
    "DISABLE_FOLDER_CATEGORY_INFERENCE"
)


# OIDC env-var pins. When set, each individual field is locked and the UI
# renders it read-only. Each env var is independent — pinning the issuer URL
# does not require pinning the client secret, etc.
OIDC_ENV: dict = {
    "oidc_enabled": _bool_env("OIDC_ENABLED"),
    "oidc_issuer_url": os.environ.get("OIDC_ISSUER_URL"),
    "oidc_token_issuer": os.environ.get("OIDC_TOKEN_ISSUER"),
    "oidc_authorization_endpoint": os.environ.get("OIDC_AUTHORIZATION_ENDPOINT"),
    "oidc_token_endpoint": os.environ.get("OIDC_TOKEN_ENDPOINT"),
    "oidc_userinfo_endpoint": os.environ.get("OIDC_USERINFO_ENDPOINT"),
    "oidc_jwks_uri": os.environ.get("OIDC_JWKS_URI"),
    "oidc_end_session_endpoint": os.environ.get("OIDC_END_SESSION_ENDPOINT"),
    "oidc_client_id": os.environ.get("OIDC_CLIENT_ID"),
    "oidc_client_secret": os.environ.get("OIDC_CLIENT_SECRET"),
    "oidc_signing_alg": os.environ.get("OIDC_SIGNING_ALG"),
    "oidc_button_text": os.environ.get("OIDC_BUTTON_TEXT"),
    "oidc_groups_claim": os.environ.get("OIDC_GROUPS_CLAIM"),
    "oidc_permissions_claim": os.environ.get("OIDC_PERMISSIONS_CLAIM"),
    "oidc_match_by": os.environ.get("OIDC_MATCH_BY"),
    "oidc_auto_launch": _bool_env("OIDC_AUTO_LAUNCH"),
    "oidc_auto_register": _bool_env("OIDC_AUTO_REGISTER"),
}

# Timezone for all log timestamps (console output and the in-app log viewer).
# Set the standard TZ env var to an IANA zone name such as "America/Toronto"
# or "Europe/Berlin". Defaults to UTC. An unknown or unavailable zone name
# falls back to UTC with a warning rather than crashing.
_BAD_TIMEZONES: list[str] = []


def _resolve_log_timezone() -> datetime.tzinfo:
    name = (os.environ.get("TZ") or "").strip()
    if not name or name.upper() == "UTC":
        return datetime.timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        # Deferred: logging isn't configured yet, so stash the bad value and
        # emit the warning once the logger is up (see below).
        _BAD_TIMEZONES.append(name)
        return datetime.timezone.utc


LOG_TIMEZONE = _resolve_log_timezone()

# Console log level is controlled by the LOG_LEVEL env var (default: info).
# In-memory ring buffer always captures DEBUG+ so the /api/logs endpoint can
# serve debug logs regardless of the console level.
_LOG_LEVEL_NAME = os.environ.get("LOG_LEVEL", "info").upper()
_CONSOLE_LEVEL = getattr(logging, _LOG_LEVEL_NAME, logging.INFO)


class _TZFormatter(logging.Formatter):
    """Formatter whose asctime is rendered in LOG_TIMEZONE."""

    def formatTime(self, record: logging.LogRecord, datefmt: Optional[str] = None) -> str:
        dt = datetime.datetime.fromtimestamp(record.created, tz=LOG_TIMEZONE)
        if datefmt:
            return dt.strftime(datefmt)
        return dt.isoformat(sep=" ", timespec="milliseconds")


_LOG_FORMAT = "%(asctime)s [%(name)s] %(levelname)s: %(message)s"
logging.basicConfig(level=logging.DEBUG, format=_LOG_FORMAT)
for _h in logging.root.handlers:
    _h.setFormatter(_TZFormatter(_LOG_FORMAT))

for _noisy in (
    "uvicorn",
    "uvicorn.access",
    "uvicorn.error",
    "fastapi",
    "sqlalchemy.engine",
    # redis-py 7+ logs a benign DEBUG line on connect when the server (Valkey /
    # OSS Redis) doesn't support its "maintenance notifications" probe. We only
    # use it as a page cache, so keep that noise out of the log buffer.
    "redis",
):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

for _h in logging.root.handlers:
    _h.setLevel(_CONSOLE_LEVEL)

logger = logging.getLogger("grimoire")
logger.setLevel(logging.DEBUG)

for _bad_tz in _BAD_TIMEZONES:
    logger.warning(
        "Unknown timezone %r (from TZ); logging in UTC instead. "
        "Use an IANA zone name like 'America/Toronto'.",
        _bad_tz,
    )

_LOG_BUFFER_MAX = 20000

_seq_counter = 0


class _LogEntry:
    """Lightweight log record stored in the ring buffer."""
    __slots__ = ("seq", "timestamp", "level", "logger", "message")

    def __init__(self, seq: int, timestamp: str, level: str, logger_name: str, message: str):
        self.seq       = seq
        self.timestamp = timestamp
        self.level     = level
        self.logger    = logger_name
        self.message   = message

    def to_dict(self) -> dict:
        return {
            "seq":       self.seq,
            "timestamp": self.timestamp,
            "level":     self.level,
            "logger":    self.logger,
            "message":   self.message,
        }


class _MemoryLogHandler(logging.Handler):
    """Thread-safe ring-buffer log handler for in-app log viewing."""

    def __init__(self, maxlen: int = _LOG_BUFFER_MAX):
        super().__init__(level=logging.DEBUG)
        self._buf: collections.deque[_LogEntry] = collections.deque(maxlen=maxlen)
        self._lock = threading.Lock()

    def emit(self, record: logging.LogRecord) -> None:
        global _seq_counter
        try:
            # Rendered in LOG_TIMEZONE. Keep the fixed-width
            # YYYY-MM-DDTHH:MM:SS.mmm layout the log viewer slices by offset,
            # and append the actual UTC offset (e.g. "+02:00", or "Z" for UTC).
            local = datetime.datetime.fromtimestamp(record.created, tz=LOG_TIMEZONE)
            ts = local.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
            offset = local.strftime("%z")
            ts += "Z" if offset in ("", "+0000") else f"{offset[:3]}:{offset[3:]}"
            with self._lock:
                _seq_counter += 1
                entry = _LogEntry(
                    seq=_seq_counter,
                    timestamp=ts,
                    level=record.levelname,
                    logger_name=record.name,
                    message=self.format(record),
                )
                self._buf.append(entry)
        except Exception:
            self.handleError(record)

    def get_entries(
        self,
        min_level: int = logging.DEBUG,
        limit: int = 500,
        offset: int = 0,
        after_seq: int = 0,
    ) -> tuple[list[dict], int]:
        """Return entries in oldest-to-newest order and the current max seq.

        When `after_seq` > 0, returns only entries with seq > after_seq (up to
        `limit`), ignoring `offset`.  This is the fast path for live polling.

        When `after_seq` == 0 (initial / historical load), `offset` is counted
        from the newest end: offset=0 → most-recent `limit` entries,
        offset=limit → next-older page, etc.

        Returns (entries_list, max_seq_in_buffer).
        """
        with self._lock:
            all_entries = [e for e in self._buf if logging.getLevelName(e.level) >= min_level]  # type: ignore[arg-type]
            max_seq = self._buf[-1].seq if self._buf else 0

        if after_seq > 0:
            new = [e for e in all_entries if e.seq > after_seq]
            return [e.to_dict() for e in new[-limit:]], max_seq

        total = len(all_entries)
        end   = total - offset
        start = max(0, end - limit)
        return [e.to_dict() for e in all_entries[start:end]], max_seq

    def get_total(self, min_level: int = logging.DEBUG) -> int:
        with self._lock:
            return sum(1 for e in self._buf if logging.getLevelName(e.level) >= min_level)  # type: ignore[arg-type]

    def clear(self) -> None:
        with self._lock:
            self._buf.clear()


_memory_handler = _MemoryLogHandler()
_memory_handler.setFormatter(logging.Formatter("%(message)s"))

logging.root.addHandler(_memory_handler)

os.makedirs(DATA_PATH, exist_ok=True)
os.makedirs(THUMB_DIR, exist_ok=True)
os.makedirs(os.path.join(THUMB_DIR, "books"), exist_ok=True)
os.makedirs(os.path.join(THUMB_DIR, "maps"), exist_ok=True)
os.makedirs(PAGE_CACHE_DIR, exist_ok=True)
os.makedirs(os.path.join(CAMPAIGN_UPLOAD_DIR, "banners"), exist_ok=True)
os.makedirs(os.path.join(CAMPAIGN_UPLOAD_DIR, "art"), exist_ok=True)
os.makedirs(os.path.join(CAMPAIGN_UPLOAD_DIR, "sheets"), exist_ok=True)
os.makedirs(os.path.join(CAMPAIGN_UPLOAD_DIR, "files"), exist_ok=True)
os.makedirs(SYSTEM_COVER_DIR, exist_ok=True)
os.makedirs(AUDIO_COVER_DIR, exist_ok=True)

engine, SessionLocal = init_db(DB_PATH)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


_valkey: Optional[object] = None
if VALKEY_URL:
    try:
        import redis as _redis_mod  # type: ignore[import-untyped]

        # Note: redis-py 7+ probes for "maintenance notifications" (a Redis
        # Enterprise feature) on connect under RESP3; Valkey/OSS Redis reject it
        # and redis-py logs a benign DEBUG line. That logger is quieted above —
        # we only use this as a page cache and don't need the feature.
        _valkey = _redis_mod.from_url(VALKEY_URL, decode_responses=False)
        _valkey.ping()
        logger.info(f"Valkey page cache connected: {VALKEY_URL}")
    except Exception as e:
        logger.warning(f"Valkey connection failed, falling back to disk cache: {e}")
        _valkey = None


# Key prefixes for regenerable render caches. Scan state lives under "grimoire:"
# and is deliberately excluded — purging it would wipe a running scan's status.
_CACHE_KEY_PREFIXES = ("page:", "mappage:")


def valkey_cache_set(key: str, value: bytes) -> bool:
    """Store a rendered page in Valkey under the configured TTL.

    Returns whether the write succeeded, so callers can fall back to the disk
    cache. Errors are logged rather than raised: the cache is an optimisation
    and a Valkey blip must never fail the request populating it.
    """
    if _valkey is None:
        return False
    try:
        if PAGE_CACHE_TTL > 0:
            _valkey.set(key, value, ex=PAGE_CACHE_TTL)  # type: ignore[attr-defined]
        else:
            _valkey.set(key, value)  # type: ignore[attr-defined]
        return True
    except Exception as e:
        logger.warning(f"Valkey set error: {e}")
        return False


def purge_valkey_keys(pattern: str) -> int:
    """UNLINK every Valkey key matching ``pattern``. Returns the number removed.

    Uses SCAN rather than KEYS so a large cache doesn't block the Valkey server,
    and UNLINK (falling back to DEL) so reclaim happens off the main thread.
    Errors are logged rather than raised — this is a cache, and a Valkey blip
    must never fail the scan or request that triggered the purge.
    """
    if _valkey is None:
        return 0
    removed = 0
    try:
        batch: list = []
        for key in _valkey.scan_iter(match=pattern, count=500):  # type: ignore[attr-defined]
            batch.append(key)
            if len(batch) >= 500:
                removed += _valkey_unlink(batch)
                batch = []
        if batch:
            removed += _valkey_unlink(batch)
    except Exception as e:
        logger.warning(f"Valkey purge of '{pattern}' failed: {e}")
    return removed


def purge_valkey_page_cache() -> int:
    """Drop every cached render from Valkey. Returns the number of keys removed.

    Runs once at startup, as a backstop. Page keys now carry a content hash, so
    a file replaced while the server was down is no longer *reachable* under its
    old key — but the superseded entries would still sit there until their TTL,
    and a pre-upgrade row (no hash yet) still falls back to an id-only key. A
    boot-time sweep keeps both cases bounded.
    """
    if _valkey is None:
        return 0
    removed = sum(purge_valkey_keys(f"{prefix}*") for prefix in _CACHE_KEY_PREFIXES)
    if removed:
        logger.info(f"Cleared {removed} cached page render(s) from Valkey")
    return removed


def _valkey_unlink(keys: list) -> int:
    """UNLINK a batch of keys, falling back to DEL on older servers."""
    try:
        return int(_valkey.unlink(*keys))  # type: ignore[attr-defined]
    except Exception:
        return int(_valkey.delete(*keys))  # type: ignore[attr-defined]
