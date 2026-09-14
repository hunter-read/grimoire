"""Add-on management endpoints (admin only)."""
import logging

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ... import addons
from ...addons.authors import parse_author
from ...addons.constants import DEFAULT_INDEX_URL, TRUSTED_INDEX_URLS, is_trusted_index_url
from ...auth import CurrentUser, get_current_user, require_admin
from ...config import get_db
from ._schemas import AddonInstall, AddonSettingsUpdate, AddonUpdate
import os
import re

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

    # Gather available_in data
    available_map = {}
    for entry in addons.available(db):
        if entry.id not in available_map:
            available_map[entry.id] = []
        available_map[entry.id].append(entry)

    available = []
    for addon_id, entries in available_map.items():
        # First entry is highest priority
        primary = entries[0]
        current = installed.get(primary.id)

        available_in = []
        for e in entries:
            is_newer = bool(current and addons.is_newer(e.version, current["version"]))
            available_in.append({
                "index_url": e.index_url,
                "version": e.version,
                "update_available": is_newer
            })

        newer = available_in[0]["update_available"]

        filtered_changelog = primary.changelog or []
        if current is not None and "version" in current:
            filtered_changelog = [
                c for c in filtered_changelog
                if addons.is_newer(c["version"], current["version"])
            ]

        m = re.match(r"^https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/(.*)/[^/]+$", primary.index_url)
        base_source_url = f"https://github.com/{m.group(1)}/{m.group(2)}/tree/{m.group(3)}/" if m else "https://github.com/grimoire-codex/community-add-ons/tree/main/"

        if current is not None:
            current_index_url = current.get("index_url") or primary.index_url
            matching_entry = next((e for e in entries if e.index_url == current_index_url), primary)
            current_is_newer = bool(addons.is_newer(matching_entry.version, current["version"]))

            current["available_version"] = matching_entry.version
            current["update_available"] = current_is_newer
            current["index_url"] = current_index_url
            current["available_in"] = available_in
            current["changelog"] = filtered_changelog
            current["source_url"] = base_source_url + os.path.dirname(matching_entry.path)

        entry_author, entry_author_url = parse_author(primary.author)
        available.append(
            {
                "id": primary.id,
                "name": primary.name,
                "kind": primary.kind,
                "target": primary.target,
                "version": primary.version,
                "description": primary.description,
                "homepage": primary.homepage,
                "author": entry_author,
                "author_url": entry_author_url,
                "requires_script": primary.requires_script,
                "script_sha256": primary.script_sha256,
                "installed": current is not None,
                "update_available": newer,
                "changelog": filtered_changelog,
                "source_url": base_source_url + os.path.dirname(primary.path),
                "index_url": primary.index_url,
                "available_in": available_in,
            }
        )

    # Ensure installed plugins missing from available still have basic fields
    for current in installed.values():
        if "index_url" not in current:
            current["index_url"] = ""
            current["available_in"] = []

    index_urls_str = addons.get_index_url(db).strip()
    index_urls = [u.strip() for u in index_urls_str.split(",") if u.strip()]

    return {
        "installed": sorted(installed.values(), key=lambda a: a["name"].lower()),
        "available": sorted(available, key=lambda a: a["name"].lower()),
        "index_url": index_urls[0] if index_urls else DEFAULT_INDEX_URL,
        "index_urls": index_urls,
        "default_index_url": DEFAULT_INDEX_URL,
        "trusted_index_urls": TRUSTED_INDEX_URLS,
        "source_contents": addons.get_source_contents(db, index_urls),
        "allow_scripts": addons.scripts_allowed(db),
        "index_generated": addons.get_cached_index(db).get("generated", ""),
    }


def verify_index(
    url: str = "",
    _: CurrentUser = Depends(get_current_user),  # noqa: ARG001
):
    """Verify if a given index URL is an approved trusted index URL.

    Available to any authenticated user (non-admin).
    """
    verified = is_trusted_index_url(url)
    return {
        "url": url,
        "verified": verified,
        "trusted_index_urls": TRUSTED_INDEX_URLS,
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
    return {"status": "ok", "count": len(index.get("addons", [])), "errors": index.get("errors", [])}


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
    if data.index_urls is not None:
        addons.set_index_url(db, ",".join(data.index_urls))
    elif data.index_url is not None:
        addons.set_index_url(db, data.index_url)
    if data.allow_scripts is not None:
        addons.set_scripts_allowed(db, data.allow_scripts)

    db.commit()

    index_urls_str = addons.get_index_url(db).strip()
    index_urls = [u.strip() for u in index_urls_str.split(",") if u.strip()]

    return {
        "index_url": index_urls[0] if index_urls else DEFAULT_INDEX_URL,
        "index_urls": index_urls,
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
        addons.install_addon(db, addon_id, approve_script=data.approve_script, index_url=data.index_url)
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
