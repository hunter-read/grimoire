"""Background thread that deletes long-dead auth sessions.

Every login writes an ``auth_sessions`` row, and revoking or expiring one only
marks it — nothing removes it. Without this the table grows for the life of the
install. Runs once at startup, then daily.

Only one worker purges. The work is idempotent, so a double run would be
harmless, but there is no reason for every worker to issue the same DELETE, and
concurrent writers on SQLite serialise anyway. The lock is held for the life of
the process rather than per-pass: whichever worker wins at startup keeps the
job, and if that worker dies its file lock is released by the OS so a survivor
picks it up on the next restart.
"""

import datetime
import fcntl
import os
import threading
from typing import Optional, TextIO

from .config import logger

# Sessions stay in the table this long after they die, so a refresh token
# replayed shortly after logout is still recognisable as a reuse rather than
# looking like an unknown token. Matches purge_expired_sessions' own default.
RETAIN_DAYS = 7

_PURGE_INTERVAL_SECONDS = 24 * 60 * 60

_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()
_lock_file: Optional[TextIO] = None


def _acquire_lock(data_path: str) -> bool:
    """Claim the purger role for this process. False if another worker has it."""
    global _lock_file

    lock_path = os.path.join(data_path, ".session_purge.lock")
    try:
        handle = open(lock_path, "w")
    except OSError as e:
        logger.warning(f"Session purger could not open its lock file: {e}")
        return False

    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return False

    _lock_file = handle
    return True


def _release_lock() -> None:
    global _lock_file
    if _lock_file is None:
        return
    try:
        fcntl.flock(_lock_file, fcntl.LOCK_UN)
    finally:
        _lock_file.close()
        _lock_file = None


def _purge_once() -> int:
    from .config import SessionLocal
    from .sessions import purge_expired_sessions

    db = SessionLocal()
    try:
        return purge_expired_sessions(db, retain_days=RETAIN_DAYS)
    finally:
        db.close()


def _run() -> None:
    # Once at startup, to clear whatever accumulated while the server was down.
    try:
        _purge_once()
    except Exception as e:
        logger.error(f"Session purge startup error: {e}")

    while not _stop_event.is_set():
        if _stop_event.wait(_PURGE_INTERVAL_SECONDS):
            break
        try:
            _purge_once()
        except Exception as e:
            # Never let a bad pass kill the thread — the next one may well work,
            # and an unpurged table is a slow leak rather than an outage.
            logger.error(f"Session purge error: {e}")


def start(data_path: str) -> None:
    """Start the purge thread in whichever worker claims the lock first."""
    global _thread

    if not _acquire_lock(data_path):
        logger.debug("Session purge running in another worker, skipping.")
        return

    _stop_event.clear()
    _thread = threading.Thread(target=_run, daemon=True, name="session-purger")
    _thread.start()
    logger.info(
        "Session purge enabled: daily, retaining dead sessions for %d day(s)", RETAIN_DAYS
    )


def stop() -> None:
    global _thread
    _stop_event.set()
    if _thread and _thread.is_alive():
        _thread.join(timeout=5)
    _thread = None
    _stop_event.clear()
    _release_lock()


def next_run_after(now: Optional[datetime.datetime] = None) -> datetime.datetime:
    """When the next purge is due. Exposed for tests and diagnostics."""
    base = now or datetime.datetime.utcnow()
    return base + datetime.timedelta(seconds=_PURGE_INTERVAL_SECONDS)
