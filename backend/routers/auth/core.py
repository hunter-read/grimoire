"""Authentication endpoint handlers."""
from typing import Optional

from fastapi import Cookie, Depends, HTTPException, Request, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...auth import (
    AUTH_COOKIE_NAME,
    CurrentUser,
    clear_auth_cookie,
    clear_refresh_cookie,
    create_token,
    get_current_user,
    hash_password,
    set_auth_cookie,
    set_refresh_cookie,
    verify_password,
)
from ...config import get_db
from ...models import AuthSession, CampaignMember, User
from ...security import AUTH_RATE_LIMIT, limiter
from ...sessions import (
    REFRESH_COOKIE_NAME,
    get_active_session,
    list_user_sessions,
    revoke_session,
    revoke_session_by_token,
    revoke_user_sessions,
    rotate_session,
)
from ..settings._helpers import (
    _get_raw,
    guest_access_effective,
    oidc_effective,
    oidc_is_configured,
    password_auth_effective,
)
from ._helpers import issue_login
from ._schemas import GuestLoginRequest, LoginRequest, SetupRequest


def auth_status(db: Session = Depends(get_db)):
    return {"initialized": db.query(User).count() > 0}


@limiter.limit(AUTH_RATE_LIMIT)
def auth_setup(
    request: Request,
    data: SetupRequest,
    response: Response,
    db: Session = Depends(get_db),
):
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
    return issue_login(db, user, response, request)


@limiter.limit(AUTH_RATE_LIMIT)
def auth_login(
    request: Request,
    data: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
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
    return issue_login(db, user, response, request)


@limiter.limit(AUTH_RATE_LIMIT)
def guest_login(
    request: Request,
    data: GuestLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
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

    body = issue_login(db, user, response, request, origin="guest")
    body["campaign_id"] = member.campaign_id
    return body


def auth_logout(
    response: Response,
    refresh_token: Optional[str] = Cookie(None, alias=REFRESH_COOKIE_NAME),
    db: Session = Depends(get_db),
):
    """Revoke the current session and clear both auth cookies.

    Deliberately requires no auth so a client with an already-expired access
    token can still log out cleanly — the refresh cookie alone identifies which
    session to end, and an unknown or missing one is not an error.
    """
    if refresh_token:
        revoke_session_by_token(db, refresh_token)
    clear_auth_cookie(response)
    clear_refresh_cookie(response)
    return {"ok": True}


@limiter.limit(AUTH_RATE_LIMIT)
def auth_refresh(
    request: Request,
    response: Response,
    refresh_token: Optional[str] = Cookie(None, alias=REFRESH_COOKIE_NAME),
    db: Session = Depends(get_db),
):
    """Exchange a refresh token for a new access token, rotating the refresh token.

    Rate-limited like the other credential-checking endpoints: the refresh
    cookie is a bearer credential, so this must not be a free brute-force oracle.

    The user is re-read from the database on every refresh, so a role change or
    a deleted account takes effect at the next refresh rather than lingering
    until the old token's natural expiry.
    """
    if not refresh_token:
        raise HTTPException(401, "No refresh token")

    session = get_active_session(db, refresh_token)
    if session is None:
        # Unknown, expired, revoked, or a detected replay (which has already
        # revoked the session inside get_active_session). Clear the dead cookie
        # so the client stops retrying with it.
        clear_refresh_cookie(response)
        clear_auth_cookie(response)
        raise HTTPException(401, "Invalid or expired refresh token")

    user = db.query(User).filter_by(id=session.user_id).first()
    if not user:
        revoke_session(db, session)
        clear_refresh_cookie(response)
        clear_auth_cookie(response)
        raise HTTPException(401, "User no longer exists")

    new_refresh = rotate_session(db, session)
    token = create_token(user.id, user.username, user.role, session_id=session.id)
    set_auth_cookie(response, token)
    set_refresh_cookie(response, new_refresh)
    return {
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "role": user.role,
        },
    }


def _session_payload(session: AuthSession, current_session_id: Optional[str]) -> dict:
    return {
        "id": session.id,
        "origin": session.origin or "password",
        "user_agent": session.user_agent,
        "ip_address": session.ip_address,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "last_used_at": session.last_used_at.isoformat() if session.last_used_at else None,
        "expires_at": session.expires_at.isoformat() if session.expires_at else None,
        # Lets the UI label one row "this device" and warn before ending it.
        "current": bool(current_session_id) and session.id == current_session_id,
    }


def list_sessions(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The caller's own live sessions, newest first."""
    return [_session_payload(s, user.session_id) for s in list_user_sessions(db, user.id)]


def revoke_one_session(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke one of the caller's own sessions.

    Scoped to the caller's own rows: a session id is a bare UUID, so looking it
    up without the user filter would let anyone end anyone else's session.
    """
    session = (
        db.query(AuthSession).filter_by(id=session_id, user_id=str(user.id)).first()
    )
    if session is None:
        raise HTTPException(404, "Session not found")
    revoke_session(db, session)
    return {"ok": True, "revoked": 1}


def revoke_other_sessions(
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Log out everywhere else, keeping the caller's current session alive.

    When the access token carries no ``sid`` (a token minted before sessions
    existed), there is no current session to preserve, so every session is
    revoked and the caller is logged out along with everyone else.
    """
    revoked = revoke_user_sessions(db, user.id, except_session_id=user.session_id)
    if not user.session_id:
        clear_auth_cookie(response)
        clear_refresh_cookie(response)
    return {"ok": True, "revoked": revoked, "kept_current": bool(user.session_id)}


def auth_config(db: Session = Depends(get_db)):
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


def auth_me(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Re-establish the session cookie for clients that authenticated with a
    # Bearer header but have no cookie yet — chiefly users who were logged in
    # before the cookie was introduced (issue #156). Reuse their existing token
    # rather than minting a new one so the expiry isn't silently extended.
    if AUTH_COOKIE_NAME not in request.cookies:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            set_auth_cookie(response, auth_header[len("Bearer ") :])

    u = db.query(User).filter_by(id=user.id).first()
    if not u:
        raise HTTPException(401, "User no longer exists")
    allow_explicit = u.allow_explicit if u.allow_explicit is not None else True
    campaign_access = u.campaign_access is None or bool(u.campaign_access)
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
