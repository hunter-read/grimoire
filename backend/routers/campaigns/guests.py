"""Guest invite management: create/list/regenerate/remove per-campaign guests.

A guest is a lightweight, code-only User (role="guest", no password/OIDC) backing
a CampaignMember. The 10-char alphanumeric guest code (stored hashed and sealed,
see ``CampaignMember.guest_code``) mints a JWT for that guest
via POST /api/auth/guest-login. A guest normally belongs to one campaign:
removing the member (here or via the generic member-removal endpoint) also
deletes the guest User and its contributions, unless an admin merged it into
other campaigns it is still in (see release_guest_membership).
"""

import secrets
import urllib.parse
from typing import Optional

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db, BASE_URL
from ...models import Campaign, CampaignMember, User
from ...sessions import revoke_user_sessions
from ...services.app_settings import get_raw, guest_access_effective
from ._helpers import assert_can_manage, get_campaign_or_404
from ...services.campaigns.user_data import generate_guest_code, release_guest_membership
from ._schemas import GuestCreate

def _assert_guest_access(db):
    if not guest_access_effective(get_raw(db)):
        raise HTTPException(403, "Guest access is disabled on this server")


def _serialize_guest(member: CampaignMember, user: Optional[User]) -> dict:
    return {
        "id": member.id,
        "user_id": member.user_id,
        "nickname": user.display_name if user else None,
        "guest_code": member.guest_code,
        "status": member.status,
        "character_name": member.character_name,
        "has_art": bool(member.character_art_path),
        "has_sheet": bool(member.character_sheet_path),
    }


def _share_template(campaign: Campaign, nickname: str, code: str) -> dict:
    """Build copy-paste share text plus a mailto: link carrying the invite code."""
    link = f"{BASE_URL}/guest?code={code}"
    greeting = f"Hi {nickname}," if nickname else "Hi,"
    message = (
        f"{greeting}\n\n"
        f'You\'ve been invited as a guest to the campaign "{campaign.name}" on Grimoire.\n\n'
        f"Open this link and you're in: {link}\n"
        f"Or go to the login page and enter your invite code: {code}\n"
    )
    subject = f'Guest invite to "{campaign.name}"'
    mailto = (
        "mailto:?subject="
        + urllib.parse.quote(subject)
        + "&body="
        + urllib.parse.quote(message)
    )
    return {
        "code": code,
        "link": link,
        "message": message,
        "mailto_url": mailto,
        # Discord has no addressable "DM a user" URL, so the client copies this
        # text into a DM. Kept distinct in case the wording diverges later.
        "discord_message": message,
    }


def _get_managed_campaign(db, campaign_id: str, current_user: CurrentUser) -> Campaign:
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    if not c.is_gm_campaign:
        raise HTTPException(400, "Only GM campaigns support guest invites")
    return c


def _get_guest_member(db, campaign_id: str, member_id: str) -> CampaignMember:
    member = (
        db.query(CampaignMember)
        .filter_by(id=member_id, campaign_id=campaign_id, is_guest=True)
        .first()
    )
    if not member:
        raise HTTPException(404, "Guest not found")
    return member


def create_guest(
    campaign_id: str,
    data: GuestCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _assert_guest_access(db)
    _get_managed_campaign(db, campaign_id, current_user)

    nickname = (data.nickname or "").strip() or "Guest"
    code = generate_guest_code(db)

    guest_user = User(
        username=f"guest_{secrets.token_hex(8)}",
        display_name=nickname,
        role="guest",
        is_guest=True,
        hashed_password=None,
        campaign_access=True,
    )
    db.add(guest_user)
    db.flush()

    member = CampaignMember(
        campaign_id=campaign_id,
        user_id=guest_user.id,
        status="accepted",
        is_guest=True,
        guest_code=code,
    )
    db.add(member)

    db.commit()
    db.refresh(member)
    return _serialize_guest(member, guest_user)


def list_guests(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_managed_campaign(db, campaign_id, current_user)
    members = (
        db.query(CampaignMember).filter_by(campaign_id=campaign_id, is_guest=True).all()
    )
    users = {u.id: u for u in db.query(User).all()}
    return [_serialize_guest(m, users.get(m.user_id)) for m in members]


def regenerate_guest_code(
    campaign_id: str,
    member_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _assert_guest_access(db)
    _get_managed_campaign(db, campaign_id, current_user)
    member = _get_guest_member(db, campaign_id, member_id)
    member.guest_code = generate_guest_code(db)
    # Regenerating the code is how a GM revokes a shared invite, so sessions
    # opened with the old code must end with it.
    revoke_user_sessions(db, member.user_id)
    db.commit()
    db.refresh(member)
    user = db.query(User).filter_by(id=member.user_id).first()
    return _serialize_guest(member, user)


def remove_guest(
    campaign_id: str,
    member_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_managed_campaign(db, campaign_id, current_user)
    member = _get_guest_member(db, campaign_id, member_id)
    user_id, guest_code = member.user_id, member.guest_code
    db.delete(member)
    # A guest in no other campaign loses its backing User and contributions too,
    # so no orphan account lingers; a merged guest keeps its other campaigns.
    release_guest_membership(db, user_id, guest_code)
    db.commit()


def guest_share_template(
    campaign_id: str,
    member_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = _get_managed_campaign(db, campaign_id, current_user)
    member = _get_guest_member(db, campaign_id, member_id)
    user = db.query(User).filter_by(id=member.user_id).first()
    nickname = (user.display_name or "") if user else ""
    return _share_template(c, nickname, member.guest_code or "")
