"""Installing, updating, and removing add-ons from a community index.

The index is a JSON catalogue (see the community-add-ons repo). Files are
fetched relative to the index URL, verified against the digests the index
declares, and written into ``DATA_PATH/add-ons/<id>/``.
"""
import hashlib
import logging
import os
import shutil
from typing import Optional
from urllib.parse import urljoin

import httpx
from pydantic import ValidationError
from sqlalchemy.orm import Session

from .. import config
from .constants import (
    HTTP_MAX_BYTES,
    HTTP_MAX_REDIRECTS,
    HTTP_TIMEOUT,
    external_installs_enabled,
)
from .fetch import AddonFetchError, fetch_json
from .manifest import AddonIndex, IndexEntry
from .registry import (
    AddonError,
    addon_dir,
    drop_state_for,
    get_cached_index,
    get_index_url,
    load_manifest,
    save_cached_index,
    update_state_for,
)

logger = logging.getLogger("grimoire.addons")


def _assert_external_installs_enabled() -> None:
    """Refuse before any network call when the operator has locked installs off.

    Uninstalling, enabling, and running an already-installed add-on stay
    available — this only stops new content being pulled from the internet.
    """
    if not external_installs_enabled():
        raise AddonError("Installing add-ons from a community repository is disabled")


def _fetch_text(url: str) -> bytes:
    """GET a text file (manifest or script) under the shared network limits."""
    headers = {"User-Agent": f"Grimoire/{config.VERSION}"}
    try:
        with httpx.Client(
            timeout=HTTP_TIMEOUT,
            follow_redirects=True,
            max_redirects=HTTP_MAX_REDIRECTS,
            headers=headers,
        ) as client:
            response = client.get(url)
            if response.status_code != 200:
                raise AddonFetchError(f"download returned HTTP {response.status_code}")
            body = response.content
    except httpx.TimeoutException as exc:
        raise AddonFetchError("download timed out") from exc
    except httpx.HTTPError as exc:
        raise AddonFetchError(f"could not download add-on: {exc}") from exc

    if len(body) > HTTP_MAX_BYTES:
        raise AddonFetchError("add-on file is too large")
    return body


def refresh_index(db: Session, url: Optional[str] = None) -> dict:
    """Fetch the community index and cache it.  Returns the parsed index."""
    _assert_external_installs_enabled()
    index_url = (url or get_index_url(db)).strip()
    if not index_url.startswith(("http://", "https://")):
        raise AddonError("index URL must be an http(s) URL")

    raw = fetch_json(index_url, user_agent=f"Grimoire/{config.VERSION}")
    try:
        index = AddonIndex(**raw) if isinstance(raw, dict) else AddonIndex()
    except ValidationError as exc:
        raise AddonError(f"index is not in the expected format: {exc}") from exc

    payload = index.model_dump()
    payload["_url"] = index_url
    save_cached_index(db, payload)
    db.commit()
    logger.info("Refreshed add-on index from %s (%d add-on(s))", index_url, len(index.addons))
    return payload


def _index_entries(db: Session) -> list[IndexEntry]:
    cached = get_cached_index(db)
    entries = cached.get("addons") or []
    out = []
    for entry in entries:
        try:
            out.append(IndexEntry(**entry))
        except ValidationError:
            continue
    return out


def find_entry(db: Session, addon_id: str) -> Optional[IndexEntry]:
    for entry in _index_entries(db):
        if entry.id == addon_id:
            return entry
    return None


def available(db: Session) -> list[IndexEntry]:
    return _index_entries(db)


def _verify(body: bytes, expected: str, what: str) -> None:
    """Reject a download whose digest does not match the index.

    The index is the thing the user chose to trust; a file that does not match
    it has been altered in transit or at rest, and we refuse it either way.
    """
    if not expected:
        return
    actual = hashlib.sha256(body).hexdigest()
    if actual != expected:
        raise AddonError(
            f"{what} failed its integrity check (expected {expected[:12]}…, "
            f"got {actual[:12]}…)"
        )


def install(db: Session, addon_id: str, approve_script: bool = False) -> dict:
    """Install or update one add-on from the cached index.

    A script-backed add-on is written to disk either way, but is only marked
    approved when the caller passes ``approve_script`` — and the approval is
    recorded against the script's digest, so a later update that changes the
    script drops back to unapproved.
    """
    _assert_external_installs_enabled()
    entry = find_entry(db, addon_id)
    if entry is None:
        raise AddonError(
            f"'{addon_id}' is not in the add-on index - try refreshing it"
        )

    index_url = get_cached_index(db).get("_url") or get_index_url(db)
    manifest_url = urljoin(index_url, entry.path)
    manifest_body = _fetch_text(manifest_url)
    _verify(manifest_body, entry.sha256, "add-on manifest")

    target_dir = addon_dir(addon_id)
    staging = f"{target_dir}.incoming"
    # Stage into a sibling directory and swap, so a failed download never
    # leaves a half-installed add-on where a working one used to be.
    if os.path.isdir(staging):
        shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging, exist_ok=True)

    try:
        with open(os.path.join(staging, f"{addon_id}.yml"), "wb") as fh:
            fh.write(manifest_body)

        script_digest = ""
        if entry.requires_script:
            # Read the staged manifest to learn the script filename rather than
            # trusting the index's word for it.
            script_name = _script_entry_name(staging, addon_id)
            script_body = _fetch_text(urljoin(index_url, f"{os.path.dirname(entry.path)}/{script_name}"))
            _verify(script_body, entry.script_sha256, "add-on script")
            with open(os.path.join(staging, script_name), "wb") as fh:
                fh.write(script_body)
            script_digest = hashlib.sha256(script_body).hexdigest()

        if os.path.isdir(target_dir):
            shutil.rmtree(target_dir)
        os.makedirs(os.path.dirname(target_dir), exist_ok=True)
        os.replace(staging, target_dir)
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    # Fail loudly if what we just installed does not actually load.
    try:
        manifest = load_manifest(addon_id)
    except AddonError:
        shutil.rmtree(target_dir, ignore_errors=True)
        raise

    record = update_state_for(
        db,
        addon_id,
        version=manifest.version,
        source="index",
        enabled=True,
        script_sha256=script_digest,
        script_approved=bool(approve_script and manifest.requires_script),
    )
    db.commit()
    logger.info("Installed add-on '%s' v%s", addon_id, manifest.version)
    return record


def _script_entry_name(directory: str, addon_id: str) -> str:
    """Read ``script.entry`` out of a staged manifest, safely."""
    import yaml

    with open(os.path.join(directory, f"{addon_id}.yml"), "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    entry = ((data or {}).get("script") or {}).get("entry", "")
    if not entry or "/" in entry or "\\" in entry or entry.startswith("."):
        raise AddonError("add-on declares an invalid script entry")
    return str(entry)


def pending_updates(db: Session) -> list[tuple[str, str, str]]:
    """Installed add-ons with a newer version in the cached index.

    Returns ``(id, installed_version, available_version)`` triples.
    """
    from .registry import is_newer, load_all

    index = {entry.id: entry for entry in _index_entries(db)}
    out = []
    for addon_id, manifest in load_all().items():
        entry = index.get(addon_id)
        if entry and is_newer(entry.version, manifest.version):
            out.append((addon_id, manifest.version, entry.version))
    return out


def update_all(db: Session) -> dict:
    """Update every installed add-on that has a newer version available.

    Failures are collected rather than raised: one unreachable add-on should
    not stop the rest from updating. Script approval is deliberately **not**
    carried over — an updated script must be re-approved, which ``install``
    enforces by only setting ``script_approved`` when asked.
    """
    updated: list[dict] = []
    failed: list[dict] = []
    for addon_id, from_version, to_version in pending_updates(db):
        try:
            install(db, addon_id)
            updated.append({"id": addon_id, "from": from_version, "to": to_version})
        except (AddonError, AddonFetchError) as exc:
            logger.warning("Add-on '%s' failed to update: %s", addon_id, exc)
            failed.append({"id": addon_id, "error": str(exc)})
    return {"updated": updated, "failed": failed}


def uninstall(db: Session, addon_id: str) -> None:
    """Remove an add-on's directory and forget its state."""
    target = addon_dir(addon_id)
    if not os.path.isdir(target):
        raise AddonError(f"add-on '{addon_id}' is not installed")
    shutil.rmtree(target, ignore_errors=True)
    drop_state_for(db, addon_id)
    db.commit()
    logger.info("Uninstalled add-on '%s'", addon_id)


def set_enabled(db: Session, addon_id: str, enabled: bool) -> dict:
    load_manifest(addon_id)  # 404s a request for something not installed
    record = update_state_for(db, addon_id, enabled=enabled)
    db.commit()
    return record


def set_script_approved(db: Session, addon_id: str, approved: bool) -> dict:
    manifest = load_manifest(addon_id)
    if approved and not manifest.requires_script:
        raise AddonError(f"add-on '{addon_id}' does not use a script")
    record = update_state_for(db, addon_id, script_approved=approved)
    db.commit()
    return record
