"""Unit tests for the background thread that stubs tomorrow's session notes."""
import datetime
import threading
import uuid
from unittest.mock import patch

from backend import session_creator
from backend.config import SessionLocal
from backend.models import CampaignSchedule, SessionNote, User
from backend.tests.conftest import make_campaign


def _tomorrow() -> str:
    return (datetime.date.today() + datetime.timedelta(days=1)).isoformat()


def _scheduled_campaign(dates: list[str], *, gm_campaign: bool = True) -> str:
    db = SessionLocal()
    try:
        owner = User(id=str(uuid.uuid4()), username=f"gm-{uuid.uuid4().hex[:8]}", role="gm")
        db.add(owner)
        db.commit()
        owner_id = owner.id
    finally:
        db.close()
    campaign = make_campaign(owner_id, is_gm_campaign=gm_campaign)
    db = SessionLocal()
    try:
        db.add(
            CampaignSchedule(
                campaign_id=campaign.id,
                definition={"frequency": "custom", "custom_dates": dates},
            )
        )
        db.commit()
    finally:
        db.close()
    return campaign.id


def _notes(campaign_id: str) -> list[str]:
    db = SessionLocal()
    try:
        rows = db.query(SessionNote).filter_by(campaign_id=campaign_id).all()
        return [r.session_date for r in rows]
    finally:
        db.close()


def _run_once() -> None:
    db = SessionLocal()
    try:
        session_creator._create_upcoming_sessions(db)
    finally:
        db.close()


class TestCreateUpcomingSessions:
    def test_stubs_tomorrows_session_once(self):
        campaign_id = _scheduled_campaign([_tomorrow()])
        _run_once()
        _run_once()
        assert _notes(campaign_id) == [_tomorrow()]

    def test_skips_a_campaign_without_a_session_tomorrow(self):
        later = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
        campaign_id = _scheduled_campaign([later])
        _run_once()
        assert _notes(campaign_id) == []

    def test_skips_a_campaign_that_is_not_run_by_a_gm(self):
        campaign_id = _scheduled_campaign([_tomorrow()], gm_campaign=False)
        _run_once()
        assert _notes(campaign_id) == []


def test_seconds_until_midnight_is_within_a_day():
    secs = session_creator._seconds_until_utc_midnight()
    assert 1.0 <= secs <= 24 * 60 * 60


class TestThread:
    def test_runs_at_start_and_stops_cleanly(self):
        ran = threading.Event()
        with patch.object(
            session_creator, "_create_upcoming_sessions", side_effect=lambda _db: ran.set()
        ), patch.object(session_creator, "_seconds_until_utc_midnight", return_value=3600.0):
            session_creator.start()
            assert ran.wait(5)
            session_creator.stop()
        assert session_creator._thread is None

    def test_a_failing_run_is_logged_and_the_thread_keeps_going(self):
        calls = []
        done = threading.Event()

        def fail(_db):
            calls.append(1)
            if len(calls) >= 2:
                done.set()
            raise RuntimeError("database is locked")

        with patch.object(session_creator, "_create_upcoming_sessions", side_effect=fail), patch.object(
            session_creator, "_seconds_until_utc_midnight", return_value=0.01
        ), patch.object(session_creator.logger, "error") as logged:
            session_creator.start()
            assert done.wait(5)
            session_creator.stop()
        assert len(calls) >= 2
        assert logged.call_count >= 2
