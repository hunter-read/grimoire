"""GrimoireCodexDB connection settings (issue #35).

Stored as ``codex_*`` rows in ``app_settings``, each overridable by an
environment variable. A variable that is set pins the value and the admin UI
shows it read-only, the same convention as the other env-locked settings.

Lookup is on by default and only ever runs when someone asks for it (fetching
metadata, sending a record). Nothing is sent in the background. File hashes are
the one signal that can say "this library holds this exact file", so sending
them is opt-in. Submitting needs an API token from the user's GrimoireCodexDB account.
"""
import os
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from ..models import AppSetting

DEFAULT_URL = "https://db.grimoirecodex.org"

_DEFAULTS = {
    "codex_enabled": "true",
    "codex_url": DEFAULT_URL,
    "codex_api_token": "",
    "codex_send_hashes": "false",
}

ENV_VARS = {
    "codex_enabled": "CODEX_ENABLED",
    "codex_url": "CODEX_URL",
    "codex_api_token": "CODEX_API_TOKEN",
    "codex_send_hashes": "CODEX_SEND_HASHES",
}


@dataclass(frozen=True)
class CodexSettings:
    enabled: bool
    url: str
    token: str
    send_hashes: bool
    # Setting keys pinned by an environment variable.
    locked: frozenset[str]

    @property
    def can_submit(self) -> bool:
        return self.enabled and bool(self.token)

    def public(self) -> dict:
        """The settings as the API returns them: the token is never echoed back."""
        return {
            "enabled": self.enabled,
            "url": self.url,
            "send_hashes": self.send_hashes,
            "has_token": bool(self.token),
            "can_submit": self.can_submit,
            "locked": sorted(k.removeprefix("codex_") for k in self.locked),
        }


def normalize_url(value: str) -> str:
    """Validate a GrimoireCodexDB base URL and strip any trailing slash.

    Plain http is allowed so a self-hosted dev instance on the LAN works.
    """
    url = value.strip().rstrip("/")
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("The GrimoireCodexDB URL must be an http(s) address")
    if parts.query or parts.fragment:
        raise ValueError("The GrimoireCodexDB URL must not have a query or fragment")
    return url


def _env(key: str) -> Optional[str]:
    raw = os.environ.get(ENV_VARS[key])
    return raw.strip() if raw is not None else None


def load(db: Session) -> CodexSettings:
    """The effective settings: environment first, then the database, then defaults."""
    rows = {
        r.key: r.value
        for r in db.query(AppSetting).filter(AppSetting.key.in_(list(_DEFAULTS))).all()
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
        enabled=raw["codex_enabled"].lower() == "true",
        url=url,
        token=raw["codex_api_token"],
        send_hashes=raw["codex_send_hashes"].lower() == "true",
        locked=frozenset(locked),
    )


def save(
    db: Session,
    *,
    enabled: Optional[bool] = None,
    url: Optional[str] = None,
    token: Optional[str] = None,
    send_hashes: Optional[bool] = None,
) -> None:
    """Store the given settings. ``None`` leaves a setting alone; ``token=""`` clears it.

    Raises ``ValueError`` for an invalid URL or a setting pinned by the environment.
    Does not commit.
    """
    updates: dict[str, str] = {}
    if enabled is not None:
        updates["codex_enabled"] = "true" if enabled else "false"
    if url is not None:
        updates["codex_url"] = normalize_url(url)
    if token is not None:
        updates["codex_api_token"] = token.strip()
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
