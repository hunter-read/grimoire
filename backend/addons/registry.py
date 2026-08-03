"""Discovery and loading of installed add-ons, plus their persisted state.

Add-ons live one directory per id under ``DATA_PATH/add-ons/``. Install state
(version, digests, script approval, enabled flag) is a JSON blob in the generic
``app_settings`` KV table — no dedicated table, so no migration.

Directories are the source of truth for *what is installed*; the state blob only
annotates them. A hand-placed directory therefore works without any UI step,
which is how private/unpublished add-ons are supported.
"""
import json
import logging
import os
from typing import Any, Optional

import yaml
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..models import AppSetting
from .constants import (
    ADDONS_DIR,
    DEFAULT_INDEX_URL,
    SETTING_ALLOW_SCRIPTS,
    SETTING_INDEX_CACHE,
    SETTING_INDEX_URL,
    SETTING_INSTALLED,
)
from .manifest import AddonManifest

logger = logging.getLogger("grimoire.addons")


class AddonError(Exception):
    """An add-on could not be loaded or is not usable."""


# --- raw settings access -------------------------------------------------
# The settings router enumerates its fields explicitly, so these keys would not
# survive a trip through it.  Read and write them directly, as scheduler.py does.


def _get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.query(AppSetting).filter_by(key=key).first()
    return row.value if row and row.value is not None else default


def _set_setting(db: Session, key: str, value: str) -> None:
    row = db.query(AppSetting).filter_by(key=key).first()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))


def get_index_url(db: Session) -> str:
    return _get_setting(db, SETTING_INDEX_URL, DEFAULT_INDEX_URL) or DEFAULT_INDEX_URL


def set_index_url(db: Session, url: str) -> None:
    _set_setting(db, SETTING_INDEX_URL, url.strip())


def scripts_allowed(db: Session) -> bool:
    """Global kill-switch for script execution.  Off unless explicitly enabled."""
    return _get_setting(db, SETTING_ALLOW_SCRIPTS, "false").lower() == "true"


def set_scripts_allowed(db: Session, allowed: bool) -> None:
    _set_setting(db, SETTING_ALLOW_SCRIPTS, "true" if allowed else "false")


def _load_json_setting(db: Session, key: str) -> dict:
    raw = _get_setting(db, key, "")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except ValueError:
        logger.warning("Add-on setting '%s' is not valid JSON; ignoring it", key)
        return {}


def get_state(db: Session) -> dict[str, dict]:
    """Per-add-on install state, keyed by add-on id."""
    return _load_json_setting(db, SETTING_INSTALLED)


def save_state(db: Session, state: dict[str, dict]) -> None:
    _set_setting(db, SETTING_INSTALLED, json.dumps(state))


def get_state_for(db: Session, addon_id: str) -> dict:
    return get_state(db).get(addon_id, {})


def update_state_for(db: Session, addon_id: str, **changes: Any) -> dict:
    """Merge ``changes`` into one add-on's state record and persist it."""
    state = get_state(db)
    record = dict(state.get(addon_id, {}))
    record.update(changes)
    state[addon_id] = record
    save_state(db, state)
    return record


def drop_state_for(db: Session, addon_id: str) -> None:
    state = get_state(db)
    if state.pop(addon_id, None) is not None:
        save_state(db, state)


def get_cached_index(db: Session) -> dict:
    return _load_json_setting(db, SETTING_INDEX_CACHE)


def save_cached_index(db: Session, index: dict) -> None:
    _set_setting(db, SETTING_INDEX_CACHE, json.dumps(index))


# --- on-disk add-ons -----------------------------------------------------


def parse_version(version: str) -> tuple[int, ...]:
    """Semver as a comparable tuple.  Unparseable parts sort as 0.

    Used so "1.10.0 is newer than 1.9.0" holds — a plain string comparison gets
    that backwards, and would also flag a *downgrade* in the index as an update.
    """
    parts: list[int] = []
    for chunk in (version or "").split("."):
        digits = "".join(c for c in chunk if c.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts[:3] or [0])


def is_newer(candidate: str, installed: str) -> bool:
    """Whether ``candidate`` is a later version than ``installed``."""
    return parse_version(candidate) > parse_version(installed)


def addon_dir(addon_id: str) -> str:
    """Absolute install directory for an add-on id.

    The id is validated by ``AddonManifest`` (lowercase alphanumerics and
    hyphens), but this is also the one place a caller-supplied id becomes a
    filesystem path, so re-check it here rather than trusting the caller.
    """
    if not addon_id or not all(c.isalnum() or c == "-" for c in addon_id):
        raise AddonError(f"invalid add-on id: {addon_id!r}")
    return os.path.join(ADDONS_DIR, addon_id)


def manifest_path(addon_id: str) -> str:
    return os.path.join(addon_dir(addon_id), f"{addon_id}.yml")


def load_manifest(addon_id: str) -> AddonManifest:
    """Read and validate one installed add-on's manifest."""
    path = manifest_path(addon_id)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = yaml.safe_load(fh)
    except FileNotFoundError as exc:
        raise AddonError(f"add-on '{addon_id}' is not installed") from exc
    except (OSError, yaml.YAMLError) as exc:
        raise AddonError(f"add-on '{addon_id}' has an unreadable manifest: {exc}") from exc

    if not isinstance(raw, dict):
        raise AddonError(f"add-on '{addon_id}' manifest is not a mapping")

    try:
        manifest = AddonManifest(**raw)
    except ValidationError as exc:
        raise AddonError(f"add-on '{addon_id}' manifest is invalid: {exc}") from exc

    if manifest.id != addon_id:
        raise AddonError(
            f"add-on id '{manifest.id}' does not match directory '{addon_id}'"
        )
    return manifest


def installed_ids() -> list[str]:
    """Every add-on directory currently on disk."""
    try:
        entries = os.listdir(ADDONS_DIR)
    except OSError:
        return []
    ids = []
    for name in sorted(entries):
        # Skip the response cache and any other dot-directory.
        if name.startswith("."):
            continue
        if os.path.isfile(os.path.join(ADDONS_DIR, name, f"{name}.yml")):
            ids.append(name)
    return ids


def load_all() -> dict[str, AddonManifest]:
    """Load every installed manifest.  Broken ones are logged and skipped, so
    one bad definition can never take the whole add-on system down."""
    loaded: dict[str, AddonManifest] = {}
    for addon_id in installed_ids():
        try:
            loaded[addon_id] = load_manifest(addon_id)
        except AddonError as exc:
            logger.warning("Skipping add-on '%s': %s", addon_id, exc)
    return loaded


def is_enabled(db: Session, addon_id: str) -> bool:
    """Add-ons are enabled unless explicitly turned off."""
    return bool(get_state_for(db, addon_id).get("enabled", True))


def is_runnable(db: Session, addon_id: str, manifest: AddonManifest) -> tuple[bool, str]:
    """Whether an add-on may run now.  Returns ``(ok, reason_if_not)``.

    Script-backed add-ons need both the global toggle and their own
    install-time approval; the approval is tied to the script digest, so an
    updated script must be re-approved.
    """
    if not is_enabled(db, addon_id):
        return False, "add-on is disabled"
    if not manifest.requires_script:
        return True, ""
    if not scripts_allowed(db):
        return False, "add-on scripts are not enabled on this server"
    if not get_state_for(db, addon_id).get("script_approved"):
        return False, "add-on script has not been approved"
    return True, ""


def enabled_for_target(db: Session, target: str = "game-system") -> list[AddonManifest]:
    """Installed, enabled, runnable scrapers for a given target entity."""
    out = []
    for addon_id, manifest in load_all().items():
        if manifest.kind != "scraper" or manifest.target != target:
            continue
        ok, _ = is_runnable(db, addon_id, manifest)
        if ok:
            out.append(manifest)
    return out


def get_runnable(db: Session, addon_id: str) -> AddonManifest:
    """Load an add-on, raising ``AddonError`` unless it may run right now."""
    manifest = load_manifest(addon_id)
    ok, reason = is_runnable(db, addon_id, manifest)
    if not ok:
        raise AddonError(reason)
    return manifest


def describe(db: Session, addon_id: str, manifest: Optional[AddonManifest] = None) -> dict:
    """Serialise one installed add-on for the API."""
    if manifest is None:
        manifest = load_manifest(addon_id)
    state = get_state_for(db, addon_id)
    runnable, reason = is_runnable(db, addon_id, manifest)
    return {
        "id": manifest.id,
        "name": manifest.name,
        "version": manifest.version,
        "kind": manifest.kind,
        "target": manifest.target,
        "description": manifest.description,
        "homepage": manifest.homepage,
        "attribution": manifest.attribution,
        "requires_script": manifest.requires_script,
        "script_approved": bool(state.get("script_approved", False)),
        "enabled": is_enabled(db, addon_id),
        "runnable": runnable,
        "blocked_reason": reason,
        "source": state.get("source", "local"),
        # Filled in by the router when the add-on appears in the cached index.
        # A hand-placed add-on has no index entry, so it never offers an update.
        "available_version": "",
        "update_available": False,
    }
