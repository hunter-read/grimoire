"""One database step of a scan, run on the thread that owns the Session.

The scan used to run each commit and query on a helper thread and give up on it
after a wall-clock timeout, but the caller then rolled back the same Session
while the helper might still be inside ``commit()``. Sessions are not
thread-safe, so that could raise ``IllegalStateChangeError``, drive one sqlite3
connection from two threads at once, or let the commit land after the caller
had moved on (issue #702).

SQLite already bounds the wait that mattered: the engine sets
``busy_timeout`` (see ``models/db.py``), so a step blocked on another writer's
lock fails with "database is locked" instead of hanging. ``_db_call`` turns that
failure into :class:`DatabaseBusyError`, which callers catch to roll back and
move on to the next file.
"""
from typing import Callable, TypeVar

from sqlalchemy.exc import OperationalError, SQLAlchemyError

T = TypeVar("T")

# What SQLite says when busy_timeout runs out: SQLITE_BUSY and SQLITE_LOCKED.
_BUSY_MESSAGES = ("database is locked", "database table is locked", "database is busy")


class DatabaseBusyError(SQLAlchemyError):
    """A scan step gave up waiting for another connection's lock."""


def is_busy(exc: BaseException) -> bool:
    """Whether ``exc`` is SQLite reporting that the database stayed locked."""
    return isinstance(exc, OperationalError) and any(
        msg in str(exc.orig).lower() for msg in _BUSY_MESSAGES
    )


def _db_call(fn: Callable[[], T], label: str) -> T:
    """Run ``fn()`` here, raising :class:`DatabaseBusyError` if SQLite stays locked.

    ``label`` names the step in the error, and lets a test pick out one step
    to fail. Any other database error propagates unchanged.
    """
    try:
        return fn()
    except OperationalError as exc:
        if is_busy(exc):
            raise DatabaseBusyError(f"database stayed locked: {label}") from exc
        raise
