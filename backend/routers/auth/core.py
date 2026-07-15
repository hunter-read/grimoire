"""Authentication endpoint handlers."""
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import func

from ...auth import (
    AUTH_COOKIE_NAME,
    CurrentUser,
    clear_auth_cookie,
    create_token,
    get_current_user,
    hash_password,
    set_auth_cookie,
    verify_password,
)
from ...config import SessionLocal
from ...models import CampaignMember, User
from ...security import AUTH_RATE_LIMIT, limiter
from ..settings._helpers import (
    _get_raw,
    guest_access_effective,
    oidc_effective,
    oidc_is_configured,
    password_auth_effective,
)
from ._schemas import GuestLoginRequest, LoginRequest, SetupRequest


def auth_status():
    db = SessionLocal()
    try:
        return {"initialized": db.query(User).count() > 0}
    finally:
        db.close()


@limiter.limit(AUTH_RATE_LIMIT)
def auth_setup(request: Request, data: SetupRequest, response: Response):
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            raise HTTPException(400, "Server is already initialized")
        user = User(
            username=data.username,
            hashed_password=hash_password(data.password),
            role="admin",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        token = create_token(user.id, user.username, user.role)
        set_auth_cookie(response, token)
        return {
            "token": token,
            "user": {
                "id": user.id,
                "username": user.username,
                "display_name": user.display_name,
                "role": user.role,
            },
        }
    finally:
        db.close()


@limiter.limit(AUTH_RATE_LIMIT)
def auth_login(request: Request, data: LoginRequest, response: Response):
    db = SessionLocal()
    try:
        if not password_auth_effective(_get_raw(db)):
            raise HTTPException(403, "Password authentication is disabled")
        # Usernames are matched case-insensitively so a user who registered as
        # "Admin" can still log in as "admin"/"ADMIN". Passwords stay case-sensitive.
        user = (
            db.query(User)
            .filter(func.lower(User.username) == data.username.strip().lower())
            .first()
        )
        if not user or not verify_password(data.password, user.hashed_password):
            raise HTTPException(401, "Invalid username or password")
        token = create_token(user.id, user.username, user.role)
        set_auth_cookie(response, token)
        return {
            "token": token,
            "user": {
                "id": user.id,
                "username": user.username,
                "display_name": user.display_name,
                "role": user.role,
            },
        }
    finally:
        db.close()


@limiter.limit(AUTH_RATE_LIMIT)
def guest_login(request: Request, data: GuestLoginRequest, response: Response):
    db = SessionLocal()
    try:
        if not guest_access_effective(_get_raw(db)):
            raise HTTPException(403, "Guest access is disabled")
        if not data.code:
            raise HTTPException(401, "Invalid invite code")

        member = (
            db.query(CampaignMember)
            .filter_by(guest_code=data.code, is_guest=True, status="accepted")
            .first()
        )
        if not member:
            raise HTTPException(401, "Invalid invite code")

        user = db.query(User).filter_by(id=member.user_id).first()
        if not user or user.role != "guest":
            raise HTTPException(401, "Invalid invite code")

        token = create_token(user.id, user.username, user.role)
        set_auth_cookie(response, token)
        return {
            "token": token,
            "user": {
                "id": user.id,
                "username": user.username,
                "display_name": user.display_name,
                "role": user.role,
            },
            "campaign_id": member.campaign_id,
        }
    finally:
        db.close()


def auth_logout(response: Response):
    """Clear the session cookie. Deliberately requires no auth so a client with
    an already-expired or otherwise unusable cookie can still log out cleanly."""
    clear_auth_cookie(response)
    return {"ok": True}


def auth_config():
    db = SessionLocal()
    try:
        raw = _get_raw(db)
        msg_enabled = raw.get("custom_login_message_enabled", "false") == "true"
        eff = oidc_effective(raw)
        oidc_ready = oidc_is_configured(raw)
        return {
            "password_auth_enabled": password_auth_effective(raw),
            "guest_access_enabled": guest_access_effective(raw),
            "custom_login_message_enabled": msg_enabled,
            "custom_login_message": raw.get("custom_login_message", "") if msg_enabled else "",
            # OIDC — only expose enough for the login screen to render the button.
            # The button is shown only when the IdP is fully configured.
            "oidc_enabled": eff["oidc_enabled"] and oidc_ready,
            "oidc_button_text": eff["oidc_button_text"] if oidc_ready else "",
            "oidc_auto_launch": eff["oidc_auto_launch"] and oidc_ready,
        }
    finally:
        db.close()


def auth_me(request: Request, response: Response, user: CurrentUser = Depends(get_current_user)):
    # Re-establish the session cookie for clients that authenticated with a
    # Bearer header but have no cookie yet — chiefly users who were logged in
    # before the cookie was introduced (issue #156). Reuse their existing token
    # rather than minting a new one so the expiry isn't silently extended.
    if AUTH_COOKIE_NAME not in request.cookies:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            set_auth_cookie(response, auth_header[len("Bearer ") :])

    db = SessionLocal()
    try:
        u = db.query(User).filter_by(id=user.id).first()
        if not u:
            raise HTTPException(401, "User no longer exists")
        allow_explicit = u.allow_explicit if u.allow_explicit is not None else True
        campaign_access = u.campaign_access is None or bool(u.campaign_access)
    finally:
        db.close()
    return {
        "id": u.id,
        "username": u.username,
        "display_name": u.display_name,
        "email": u.email,
        "role": u.role,
        "allow_explicit": allow_explicit,
        "campaign_access": campaign_access,
        "oidc_linked": bool(u.oidc_subject),
    }
