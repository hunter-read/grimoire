"""Admin user management endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from ...config import get_db
from ...models import User, Campaign, CampaignMember
from ...auth import require_admin, CurrentUser, hash_password
from ...sessions import delete_user_sessions, revoke_user_sessions
from ..campaigns._helpers import purge_user_data, reassign_user_data
from ..settings._helpers import _get_raw, password_auth_effective
from ._schemas import UserCreate, UserUpdate, GuestConvert, GuestMerge

router = APIRouter()


def list_users(_: CurrentUser = Depends(require_admin), db: Session = Depends(get_db)):
    # Guests are code-only accounts managed per-campaign by their GM; they
    # never appear in the global user admin list.
    users = (
        db.query(User)
        .filter((User.is_guest == False) | (User.is_guest.is_(None)))  # noqa: E712
        .order_by(User.username)
        .all()
    )
    owned_counts = dict(
        db.query(Campaign.owner_id, func.count(Campaign.id))
        .group_by(Campaign.owner_id)
        .all()
    )
    return [
        {
            "id": u.id,
            "username": u.username,
            "display_name": u.display_name,
            "email": u.email,
            "role": u.role,
            "allow_explicit": bool(u.allow_explicit) if u.allow_explicit is not None else True,
            "campaign_access": u.campaign_access is None or bool(u.campaign_access),
            "campaign_count": owned_counts.get(u.id, 0),
            "oidc_linked": bool(u.oidc_subject),
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]


def list_guests(_: CurrentUser = Depends(require_admin), db: Session = Depends(get_db)):
    """List every guest account with the campaign it belongs to and who invited it.

    Guests are code-only accounts scoped to a single campaign, so each one maps to
    exactly one CampaignMember. The inviter is the campaign owner (the GM).
    """
    guests = (
        db.query(User)
        .filter(User.is_guest == True)  # noqa: E712
        .order_by(User.created_at)
        .all()
    )
    members = {
        m.user_id: m
        for m in db.query(CampaignMember).filter_by(is_guest=True).all()
    }
    campaigns = {c.id: c for c in db.query(Campaign).all()}
    owners = {u.id: u for u in db.query(User).all()}

    result = []
    for g in guests:
        member = members.get(g.id)
        campaign = campaigns.get(member.campaign_id) if member else None
        inviter = owners.get(campaign.owner_id) if campaign else None
        result.append(
            {
                "id": g.id,
                "display_name": g.display_name,
                "created_at": g.created_at.isoformat(),
                "campaign_id": campaign.id if campaign else None,
                "campaign_name": campaign.name if campaign else None,
                "invited_by": (
                    (inviter.display_name or inviter.username) if inviter else None
                ),
            }
        )
    return result


def create_user(
    data: UserCreate,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if db.query(User).filter_by(username=data.username.strip()).first():
        raise HTTPException(400, "Username already exists")
    if data.email and db.query(User).filter_by(email=data.email).first():
        raise HTTPException(400, "Email already in use")
    user = User(
        username=data.username.strip(),
        hashed_password=hash_password(data.password) if data.password else None,
        role=data.role,
        email=data.email,
    )
    if data.allow_explicit is not None:
        user.allow_explicit = data.allow_explicit
    if data.campaign_access is not None:
        user.campaign_access = data.campaign_access
    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "allow_explicit": bool(user.allow_explicit) if user.allow_explicit is not None else True,
        "campaign_access": user.campaign_access is None or bool(user.campaign_access),
        "campaign_count": 0,
        "oidc_linked": bool(user.oidc_subject),
    }


def update_user(
    user_id: str,
    data: UserUpdate,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found")

    if data.role and data.role != "admin" and user.role == "admin":
        admin_count = db.query(User).filter_by(role="admin").count()
        if admin_count <= 1:
            raise HTTPException(400, "Cannot demote the last admin")

    # A role change or an admin password reset must not leave existing sessions
    # usable — otherwise a demoted user keeps their old role until their token
    # expires, and a password reset does not lock out whoever prompted it
    # (issue #157).
    revoke_reason = (data.role and data.role != user.role) or bool(data.password)

    if data.role:
        user.role = data.role
    if data.password:
        user.hashed_password = hash_password(data.password)
    if data.allow_explicit is not None:
        user.allow_explicit = data.allow_explicit
    if data.campaign_access is not None:
        user.campaign_access = data.campaign_access
    if data.email is not None:
        new_email = data.email or None  # "" → clear
        if new_email and new_email != user.email:
            conflict = db.query(User).filter_by(email=new_email).first()
            if conflict and conflict.id != user.id:
                raise HTTPException(400, "Email already in use")
        user.email = new_email

    db.commit()
    if revoke_reason:
        revoke_user_sessions(db, user.id)
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "allow_explicit": bool(user.allow_explicit)
        if user.allow_explicit is not None
        else True,
        "campaign_access": user.campaign_access is None or bool(user.campaign_access),
    }


def convert_guest(
    user_id: str, data: GuestConvert, _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Promote a guest account to a permanent user.

    Clears the guest flag and its campaign codes but keeps the underlying User
    (and its campaign membership, notes, and character), so the player keeps
    everything they built up as a guest. A password is only set when password
    auth is enabled on the server; otherwise the account is OIDC/password-reset
    only, matching how admin-created accounts behave.
    """
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if not user.is_guest:
        raise HTTPException(400, "User is not a guest")

    new_username = data.username.strip()
    existing = db.query(User).filter_by(username=new_username).first()
    if existing and existing.id != user.id:
        raise HTTPException(400, "Username already exists")

    password_enabled = password_auth_effective(_get_raw(db))
    if password_enabled:
        if not data.password:
            raise HTTPException(400, "Password is required")
        user.hashed_password = hash_password(data.password)

    user.username = new_username
    user.role = data.role
    user.is_guest = False

    # The membership stays, but it's no longer a guest membership — drop the
    # invite code so the old code can't mint a token for this now-real user.
    for member in db.query(CampaignMember).filter_by(user_id=user.id).all():
        member.is_guest = False
        member.guest_code = None

    db.commit()
    # The account's role and credentials both changed — end the guest sessions
    # so the next request re-authenticates as the promoted user.
    revoke_user_sessions(db, user.id)
    db.refresh(user)
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "email": user.email,
        "role": user.role,
        "allow_explicit": bool(user.allow_explicit) if user.allow_explicit is not None else True,
        "campaign_access": user.campaign_access is None or bool(user.campaign_access),
        "campaign_count": db.query(Campaign).filter_by(owner_id=user.id).count(),
        "oidc_linked": bool(user.oidc_subject),
        "created_at": user.created_at.isoformat(),
    }


def merge_guests(
    user_id: str,
    data: GuestMerge,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Fold one or more guest accounts into the account at ``user_id``.

    The same person invited to several campaigns gets a separate guest account
    per campaign, with no way to join them up. This moves every source account's
    memberships, notes, and characters onto the target and deletes the emptied
    source accounts, leaving the person with one login across all their
    campaigns.

    The target may be a guest or an already-converted permanent user, so a guest
    can be merged into the real account the same person already has. Sources
    must be guests — merging away a permanent account would silently destroy a
    login someone is still using.
    """
    target = db.query(User).filter_by(id=user_id).first()
    if not target:
        raise HTTPException(404, "User not found")

    if user_id in data.source_ids:
        raise HTTPException(400, "Cannot merge an account into itself")

    sources = db.query(User).filter(User.id.in_(data.source_ids)).all()
    found = {u.id for u in sources}
    missing = [s for s in data.source_ids if s not in found]
    if missing:
        raise HTTPException(404, "Source account not found")
    non_guest = [u for u in sources if not u.is_guest]
    if non_guest:
        raise HTTPException(400, "Only guest accounts can be merged into another account")

    moved = 0
    merged_membership_ids: list[str] = []
    for source in sources:
        # Remember which memberships came across so their invite codes can be
        # retired below — the rows themselves move to the target.
        merged_membership_ids += [
            m.id for m in db.query(CampaignMember).filter_by(user_id=source.id).all()
        ]
        moved += reassign_user_data(db, source.id, target.id)
        # The source's own sessions are minted from its guest code; once the
        # account is gone those tokens must not keep working.
        delete_user_sessions(db, source.id)
        db.delete(source)

    # A merged-away guest's invite code must stop working. The membership row it
    # was attached to now belongs to the target, so leaving the code in place
    # would turn a retired invite into a second working login for the surviving
    # account. Access to the campaign comes from the membership row itself, not
    # the code, so the person still reaches every campaign they were in — they
    # just use the one code (or password) their surviving account already has.
    if merged_membership_ids:
        for member in (
            db.query(CampaignMember).filter(CampaignMember.id.in_(merged_membership_ids)).all()
        ):
            member.guest_code = None
            # Mirrors convert_guest: a membership under a permanent user is not
            # a guest membership.
            member.is_guest = bool(target.is_guest)

    db.commit()
    db.refresh(target)
    return {
        "id": target.id,
        "display_name": target.display_name,
        "merged_ids": data.source_ids,
        "memberships_moved": moved,
    }


def delete_user(
    user_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if user.id == current_user.id:
        raise HTTPException(400, "Cannot delete your own account")

    if user.role == "admin":
        admin_count = db.query(User).filter_by(role="admin").count()
        if admin_count <= 1:
            raise HTTPException(400, "Cannot delete the last admin")

    delete_user_sessions(db, user.id)
    purge_user_data(db, user.id)
    db.delete(user)
    db.commit()
