"""Campaign membership: invitations, status updates, removal, and the
invitable-users listing.

Split out of ``core.py`` (issue #152) so campaign CRUD and member management live
in focused modules. Route registration stays centralised in ``__init__.py`` — the
external API surface is unchanged.
"""

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import CampaignMember, User
from ._helpers import (
    assert_can_manage,
    assert_not_archived,
    delete_guest_user,
    get_campaign_or_404,
    user_has_campaign_access,
)
from ._schemas import InvitePayload, MemberStatusUpdate


def invite_member(
    campaign_id: str,
    data: InvitePayload,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    if not c.is_gm_campaign:
        raise HTTPException(400, "Only GM campaigns support invitations")

    target = db.query(User).filter_by(id=data.user_id).first()
    if not target:
        raise HTTPException(404, "User not found")
    if not user_has_campaign_access(db, target.id):
        raise HTTPException(
            403,
            "This user's campaign access is disabled and they cannot be added to campaigns",
        )

    existing = (
        db.query(CampaignMember)
        .filter_by(campaign_id=campaign_id, user_id=data.user_id)
        .first()
    )
    if existing:
        raise HTTPException(409, "User already invited")

    member = CampaignMember(campaign_id=campaign_id, user_id=data.user_id, status="invited")
    db.add(member)
    db.commit()
    return {"user_id": data.user_id, "status": "invited"}


def update_member_status(
    campaign_id: str,
    user_id: str,
    data: MemberStatusUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    is_owner = c.owner_id == current_user.id
    if user_id != current_user.id and not is_owner:
        raise HTTPException(403, "Cannot update another member's status")
    assert_not_archived(c)

    member = (
        db.query(CampaignMember).filter_by(campaign_id=campaign_id, user_id=user_id).first()
    )
    if not member:
        raise HTTPException(404, "Member not found")

    if data.status is not None:
        if data.status not in ("accepted", "declined"):
            raise HTTPException(400, "Status must be 'accepted' or 'declined'")
        # A user whose campaign access is disabled may decline an existing
        # invitation but cannot join (accept) a campaign.
        if data.status == "accepted" and not user_has_campaign_access(db, member.user_id):
            raise HTTPException(403, "Your campaign access has been disabled")
        member.status = data.status

    if data.character_name is not None:
        if not is_owner and user_id != current_user.id:
            raise HTTPException(
                403, "Only the GM or the member themselves can set a character name"
            )
        member.character_name = data.character_name.strip() or None

    if data.character_sheet_url is not None:
        if not is_owner and user_id != current_user.id:
            raise HTTPException(
                403, "Only the GM or the member themselves can set a character sheet link"
            )
        url = data.character_sheet_url.strip()
        member.character_sheet_url = url or None
        if url:
            # A link replaces any uploaded sheet file.
            member.character_sheet_path = None
            member.character_sheet_filename = None

    db.commit()
    return {
        "user_id": user_id,
        "status": member.status,
        "character_name": member.character_name,
        "character_sheet_url": member.character_sheet_url,
    }


def remove_member(
    campaign_id: str,
    user_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    is_self = user_id == current_user.id
    if not is_self and c.owner_id != current_user.id:
        raise HTTPException(403, "Not authorised")
    # Leaving is always the member's own call, archived or not — nobody should be
    # held in a campaign because its GM archived it. The archive freeze therefore
    # only blocks the *owner* removing someone else, which is an edit to a record
    # that is meant to stay as it was left.
    if not is_self:
        assert_not_archived(c)

    member = (
        db.query(CampaignMember).filter_by(campaign_id=campaign_id, user_id=user_id).first()
    )
    if member:
        was_guest = bool(member.is_guest)
        db.delete(member)
        # A guest is single-campaign, so removing them from it leaves nothing
        # behind — delete the backing guest account and its contributions too.
        if was_guest:
            delete_guest_user(db, user_id)
        db.commit()


def eligible_members(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)

    existing = {
        m.user_id for m in db.query(CampaignMember).filter_by(campaign_id=campaign_id).all()
    }
    # Guests are not invitable here — they're created via the guest panel.
    users = (
        db.query(User)
        .filter(
            User.id != c.owner_id,
            (User.is_guest == False) | (User.is_guest.is_(None)),  # noqa: E712
        )
        .all()
    )
    return [
        {
            "id": u.id,
            "username": u.username,
            "display_name": u.display_name,
            "role": u.role,
            "already_invited": u.id in existing,
            "campaign_access": u.campaign_access is None or bool(u.campaign_access),
        }
        for u in users
    ]
