"""Schedule and availability endpoint handlers for campaigns."""

import datetime
import zoneinfo

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import CampaignMember, CampaignSchedule, SessionAvailability, User
from ._helpers import (
    assert_can_manage,
    assert_not_archived,
    can_view,
    compute_next_sessions,
    get_campaign_or_404,
)
from ._schemas import AvailabilityUpdate, ScheduleUpsert


def _utc_clock_to_local(utc_clock: str, tz_name: str | None) -> str:
    """Convert a legacy "HH:MM" UTC clock to the local clock in ``tz_name``.

    Only the clock is returned; the caller's ``days`` are already local, which is
    precisely the pairing the local-time model restores. Without a usable zone the
    clock is passed through unchanged — there is nothing to convert against.

    The conversion is resolved against *today*, because a UTC clock alone does not
    say which offset produced it: 02:30Z is 18:30 PST in January but 19:30 PDT in
    July. Today's offset is the one the client was using when it sent this, so it
    recovers what the user actually picked. This is a one-shot compatibility path
    — once stored, the local clock needs no further conversion, which is the whole
    point of the model.
    """
    if not tz_name:
        return utc_clock
    try:
        zone = zoneinfo.ZoneInfo(tz_name)
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        return utc_clock
    try:
        hour, minute = (int(p) for p in utc_clock.split(":")[:2])
    except (ValueError, TypeError):
        return utc_clock
    today = datetime.date.today()
    ref = datetime.datetime(
        today.year, today.month, today.day, hour, minute, tzinfo=datetime.timezone.utc
    )
    local = ref.astimezone(zone)
    return f"{local.hour:02d}:{local.minute:02d}"


def get_schedule(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")

    sched = db.query(CampaignSchedule).filter_by(campaign_id=campaign_id).first()
    if not sched:
        return {"definition": None, "enabled": False, "next_sessions": []}

    # A disabled schedule keeps its definition but produces no upcoming sessions.
    next_sessions = compute_next_sessions(sched.definition, n=10) if sched.enabled else []
    return {
        "definition": sched.definition,
        "enabled": sched.enabled,
        "next_sessions": next_sessions,
    }


def upsert_schedule(
    campaign_id: str,
    data: ScheduleUpsert,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    if not c.is_gm_campaign:
        raise HTTPException(400, "Schedules are only available on GM-run campaigns")
    if data.frequency not in ("weekly", "biweekly", "monthly", "custom"):
        raise HTTPException(400, "frequency must be weekly | biweekly | monthly | custom")
    if data.frequency != "custom" and any(d < 0 or d > 6 for d in data.days):
        raise HTTPException(400, "days must be weekday indices 0-6")

    if data.timezone is not None:
        try:
            zoneinfo.ZoneInfo(data.timezone)
        except (zoneinfo.ZoneInfoNotFoundError, ValueError):
            raise HTTPException(400, "timezone must be a valid IANA zone name")

    # Both halves of the stored pair are local. A legacy client posting only the
    # UTC form is converted here, using the zone it also sends; without a zone
    # there is nothing to convert with, so the clock is taken at face value.
    time_local = data.time_local
    if time_local is None and data.time_utc is not None:
        time_local = _utc_clock_to_local(data.time_utc, data.timezone)

    definition: dict = {
        "days": data.days,
        "frequency": data.frequency,
        "time_local": time_local,
        "timezone": data.timezone,
        # Marks the definition as already using the local-time model, so the
        # startup migration skips it.
        "time_model": "local",
    }
    if data.frequency == "biweekly":
        definition["biweekly_reference"] = (
            data.biweekly_reference or datetime.date.today().isoformat()
        )
    if data.frequency == "monthly":
        definition["monthly_week"] = data.monthly_week if data.monthly_week is not None else 1
    if data.frequency == "custom":
        definition["custom_dates"] = sorted(set(data.custom_dates or []))

    sched = db.query(CampaignSchedule).filter_by(campaign_id=campaign_id).first()
    if sched:
        sched.definition = definition
        sched.enabled = data.enabled
    else:
        sched = CampaignSchedule(
            campaign_id=campaign_id, definition=definition, enabled=data.enabled
        )
        db.add(sched)
    db.commit()

    next_sessions = compute_next_sessions(definition, n=10) if data.enabled else []
    return {"definition": definition, "enabled": data.enabled, "next_sessions": next_sessions}


def delete_schedule(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    sched = db.query(CampaignSchedule).filter_by(campaign_id=campaign_id).first()
    if sched:
        db.delete(sched)
        db.commit()


def get_availability(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")

    sched = db.query(CampaignSchedule).filter_by(campaign_id=campaign_id).first()
    next_sessions = (
        compute_next_sessions(sched.definition, n=10) if sched and sched.enabled else []
    )

    all_avail = (
        db.query(SessionAvailability)
        .filter(
            SessionAvailability.campaign_id == campaign_id,
            SessionAvailability.session_date.in_(next_sessions) if next_sessions else False,
        )
        .all()
        if next_sessions
        else []
    )

    avail_map: dict = {}
    cancelled_dates: set = set()
    for a in all_avail:
        if a.session_date not in avail_map:
            avail_map[a.session_date] = {}
        avail_map[a.session_date][a.user_id] = {
            "status": a.status,
            "is_cancelled": a.is_cancelled,
        }
        if a.is_cancelled:
            cancelled_dates.add(a.session_date)

    members = (
        db.query(CampaignMember).filter_by(campaign_id=campaign_id, status="accepted").all()
    )
    participant_ids = [c.owner_id] + [m.user_id for m in members]
    all_users = {u.id: u for u in db.query(User).filter(User.id.in_(participant_ids)).all()}

    rows = []
    for uid in participant_ids:
        u = all_users.get(uid)
        is_owner = uid == c.owner_id
        row = {
            "user_id": uid,
            "username": u.username if u else "",
            "display_name": u.display_name if u else None,
            "is_owner": is_owner,
            "dates": {},
        }
        for d in next_sessions:
            entry = avail_map.get(d, {}).get(uid)
            row["dates"][d] = entry or {"status": None, "is_cancelled": False}
        rows.append(row)

    return {
        "next_sessions": next_sessions,
        "cancelled_dates": list(cancelled_dates),
        "rows": rows,
    }


def set_availability(
    campaign_id: str,
    session_date: str,
    data: AvailabilityUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")
    assert_not_archived(c)
    if data.status not in ("available", "tentative", "unavailable"):
        raise HTTPException(400, "status must be available | tentative | unavailable")

    # Resolve the target user — GMs and admins may set another member's availability.
    is_gm = c.owner_id == current_user.id or current_user.role == "admin"
    if data.user_id is not None and data.user_id != current_user.id:
        if not is_gm:
            raise HTTPException(403, "Only the GM can set another member's availability")
        target_user_id = data.user_id
    else:
        target_user_id = current_user.id

    is_cancelled = False
    if data.is_cancelled is not None:
        if not is_gm:
            raise HTTPException(403, "Only the GM can cancel sessions")
        is_cancelled = data.is_cancelled

    try:
        datetime.date.fromisoformat(session_date)
    except ValueError:
        raise HTTPException(400, "session_date must be YYYY-MM-DD")

    avail = (
        db.query(SessionAvailability)
        .filter_by(
            campaign_id=campaign_id,
            user_id=target_user_id,
            session_date=session_date,
        )
        .first()
    )
    if avail:
        avail.status = data.status
        if data.is_cancelled is not None:
            avail.is_cancelled = is_cancelled
    else:
        avail = SessionAvailability(
            campaign_id=campaign_id,
            user_id=target_user_id,
            session_date=session_date,
            status=data.status,
            is_cancelled=is_cancelled,
        )
        db.add(avail)
    db.commit()
    return {
        "session_date": session_date,
        "status": avail.status,
        "is_cancelled": avail.is_cancelled,
    }


def cancel_session_date(
    campaign_id: str,
    session_date: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if c.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(403, "Only the GM can cancel sessions")
    assert_not_archived(c)
    try:
        datetime.date.fromisoformat(session_date)
    except ValueError:
        raise HTTPException(400, "session_date must be YYYY-MM-DD")

    avail = (
        db.query(SessionAvailability)
        .filter_by(
            campaign_id=campaign_id,
            user_id=current_user.id,
            session_date=session_date,
        )
        .first()
    )
    if avail:
        avail.is_cancelled = not avail.is_cancelled
    else:
        avail = SessionAvailability(
            campaign_id=campaign_id,
            user_id=current_user.id,
            session_date=session_date,
            status="available",
            is_cancelled=True,
        )
        db.add(avail)

    db.query(SessionAvailability).filter_by(
        campaign_id=campaign_id,
        session_date=session_date,
    ).update({"is_cancelled": avail.is_cancelled})

    db.commit()
    return {"session_date": session_date, "is_cancelled": avail.is_cancelled}
