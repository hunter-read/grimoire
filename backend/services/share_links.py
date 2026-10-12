"""Who may create share links, and whether a link still works (issue #541).

Three layers decide whether a user may share, from the top:

1. ``SHARE_LINKS_ENABLED`` - the instance switch. Off means nobody, and every
   existing link stops resolving.
2. ``users.share_links_enabled`` - a per-user override. True or False wins over
   the role either way; NULL follows the role.
3. The role default. Admins always may. GMs may unless an admin turns the GM
   default off; players may only once an admin turns the player default on.
   Guests never may: their account exists only to reach one campaign.

Nothing about a link's validity is stored. :func:`link_state` works it out on
every request, so a creator who loses the right to share - or to read the item -
takes their links down with them, and a creator who regains it brings them back.
"""
from __future__ import annotations

import datetime
import secrets
from typing import Any, Literal, Optional

from sqlalchemy.orm import Session

from .. import config
from ..models import AppSetting

# app_settings keys for the role defaults, and their values when unset.
ROLE_SETTING_KEYS = {"gm": "share_links_role_gm", "player": "share_links_role_player"}
ROLE_DEFAULTS = {"gm": True, "player": False}

RESOURCE_TYPES = ("book", "map", "token", "audio", "model")

# Where the decision came from, for the admin UI's "allowed (from role)".
Source = Literal["disabled", "guest", "role", "user"]

# The override as the admin API speaks it.
Override = Literal["role", "allow", "deny"]

LinkState = Literal["active", "disabled", "revoked", "expired", "suspended", "unavailable"]


def links_enabled() -> bool:
    """Whether share links exist on this instance at all (``SHARE_LINKS_ENABLED``)."""
    return config.SHARE_LINKS_ENABLED


def role_defaults(db: Session) -> dict[str, bool]:
    """The configurable role defaults, as ``{"gm": bool, "player": bool}``."""
    rows = {
        r.key: r.value
        for r in db.query(AppSetting).filter(AppSetting.key.in_(ROLE_SETTING_KEYS.values())).all()
    }
    result = {}
    for role, key in ROLE_SETTING_KEYS.items():
        raw = rows.get(key)
        result[role] = ROLE_DEFAULTS[role] if raw in (None, "") else raw == "true"
    return result


def set_role_default(db: Session, role: str, allowed: bool) -> None:
    """Store a role default. Does not commit."""
    key = ROLE_SETTING_KEYS[role]
    row = db.query(AppSetting).filter_by(key=key).first()
    value = "true" if allowed else "false"
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))


def role_allows(db: Session, role: Optional[str]) -> bool:
    """Whether ``role`` may share by default, before any per-user override."""
    if role == "admin":
        return True
    if role in ROLE_SETTING_KEYS:
        return role_defaults(db)[role]
    return False


def override_of(user: Any) -> Override:
    """The user's stored override, as the admin API names it."""
    value = getattr(user, "share_links_enabled", None)
    if value is None:
        return "role"
    return "allow" if value else "deny"


def override_value(override: Override) -> Optional[bool]:
    """The column value for an override name."""
    return {"role": None, "allow": True, "deny": False}[override]


def share_status(db: Session, user: Any) -> dict[str, Any]:
    """Whether ``user`` (an ORM ``User``) may create share links, and why.

    ``{"allowed", "source", "override", "role_allows"}`` - ``source`` says which
    layer decided, so the admin UI can show "allowed (from role)" for a GM with
    no override of their own.
    """
    override = override_of(user)
    role = getattr(user, "role", None)
    by_role = role_allows(db, role)
    if user is None or not links_enabled():
        return {"allowed": False, "source": "disabled", "override": override, "role_allows": by_role}
    if role == "guest" or getattr(user, "is_guest", False):
        return {"allowed": False, "source": "guest", "override": override, "role_allows": False}
    if override != "role":
        return {
            "allowed": override == "allow",
            "source": "user",
            "override": override,
            "role_allows": by_role,
        }
    return {"allowed": by_role, "source": "role", "override": override, "role_allows": by_role}


def user_can_share(db: Session, user: Any) -> bool:
    """Whether ``user`` (an ORM ``User``) may create - and keep live - share links."""
    return bool(share_status(db, user)["allowed"])


def new_token() -> str:
    """A fresh link token: 32 random bytes, URL-safe (43 characters)."""
    return secrets.token_urlsafe(32)


def _utc(value: Optional[datetime.datetime]) -> Optional[datetime.datetime]:
    """SQLite hands back naive datetimes; every stored one is UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=datetime.timezone.utc)


def expires_at_for(days: Optional[int]) -> Optional[datetime.datetime]:
    """The expiry for a link valid ``days`` from now, or None for never."""
    if not days:
        return None
    return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=days)


def link_state(db: Session, link: Any, creator: Any, readable: bool) -> LinkState:
    """Whether a link works right now, and if not, why.

    ``creator`` is the link's ``User`` row (None if gone) and ``readable``
    whether that user can still read the item - the caller resolves both, since
    reading depends on the item's own access rules. The order matters for the
    owner's list: a revoked link reads "revoked" even after it would also have
    expired.
    """
    if not links_enabled():
        return "disabled"
    if link.revoked_at is not None:
        return "revoked"
    expires = _utc(link.expires_at)
    if expires is not None and expires <= datetime.datetime.now(datetime.timezone.utc):
        return "expired"
    if creator is None or not user_can_share(db, creator):
        return "suspended"
    if not readable:
        return "unavailable"
    return "active"
