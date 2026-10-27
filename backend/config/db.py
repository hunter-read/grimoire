"""The database: the engine and the shared session factory.

Nothing here opens the database at import. ``init_database()`` (run by
``backend.config.startup()``) opens and migrates it, and a session opened before
that initialises it on demand, so scripts and tests work without a start-up.
"""
import os
import threading
from typing import TYPE_CHECKING, Any, Iterator, Optional

from . import env, paths

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine
    from sqlalchemy.orm import Session, sessionmaker

# The engine, once init_database() has run. SessionLocal is created unbound on
# first access (see __getattr__) and bound to this engine by init_database().
engine: Optional["Engine"] = None
SessionLocal: "sessionmaker[Session]"
_db_lock = threading.Lock()


def _session_factory() -> "sessionmaker[Session]":
    """The shared session factory, created (unbound) on first use.

    Created here rather than at import so importing config doesn't load
    SQLAlchemy - a worker process that only reads settings never needs it. It is
    the same object for the life of the process, so ``from config import
    SessionLocal`` taken before startup still sees the database once it's bound.
    """
    factory = globals().get("SessionLocal")
    if factory is None:
        from sqlalchemy.orm import sessionmaker

        class _DeferredSessionmaker(sessionmaker):
            def __call__(self, **local_kw: Any) -> Any:
                # A script, a test or a worker that never called startup()
                # still gets a migrated database rather than an unbound session.
                if self.kw.get("bind") is None:
                    init_database()
                return super().__call__(**local_kw)

        # Bound straight away when the database is already open: a factory is
        # made again after ``SessionLocal`` is deleted (mock.patch restores a
        # name it found through the config facade that way), and
        # init_database() would not bind it a second time.
        factory = _DeferredSessionmaker(bind=engine)
        globals()["SessionLocal"] = factory
    return factory


def init_database() -> "Engine":
    """Open and migrate the database, and bind SessionLocal to it. Idempotent."""
    global engine
    with _db_lock:
        if engine is None:
            from ..models import init_db

            os.makedirs(env.DATA_PATH, exist_ok=True)
            engine, _ = init_db(paths.DB_PATH)
            _session_factory().configure(bind=engine)
        return engine


def get_db() -> Iterator["Session"]:
    db = _session_factory()()
    try:
        yield db
    finally:
        db.close()


def release_connection(db: "Session") -> None:
    """Hand the session's pooled connection back before a slow wait (issue #701).

    A session holds its connection from its first query until the transaction
    ends, which for a request's ``get_db`` session is the end of the request. A
    handler that then waits on a render or a remote server kept a connection
    out of a small pool the whole time, and a burst of them left every other
    request waiting 30 seconds for one.

    Ends the transaction without expiring what it loaded, so the objects stay
    usable; the next query starts a new one. Only for a session with nothing
    left to write: committing someone's pending changes early would be a
    surprise, so that raises instead.
    """
    if not db.in_transaction():
        return
    if db.new or db.dirty or db.deleted:
        raise RuntimeError("release_connection() on a session with unsaved changes")
    expire = db.expire_on_commit
    db.expire_on_commit = False
    try:
        db.commit()
    finally:
        db.expire_on_commit = expire


def __getattr__(name: str) -> Any:
    """``SessionLocal``, created on first use so importing config doesn't load SQLAlchemy."""
    if name == "SessionLocal":
        return _session_factory()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
