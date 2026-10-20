"""Character importers a user installs for their own account.

Most add-ons are server-wide and admin-installed, because a scraper or an
importer that fetches links makes the server talk to the internet, and one
with a script runs code. A character importer that only reads uploaded files
with a YAML mapping does neither - it is no riskier than a pasted character
sheet - so, like a sheet, any user may install one for themselves
(``AddonManifest.user_installable``).

It comes from the same index, through the same digest check, as an admin's
install. The manifest is stored in the ``user_importers`` table rather than on
disk, and re-validated - including whether a user may hold it - whenever it is
loaded.
"""
import logging
from typing import Any, Optional
from urllib.parse import urljoin

import yaml
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..models import UserImporter
from . import credentials as source_credentials
from . import install as server_install
from .constants import external_installs_enabled
from .manifest import AddonManifest, IndexEntry
from .registry import AddonError

logger = logging.getLogger("grimoire.addons")


def catalogue(db: Session) -> list[IndexEntry]:
    """The character importers the add-on index offers.

    Read from the index an admin last refreshed. When nobody has yet, it is
    fetched once here - from the admin's configured sources, never anywhere a
    user names - so a player is not left with an empty list on a fresh server.
    """
    entries = server_install.available(db)
    if not entries and external_installs_enabled():
        try:
            server_install.refresh_index(db)
        except Exception as exc:  # noqa: BLE001 - a listing must not fail on this
            logger.info("Could not refresh the add-on index for importers: %s", exc)
        entries = server_install.available(db)
    return [entry for entry in entries if entry.kind == "character-importer"]


def _validated(raw: Any, importer_id: str) -> AddonManifest:
    if not isinstance(raw, dict):
        raise AddonError(f"importer '{importer_id}' is not a manifest")
    try:
        manifest = AddonManifest(**raw)
    except ValidationError as exc:
        raise AddonError(f"importer '{importer_id}' is invalid: {exc}") from exc
    if manifest.id != importer_id:
        raise AddonError(f"importer id '{manifest.id}' does not match '{importer_id}'")
    if not manifest.user_installable:
        raise AddonError(
            f"'{manifest.name}' fetches links or runs a script, so an admin has to install it"
        )
    return manifest


def install_for_user(
    db: Session, user_id: str, importer_id: str, index_url: Optional[str] = None
) -> UserImporter:
    """Download, verify and store one importer for one user. Installing again
    replaces their copy, which is how an update is applied."""
    server_install._assert_external_installs_enabled()
    entry = server_install.find_entry(db, importer_id, index_url=index_url)
    if entry is None or entry.kind != "character-importer":
        raise AddonError(f"'{importer_id}' is not a character importer in the add-on index")
    if server_install.needs_newer_grimoire(entry):
        raise AddonError(
            f"'{entry.name}' needs Grimoire {entry.grimoire_min_version} or newer - "
            "ask an admin to update Grimoire"
        )

    source = entry.index_url or server_install.get_cached_index(db).get("_url") or ""
    body = server_install._fetch_text(urljoin(source, entry.path), source_credentials.load(db))
    server_install._verify(body, entry.sha256, "importer manifest")
    try:
        raw = yaml.safe_load(body)
    except yaml.YAMLError as exc:
        raise AddonError(f"'{importer_id}' has an unreadable manifest: {exc}") from exc
    # The index's `user_installable` only decided what to offer; this is the
    # check that counts, made on what was actually downloaded.
    manifest = _validated(raw, importer_id)

    row = db.query(UserImporter).filter_by(user_id=user_id, importer_id=importer_id).first()
    if row is None:
        row = UserImporter(user_id=user_id, importer_id=importer_id)
        db.add(row)
    row.name = manifest.name[:200]
    row.version = manifest.version[:20]
    row.manifest = raw
    row.source_url = source
    row.sha256 = entry.sha256
    db.commit()
    db.refresh(row)
    logger.info("User %s installed importer '%s' v%s", user_id, importer_id, manifest.version)
    return row


def uninstall_for_user(db: Session, user_id: str, importer_id: str) -> bool:
    row = db.query(UserImporter).filter_by(user_id=user_id, importer_id=importer_id).first()
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def installed_for_user(db: Session, user_id: str) -> dict[str, tuple[AddonManifest, UserImporter]]:
    """A user's own importers, each re-validated. One that no longer loads -
    or has become something a user may not hold - is skipped, not fatal."""
    out: dict[str, tuple[AddonManifest, UserImporter]] = {}
    for row in db.query(UserImporter).filter_by(user_id=user_id).all():
        try:
            out[row.importer_id] = (_validated(row.manifest, row.importer_id), row)
        except AddonError as exc:
            logger.warning("Skipping importer '%s' for user %s: %s", row.importer_id, user_id, exc)
    return out
