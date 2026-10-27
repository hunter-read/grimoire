"""Shared helpers for issuing and ending login sessions."""
from typing import Optional

from fastapi import Request, Response
from sqlalchemy.orm import Session

from ...api_keys import user_keys_allowed
from ...services import share_links as share_policy
from ...auth import create_token, set_auth_cookie, set_refresh_cookie
from ...models import User
from ...sessions import create_session
from ...services.user_activity import note_sign_in
from .._client import client_ip, client_user_agent


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
    note_sign_in(user.username, origin)
    token = create_token(user.id, user.username, user.role, session_id=session.id)
    set_auth_cookie(response, token, request)
    set_refresh_cookie(response, refresh_token, request)
    return {
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "role": user.role,
            "api_keys_allowed": user_keys_allowed(user),
            "share_links_allowed": share_policy.user_can_share(db, user),
        },
    }
