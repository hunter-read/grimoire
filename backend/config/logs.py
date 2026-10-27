"""Logging: the console handler, and the in-memory ring buffer behind /api/logs.

Set up at import. Safe to repeat: the tests reload this module to re-read the
environment, and a reload attaches no second handler (see ``_is_ours``).
"""
import collections
import datetime
import logging
import threading
from typing import Optional

from ..filenames import display_name
from ..log_context import current_log_user
from . import env


class _TZFormatter(logging.Formatter):
    """Formatter whose asctime is rendered in LOG_TIMEZONE."""

    def formatTime(self, record: logging.LogRecord, datefmt: Optional[str] = None) -> str:
        dt = datetime.datetime.fromtimestamp(record.created, tz=env.LOG_TIMEZONE)
        if datefmt:
            return dt.strftime(datefmt)
        return dt.isoformat(sep=" ", timespec="milliseconds")


_LOG_FORMAT = "%(asctime)s [%(name)s] %(levelname)s: %(message)s"


def _is_ours(handler: logging.Handler, role: str) -> bool:
    """Whether this module attached ``handler`` to root in the given role.

    Tagged rather than matched by class, because a reload of this module (the
    tests reload it to re-read the environment) redefines its classes.
    """
    return getattr(handler, "_grimoire_role", None) == role


# basicConfig adds a console handler only when root has none, which is also why
# a reload adds no second one. Only that handler is formatted and levelled here:
# a host that configured root itself keeps its own, and so does this module's
# ring buffer below, whose lines must stay the bare message.
_root_before = list(logging.root.handlers)
logging.basicConfig(level=logging.DEBUG, format=_LOG_FORMAT)
for _h in logging.root.handlers:
    if _h not in _root_before:
        setattr(_h, "_grimoire_role", "console")

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
    if _is_ours(_h, "console"):
        _h.setFormatter(_TZFormatter(_LOG_FORMAT))
        _h.setLevel(env.LOG_LEVEL)

logger = logging.getLogger("grimoire")
logger.setLevel(logging.DEBUG)

_LOG_BUFFER_MAX = 20000


class _LogEntry:
    """Lightweight log record stored in the ring buffer."""
    __slots__ = ("seq", "timestamp", "level", "logger", "message", "user")

    def __init__(
        self,
        seq: int,
        timestamp: str,
        level: str,
        logger_name: str,
        message: str,
        user: Optional[str] = None,
    ):
        self.seq       = seq
        self.timestamp = timestamp
        self.level     = level
        self.logger    = logger_name
        self.message   = message
        # The username of the request that emitted the line, or None for lines
        # from no request or before authentication (see backend/log_context.py).
        self.user      = user

    def to_dict(self) -> dict:
        return {
            "seq":       self.seq,
            "timestamp": self.timestamp,
            "level":     self.level,
            "logger":    self.logger,
            "message":   self.message,
            "user":      self.user,
        }


class _MemoryLogHandler(logging.Handler):
    """Thread-safe ring-buffer log handler for in-app log viewing."""

    def __init__(self, maxlen: int = _LOG_BUFFER_MAX):
        super().__init__(level=logging.DEBUG)
        self._buf: collections.deque[_LogEntry] = collections.deque(maxlen=maxlen)
        self._lock = threading.Lock()
        self._seq = 0

    def emit(self, record: logging.LogRecord) -> None:
        try:
            # Rendered in LOG_TIMEZONE. Keep the fixed-width
            # YYYY-MM-DDTHH:MM:SS.mmm layout the log viewer slices by offset,
            # and append the actual UTC offset (e.g. "+02:00", or "Z" for UTC).
            local = datetime.datetime.fromtimestamp(record.created, tz=env.LOG_TIMEZONE)
            ts = local.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
            offset = local.strftime("%z")
            ts += "Z" if offset in ("", "+0000") else f"{offset[:3]}:{offset[3:]}"
            with self._lock:
                self._seq += 1
                entry = _LogEntry(
                    seq=self._seq,
                    timestamp=ts,
                    level=record.levelname,
                    logger_name=record.name,
                    # A filename that is not UTF-8 (issue #547) can reach a
                    # message through any logger; kept raw, it would make every
                    # /api/logs response fail to serialise until it aged out.
                    message=display_name(self.format(record)),
                    user=current_log_user(),
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
        user: Optional[str] = None,
    ) -> tuple[list[dict], int]:
        """Return entries in oldest-to-newest order and the current max seq.

        When `after_seq` > 0, returns only entries with seq > after_seq (up to
        `limit`), ignoring `offset`.  This is the fast path for live polling.

        When `after_seq` == 0 (initial / historical load), `offset` is counted
        from the newest end: offset=0 → most-recent `limit` entries,
        offset=limit → next-older page, etc.

        `user`, when given, keeps only lines attributed to that username.

        Returns (entries_list, max_seq_in_buffer).
        """
        with self._lock:
            all_entries = self._matching(min_level, user)
            max_seq = self._buf[-1].seq if self._buf else 0

        if after_seq > 0:
            new = [e for e in all_entries if e.seq > after_seq]
            return [e.to_dict() for e in new[-limit:]], max_seq

        total = len(all_entries)
        end   = total - offset
        start = max(0, end - limit)
        return [e.to_dict() for e in all_entries[start:end]], max_seq

    def get_total(self, min_level: int = logging.DEBUG, user: Optional[str] = None) -> int:
        with self._lock:
            return len(self._matching(min_level, user))

    def get_users(self) -> list[str]:
        """Every username with at least one line in the buffer, sorted."""
        with self._lock:
            names = {e.user for e in self._buf if e.user}
        return sorted(names, key=str.lower)

    def _matching(self, min_level: int, user: Optional[str]) -> list[_LogEntry]:
        """Buffered entries at or above ``min_level`` (and from ``user``). Call under the lock."""
        return [
            e
            for e in self._buf
            if logging.getLevelName(e.level) >= min_level  # type: ignore[operator]
            and (user is None or e.user == user)
        ]

    def clear(self) -> None:
        with self._lock:
            self._buf.clear()


def _attach_memory_handler() -> _MemoryLogHandler:
    """The ring buffer on root, attaching it on first import.

    A reload hands back the one already attached: the logs API imported it by
    name, so a second buffer would collect lines that API never shows.
    """
    for handler in logging.root.handlers:
        if _is_ours(handler, "memory"):
            return handler  # type: ignore[return-value]  # the class from before a reload
    handler = _MemoryLogHandler()
    setattr(handler, "_grimoire_role", "memory")
    logging.root.addHandler(handler)
    return handler


_memory_handler = _attach_memory_handler()
_memory_handler.setFormatter(logging.Formatter("%(message)s"))
