"""Shared helpers and schedule computation for the campaigns package."""

import datetime
from typing import Optional, List

from fastapi import HTTPException

from ...models import Campaign, CampaignMember
from ...auth import CurrentUser


def is_gm_or_admin(user: CurrentUser) -> bool:
    return user.role in ("admin", "gm")


def get_campaign_or_404(db, campaign_id: str, allow_deleted: bool = False) -> Campaign:
    c = db.query(Campaign).filter_by(id=campaign_id).first()
    if not c:
        raise HTTPException(404, "Campaign not found")
    if not allow_deleted and c.deleted_at is not None:
        raise HTTPException(404, "Campaign not found")
    return c


def assert_can_manage(campaign: Campaign, user: CurrentUser):
    """Owner or admin can manage."""
    if campaign.owner_id != user.id and user.role != "admin":
        raise HTTPException(403, "Not authorised to manage this campaign")


def is_member(db, campaign_id: str, user_id: str) -> bool:
    return (
        db.query(CampaignMember)
        .filter_by(campaign_id=campaign_id, user_id=user_id, status="accepted")
        .first()
        is not None
    )


def can_view(campaign: Campaign, user: CurrentUser, db) -> bool:
    """Owner, accepted members, or admin can view."""
    if user.role == "admin" or campaign.owner_id == user.id:
        return True
    return is_member(db, campaign.id, user.id)


def serialize_campaign(c: Campaign, members: list, db) -> dict:
    from ...models import User, CampaignSchedule

    owner = db.query(User).filter_by(id=c.owner_id).first()
    owner_display = owner.display_name or owner.username if owner else ""
    has_schedule = db.query(CampaignSchedule).filter_by(campaign_id=c.id).first() is not None
    return {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "owner_id": c.owner_id,
        "owner_display_name": owner_display,
        "is_gm_campaign": c.is_gm_campaign,
        "gm_title": c.gm_title,
        "parent_campaign_id": c.parent_campaign_id,
        "system_id": c.system_id,
        "has_schedule": has_schedule,
        "members": members,
        "created_at": c.created_at.isoformat(),
        "updated_at": c.updated_at.isoformat(),
    }


def extract_snippet(content: str, query: str, window: int = 120) -> str:
    """Return a ~window-char excerpt centred on the first match of query."""
    idx = content.lower().find(query.lower())
    if idx == -1:
        return content[:window] + ("…" if len(content) > window else "")
    start = max(0, idx - window // 2)
    end = min(len(content), idx + len(query) + window // 2)
    snippet = content[start:end]
    if start > 0:
        snippet = "…" + snippet
    if end < len(content):
        snippet += "…"
    return snippet


def compute_next_sessions(definition: dict, n: int = 10) -> List[str]:
    """Return the next n session dates (YYYY-MM-DD) from today based on schedule."""
    frequency = definition.get("frequency", "weekly")
    # Offset by one day so sessions don't disappear for users west of UTC before midnight.
    today = datetime.date.today() - datetime.timedelta(days=1)

    if frequency == "custom":
        custom_dates = definition.get("custom_dates", [])
        future = sorted(d for d in custom_dates if d >= today.isoformat())
        return future[:n]

    days = definition.get("days", [])
    if not days:
        return []

    results: List[str] = []

    if frequency == "monthly":
        weekday = days[0]
        monthly_week = definition.get("monthly_week", 1)
        year, month = today.year, today.month
        for _ in range(24):
            if len(results) >= n:
                break
            d = nth_weekday_of_month(year, month, weekday, monthly_week)
            if d and d >= today:
                results.append(d.isoformat())
            month += 1
            if month > 12:
                month = 1
                year += 1
        return results

    reference = definition.get("biweekly_reference")
    if frequency == "biweekly" and reference:
        try:
            ref_date = datetime.date.fromisoformat(reference)
            ref_monday = ref_date - datetime.timedelta(days=ref_date.weekday())
        except ValueError:
            ref_monday = today - datetime.timedelta(days=today.weekday())
    else:
        ref_monday = None

    candidate = today
    max_search = 365 * 2
    searched = 0
    while len(results) < n and searched < max_search:
        searched += 1
        candidate += datetime.timedelta(days=1)
        if candidate.weekday() not in days:
            continue
        if frequency == "biweekly" and ref_monday:
            week_monday = candidate - datetime.timedelta(days=candidate.weekday())
            delta_weeks = (week_monday - ref_monday).days // 7
            if delta_weeks % 2 != 0:
                continue
        results.append(candidate.isoformat())

    return results


def nth_weekday_of_month(year: int, month: int, weekday: int, n: int) -> Optional[datetime.date]:
    """Return the nth occurrence (1-based, -1=last) of weekday (0=Mon) in year/month."""
    first_day = datetime.date(year, month, 1)
    first_wd = first_day.weekday()
    diff = (weekday - first_wd) % 7
    first_occurrence = first_day + datetime.timedelta(days=diff)
    if n == -1:
        last = first_occurrence
        while (last + datetime.timedelta(weeks=1)).month == month:
            last += datetime.timedelta(weeks=1)
        return last
    occurrence = first_occurrence + datetime.timedelta(weeks=n - 1)
    if occurrence.month != month:
        return None
    return occurrence
