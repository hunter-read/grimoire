"""Self-service user endpoints (preferences, password, account deletion)."""
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ... import api_keys, config, token_vault
from ...config import OPDS_ENABLED, BASE_URL, get_db
from ...models import User
from ...auth import get_current_user, CurrentUser, hash_password, verify_password
from ...sessions import delete_user_sessions, revoke_user_sessions
from ...services.campaigns.user_data import purge_user_data
from ._schemas import PasswordChange, PreferencesUpdate

router = APIRouter()


def _assert_email_self_service(db: Session, user: User) -> None:
    """Refuse a self-service email change where the address identifies the account.

    When single sign-on matches accounts by email, the address is how a first
    SSO login finds its account, so only an admin (or the provider) sets it.
    Campaign guests have no use for an email at all.
    """
    from ...services.app_settings import get_raw, oidc_effective

    if user.is_guest or user.role == "guest":
        raise HTTPException(403, "Guest accounts can't set an email address")
    if oidc_effective(get_raw(db)).get("oidc_match_by") == "email":
        raise HTTPException(
            403,
            "Your email address is used to sign you in, so only an admin can change it",
        )


def _assert_not_demo(current_user: CurrentUser) -> None:
    """Block self-service account changes for non-admins when demo mode is on."""
    if config.ENABLE_DEMO_MODE and current_user.role != "admin":
        raise HTTPException(403, "Account actions are disabled in demo mode")


def update_own_preferences(
    data: PreferencesUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _assert_not_demo(current_user)
    user = db.query(User).filter_by(id=current_user.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if data.allow_explicit is not None and data.allow_explicit != user.allow_explicit:
        # A content preference a person sets for themselves, not an
        # integration's to change.
        api_keys.assert_session(current_user)
    if data.allow_explicit is not None:
        if data.allow_explicit and user.explicit_locked:
            raise HTTPException(
                403, "An admin has turned explicit content off for your account"
            )
        user.allow_explicit = data.allow_explicit
    if data.display_name is not None:
        user.display_name = data.display_name.strip() or None
    if data.email is not None and (data.email or None) != user.email:
        # The address single sign-on can match accounts on.
        api_keys.assert_session(current_user)
        _assert_email_self_service(db, user)
        new_email = data.email or None  # "" → clear
        if new_email:
            conflict = db.query(User).filter_by(email=new_email).first()
            if conflict and conflict.id != user.id:
                raise HTTPException(400, "Email already in use")
        user.email = new_email
    db.commit()
    return {
        "allow_explicit": user.allow_explicit,
        "explicit_locked": bool(user.explicit_locked),
        "display_name": user.display_name,
        "email": user.email,
    }


def change_own_password(
    data: PasswordChange,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _assert_not_demo(current_user)
    user = db.query(User).filter_by(id=current_user.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if not verify_password(data.current_password, user.hashed_password):
        raise HTTPException(400, "Current password is incorrect")
    user.hashed_password = hash_password(data.new_password)
    # Changing your password is the standard way to boot out someone who has
    # your old one, so every *other* session ends. The current one is kept so
    # the user isn't logged out of the device they just did this on.
    revoked = revoke_user_sessions(db, user.id, except_session_id=current_user.session_id)
    db.commit()
    return {"status": "ok", "sessions_revoked": revoked}


def delete_own_account(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _assert_not_demo(current_user)
    user = db.query(User).filter_by(id=current_user.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == "admin":
        raise HTTPException(400, "Admin accounts cannot be self-deleted")
    delete_user_sessions(db, user.id)
    purge_user_data(db, user.id)
    db.delete(user)
    db.commit()


def _opds_feed_urls(token: Optional[str]) -> Optional[list[dict[str, str]]]:
    """Each feed version's URL for ``token``, newest first; None without a token.

    v1 stays on offer so a reader already subscribed to it keeps a working URL
    (issue #673); ``feed_url`` keeps returning it for the same reason.
    """
    if not token:
        return None
    return [
        {"version": "v2", "url": f"{BASE_URL}/opds/v2/{token}"},
        {"version": "v1", "url": f"{BASE_URL}/opds/{token}"},
    ]


def get_opds_status(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return OPDS availability and the user's current feed URL (if enabled)."""
    # OPDS is a full-library-browse feature; guests are campaign-scoped and get no
    # library feed. Report it as unavailable to them.
    if not OPDS_ENABLED or current_user.role == "guest":
        return {"opds_enabled": False, "feed_url": None, "feed_urls": None}
    user = db.query(User).filter_by(id=current_user.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    # None too when it was sealed under a different SECRET_KEY: that token can
    # no longer match a feed request either, so the user is offered a new one.
    token = token_vault.unseal(user.opds_token_sealed)
    feed_url = f"{BASE_URL}/opds/{token}" if token else None
    return {
        "opds_enabled": True,
        "has_token": bool(token),
        "feed_url": feed_url,
        "feed_urls": _opds_feed_urls(token),
    }


def generate_opds_token(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate (or regenerate) the user's OPDS token. Old token is immediately revoked."""
    _assert_not_demo(current_user)
    if not OPDS_ENABLED:
        raise HTTPException(403, "OPDS is not enabled on this server")
    # Guests are campaign-scoped and must not get a full-library OPDS feed.
    if current_user.role == "guest":
        raise HTTPException(403, "Guests cannot use OPDS")
    token = secrets.token_urlsafe(48)
    user = db.query(User).filter_by(id=current_user.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    user.opds_token_hash = token_vault.lookup_hash(token)
    user.opds_token_sealed = token_vault.seal(token)
    db.commit()
    feed_url = f"{BASE_URL}/opds/{token}"
    return {
        "opds_enabled": True,
        "has_token": True,
        "feed_url": feed_url,
        "feed_urls": _opds_feed_urls(token),
    }


def revoke_opds_token(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke the user's OPDS token. The feed URL immediately stops working."""
    _assert_not_demo(current_user)
    if not OPDS_ENABLED:
        raise HTTPException(403, "OPDS is not enabled on this server")
    user = db.query(User).filter_by(id=current_user.id).first()
    if not user:
        raise HTTPException(404, "User not found")
    user.opds_token_hash = None
    user.opds_token_sealed = None
    db.commit()
    return {"opds_enabled": True, "has_token": False, "feed_url": None, "feed_urls": None}
