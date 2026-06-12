"""Self-service user endpoints (preferences, password, account deletion)."""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from ...config import SessionLocal, OPDS_ENABLED, BASE_URL, DISABLE_PASSWORD_CHANGE
from ...models import User, Campaign
from ...auth import get_current_user, CurrentUser, hash_password, verify_password
from ._schemas import PasswordChange, PreferencesUpdate

router = APIRouter()


def update_own_preferences(
    data: PreferencesUpdate,
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=current_user.id).first()
        if not user:
            raise HTTPException(404, "User not found")
        if data.allow_explicit is not None:
            user.allow_explicit = data.allow_explicit
        if data.display_name is not None:
            user.display_name = data.display_name.strip() or None
        if data.email is not None:
            new_email = data.email or None  # "" → clear
            if new_email and new_email != user.email:
                conflict = db.query(User).filter_by(email=new_email).first()
                if conflict and conflict.id != user.id:
                    raise HTTPException(400, "Email already in use")
            user.email = new_email
        db.commit()
        return {
            "allow_explicit": user.allow_explicit,
            "display_name": user.display_name,
            "email": user.email,
        }
    finally:
        db.close()


def change_own_password(
    data: PasswordChange,
    current_user: CurrentUser = Depends(get_current_user),
):
    if DISABLE_PASSWORD_CHANGE and current_user.role != "admin":
        raise HTTPException(403, "Password changes are disabled on this server")
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=current_user.id).first()
        if not user:
            raise HTTPException(404, "User not found")
        if not verify_password(data.current_password, user.hashed_password):
            raise HTTPException(400, "Current password is incorrect")
        user.hashed_password = hash_password(data.new_password)
        db.commit()
        return {"status": "ok"}
    finally:
        db.close()


def delete_own_account(current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=current_user.id).first()
        if not user:
            raise HTTPException(404, "User not found")
        if user.role == "admin":
            raise HTTPException(400, "Admin accounts cannot be self-deleted")
        uid = user.id
        for campaign in db.query(Campaign).filter_by(owner_id=uid).all():
            db.delete(campaign)
        db.execute(text("DELETE FROM campaign_members WHERE user_id = :uid"), {"uid": uid})
        db.execute(text("DELETE FROM player_session_notes WHERE user_id = :uid"), {"uid": uid})
        db.execute(text("DELETE FROM session_availability WHERE user_id = :uid"), {"uid": uid})
        db.execute(text("DELETE FROM bookmarks WHERE user_id = :uid"), {"uid": uid})
        db.execute(text("DELETE FROM favorites WHERE user_id = :uid"), {"uid": uid})
        db.delete(user)
        db.commit()
    finally:
        db.close()


def get_opds_status(current_user: CurrentUser = Depends(get_current_user)):
    """Return OPDS availability and the user's current feed URL (if enabled)."""
    if not OPDS_ENABLED:
        return {"opds_enabled": False, "feed_url": None}
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=current_user.id).first()
        if not user:
            raise HTTPException(404, "User not found")
        feed_url = f"{BASE_URL}/opds/{user.opds_token}" if user.opds_token else None
        return {"opds_enabled": True, "has_token": bool(user.opds_token), "feed_url": feed_url}
    finally:
        db.close()


def generate_opds_token(current_user: CurrentUser = Depends(get_current_user)):
    """Generate (or regenerate) the user's OPDS token. Old token is immediately revoked."""
    if not OPDS_ENABLED:
        raise HTTPException(403, "OPDS is not enabled on this server")
    token = secrets.token_urlsafe(48)
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=current_user.id).first()
        if not user:
            raise HTTPException(404, "User not found")
        user.opds_token = token
        db.commit()
        feed_url = f"{BASE_URL}/opds/{token}"
        return {"opds_enabled": True, "has_token": True, "feed_url": feed_url}
    finally:
        db.close()


def revoke_opds_token(current_user: CurrentUser = Depends(get_current_user)):
    """Revoke the user's OPDS token. The feed URL immediately stops working."""
    if not OPDS_ENABLED:
        raise HTTPException(403, "OPDS is not enabled on this server")
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=current_user.id).first()
        if not user:
            raise HTTPException(404, "User not found")
        user.opds_token = None
        db.commit()
        return {"opds_enabled": True, "has_token": False, "feed_url": None}
    finally:
        db.close()
