"""Add-on management endpoints (admin only)."""
import logging

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ... import addons
from ...addons.constants import DEFAULT_INDEX_URL
from ...auth import CurrentUser, require_admin
from ...config import get_db
from ._schemas import AddonInstall, AddonSettingsUpdate, AddonUpdate

logger = logging.getLogger("grimoire.addons")


def list_addons(
    _: CurrentUser = Depends(require_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Installed add-ons, plus what the cached index offers."""
    installed = {
        addon_id: addons.describe(db, addon_id, manifest)
        for addon_id, manifest in addons.load_all().items()
    }

    available = []
    for entry in addons.available(db):
        current = installed.get(entry.id)
        newer = bool(current and addons.is_newer(entry.version, current["version"]))
        if current is not None:
            # Annotate the installed record too — the UI lists installed and
            # available separately, so an update is only discoverable if it is
            # reported on the row the user is actually looking at.
            current["available_version"] = entry.version
            current["update_available"] = newer
        available.append(
            {
                "id": entry.id,
                "name": entry.name,
                "kind": entry.kind,
                "target": entry.target,
                "version": entry.version,
                "description": entry.description,
                "homepage": entry.homepage,
                "requires_script": entry.requires_script,
                "script_sha256": entry.script_sha256,
                "installed": current is not None,
                # A newer version in the index is what the UI offers an
                # "Update" button for.
                "update_available": newer,
            }
        )

    return {
        "installed": sorted(installed.values(), key=lambda a: a["name"].lower()),
        "available": sorted(available, key=lambda a: a["name"].lower()),
        "index_url": addons.get_index_url(db),
        # Lets the UI say "using the community index" and keep the URL field
        # tucked behind a button, rather than showing a URL nobody edits.
        "default_index_url": DEFAULT_INDEX_URL,
        "allow_scripts": addons.scripts_allowed(db),
        "index_generated": addons.get_cached_index(db).get("generated", ""),
    }


def refresh_index(
    _: CurrentUser = Depends(require_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Re-fetch the community index."""
    try:
        index = addons.refresh_index(db)
    except addons.AddonFetchError as exc:
        raise HTTPException(502, f"Could not fetch the add-on index: {exc}") from exc
    except addons.AddonError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"status": "ok", "count": len(index.get("addons", []))}


def update_all_addons(
    _: CurrentUser = Depends(require_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Update every installed add-on that has a newer version in the index.

    Refreshes the index first, so "Update all" reflects what is actually
    published rather than whatever was cached last time.
    """
    try:
        addons.refresh_index(db)
    except (addons.AddonFetchError, addons.AddonError) as exc:
        # A stale cache is still usable; report it but carry on with what we have.
        logger.warning("Could not refresh the add-on index before updating: %s", exc)

    result = addons.update_all(db)
    return {
        "status": "ok",
        "updated": result["updated"],
        "failed": result["failed"],
    }


def update_addon_settings(
    data: AddonSettingsUpdate,
    _: CurrentUser = Depends(require_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Set the index URL and the global script switch."""
    if data.index_url is not None:
        addons.set_index_url(db, data.index_url)
    if data.allow_scripts is not None:
        addons.set_scripts_allowed(db, data.allow_scripts)
    db.commit()
    return {
        "index_url": addons.get_index_url(db),
        "allow_scripts": addons.scripts_allowed(db),
    }


def install_addon(
    addon_id: str,
    data: AddonInstall,
    _: CurrentUser = Depends(require_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Install or update an add-on from the cached index."""
    try:
        addons.install_addon(db, addon_id, approve_script=data.approve_script)
    except addons.AddonFetchError as exc:
        raise HTTPException(502, f"Could not download the add-on: {exc}") from exc
    except addons.AddonError as exc:
        raise HTTPException(400, str(exc)) from exc
    return addons.describe(db, addon_id)


def update_addon(
    addon_id: str,
    data: AddonUpdate,
    _: CurrentUser = Depends(require_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Enable/disable an add-on, or grant/revoke its script approval."""
    try:
        if data.enabled is not None:
            addons.set_enabled(db, addon_id, data.enabled)
        if data.script_approved is not None:
            addons.set_script_approved(db, addon_id, data.script_approved)
        return addons.describe(db, addon_id)
    except addons.AddonError as exc:
        raise HTTPException(404, str(exc)) from exc


def uninstall_addon(
    addon_id: str,
    _: CurrentUser = Depends(require_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    try:
        addons.uninstall(db, addon_id)
    except addons.AddonError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"status": "ok"}
