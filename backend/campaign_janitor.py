"""Background thread that permanently deletes soft-deleted campaigns older than 7 days.

Runs once at startup then sleeps until the next UTC midnight and repeats daily.
"""

import datetime
import threading
from typing import Optional

from .config import logger

_RETENTION_DAYS = 7

_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()


def _purge_expired(db) -> None:
    from .models import Campaign

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=_RETENTION_DAYS)
    expired = (
        db.query(Campaign)
        .filter(Campaign.deleted_at.isnot(None), Campaign.deleted_at <= cutoff)
        .all()
    )
    for campaign in expired:
        logger.info(
            f"Purging soft-deleted campaign {campaign.id!r} ({campaign.name!r}), "
            f"deleted at {campaign.deleted_at.isoformat()}"
        )
        db.delete(campaign)

    if expired:
        db.commit()
        logger.info(f"Purged {len(expired)} expired soft-deleted campaign(s)")


def _seconds_until_utc_midnight() -> float:
    now = datetime.datetime.utcnow()
    tomorrow = (now + datetime.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1.0, (tomorrow - now).total_seconds())


def _run() -> None:
    from .config import SessionLocal

    db = SessionLocal()
    try:
        _purge_expired(db)
    except Exception as e:
        logger.error(f"Campaign janitor startup error: {e}")
    finally:
        db.close()

    while not _stop_event.is_set():
        secs = _seconds_until_utc_midnight()
        if _stop_event.wait(secs):
            break

        db = SessionLocal()
        try:
            _purge_expired(db)
        except Exception as e:
            logger.error(f"Campaign janitor error: {e}")
        finally:
            db.close()


def start() -> None:
    global _thread
    _stop_event.clear()
    _thread = threading.Thread(target=_run, daemon=True, name="campaign-janitor")
    _thread.start()


def stop() -> None:
    global _thread
    _stop_event.set()
    if _thread and _thread.is_alive():
        _thread.join(timeout=5)
    _thread = None
    _stop_event.clear()
