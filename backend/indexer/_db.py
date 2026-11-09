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
failure into :class:`DatabaseBusyError`, which callers catch to move on to the
next file. On PostgreSQL the engine sets ``lock_timeout`` to the same 30
seconds, and a lock timeout, deadlock or serialization failure is the same "try
the next file" case.

``_db_call`` rolls the Session back before it raises, so a caller cannot forget
to. On PostgreSQL that matters: a failed statement aborts its transaction, and
every later query on the Session would fail with "current transaction is
aborted" until it is rolled back. Inside a savepoint only the savepoint is
rolled back, so the work outside it is kept; the savepoint's ``with`` block is
then closed, and the busy error must be allowed to leave it.
"""
from typing import Any, Callable, Sequence, TypeVar

from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session

T = TypeVar("T")

# What SQLite says when busy_timeout runs out: SQLITE_BUSY and SQLITE_LOCKED.
_BUSY_MESSAGES = ("database is locked", "database table is locked", "database is busy")
# PostgreSQL's SQLSTATEs for the same: lock_not_available (lock_timeout ran
# out), deadlock_detected, serialization_failure.
_BUSY_SQLSTATES = ("55P03", "40P01", "40001")


class DatabaseBusyError(SQLAlchemyError):
    """A scan step gave up waiting for another connection's lock."""


def is_busy(exc: BaseException) -> bool:
    """Whether ``exc`` is the database reporting that it stayed locked."""
    if not isinstance(exc, OperationalError):
        return False
    if getattr(exc.orig, "sqlstate", None) in _BUSY_SQLSTATES:
        return True
    return any(msg in str(exc.orig).lower() for msg in _BUSY_MESSAGES)


def _db_call(fn: Callable[[], T], label: str, session: Session) -> T:
    """Run ``fn()`` here, raising :class:`DatabaseBusyError` if the database stays locked.

    ``label`` names the step in the error, and lets a test pick out one step
    to fail. ``session`` is the Session ``fn`` works on: it is rolled back (to
    its innermost savepoint, if one is open) before the busy error is raised.
    Any other database error propagates unchanged.
    """
    try:
        return fn()
    except OperationalError as exc:
        if is_busy(exc):
            _roll_back(session)
            raise DatabaseBusyError(f"database stayed locked: {label}") from exc
        raise


def _roll_back(session: Session) -> None:
    """Undo the transaction a busy step failed in, or just its savepoint."""
    nested = session.get_nested_transaction()
    if nested is not None:
        nested.rollback()
    else:
        session.rollback()


# Paths per ``IN (...)`` lookup. SQLite builds before 3.32 cap a statement at
# 999 bound variables.
LOOKUP_BATCH = 500


def lookup_by_path(
    db_call: Callable[[Callable[[], Any], str, Session], Any],
    session: Session,
    columns: Sequence[Any],
    paths: Sequence[str],
    label: str,
) -> dict[str, Any]:
    """The rows for ``paths``, as ``columns``, keyed by filepath.

    One query per ``LOOKUP_BATCH`` paths rather than one per file: a walk asks
    for a whole directory at once. ``columns`` must include the model's
    ``filepath``. Each query goes through ``db_call`` (the caller's own
    ``_db_call``, which is what tests patch) labelled ``label`` and the paths it
    asks for, so a locked database raises :class:`DatabaseBusyError` here.
    """
    filepath = next(c for c in columns if getattr(c, "key", None) == "filepath")
    found: dict[str, Any] = {}
    for i in range(0, len(paths), LOOKUP_BATCH):
        chunk = list(paths[i : i + LOOKUP_BATCH])

        def query(chunk: list[str] = chunk) -> list[Any]:
            return session.query(*columns).filter(filepath.in_(chunk)).all()

        rows = db_call(query, f"{label} " + ", ".join(f"'{p}'" for p in chunk), session)
        found.update((row.filepath, row) for row in rows)
    return found
