"""Background scheduler for periodic library rescans.

For 'hourly' the scheduler fires every 3600 s from when it starts.
For 'daily' and 'weekly' it calculates the next wall-clock UTC occurrence of
the configured hour:minute (and weekday for weekly) and sleeps until then,
so the rescan always happens at the same time of day regardless of when
the server was started or restarted.
"""

import threading
from datetime import datetime, timedelta
from typing import Optional
from .config import logger

_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()


def _seconds_until_next(hour: int, minute: int, weekday: Optional[int]) -> float:
    """Return seconds until the next UTC occurrence of hour:minute (and weekday)."""
    now = datetime.utcnow()
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)

    if weekday is not None:
        # Weekly: advance to the correct day-of-week (0=Mon … 6=Sun)
        days_ahead = (weekday - now.weekday()) % 7
        if days_ahead == 0 and now >= target:
            days_ahead = 7
        target += timedelta(days=days_ahead)
    else:
        # Daily
        if now >= target:
            target += timedelta(days=1)

    return max(1.0, (target - now).total_seconds())


def _run(
    interval: str,
    hour: int,
    minute: int,
    weekday: Optional[int],
    rescan_fn,
    cleanup_fn=None,
) -> None:
    while True:
        if interval == "hourly":
            secs = 3600.0
        else:
            secs = _seconds_until_next(hour, minute, weekday)

        if _stop_event.wait(secs):
            break  # stop() was called

        logger.info("Scheduled rescan starting…")
        try:
            rescan_fn()
        except Exception as e:
            logger.error(f"Scheduled rescan error: {e}")

        if cleanup_fn is not None:
            logger.info("Scheduled database cleanup starting…")
            try:
                cleanup_fn()
            except Exception as e:
                logger.error(f"Scheduled database cleanup error: {e}")


def start(interval: str, hour: int, minute: int, weekday: int, rescan_fn, cleanup_fn=None) -> None:
    """Start (or restart) the background rescan thread."""
    global _thread
    stop()
    _stop_event.clear()
    _wd = weekday if interval == "weekly" else None
    _thread = threading.Thread(
        target=_run,
        args=(interval, hour, minute, _wd, rescan_fn, cleanup_fn),
        daemon=True,
        name="grimoire-scheduler",
    )
    _thread.start()
    if interval == "hourly":
        logger.info("Scheduled rescan enabled: every hour")
    elif interval == "weekly":
        days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        logger.info(
            f"Scheduled rescan enabled: weekly on {days[weekday]} at {hour:02d}:{minute:02d} UTC"
        )
    else:
        logger.info(f"Scheduled rescan enabled: daily at {hour:02d}:{minute:02d} UTC")


def stop() -> None:
    """Stop the background rescan thread if one is running."""
    global _thread
    _stop_event.set()
    if _thread and _thread.is_alive():
        _thread.join(timeout=5)
    _thread = None
    _stop_event.clear()


def apply(db) -> None:
    """Read schedule settings from the DB and start/stop the scheduler.

    Called on app startup and after settings are updated.
    """
    from .models import AppSetting
    from .routers.library import run_rescan_sync
    from .routers.maintenance import run_cleanup_sync

    rows = {r.key: r.value for r in db.query(AppSetting).all()}
    enabled = rows.get("rescan_schedule_enabled", "false") == "true"
    interval = rows.get("rescan_schedule_interval", "daily")
    hour = int(rows.get("rescan_schedule_hour", "2"))
    minute = int(rows.get("rescan_schedule_minute", "0"))
    weekday = int(rows.get("rescan_schedule_weekday", "0"))
    cleanup_on_rescan = rows.get("cleanup_on_rescan", "false") == "true"

    if enabled:
        cleanup_fn = run_cleanup_sync if cleanup_on_rescan else None
        start(interval, hour, minute, weekday, run_rescan_sync, cleanup_fn)
    else:
        stop()
