"""Authentication utilities for Grimoire."""

import os
import datetime
import logging
from typing import Optional

import jwt
from fastapi import Cookie, Depends, HTTPException, Query, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext

logger = logging.getLogger("grimoire.auth")

SECRET_KEY = os.environ.get("SECRET_KEY", "grimoire-dev-secret-change-in-production")
ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 30

# Name of the HttpOnly session cookie that carries the JWT. This lets
# <img>/download GETs authenticate without the token appearing in the URL
# (query params leak into proxy/access logs, Referer headers, and history).
AUTH_COOKIE_NAME = "grimoire_session"

# Mark the cookie Secure whenever the instance is served over HTTPS, so it is
# never sent over plaintext. Derived from BASE_URL — a bare "http://" self-host
# (e.g. behind a LAN reverse proxy without TLS) still needs the cookie to be
# sent, so Secure is off there.
COOKIE_SECURE = os.environ.get("BASE_URL", "http://localhost:9481").lower().startswith(
    "https://"
)

if SECRET_KEY == "grimoire-dev-secret-change-in-production":
    logger.warning(
        "Using default SECRET_KEY — set the SECRET_KEY environment variable in production"
    )

# bcrypt_sha256 pre-hashes with SHA-256 so passwords >72 chars are handled correctly
pwd_context = CryptContext(
    schemes=["bcrypt_sha256"],
    deprecated="auto",
)

bearer_scheme = HTTPBearer(auto_error=False)

ROLES = ("admin", "gm", "player", "guest")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(user_id: str, username: str, role: str) -> str:
    expire = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
        days=TOKEN_EXPIRE_DAYS
    )
    return jwt.encode(
        {
            "sub": str(user_id),
            "username": username,
            "role": role,
            "exp": expire,
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


def set_auth_cookie(response: Response, token: str) -> None:
    """Attach the session JWT as an HttpOnly cookie on a login/setup response.

    HttpOnly keeps it out of reach of JS (XSS can't exfiltrate it); SameSite=Lax
    prevents it riding cross-site requests (CSRF) while still being sent on the
    top-level navigations that download links rely on; Secure is set when served
    over HTTPS. Lifetime matches the JWT's own expiry.
    """
    response.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        max_age=TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    """Remove the session cookie (logout). Attributes must match set_auth_cookie
    so the browser matches and deletes the right cookie."""
    response.delete_cookie(
        AUTH_COOKIE_NAME,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


class CurrentUser:
    def __init__(self, id: str, username: str, role: str):
        self.id = id
        self.username = username
        self.role = role


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    cookie_token: Optional[str] = Cookie(None, alias=AUTH_COOKIE_NAME),
    token: Optional[str] = Query(None),
) -> CurrentUser:
    # Header (normal API calls) → cookie (image/download GETs) → ?token= query
    # param. The query param is a deprecated fallback kept only so pre-existing
    # links/clients keep working; new clients should never put the JWT in a URL.
    raw = (credentials.credentials if credentials else None) or cookie_token or token
    if not raw:
        raise HTTPException(401, "Not authenticated")

    try:
        payload = decode_token(raw)
        return CurrentUser(
            id=payload["sub"],
            username=payload["username"],
            role=payload["role"],
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired — please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")


def optional_get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    cookie_token: Optional[str] = Cookie(None, alias=AUTH_COOKIE_NAME),
    token: Optional[str] = Query(None),
) -> Optional["CurrentUser"]:
    """Like get_current_user but returns None instead of raising when no/invalid token."""
    raw = (credentials.credentials if credentials else None) or cookie_token or token
    if not raw:
        return None
    try:
        payload = decode_token(raw)
        return CurrentUser(
            id=payload["sub"],
            username=payload["username"],
            role=payload["role"],
        )
    except jwt.InvalidTokenError:
        return None


def require_admin(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")
    return user


def require_gm_or_admin(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    if user.role not in ("admin", "gm"):
        raise HTTPException(403, "GM or admin access required")
    return user


def require_not_guest(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Block guest accounts from areas outside their invited campaign(s).

    Guests have no access to the shared library, maps, tokens, search, or
    settings — only the campaign they hold an invite code for.
    """
    if user.role == "guest":
        raise HTTPException(403, "Guests cannot access this area")
    return user
