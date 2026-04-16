"""Shared configuration, database, and cache setup for Grimoire."""
import os
import logging
import collections
import threading
import datetime
from typing import Optional
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
VALKEY_URL = os.environ.get("VALKEY_URL", "")
_PAGE_CACHE_HEADERS = {"Cache-Control": "max-age=31536000, immutable"}

# Console log level is controlled by the LOG_LEVEL env var (default: info).
# In-memory ring buffer always captures DEBUG+ so the /api/logs endpoint can
# serve debug logs regardless of the console level.
_LOG_LEVEL_NAME = os.environ.get("LOG_LEVEL", "info").upper()
_CONSOLE_LEVEL = getattr(logging, _LOG_LEVEL_NAME, logging.INFO)

_LOG_FORMAT = "%(asctime)s [%(name)s] %(levelname)s: %(message)s"
logging.basicConfig(level=logging.DEBUG, format=_LOG_FORMAT)

for _noisy in ("uvicorn", "uvicorn.access", "uvicorn.error", "fastapi", "sqlalchemy.engine"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

for _h in logging.root.handlers:
    _h.setLevel(_CONSOLE_LEVEL)

logger = logging.getLogger("grimoire")
logger.setLevel(logging.DEBUG)

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
            ts = datetime.datetime.fromtimestamp(
                record.created, tz=datetime.timezone.utc
            ).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
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

engine, SessionLocal = init_db(DB_PATH)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


_valkey: Optional[object] = None
if VALKEY_URL:
    try:
        import redis as _redis_mod  # type: ignore[import-untyped]

        _valkey = _redis_mod.from_url(VALKEY_URL, decode_responses=False)
        _valkey.ping()
        logger.info(f"Valkey page cache connected: {VALKEY_URL}")
    except Exception as e:
        logger.warning(f"Valkey connection failed, falling back to disk cache: {e}")
        _valkey = None
