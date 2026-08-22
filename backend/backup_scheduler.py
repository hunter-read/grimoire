"""Background scheduler for periodic backups (issue #338).

Mirrors `scheduler.py`, which drives library rescans: 'hourly' fires every
3600 s from start, while 'daily' and 'weekly' target the next wall-clock UTC
occurrence of the configured time so the backup lands at the same hour
regardless of when the server was last restarted.

Kept separate from the rescan scheduler rather than folded into it: the two
have independent schedules, and a user who wants hourly backups but weekly
rescans (or vice versa) should not have to choose.
"""
import threading
from typing import Optional

from sqlalchemy.orm import Session

from .config import logger
from .scheduler import _seconds_until_next
from .services import backup as backup_service_module

_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()

_DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def _run(schedule: str, hour: int, minute: int, weekday: Optional[int]) -> None:
    from .config import SessionLocal

    while True:
        secs = 3600.0 if schedule == "hourly" else _seconds_until_next(hour, minute, weekday)

        if _stop_event.wait(secs):
            break  # stop() was called

        logger.info("Scheduled backup starting…")
        db = SessionLocal()
        try:
            record = backup_service_module.create_backup(db, trigger="scheduled")
            logger.info(f"Scheduled backup complete: {record.filename}")
        except Exception as e:
            # A failed backup must not kill the thread — the next run should
            # still get its chance (a full disk today may be fine tomorrow).
            logger.error(f"Scheduled backup error: {e}")
        finally:
            db.close()


def start(schedule: str, hour: int, minute: int, weekday: int) -> None:
    """Start (or restart) the background backup thread."""
    global _thread
    stop()
    _stop_event.clear()
    _wd = weekday if schedule == "weekly" else None
    _thread = threading.Thread(
        target=_run,
        args=(schedule, hour, minute, _wd),
        daemon=True,
        name="grimoire-backup-scheduler",
    )
    _thread.start()
    if schedule == "hourly":
        logger.info("Scheduled backups enabled: every hour")
    elif schedule == "weekly":
        logger.info(
            f"Scheduled backups enabled: weekly on {_DAYS[weekday]} "
            f"at {hour:02d}:{minute:02d} UTC"
        )
    else:
        logger.info(f"Scheduled backups enabled: daily at {hour:02d}:{minute:02d} UTC")


def stop() -> None:
    """Stop the background backup thread if one is running."""
    global _thread
    _stop_event.set()
    if _thread and _thread.is_alive():
        _thread.join(timeout=5)
    _thread = None
    _stop_event.clear()


def apply(db: Session) -> None:
    """Read backup settings from the DB and start/stop the scheduler.

    Called on app startup and after backup settings are updated.
    """
    config = backup_service_module.backup_settings(db)
    if config.schedule == "off":
        stop()
        return
    start(config.schedule, config.hour, config.minute, config.weekday)
