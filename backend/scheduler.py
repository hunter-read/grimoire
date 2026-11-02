"""Background scheduler for periodic library rescans.

For 'hourly' the scheduler fires every 3600 s from when it starts.
For 'daily' and 'weekly' it calculates the next wall-clock UTC occurrence of
the configured hour:minute (and weekday for weekly) and sleeps until then,
so the rescan always happens at the same time of day regardless of when
the server was started or restarted.
"""

import threading
from datetime import timedelta
from typing import Callable, Optional

from sqlalchemy.orm import Session

from .clock import utcnow_naive
from .config import logger

_thread: Optional[threading.Thread] = None
# The running thread's own stop flag. Each start() makes a new one and stop()
# sets it and lets go - it is never cleared, so a thread still busy in a scan
# when stop() gives up waiting still sees the request once the scan ends
# (issue #786). A shared event cleared after the join let that thread run on,
# beside the next start()'s.
_stop: Optional[threading.Event] = None

# How long stop() waits for the thread before returning. A scan can take far
# longer; the thread then exits on its own when the scan finishes.
JOIN_TIMEOUT = 5.0


def _seconds_until_next(hour: int, minute: int, weekday: Optional[int]) -> float:
    """Return seconds until the next UTC occurrence of hour:minute (and weekday)."""
    now = utcnow_naive()
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
    rescan_fn: Callable[[], None],
    cleanup_fn: Optional[Callable[[], None]],
    stop_event: threading.Event,
) -> None:
    while not stop_event.is_set():
        if interval == "hourly":
            secs = 3600.0
        else:
            secs = _seconds_until_next(hour, minute, weekday)

        if stop_event.wait(secs):
            break  # stop() was called

        logger.info("Scheduled rescan starting…")
        try:
            rescan_fn()
        except Exception as e:
            logger.error(f"Scheduled rescan error: {e}")

        # Stopped while the scan ran: the schedule was turned off or replaced,
        # so the cleanup that belonged to it is skipped too.
        if stop_event.is_set():
            break

        if cleanup_fn is not None:
            logger.info("Scheduled database cleanup starting…")
            try:
                cleanup_fn()
            except Exception as e:
                logger.error(f"Scheduled database cleanup error: {e}")


def start(
    interval: str,
    hour: int,
    minute: int,
    weekday: int,
    rescan_fn: Callable[[], None],
    cleanup_fn: Optional[Callable[[], None]] = None,
) -> None:
    """Start (or restart) the background rescan thread."""
    global _thread, _stop
    stop()
    _stop = threading.Event()
    _wd = weekday if interval == "weekly" else None
    _thread = threading.Thread(
        target=_run,
        args=(interval, hour, minute, _wd, rescan_fn, cleanup_fn, _stop),
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
    """Stop the background rescan thread if one is running.

    Waits up to ``JOIN_TIMEOUT`` for it. A thread still in a scan after that is
    left to finish it and exit; its stop flag stays set, so it cannot carry on.
    """
    global _thread, _stop
    if _stop is not None:
        _stop.set()
    if _thread and _thread.is_alive():
        _thread.join(timeout=JOIN_TIMEOUT)
        if _thread.is_alive():
            logger.info("Scheduled rescan still running; it will stop when it finishes")
    _thread = None
    _stop = None


def apply(db: Session) -> None:
    """Read schedule settings from the DB and start/stop the scheduler.

    Called on app startup and after settings are updated.
    """
    from .models import AppSetting
    from .services.library_scan.runner import run_rescan_sync
    from .services.library_cleanup import run_cleanup_sync

    rows = {r.key: r.value for r in db.query(AppSetting).all() if r.value is not None}
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
