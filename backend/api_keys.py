"""Personal API keys: permissions, hashing, and request checks (issue #489).

A key is sent as ``X-API-Key: <key>``. Every key belongs to a user and the
request runs **as that user** - their role, their campaigns, their favourites -
narrowed by the key's permissions. A key can never do more than its owner: the
role guards and handlers still run exactly as for the owner's own session, and
this module only decides which parts of the API the key may touch at all, from
the matched route:

* The route's OpenAPI **tag** picks the permission, through :data:`PERMISSIONS`.
  That table is the one place tags are grouped (``tokens`` + ``token-frames``);
  a test fails if a router tag is neither mapped nor in :data:`EXCLUDED_TAGS`.
* The **method** picks the level: ``GET``/``HEAD`` need Read, anything else Read
  and Write. A ``POST`` that only takes a body and changes nothing is marked
  :data:`READ_ONLY` on the route and counts as Read.
* Single routes inside a mapped tag that change credentials (password, account
  deletion, OPDS and calendar tokens) are marked :data:`EXCLUDED` on the route.
* :data:`ALL_PERMISSIONS` (``"*"``) in a key's permissions sets a floor for
  every permission at once, including ones added in later versions.

Which levels a user is *offered* comes from the routes too: each route's role
guard (``require_admin`` / ``require_gm_or_admin`` / ``require_not_guest``) says
who may call it, so a player is never offered Read and Write on game systems
they cannot edit (:func:`available_levels`).

Anything this module cannot place - an unmapped tag, a route with no tag, a
route spanning two permissions - is refused, so a new router fails closed.

Keys are ``grim_`` + 32 random bytes. Only the SHA-256 hash is stored: a
high-entropy random token needs no slow KDF, and the hash is what lookup keys on.
Keys migrated from the old single stats key have no prefix; lookup hashes the
whole presented value, so they authenticate the same way.
"""
from __future__ import annotations

import datetime
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from typing import Any, Iterable, NamedTuple, Optional

from fastapi import HTTPException, Request

# Levels, lowest first. "none" is never stored: an absent permission is no access.
LEVEL_NONE = "none"
LEVEL_READ = "read"
LEVEL_WRITE = "write"
LEVELS = (LEVEL_NONE, LEVEL_READ, LEVEL_WRITE)
_RANK = {LEVEL_NONE: 0, LEVEL_READ: 1, LEVEL_WRITE: 2}

class Permission(NamedTuple):
    """One API key permission: the router tags it covers, what it's for, and
    the section of the key editor it's listed under."""

    tags: tuple[str, ...]
    description: str
    group: str


# Sections of the key editor, in display order. A new permission joins one of
# these (the UI shows an unknown group under its id, so nothing is ever lost).
GROUPS = ("library", "media", "campaigns", "admin")

# Permission → its tags, an English description for API clients (the UI
# translates its own copy) and its group. Order is the order the UI lists them.
PERMISSIONS: dict[str, Permission] = {
    # Library
    "stats": Permission(
        ("stats",), "Library counts and totals (e.g. for dashboard widgets like Homepage)", "library"
    ),
    "library": Permission(
        ("library",),
        "Scan status, start or cancel a rescan, clean up missing items, "
        "version and changelog info",
        "library",
    ),
    "books": Permission(("books",), "Books and their metadata, covers, pages and files", "library"),
    "systems": Permission(("systems",), "Game systems, their covers and book folders", "library"),
    "search": Permission(("search",), "Full-text search across the library", "library"),
    "tags": Permission(
        ("tags",), "Create, rename, merge and delete tags, and list tagged items", "library"
    ),
    "lookups": Permission(
        ("lookups",),
        "Genres, system families, parent systems, licenses and dice/materials",
        "library",
    ),
    "downloads": Permission(("downloads",), "Download files and zip archives", "library"),
    # Media
    "maps": Permission(("maps",), "Maps and map folders", "media"),
    "tokens": Permission(
        ("tokens", "token-frames"), "Tokens, token folders and token frames", "media"
    ),
    "audio": Permission(("audio",), "Audio tracks, their covers and folders", "media"),
    "models": Permission(("models",), "3D models and model folders", "media"),
    # Campaigns and the owner's own data
    "campaigns": Permission(
        ("campaigns",),
        "Campaigns, members, sessions, wiki pages and linked resources",
        "campaigns",
    ),
    "personal": Permission(
        ("favorites", "bookmarks", "saved-filters", "audio-sets", "themes"),
        "Your favorites, bookmarks, saved filters, saved playlists and soundboards, and themes",
        "campaigns",
    ),
    # Administration
    "files": Permission(
        ("files",),
        "Browse, upload, move, rename and delete files in the library folder",
        "admin",
    ),
    "duplicates": Permission(
        ("duplicates",), "Find, compare, link and merge duplicate items", "admin"
    ),
    "addons": Permission(
        ("addons",), "Community metadata add-ons: install, update, enable, run", "admin"
    ),
    "maintenance": Permission(("maintenance",), "Metadata sidecar settings and export", "admin"),
    "backups": Permission(
        ("backups",), "List, create, download and delete backups, and the backup schedule", "admin"
    ),
    "logs": Permission(("logs",), "Read the application logs", "admin"),
    "settings": Permission(("settings",), "App settings", "admin"),
    "users": Permission(
        ("users",), "User accounts, roles and access grants, and your own preferences", "admin"
    ),
}

# A key's permissions may also hold this, raising every permission - present and
# future - to at least its level. Explicit entries can still go higher.
ALL_PERMISSIONS = "*"

TAG_PERMISSIONS: dict[str, str] = {
    tag: perm for perm, spec in PERMISSIONS.items() for tag in spec.tags
}

# Tags a key can never reach, whatever its permissions (ALL_PERMISSIONS included):
# sign-in and session flows, and key management itself - a key must never be
# able to mint or widen keys.
EXCLUDED_TAGS = frozenset({"auth", "api-keys"})

# Roles, weakest first.
ROLE_RANK = {"guest": 0, "player": 1, "gm": 2, "admin": 3}

# Route markers, passed as ``openapi_extra=`` so they also show in the schema.
_MARKER = "x-api-key-access"
READ_ONLY: dict[str, Any] = {_MARKER: LEVEL_READ}
EXCLUDED: dict[str, Any] = {_MARKER: LEVEL_NONE}

KEY_PREFIX = "grim_"
# Characters of a new key kept for display: "grim_" plus seven random ones.
DISPLAY_PREFIX_LEN = 12
# last_used_at is written at most this often per key, so a busy integration
# does not turn every request into a write.
LAST_USED_THROTTLE = datetime.timedelta(seconds=60)


def generate_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(32)


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def as_utc(dt: Optional[datetime.datetime]) -> Optional[datetime.datetime]:
    """SQLite hands datetimes back naive; they were written as UTC."""
    if dt is None or dt.tzinfo is not None:
        return dt
    return dt.replace(tzinfo=datetime.timezone.utc)


def is_expired(expires_at: Optional[datetime.datetime], now: datetime.datetime) -> bool:
    expiry = as_utc(expires_at)
    return expiry is not None and expiry <= now


# ---------------------------------------------------------------------------
# Route → permission
# ---------------------------------------------------------------------------


def granted_level(permissions: Optional[dict[str, str]], permission: str) -> str:
    """The level a key holds for ``permission``, counting ALL_PERMISSIONS."""
    perms = permissions or {}
    explicit = perms.get(permission, LEVEL_NONE)
    floor = perms.get(ALL_PERMISSIONS, LEVEL_NONE)
    return explicit if _RANK.get(explicit, 0) >= _RANK.get(floor, 0) else floor


def route_permission(route: Any) -> Optional[str]:
    """The permission a route falls under, or None when keys may not use it."""
    tags = list(getattr(route, "tags", None) or [])
    if not tags:
        return None
    if (getattr(route, "openapi_extra", None) or {}).get(_MARKER) == LEVEL_NONE:
        return None
    perms = set()
    for tag in tags:
        if tag in EXCLUDED_TAGS or tag not in TAG_PERMISSIONS:
            return None
        perms.add(TAG_PERMISSIONS[tag])
    return perms.pop() if len(perms) == 1 else None


def required_level(route: Any, method: str) -> str:
    """Read for GET/HEAD and marked read-only POSTs; Read and Write otherwise."""
    if method.upper() in ("GET", "HEAD"):
        return LEVEL_READ
    if (getattr(route, "openapi_extra", None) or {}).get(_MARKER) == LEVEL_READ:
        return LEVEL_READ
    return LEVEL_WRITE


def _guard_calls(dependant: Any) -> Iterable[Any]:
    for dep in getattr(dependant, "dependencies", None) or ():
        yield dep.call
        yield from _guard_calls(dep)


def route_min_role(route: Any) -> Optional[str]:
    """The weakest role a route's guard dependencies admit, or None if public.

    Read from the dependency tree (router-level guards included), so it tracks
    the code rather than a hand-kept list. A handler that checks the role inline
    instead is seen as open here and still refuses on its own; this only decides
    what the UI offers, never what a key may actually do.
    """
    from .auth import get_current_user, require_admin, require_gm_or_admin, require_not_guest

    calls = set(_guard_calls(getattr(route, "dependant", None)))
    if get_current_user not in calls:
        # Public (health, sign-in, feeds with their own token): not a key's to use.
        return None
    if require_admin in calls:
        return "admin"
    if require_gm_or_admin in calls:
        return "gm"
    if require_not_guest in calls:
        return "player"
    return "guest"


def available_levels(routes: Iterable[Any], role: str) -> dict[str, list[str]]:
    """Levels worth offering ``role`` per permission, from the routes that exist.

    A permission is offered only if the role can call at least one of its
    routes, and Read and Write only if it can call a write route - so a player
    sees game systems as Read at most, and never sees logs or users at all.
    """
    rank = ROLE_RANK.get(role, 0)
    reach: dict[str, str] = {}
    for route in routes:
        perm = route_permission(route)
        min_role = route_min_role(route) if perm else None
        if perm is None or min_role is None or ROLE_RANK[min_role] > rank:
            continue
        for method in getattr(route, "methods", None) or ():
            level = required_level(route, method)
            if _RANK[level] > _RANK[reach.get(perm, LEVEL_NONE)]:
                reach[perm] = level
    return {
        perm: list(LEVELS[: _RANK[reach[perm]] + 1]) for perm in PERMISSIONS if perm in reach
    }


def normalize_permissions(raw: Any, levels: dict[str, list[str]]) -> dict[str, str]:
    """Validate a ``{permission: level}`` map from a client, dropping No access.

    ``levels`` is :func:`available_levels` for the key's owner. Raises
    ``ValueError`` naming the first bad entry: a level the owner's role doesn't
    offer should be refused, not silently downgraded.
    """
    if not isinstance(raw, dict):
        raise ValueError("permissions must be an object of permission → level")
    out: dict[str, str] = {}
    for perm, level in raw.items():
        if perm == ALL_PERMISSIONS:
            if level not in LEVELS:
                raise ValueError(f"Level {level!r} is not available for all permissions")
            if level != LEVEL_NONE:
                out[perm] = level
            continue
        if perm not in PERMISSIONS:
            raise ValueError(f"Unknown permission: {perm}")
        if perm not in levels:
            raise ValueError(f"Your role cannot use {perm}")
        if level not in levels.get(perm, ()):
            raise ValueError(f"Level {level!r} is not available for {perm}")
        if level != LEVEL_NONE:
            out[perm] = level
    return out


# ---------------------------------------------------------------------------
# Authenticating a request
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class KeyPrincipal:
    """Who a key-authenticated request is: the key, and the user it acts as."""

    id: str
    user_id: str
    username: str
    role: str


def keys_enabled() -> bool:
    """Whether API keys exist on this instance at all (``API_KEYS_ENABLED``)."""
    from . import config

    return config.API_KEYS_ENABLED


def user_keys_allowed(user: Any) -> bool:
    """Whether ``user`` (an ORM ``User``) may create and use API keys.

    Never while the instance has keys turned off. Otherwise admins always may,
    and everyone else only once an admin (or the OIDC permissions claim) has
    turned ``api_keys_enabled`` on for them. Guests never may: their account
    exists only to reach one campaign by invite code.
    """
    if user is None or not keys_enabled():
        return False
    role = getattr(user, "role", None)
    if role == "admin":
        return True
    if role not in ROLE_RANK or role == "guest":
        return False
    return bool(getattr(user, "api_keys_enabled", False))


def authenticate(presented: str, request: Request) -> KeyPrincipal:
    """Resolve ``presented`` to a key and check it may call the matched route.

    401 for a key that doesn't exist or has expired; 403 for a valid key on a
    route keys can't use, or without the level the request needs - the latter
    names both, so the owner knows exactly what to grant - and for a key whose
    owner may no longer hold keys. With keys off for the instance, every key is
    refused outright. Failed attempts are throttled per client IP (429), see
    ``security.py``.
    """
    from .config import SessionLocal
    from .models import ApiKey, User
    from .security import api_key_attempts_blocked, record_api_key_failure

    if not keys_enabled():
        raise HTTPException(403, "API keys are disabled on this server")
    if api_key_attempts_blocked(request):
        raise HTTPException(429, "Too many invalid API key attempts - try again later")

    route = request.scope.get("route")
    method = request.method
    presented_hash = hash_key(presented.strip())
    now = datetime.datetime.now(datetime.timezone.utc)
    db = SessionLocal()
    try:
        row = db.query(ApiKey).filter_by(key_hash=presented_hash).first()
        if row is None or not hmac.compare_digest(row.key_hash, presented_hash):
            record_api_key_failure(request)
            raise HTTPException(401, "Invalid API key")
        if is_expired(row.expires_at, now):
            record_api_key_failure(request)
            raise HTTPException(401, "API key has expired")

        # The owner's current role, not the one they had when the key was made: a
        # demoted user's keys lose what the demotion took away.
        owner = db.query(User).filter_by(id=row.user_id).first()
        if owner is None:
            record_api_key_failure(request)
            raise HTTPException(401, "Invalid API key")
        if not user_keys_allowed(owner):
            raise HTTPException(403, "API keys are not enabled for your account")

        permission = route_permission(route)
        if permission is None:
            raise HTTPException(403, "API keys cannot be used for this endpoint")
        needed = required_level(route, method)
        granted = granted_level(row.permissions, permission)
        if _RANK.get(granted, 0) < _RANK[needed]:
            raise HTTPException(
                403,
                f"This API key needs {needed!r} access to {permission!r} "
                f"(it has {granted!r})",
            )

        last = as_utc(row.last_used_at)
        if last is None or now - last >= LAST_USED_THROTTLE:
            row.last_used_at = now
            db.commit()
        return KeyPrincipal(
            id=row.id, user_id=owner.id, username=owner.username, role=owner.role or "player"
        )
    finally:
        db.close()
