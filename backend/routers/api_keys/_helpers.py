"""Shared helpers for API key management."""
import datetime
from typing import Any, Optional

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ... import api_keys
from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import ApiKey, User


def require_session_user(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """A signed-in user - never an API key, never a guest.

    The "api-keys" tag is already excluded from keys, so a key never gets this
    far; this is the second lock, so a key can't mint or widen keys even if that
    exclusion is ever edited away.
    """
    if user.is_api_key:
        raise HTTPException(403, "API keys cannot manage API keys")
    if user.role == "guest":
        raise HTTPException(403, "Guests cannot use API keys")
    return user


def require_keys_enabled() -> None:
    """Refuse every key endpoint while API keys are off for the instance."""
    if not api_keys.keys_enabled():
        raise HTTPException(403, "API keys are disabled on this server")


def load_user(db: Session, user: CurrentUser) -> Optional[User]:
    return db.query(User).filter_by(id=user.id).first()


def require_key_user(
    user: CurrentUser = Depends(require_session_user),
    db: Session = Depends(get_db),
) -> CurrentUser:
    """A session user allowed to hold keys: an admin, or someone granted them."""
    if not api_keys.user_keys_allowed(load_user(db, user)):
        raise HTTPException(403, "API keys are not enabled for your account")
    return user


def validate_expiry(expires_at: Optional[datetime.datetime]) -> Optional[datetime.datetime]:
    """Normalize an expiry to aware UTC, refusing one already in the past."""
    if expires_at is None:
        return None
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)
    expires_at = expires_at.astimezone(datetime.timezone.utc)
    if expires_at <= datetime.datetime.now(datetime.timezone.utc):
        raise HTTPException(400, "Expiry must be in the future")
    return expires_at


def validate_permissions(raw: Any, routes: Any, role: str) -> dict[str, str]:
    try:
        return api_keys.normalize_permissions(raw, api_keys.available_levels(routes, role))
    except ValueError as e:
        raise HTTPException(400, str(e))


def serialize(row: ApiKey, username: Optional[str] = None) -> dict[str, Any]:
    now = datetime.datetime.now(datetime.timezone.utc)
    return {
        "id": row.id,
        "user_id": row.user_id,
        "username": username,
        "name": row.name,
        "prefix": row.prefix,
        "permissions": dict(row.permissions or {}),
        "created_at": api_keys.as_utc(row.created_at),
        "last_used_at": api_keys.as_utc(row.last_used_at),
        "expires_at": api_keys.as_utc(row.expires_at),
        "expired": api_keys.is_expired(row.expires_at, now),
    }


def usernames(db: Session, rows: list[ApiKey]) -> dict[str, str]:
    ids = {r.user_id for r in rows}
    if not ids:
        return {}
    return {u.id: u.username for u in db.query(User).filter(User.id.in_(ids)).all()}


def issue_secret(row: ApiKey) -> str:
    """Give ``row`` a fresh key, storing only its hash; returns the plaintext."""
    key = api_keys.generate_key()
    row.key_hash = api_keys.hash_key(key)
    row.prefix = key[: api_keys.DISPLAY_PREFIX_LEN]
    return key
