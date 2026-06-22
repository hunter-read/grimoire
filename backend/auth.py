"""Authentication utilities for Grimoire."""

import os
import datetime
import logging
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext

logger = logging.getLogger("grimoire.auth")

SECRET_KEY = os.environ.get("SECRET_KEY", "grimoire-dev-secret-change-in-production")
ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 30

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


class CurrentUser:
    def __init__(self, id: str, username: str, role: str):
        self.id = id
        self.username = username
        self.role = role


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    token: Optional[str] = Query(None),
) -> CurrentUser:
    raw = credentials.credentials if credentials else token
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
    token: Optional[str] = Query(None),
) -> Optional["CurrentUser"]:
    """Like get_current_user but returns None instead of raising when no/invalid token."""
    raw = credentials.credentials if credentials else token
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
