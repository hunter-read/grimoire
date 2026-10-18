"""Share link evaluation, serialization and password unlocking.

Shared by the public route (``/api/share``) and the management API
(``/api/share-links``), so a link reads the same state in the owner's list as
it behaves for someone opening it.
"""
from __future__ import annotations

import datetime
import hashlib
from typing import Any, Optional
from urllib.parse import quote

import jwt
from sqlalchemy.orm import Session

from ... import auth, token_vault
from ...auth import ALGORITHM, COOKIE_SECURE
from ...config import BASE_URL
from ...models import ShareLink, User
from ...models.base import utc_iso
from ...services import share_links as policy
from . import _content

# How long a correct password keeps a link unlocked in that browser.
UNLOCK_HOURS = 12
UNLOCK_COOKIE = "grimoire_share"
_UNLOCK_TYPE = "share-unlock"


def evaluate(db: Session, link: ShareLink) -> tuple[str, Any, Any]:
    """``(state, creator, record)`` for a link, decided now (see ``link_state``)."""
    creator = db.query(User).filter_by(id=link.user_id).first()
    record = _content.load_record(db, link.resource_type, link.resource_id)
    readable = _content.can_read(db, creator, link.resource_type, record)
    return policy.link_state(db, link, creator, readable), creator, record


def page_url(token: str) -> str:
    """The share page: a preview, a download button, and the password prompt."""
    return f"{BASE_URL.rstrip('/')}/share/{token}"


def file_url(link: ShareLink, token: str) -> str:
    """The raw file, for tools that load a URL directly (VTTs, OTFBM, Discord)."""
    name = quote(link.filename or link.resource_type)
    return f"{BASE_URL.rstrip('/')}/api/share/{token}/{name}"


def serialize(db: Session, link: ShareLink, *, with_owner: bool = False) -> dict:
    """A link as the management API returns it."""
    state, creator, record = evaluate(db, link)
    # The link's own token, decrypted for its owner to copy (issue #583). None
    # means it was sealed under a different SECRET_KEY: requests can no longer
    # match it either, so the link is dead for good and reads as "lost".
    token = token_vault.unseal(link.token_sealed)
    if token is None and state != "revoked":
        state = "lost"
    out = {
        "id": link.id,
        "url": page_url(token) if token else None,
        "file_url": file_url(link, token) if token else None,
        "resource_type": link.resource_type,
        "resource_id": link.resource_id,
        "resource_name": _content.display_name(link.resource_type, record),
        "label": link.label or "",
        "filename": link.filename or "",
        "has_password": bool(link.password_hash),
        "variant": link.variant,
        "variant_options": link.variant_options,
        "state": state,
        "created_at": utc_iso(link.created_at),
        "expires_at": utc_iso(link.expires_at),
        "revoked_at": utc_iso(link.revoked_at),
        "last_used_at": utc_iso(link.last_used_at),
        "use_count": link.use_count or 0,
    }
    if with_owner:
        out["user_id"] = link.user_id
        out["username"] = (creator.display_name or creator.username) if creator else None
    return out


def _password_fingerprint(link: ShareLink) -> str:
    """Ties an unlock to the password it was granted for: change it, and every
    browser that unlocked the old one is locked out again."""
    return hashlib.sha256((link.password_hash or "").encode()).hexdigest()[:16]


def unlock_token(link: ShareLink) -> str:
    """A signed, short-lived proof that this browser gave the link's password."""
    now = datetime.datetime.now(datetime.timezone.utc)
    return jwt.encode(
        {
            "typ": _UNLOCK_TYPE,
            "sl": link.id,
            "pw": _password_fingerprint(link),
            "iat": now,
            "exp": now + datetime.timedelta(hours=UNLOCK_HOURS),
        },
        auth.SECRET_KEY,
        algorithm=ALGORITHM,
    )


def is_unlocked(link: ShareLink, cookie: Optional[str]) -> bool:
    """Whether ``cookie`` unlocks ``link``. Always true for a link with no password."""
    if not link.password_hash:
        return True
    if not cookie:
        return False
    try:
        claims = jwt.decode(cookie, auth.SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:
        return False
    return (
        claims.get("typ") == _UNLOCK_TYPE
        and claims.get("sl") == link.id
        and claims.get("pw") == _password_fingerprint(link)
    )


def unlock_cookie_options(token: str) -> dict:
    """Cookie attributes for an unlock. Scoped to this one link's URLs, so
    unlocking one link never unlocks another, and HttpOnly like the session."""
    return {
        "key": UNLOCK_COOKIE,
        "max_age": UNLOCK_HOURS * 60 * 60,
        "httponly": True,
        "secure": COOKIE_SECURE,
        "samesite": "lax",
        "path": f"/api/share/{token}",
    }
