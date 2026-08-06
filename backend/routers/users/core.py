"""Admin user management endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from ...config import get_db
from ...models import User, Campaign, CampaignMember
from ...auth import require_admin, CurrentUser, hash_password
from ..campaigns._helpers import purge_user_data
from ..settings._helpers import _get_raw, password_auth_effective
from ._schemas import UserCreate, UserUpdate, GuestConvert

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

    purge_user_data(db, user.id)
    db.delete(user)
    db.commit()
