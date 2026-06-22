"""Shared helpers and schedule computation for the campaigns package."""

import datetime
import re
from typing import Optional, List

from fastapi import HTTPException

from ...models import Campaign, CampaignMember, User
from ...auth import CurrentUser


# A GM-only secret span in a wiki body: ||text the players must never see||.
# Non-greedy so adjacent spans on one line don't merge; DOTALL so a secret may
# wrap multiple lines.
_GM_SECRET_RE = re.compile(r"\|\|.*?\|\|", re.DOTALL)


def strip_gm_secrets(body: str) -> str:
    """Remove every ||...|| GM-only span (markers and enclosed text) from a body.

    Used before sending a wiki page to a non-owner so the GM's hidden notes never
    leave the server. An unterminated trailing `||` (no closing pair) is left as-is.
    """
    return _GM_SECRET_RE.sub("", body or "")


def is_gm_or_admin(user: CurrentUser) -> bool:
    return user.role in ("admin", "gm")


def user_has_campaign_access(db, user_id: str) -> bool:
    """Whether a user may create/join/manage campaigns. NULL/missing → enabled."""
    u = db.query(User).filter_by(id=user_id).first()
    if u is None:
        return False
    return u.campaign_access is None or bool(u.campaign_access)


def get_campaign_or_404(db, campaign_id: str) -> Campaign:
    c = db.query(Campaign).filter_by(id=campaign_id).first()
    if not c:
        raise HTTPException(404, "Campaign not found")
    return c


def assert_can_manage(campaign: Campaign, user: CurrentUser, db):
    """Only the owner can manage a campaign, and only while their campaign access
    is enabled. A disabled owner locks the campaign read-only for everyone."""
    if campaign.owner_id != user.id:
        raise HTTPException(403, "Not authorised to manage this campaign")
    if not user_has_campaign_access(db, campaign.owner_id):
        raise HTTPException(
            403, "Campaign is locked: the GM's campaign access has been disabled"
        )


def is_member(db, campaign_id: str, user_id: str) -> bool:
    return (
        db.query(CampaignMember)
        .filter_by(campaign_id=campaign_id, user_id=user_id, status="accepted")
        .first()
        is not None
    )


def can_view(campaign: Campaign, user: CurrentUser, db) -> bool:
    """Owner or accepted members can view the full campaign."""
    if campaign.owner_id == user.id:
        return True
    return is_member(db, campaign.id, user.id)


def build_members(c: Campaign, db) -> list:
    """Full member list for a campaign: the GM owner row first, then players."""
    from ...models import User

    rows = db.query(CampaignMember).filter_by(campaign_id=c.id).all()
    all_users = {u.id: u for u in db.query(User).all()}
    owner = all_users.get(c.owner_id)
    def _access(u) -> bool:
        return u is None or u.campaign_access is None or bool(u.campaign_access)

    members = []
    if owner:
        members.append(
            {
                "user_id": c.owner_id,
                "username": owner.username,
                "display_name": owner.display_name,
                "status": "accepted",
                "character_name": c.gm_title,
                "is_owner": True,
                "campaign_access": _access(owner),
            }
        )
    members += [
        {
            "id": m.id,
            "user_id": m.user_id,
            "username": all_users[m.user_id].username if m.user_id in all_users else "",
            "display_name": all_users[m.user_id].display_name if m.user_id in all_users else None,
            "status": m.status,
            "character_name": m.character_name,
            "is_owner": False,
            "is_guest": bool(m.is_guest),
            "guest_code": m.guest_code if m.is_guest else None,
            "campaign_access": _access(all_users.get(m.user_id)),
            "has_art": bool(m.character_art_path),
            "has_sheet": bool(m.character_sheet_path),
            "character_sheet_filename": m.character_sheet_filename,
            "character_sheet_url": m.character_sheet_url,
        }
        for m in rows
    ]
    return members


def serialize_campaign(c: Campaign, members: list, db) -> dict:
    from ...models import User, CampaignSchedule

    owner = db.query(User).filter_by(id=c.owner_id).first()
    owner_display = owner.display_name or owner.username if owner else ""
    owner_has_access = owner is None or owner.campaign_access is None or bool(owner.campaign_access)
    schedule = db.query(CampaignSchedule).filter_by(campaign_id=c.id).first()

    # Next upcoming scheduled session date (YYYY-MM-DD), if an enabled schedule exists.
    next_session = None
    if schedule and schedule.enabled and schedule.definition:
        upcoming = compute_next_sessions(schedule.definition, n=1)
        next_session = upcoming[0] if upcoming else None

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
        "system_name": c.system_name,
        "has_schedule": schedule is not None,
        "next_session": next_session,
        "has_banner": bool(c.banner_path),
        "resource_group_order": c.resource_group_order or [],
        # True when the owner's campaign access is disabled — the campaign is then
        # read-only for everyone (players keep view access, lose all writes).
        "locked": not owner_has_access,
        "owner_has_campaign_access": owner_has_access,
        "members": members,
        "created_at": c.created_at.isoformat(),
        "updated_at": c.updated_at.isoformat(),
        "last_accessed_at": c.last_accessed_at.isoformat() if c.last_accessed_at else None,
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
