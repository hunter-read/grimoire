"""Guest invite management: create/list/regenerate/remove per-campaign guests.

A guest is a lightweight, code-only User (role="guest", no password/OIDC) backing
a CampaignMember. The 10-char alphanumeric guest_code mints a JWT for that guest
via POST /api/auth/guest-login. Guests are single-campaign: deleting the member
also deletes the guest User and cascades their notes/availability.
"""

import secrets
import string
import urllib.parse

from fastapi import Depends, HTTPException

from ...auth import CurrentUser, get_current_user
from ...config import SessionLocal, BASE_URL
from ...models import Campaign, CampaignMember, User
from ..settings._helpers import _get_raw, guest_access_effective
from ._helpers import assert_can_manage, get_campaign_or_404
from ._schemas import GuestCreate

_CODE_ALPHABET = string.ascii_uppercase + string.digits
_CODE_LENGTH = 10


def _generate_guest_code(db) -> str:
    """Return a unique 10-char A–Z0–9 code, retrying on the rare collision."""
    for _ in range(20):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))
        if not db.query(CampaignMember).filter_by(guest_code=code).first():
            return code
    raise HTTPException(500, "Could not allocate a unique guest code")


def _assert_guest_access(db):
    if not guest_access_effective(_get_raw(db)):
        raise HTTPException(403, "Guest access is disabled on this server")


def _serialize_guest(member: CampaignMember, user: User) -> dict:
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
    campaign_id: str, data: GuestCreate, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        _assert_guest_access(db)
        c = _get_managed_campaign(db, campaign_id, current_user)

        nickname = (data.nickname or "").strip() or "Guest"
        code = _generate_guest_code(db)

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

        # First guest flips the per-campaign flag on.
        if not c.guest_invites_enabled:
            c.guest_invites_enabled = True

        db.commit()
        db.refresh(member)
        return _serialize_guest(member, guest_user)
    finally:
        db.close()


def list_guests(campaign_id: str, current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        _get_managed_campaign(db, campaign_id, current_user)
        members = (
            db.query(CampaignMember).filter_by(campaign_id=campaign_id, is_guest=True).all()
        )
        users = {u.id: u for u in db.query(User).all()}
        return [_serialize_guest(m, users.get(m.user_id)) for m in members]
    finally:
        db.close()


def regenerate_guest_code(
    campaign_id: str, member_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        _assert_guest_access(db)
        _get_managed_campaign(db, campaign_id, current_user)
        member = _get_guest_member(db, campaign_id, member_id)
        member.guest_code = _generate_guest_code(db)
        db.commit()
        db.refresh(member)
        user = db.query(User).filter_by(id=member.user_id).first()
        return _serialize_guest(member, user)
    finally:
        db.close()


def remove_guest(
    campaign_id: str, member_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        _get_managed_campaign(db, campaign_id, current_user)
        member = _get_guest_member(db, campaign_id, member_id)
        guest_user = db.query(User).filter_by(id=member.user_id).first()
        db.delete(member)
        # Guests are single-campaign — drop the backing User too so no orphan
        # account lingers. Only ever delete genuine guest accounts.
        if guest_user and guest_user.is_guest:
            db.delete(guest_user)
        db.commit()
    finally:
        db.close()


def guest_share_template(
    campaign_id: str, member_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        c = _get_managed_campaign(db, campaign_id, current_user)
        member = _get_guest_member(db, campaign_id, member_id)
        user = db.query(User).filter_by(id=member.user_id).first()
        nickname = user.display_name if user else ""
        return _share_template(c, nickname, member.guest_code)
    finally:
        db.close()
