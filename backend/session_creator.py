"""Background thread that auto-creates session note stubs the day before a scheduled session.

Runs once at startup (catching anything missed while the server was down) then
sleeps until the next UTC midnight and repeats daily.
"""

import threading
import datetime
from typing import Optional

from .config import logger

_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()


def _create_upcoming_sessions(db) -> None:
    from .models import Campaign, CampaignSchedule, SessionNote
    from .services.campaigns.schedule import compute_next_sessions

    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()

    schedules = db.query(CampaignSchedule).all()
    for sched in schedules:
        campaign = db.query(Campaign).filter_by(id=sched.campaign_id).first()
        if not campaign or not campaign.is_gm_campaign:
            continue

        next_dates = compute_next_sessions(sched.definition, n=30)
        if tomorrow not in next_dates:
            continue

        exists = (
            db.query(SessionNote)
            .filter_by(campaign_id=sched.campaign_id, session_date=tomorrow)
            .first()
        )
        if not exists:
            note = SessionNote(
                campaign_id=sched.campaign_id,
                session_date=tomorrow,
                title="",
            )
            db.add(note)
            logger.info(f"Auto-created session note for campaign {sched.campaign_id} on {tomorrow}")

    db.commit()


def _seconds_until_utc_midnight() -> float:
    now = datetime.datetime.utcnow()
    tomorrow = (now + datetime.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1.0, (tomorrow - now).total_seconds())


def _run() -> None:
    from .config import SessionLocal

    # Run once immediately on startup to catch anything missed
    db = SessionLocal()
    try:
        _create_upcoming_sessions(db)
    except Exception as e:
        logger.error(f"Session auto-creator startup error: {e}")
    finally:
        db.close()

    while not _stop_event.is_set():
        secs = _seconds_until_utc_midnight()
        if _stop_event.wait(secs):
            break

        db = SessionLocal()
        try:
            _create_upcoming_sessions(db)
        except Exception as e:
            logger.error(f"Session auto-creator error: {e}")
        finally:
            db.close()


def start() -> None:
    global _thread
    _stop_event.clear()
    _thread = threading.Thread(target=_run, daemon=True, name="session-creator")
    _thread.start()


def stop() -> None:
    global _thread
    _stop_event.set()
    if _thread and _thread.is_alive():
        _thread.join(timeout=5)
    _thread = None
    _stop_event.clear()
