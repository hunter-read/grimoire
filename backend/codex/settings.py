"""Grimoire Codex DB connection settings (issue #35).

The integration is on exactly when ``GRIMOIRE_CODEX_DB_API_TOKEN`` is set; there
is no separate switch. Without it Grimoire Codex DB is not offered anywhere, its
settings are hidden and its endpoints answer 404. The token comes only from the
environment, never the database, so it is never written to app data or a backup.

The other settings are stored as ``codex_*`` rows in ``app_settings``, each
overridable by an environment variable. A variable that is set pins the value
and the admin UI shows it read-only, the same convention as the other
env-locked settings.

Lookup only ever runs when someone asks for it (fetching metadata, sending a
record). Nothing is sent in the background. File hashes are the one signal that can say "this library holds
this exact file", so sending them is opt-in.
"""
import os
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from ..models import AppSetting

DEFAULT_URL = "https://db.grimoirecodex.org"

TOKEN_ENV_VAR = "GRIMOIRE_CODEX_DB_API_TOKEN"

_DEFAULTS = {
    "codex_url": DEFAULT_URL,
    "codex_send_hashes": "false",
}

ENV_VARS = {
    "codex_url": "GRIMOIRE_CODEX_DB_URL",
    "codex_send_hashes": "GRIMOIRE_CODEX_DB_SEND_HASHES",
}


@dataclass(frozen=True)
class CodexSettings:
    url: str
    token: str
    send_hashes: bool
    # Setting keys pinned by an environment variable.
    locked: frozenset[str]

    @property
    def enabled(self) -> bool:
        """``GRIMOIRE_CODEX_DB_API_TOKEN`` is set. That alone turns the integration on."""
        return bool(self.token)

    def public(self) -> dict:
        """The settings as the API returns them: the token is never echoed back."""
        return {
            "url": self.url,
            "send_hashes": self.send_hashes,
            "locked": sorted(k.removeprefix("codex_") for k in self.locked),
        }


def normalize_url(value: str) -> str:
    """Validate a Grimoire Codex DB base URL and strip any trailing slash.

    Plain http is allowed so a self-hosted dev instance on the LAN works.
    """
    url = value.strip().rstrip("/")
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("The Grimoire Codex DB URL must be an http(s) address")
    if parts.query or parts.fragment:
        raise ValueError("The Grimoire Codex DB URL must not have a query or fragment")
    return url


def _env(key: str) -> Optional[str]:
    raw = os.environ.get(ENV_VARS[key])
    return raw.strip() if raw is not None else None


def token() -> str:
    """The API token from ``GRIMOIRE_CODEX_DB_API_TOKEN``, or "" when it is unset or blank."""
    return os.environ.get(TOKEN_ENV_VAR, "").strip()


def load(db: Session) -> CodexSettings:
    """The effective settings: environment first, then the database, then defaults."""
    rows = {
        r.key: r.value
        for r in db.query(AppSetting).filter(AppSetting.key.in_(list(_DEFAULTS))).all()
        if r.value is not None
    }
    raw = {**_DEFAULTS, **rows}
    locked = set()
    for key in _DEFAULTS:
        value = _env(key)
        if value is not None:
            raw[key] = value
            locked.add(key)
    try:
        url = normalize_url(raw["codex_url"])
    except ValueError:
        url = DEFAULT_URL
    return CodexSettings(
        url=url,
        token=token(),
        send_hashes=raw["codex_send_hashes"].lower() == "true",
        locked=frozenset(locked),
    )


def save(
    db: Session,
    *,
    url: Optional[str] = None,
    send_hashes: Optional[bool] = None,
) -> None:
    """Store the given settings. ``None`` leaves a setting alone.

    Raises ``ValueError`` for an invalid URL or a setting pinned by the environment.
    Does not commit.
    """
    updates: dict[str, str] = {}
    if url is not None:
        updates["codex_url"] = normalize_url(url)
    if send_hashes is not None:
        updates["codex_send_hashes"] = "true" if send_hashes else "false"
    for key, value in updates.items():
        if _env(key) is not None:
            raise ValueError(f"{ENV_VARS[key]} is set in the environment, so this setting is read-only")
        row = db.query(AppSetting).filter_by(key=key).first()
        if row:
            row.value = value
        else:
            db.add(AppSetting(key=key, value=value))
