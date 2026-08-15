"""Campaign schedule calendar (ICS) endpoints.

Two shapes of access, deliberately different:

* **Subscription feeds** (``/api/campaigns/calendar/{token}...``) authenticate by
  the per-user ``calendar_token`` in the path, because calendar apps cannot send
  an ``Authorization`` header. They live outside the JWT-protected prefix.
* **Token management** (``/api/campaigns/calendar/subscription``) is normal
  JWT-authenticated API, used by the UI to show, mint, and revoke the URL.

Feeds are personalised: the caller identified by the token gets *their own*
availability reflected in each event. See ``_calendar.py`` for why RSVP cannot
travel back over a subscribed feed.
"""

import datetime
import secrets
from typing import List, Optional

from fastapi import Depends, HTTPException, Path
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import BASE_URL, get_db
from ...models import Campaign, CampaignMember, CampaignSchedule, SessionAvailability, User
from ._calendar import build_calendar, build_event, session_uid
from ._helpers import can_view, compute_next_sessions, get_campaign_or_404

# How far ahead a subscription feed publishes. Calendar apps re-poll, so this
# only has to outrun the polling interval by a comfortable margin.
_FEED_SESSIONS = 26

# BASE_URL's default. When it is still this, the server has no idea what public
# origin it is reachable on, so a subscription URL built from it would be wrong.
_DEFAULT_BASE_URL = "http://localhost:9481"

_ICS_MEDIA_TYPE = "text/calendar; charset=utf-8"

# Reflected into each event so the user sees their own answer in their calendar.
_STATUS_LABELS = {
    "available": "Available",
    "tentative": "Tentative",
    "unavailable": "Unavailable",
}


def base_url_configured() -> bool:
    """True when BASE_URL points at something other than the localhost default."""
    return bool(BASE_URL) and BASE_URL != _DEFAULT_BASE_URL


def _ics_response(body: str, filename: str) -> Response:
    return Response(
        content=body,
        media_type=_ICS_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Subscribed feeds are polled; a stale cached copy would silently
            # freeze someone's calendar after a reschedule.
            "Cache-Control": "no-store, max-age=0",
        },
    )


def _user_campaigns(db: Session, user_id: str) -> List[Campaign]:
    """Every non-archived campaign the user owns or is an accepted member of."""
    owned = db.query(Campaign).filter_by(owner_id=user_id).all()
    member_ids = [
        m.campaign_id
        for m in db.query(CampaignMember).filter_by(user_id=user_id, status="accepted").all()
    ]
    joined = (
        db.query(Campaign).filter(Campaign.id.in_(member_ids)).all() if member_ids else []
    )
    by_id = {c.id: c for c in list(owned) + list(joined)}
    return [c for c in by_id.values() if not c.is_archived]


def _campaign_events(
    db: Session,
    campaign: Campaign,
    user_id: str,
    dtstamp: datetime.datetime,
) -> List[List[str]]:
    """Build the VEVENTs for one campaign, from the caller's point of view."""
    sched = db.query(CampaignSchedule).filter_by(campaign_id=campaign.id).first()
    if not sched or not sched.enabled:
        return []

    dates = compute_next_sessions(sched.definition or {}, n=_FEED_SESSIONS)
    if not dates:
        return []

    rows = (
        db.query(SessionAvailability)
        .filter(
            SessionAvailability.campaign_id == campaign.id,
            SessionAvailability.session_date.in_(dates),
        )
        .all()
    )
    own_status = {r.session_date: r.status for r in rows if r.user_id == user_id}
    cancelled = {r.session_date for r in rows if r.is_cancelled}

    time_utc = (sched.definition or {}).get("time_utc")
    link = f"{BASE_URL}/campaigns/{campaign.id}?tab=schedule"

    events = []
    for date in dates:
        is_cancelled = date in cancelled
        status = own_status.get(date)
        label = _STATUS_LABELS.get(status) if status else None

        summary = campaign.name
        if is_cancelled:
            summary = f"{summary} — Cancelled"
        elif label:
            summary = f"{summary} — {label}"

        description_parts = [
            f"Your availability: {label}" if label else "Your availability: not set",
            "",
            f"Set your availability in Grimoire: {link}",
        ]
        if is_cancelled:
            description_parts.insert(0, "This session has been cancelled.")
        if campaign.description:
            description_parts.append("")
            description_parts.append(campaign.description)

        events.append(
            build_event(
                uid=session_uid(campaign.id, date),
                dtstamp=dtstamp,
                session_date=date,
                time_utc=time_utc,
                summary=summary,
                description="\n".join(description_parts),
                url=link,
                cancelled=is_cancelled,
            )
        )
    return events


def _resolve_feed_user(db: Session, token: str) -> User:
    """Resolve a feed token to its user, or 404.

    404 rather than 401: an unauthenticated caller poking at feed URLs should not
    be able to tell a revoked token from one that never existed.
    """
    user = db.query(User).filter_by(calendar_token=token).first() if token else None
    if not user:
        raise HTTPException(404, "Calendar feed not found")
    return user


# --- Subscription feeds (token in path; no JWT) ---


def campaign_calendar_feed(
    token: str = Path(..., description="Per-user calendar feed token"),
    campaign_id: str = Path(..., description="Campaign to publish"),
    db: Session = Depends(get_db),
):
    """Publish one campaign's upcoming sessions as an ICS feed."""
    user = _resolve_feed_user(db, token)
    campaign = db.query(Campaign).filter_by(id=campaign_id).first()
    if not campaign:
        raise HTTPException(404, "Calendar feed not found")

    # The token identifies the user; membership still decides what they may see,
    # so losing access to a campaign silently empties the feed they subscribed to.
    is_owner = campaign.owner_id == user.id
    is_member = (
        db.query(CampaignMember)
        .filter_by(campaign_id=campaign.id, user_id=user.id, status="accepted")
        .first()
        is not None
    )
    if not (is_owner or is_member) or campaign.is_archived:
        raise HTTPException(404, "Calendar feed not found")

    dtstamp = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    events = _campaign_events(db, campaign, user.id, dtstamp)
    body = build_calendar(events, name=campaign.name)
    return _ics_response(body, f"{campaign.id}.ics")


def all_campaigns_calendar_feed(
    token: str = Path(..., description="Per-user calendar feed token"),
    db: Session = Depends(get_db),
):
    """Publish every campaign the token's user belongs to as one merged feed."""
    user = _resolve_feed_user(db, token)
    dtstamp = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

    events: List[List[str]] = []
    for campaign in _user_campaigns(db, user.id):
        events.extend(_campaign_events(db, campaign, user.id, dtstamp))

    body = build_calendar(events, name="Grimoire — My Campaigns")
    return _ics_response(body, "grimoire-campaigns.ics")


# --- One-off download (JWT-authenticated) ---


def download_campaign_calendar(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Download a campaign's schedule as a static .ics file.

    Unlike the feed this needs no token — the caller is already authenticated —
    and so it keeps working on a server with no BASE_URL configured.
    """
    campaign = get_campaign_or_404(db, campaign_id)
    if not can_view(campaign, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")

    dtstamp = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    events = _campaign_events(db, campaign, current_user.id, dtstamp)
    body = build_calendar(events, name=campaign.name)
    return _ics_response(body, f"{campaign.name or 'campaign'}.ics")


# --- Token management (JWT-authenticated) ---


def _subscription_payload(user: User, campaign_id: Optional[str] = None) -> dict:
    """Shape the subscription status the UI renders."""
    configured = base_url_configured()
    token = user.calendar_token
    feed_url = campaign_url = webcal_url = None

    if token and configured:
        feed_url = f"{BASE_URL}/api/campaigns/calendar/{token}/all.ics"
        # webcal:// makes desktop calendar apps subscribe on click instead of
        # downloading a one-off copy. Same URL, different scheme.
        webcal_url = feed_url.replace("https://", "webcal://").replace("http://", "webcal://")
        if campaign_id:
            campaign_url = f"{BASE_URL}/api/campaigns/calendar/{token}/{campaign_id}.ics"

    return {
        "has_token": bool(token),
        "base_url_configured": configured,
        "feed_url": feed_url,
        "webcal_url": webcal_url,
        "campaign_feed_url": campaign_url,
    }


def _get_user(db: Session, user_id: str) -> User:
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    return user


def get_calendar_subscription(
    campaign_id: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the caller's subscription URLs, if they have minted a token."""
    return _subscription_payload(_get_user(db, current_user.id), campaign_id)


def generate_calendar_token(
    campaign_id: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mint or rotate the caller's calendar token, revoking the previous one."""
    if not base_url_configured():
        raise HTTPException(
            400,
            "BASE_URL must be set to this server's public address before "
            "calendar subscription URLs can be issued",
        )
    user = _get_user(db, current_user.id)
    user.calendar_token = secrets.token_urlsafe(32)
    db.commit()
    return _subscription_payload(user, campaign_id)


def revoke_calendar_token(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke the caller's calendar token; every subscribed URL stops working."""
    user = _get_user(db, current_user.id)
    user.calendar_token = None
    db.commit()
    return _subscription_payload(user)
