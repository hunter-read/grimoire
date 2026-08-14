"""Shared helpers for issuing and ending login sessions."""
from typing import Optional

from fastapi import Request, Response
from sqlalchemy.orm import Session

from ...auth import create_token, set_auth_cookie, set_refresh_cookie
from ...models import User
from ...sessions import create_session


def client_user_agent(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    return request.headers.get("User-Agent")


def client_ip(request: Optional[Request]) -> Optional[str]:
    """Best-effort client IP, honouring X-Forwarded-For behind a reverse proxy.

    Only the first hop is taken, and only for display in the session list — it
    is never used for an access decision, so a spoofed header is cosmetic.
    """
    if request is None:
        return None
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip() or None
    return request.client.host if request.client else None


def issue_login(
    db: Session,
    user: User,
    response: Response,
    request: Optional[Request] = None,
    *,
    origin: str = "password",
) -> dict:
    """Open a session for ``user`` and set both auth cookies.

    Every login path — password, first-run setup, guest code, and OIDC — goes
    through here, so all of them are equally revocable.

    Returns the payload body shared by the login-ish endpoints. The refresh
    token is deliberately *not* in the returned dict: it travels only as an
    HttpOnly cookie, so JS can never read it and it never reaches a URL.
    """
    session, refresh_token = create_session(
        db,
        user.id,
        origin=origin,
        user_agent=client_user_agent(request),
        ip_address=client_ip(request),
    )
    token = create_token(user.id, user.username, user.role, session_id=session.id)
    set_auth_cookie(response, token)
    set_refresh_cookie(response, refresh_token)
    return {
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "role": user.role,
        },
    }
