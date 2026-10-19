"""Recognising a browser that has signed in to an account before.

After a successful password login the browser gets a long-lived, HttpOnly
``grimoire_device`` cookie naming that account and a random device id, signed
with a key derived from SECRET_KEY. On later logins it lets the per-account
failure allowance (backend/security.py) be counted separately for that device:
attempts from browsers the account has used before don't share a budget with
attempts from anywhere else, so a run of failed logins elsewhere doesn't stop
the owner signing in from their usual browser. The cookie grants nothing else -
it is not a session and never authenticates a request.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from functools import lru_cache
from typing import Optional

from fastapi import Request, Response

DEVICE_COOKIE_NAME = "grimoire_device"
# Only the login endpoints read it.
DEVICE_COOKIE_PATH = "/api/auth"
DEVICE_COOKIE_DAYS = 365

_LABEL = b"grimoire/login-device/v1"


@lru_cache(maxsize=4)
def _key(secret: str) -> bytes:
    from .token_vault import _derive

    return _derive(secret, _LABEL)


def _sign(user_id: str, device_id: str) -> str:
    from . import auth

    msg = f"{user_id}.{device_id}".encode("utf-8")
    return hmac.new(_key(auth.SECRET_KEY), msg, hashlib.sha256).hexdigest()


def device_for(request: Request, user_id: Optional[str]) -> Optional[str]:
    """The device id from this browser's cookie if it was issued for ``user_id``."""
    if not user_id:
        return None
    raw = request.cookies.get(DEVICE_COOKIE_NAME) or ""
    parts = raw.split(".")
    if len(parts) != 3:
        return None
    cookie_user, device_id, signature = parts
    if cookie_user != str(user_id) or not device_id:
        return None
    if not hmac.compare_digest(signature, _sign(cookie_user, device_id)):
        return None
    return device_id


def remember(
    response: Response,
    user_id: str,
    device_id: Optional[str] = None,
    request: Optional[Request] = None,
) -> None:
    """Set (or refresh) the device cookie for ``user_id`` after a successful login."""
    from .auth import cookie_secure

    device_id = device_id or secrets.token_urlsafe(16)
    response.set_cookie(
        DEVICE_COOKIE_NAME,
        f"{user_id}.{device_id}.{_sign(str(user_id), device_id)}",
        max_age=DEVICE_COOKIE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=cookie_secure(request),
        samesite="strict",
        path=DEVICE_COOKIE_PATH,
    )
