"""Self-service user endpoints (preferences, password, account deletion)."""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...config import OPDS_ENABLED, BASE_URL, get_db
from ...models import User
from ...auth import get_current_user, CurrentUser, hash_password, verify_password
from ...sessions import delete_user_sessions, revoke_user_sessions
from ..campaigns._helpers import purge_user_data
from ._schemas import PasswordChange, PreferencesUpdate

router = APIRouter()


def update_own_preferences(
    data: PreferencesUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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


def change_own_password(
    data: PasswordChange,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter_by(id=current_user.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if not verify_password(data.current_password, user.hashed_password):
        raise HTTPException(400, "Current password is incorrect")
    user.hashed_password = hash_password(data.new_password)
    db.commit()
    # Changing your password is the standard way to boot out someone who has
    # your old one, so every *other* session ends. The current one is kept so
    # the user isn't logged out of the device they just did this on.
    revoked = revoke_user_sessions(db, user.id, except_session_id=current_user.session_id)
    return {"status": "ok", "sessions_revoked": revoked}


def delete_own_account(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter_by(id=current_user.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == "admin":
        raise HTTPException(400, "Admin accounts cannot be self-deleted")
    delete_user_sessions(db, user.id)
    purge_user_data(db, user.id)
    db.delete(user)
    db.commit()


def get_opds_status(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return OPDS availability and the user's current feed URL (if enabled)."""
    # OPDS is a full-library-browse feature; guests are campaign-scoped and get no
    # library feed. Report it as unavailable to them.
    if not OPDS_ENABLED or current_user.role == "guest":
        return {"opds_enabled": False, "feed_url": None}
    user = db.query(User).filter_by(id=current_user.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    feed_url = f"{BASE_URL}/opds/{user.opds_token}" if user.opds_token else None
    return {"opds_enabled": True, "has_token": bool(user.opds_token), "feed_url": feed_url}


def generate_opds_token(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate (or regenerate) the user's OPDS token. Old token is immediately revoked."""
    if not OPDS_ENABLED:
        raise HTTPException(403, "OPDS is not enabled on this server")
    # Guests are campaign-scoped and must not get a full-library OPDS feed.
    if current_user.role == "guest":
        raise HTTPException(403, "Guests cannot use OPDS")
    token = secrets.token_urlsafe(48)
    user = db.query(User).filter_by(id=current_user.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    user.opds_token = token
    db.commit()
    feed_url = f"{BASE_URL}/opds/{token}"
    return {"opds_enabled": True, "has_token": True, "feed_url": feed_url}


def revoke_opds_token(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke the user's OPDS token. The feed URL immediately stops working."""
    if not OPDS_ENABLED:
        raise HTTPException(403, "OPDS is not enabled on this server")
    user = db.query(User).filter_by(id=current_user.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    user.opds_token = None
    db.commit()
    return {"opds_enabled": True, "has_token": False, "feed_url": None}
