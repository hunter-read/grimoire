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
_PAGE_CACHE_HEADERS = {"Cache-Control": "max-age=31536000, immutable"}

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
