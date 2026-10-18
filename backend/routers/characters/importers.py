"""Importing characters from other tools, through character-importer add-ons.

Grimoire does not know Forge Steel's file format or Pathbuilder's: each is a
community add-on (``kind: character-importer``) that an admin installs, the
same way metadata scrapers are installed. These handlers find the importer
that recognises what the user gave, run it, and build an ordinary character
from the result on the sheet it targets.

Any account may import - a character is the player's own, like the ones they
create by hand. Importers come two ways: server-wide, installed by an admin,
and per user, for the ones that only read uploaded files with YAML and so can
do nothing a pasted sheet could not (see ``addons.user_importers``). Anything
that fetches links or runs a script is the admin's to install, so the server
only ever talks to sources, and runs code, the admin chose.
"""
import json
import logging
from typing import Any

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ... import addons
from ...addons import fetch as addon_fetch
from ...addons import importer as engine
from ...addons import install as addon_install
from ...addons import scripts as addon_scripts
from ...addons import user_importers
from ...addons.constants import external_installs_enabled
from ...addons.fetch import AddonFetchError
from ...addons.registry import AddonError, is_newer
from ...addons.authors import parse_author
from ...addons.manifest import AddonManifest
from ...addons.registry import is_runnable
from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Character, CharacterSchema
from ...services.characters import catalogue, importing
from . import _helpers as helpers
from . import core
from ._schemas import ExternalCharacterImport
from .portraits import store_portrait

logger = logging.getLogger("grimoire.characters")


def _server_importers(db: Session) -> dict[str, AddonManifest]:
    """Admin-installed importers that may run now."""
    return {
        addon_id: manifest
        for addon_id, manifest in addons.load_all().items()
        if manifest.is_importer and is_runnable(db, addon_id, manifest)[0]
    }


def _runnable_importers(db: Session, user_id: str) -> list[AddonManifest]:
    """Every importer this user can run: the server's, then their own. A copy
    the server also has is the server's - one importer, not two."""
    server = _server_importers(db)
    own = [
        manifest
        for importer_id, (manifest, _) in user_importers.installed_for_user(db, user_id).items()
        if importer_id not in server
    ]
    return sorted([*server.values(), *own], key=lambda m: m.name.lower())


def _summary(manifest: AddonManifest, installed: dict[str, str]) -> dict:
    spec = engine.spec_of(manifest)
    author, author_url = parse_author(manifest.author)
    return {
        "id": manifest.id,
        "name": manifest.name,
        "description": manifest.description,
        "homepage": manifest.homepage,
        "author": author,
        "author_url": author_url,
        "attribution": manifest.attribution,
        "version": manifest.version,
        "sheet": spec.sheet,
        "sheet_name": installed.get(spec.sheet, ""),
        "sheet_installed": spec.sheet in installed,
        "extensions": spec.extensions,
        "accepts_files": spec.accepts_files,
        "accepts_url": spec.url is not None,
        "url_hint": spec.url.hint if spec.url else "",
        "inputs": [item.model_dump() for item in spec.inputs],
    }


def _install_as(entry: Any, is_admin: bool) -> str:
    """How the caller could get an importer they do not have.

    "server": an admin installs it for everyone, here and now. "settings": an
    admin installs it from Settings, where a script's consent is asked for.
    "user": anyone may install it for themselves. "admin": only an admin can,
    so the caller can only ask.
    """
    if is_admin:
        return "settings" if entry.requires_script else "server"
    return "user" if entry.user_installable else "admin"


def list_importers(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The importers this user can run, and those the catalogue offers that
    they could install - or ask an admin to."""
    installed = {
        row.schema_id: row.name
        for row in db.query(CharacterSchema.schema_id, CharacterSchema.name)
        .filter(CharacterSchema.user_id == current_user.id)
        .all()
    }
    server = _server_importers(db)
    own = user_importers.installed_for_user(db, current_user.id)
    offered: dict[str, Any] = {}
    for entry in user_importers.catalogue(db):
        # The first source offering an id wins, as for add-ons.
        if not addon_install.needs_newer_grimoire(entry):
            offered.setdefault(entry.id, entry)

    importers = []
    for manifest in _runnable_importers(db, current_user.id):
        summary = _summary(manifest, installed)
        is_own = manifest.id not in server
        summary["scope"] = "user" if is_own else "server"
        offer = offered.get(manifest.id)
        # Only the user's own copy is theirs to update; the server's is the
        # admin's, in Settings.
        if is_own and offer is not None and is_newer(offer.version, manifest.version):
            summary["available_version"] = offer.version
        importers.append(summary)

    is_admin = current_user.role == "admin"
    have = set(server) | set(own)
    available = []
    for entry in offered.values():
        if entry.id in have:
            continue
        author, author_url = parse_author(entry.author)
        available.append(
            {
                "id": entry.id,
                "name": entry.name,
                "description": entry.description,
                "homepage": entry.homepage,
                "author": author,
                "author_url": author_url,
                "version": entry.version,
                "sheet": entry.sheet,
                "sheet_name": installed.get(entry.sheet, ""),
                "requires_script": entry.requires_script,
                "install_as": _install_as(entry, is_admin),
                "index_url": entry.index_url,
            }
        )
    return {
        "importers": importers,
        "available": sorted(available, key=lambda a: a["name"].lower()),
        "downloads_enabled": external_installs_enabled(),
    }


def install_user_importer(
    importer_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Install an importer into the caller's own account, or update their copy.

    Only one that reads uploaded files with YAML - anything that fetches links
    or runs a script is refused here, whatever the index claims, because the
    downloaded manifest is what is checked.
    """
    try:
        row = user_importers.install_for_user(db, current_user.id, importer_id)
    except AddonFetchError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except AddonError as exc:
        status = 403 if not external_installs_enabled() else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    return {"id": row.importer_id, "name": row.name, "version": row.version}


def uninstall_user_importer(
    importer_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove an importer from the caller's own account. Characters already
    imported with it are untouched."""
    if not user_importers.uninstall_for_user(db, current_user.id, importer_id):
        raise HTTPException(status_code=404, detail="You have not installed that importer")
    return {"deleted": True, "id": importer_id}


def _ambiguous(names: list[str]) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail=f"Several importers recognise this ({', '.join(names)}) - choose one and try again",
    )


def _needs_input(manifest: AddonManifest, keys: list[str], message: str) -> HTTPException:
    """Ask for inputs and a retry. The dialog reads ``needs_input``, shows
    those fields for ``importer_id``, and sends the import again."""
    return HTTPException(
        status_code=400,
        detail={
            "message": f"{manifest.name}: {message}",
            "importer_id": manifest.id,
            "needs_input": keys,
        },
    )


def _answers(manifest: AddonManifest, mode: str, given: dict[str, str]) -> dict[str, str]:
    """The inputs this import may pass to the script.

    Only keys the importer declares for this kind of import survive, so a
    request cannot hand a script anything it did not ask for. A required one
    that is missing is asked for before anything runs - before a link is
    fetched, too.
    """
    declared = engine.spec_of(manifest).inputs_for(mode)
    answers = {
        item.key: given[item.key].strip()
        for item in declared
        if isinstance(given.get(item.key), str) and given[item.key].strip()
    }
    missing = [item for item in declared if item.required and item.key not in answers]
    if missing:
        labels = ", ".join(item.label for item in missing)
        raise _needs_input(manifest, [item.key for item in missing], f"fill in {labels}")
    return answers


def _pick_for_url(
    pool: list[AddonManifest], url: str, explicit: bool
) -> tuple[AddonManifest, str]:
    candidates = [
        (manifest, identity)
        for manifest in pool
        if (identity := engine.url_identity(engine.spec_of(manifest), url))
    ]
    if not candidates:
        raise HTTPException(status_code=400, detail="No installed importer recognises that link")
    if len(candidates) > 1 and not explicit:
        raise _ambiguous([manifest.name for manifest, _ in candidates])
    return candidates[0]


def _pick_for_file(
    pool: list[AddonManifest], filename: str, document: Any, explicit: bool
) -> AddonManifest:
    if explicit:
        # The user chose: detection is skipped, so a renamed file still works.
        if not engine.spec_of(pool[0]).accepts_files:
            raise HTTPException(status_code=400, detail="That importer only reads links")
        return pool[0]
    scored = [
        (engine.file_match(engine.spec_of(manifest), filename, document), manifest)
        for manifest in pool
    ]
    best = max((score for score, _ in scored), default=0)
    if best == 0:
        raise HTTPException(status_code=400, detail="No installed importer recognises this file")
    top = [manifest for score, manifest in scored if score == best]
    if len(top) > 1:
        raise _ambiguous([manifest.name for manifest in top])
    return top[0]


def _fetch_linked(manifest: AddonManifest, identity: str) -> Any:
    spec = engine.spec_of(manifest)
    assert spec.url is not None and spec.url.fetch is not None
    url = spec.url.fetch.replace("{identity}", identity)
    try:
        # Never cached: this is one person's character, not a public catalogue.
        return addon_fetch.fetch_document(url, user_agent=spec.url.user_agent, cache_ttl=0)
    except addon_fetch.AddonFetchError as exc:
        if "HTTP 404" in str(exc) or "HTTP 400" in str(exc):
            raise HTTPException(
                status_code=400,
                detail="The source has no character at that link - check it and try again",
            ) from exc
        raise HTTPException(status_code=502, detail=f"{manifest.name}: {exc}") from exc


def _ensure_sheet(db: Session, user_id: str, sheet_id: str) -> CharacterSchema:
    """The user's copy of the importer's sheet, installing it from the
    catalogue when they do not have it yet.

    Installing a sheet needs no approval - it lives in this user's account
    alone - so asking them to go and do it first would only add a step. When
    the catalogue cannot supply it, the message says what to install.
    """
    schema = core._schema_for(db, user_id, sheet_id)
    if schema:
        return schema
    try:
        listing = catalogue.fetch_catalogue(db)
        entry = next((row for row in listing["sheets"] if row["raw_id"] == sheet_id), None)
        if entry:
            document = catalogue.fetch_sheet(db, entry)
            core._store_schema(
                db,
                user_id,
                document,
                source_id=entry["raw_id"],
                source_url=entry.get("index_url"),
                source_version=entry.get("version"),
            )
            schema = core._schema_for(db, user_id, sheet_id)
    except (catalogue.CatalogueError, HTTPException) as exc:
        logger.info("Could not install sheet %s for an import: %s", sheet_id, exc)
    if not schema:
        raise HTTPException(
            status_code=400,
            detail=(
                f"This importer builds characters on the '{sheet_id}' sheet, which is not "
                "installed. Install it from Manage sheets and try again."
            ),
        )
    return schema


def _parse(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return None


def import_external(
    body: ExternalCharacterImport,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Build a character from another tool's file or link.

    A one-time copy, not a sync: the character is the player's from then on,
    and editing it never reaches back to where it came from.
    """
    text, url = body.text, body.url.strip()
    if bool(text) == bool(url):
        raise HTTPException(status_code=400, detail="Give either a file or a link")

    pool = _runnable_importers(db, current_user.id)
    if body.importer_id:
        pool = [manifest for manifest in pool if manifest.id == body.importer_id]
        if not pool:
            raise HTTPException(status_code=404, detail="That importer is not installed")
    elif not pool:
        raise HTTPException(
            status_code=400,
            detail=(
                "No character importers are installed. Add one under Import a character, "
                "or ask an admin to."
            ),
        )
    helpers.assert_in_campaign(db, current_user.id, body.campaign_id)

    explicit = bool(body.importer_id)
    document: Any = None
    identity = ""
    if url:
        manifest, identity = _pick_for_url(pool, url, explicit)
        answers = _answers(manifest, "link", body.inputs)
        spec = engine.spec_of(manifest)
        if spec.url is not None and spec.url.fetch:
            document = _fetch_linked(manifest, identity)
            # A source that answers 200 with "no such character" still has to
            # look like one before anything is built from it.
            if spec.detect and not engine.detects(spec, document):
                raise HTTPException(
                    status_code=400,
                    detail="The source has no character at that link - check it and try again",
                )
    else:
        document = _parse(text)
        manifest = _pick_for_file(pool, body.filename, document, explicit)
        answers = _answers(manifest, "file", body.inputs)

    try:
        if manifest.requires_script:
            mapped = addon_scripts.run_import(
                manifest,
                document=document,
                text=text,
                filename=body.filename,
                identity=identity,
                inputs=answers,
            )
        else:
            mapped = engine.map_document(manifest, document)
    except engine.ImporterError as exc:
        raise HTTPException(status_code=400, detail=f"{manifest.name}: {exc}") from exc
    except addon_scripts.AddonScriptError as exc:
        # "Private sheet - I need a key" is a question for the user, not an
        # outage. Only inputs the importer declared for this import count.
        mode = "link" if url else "file"
        declared = {item.key for item in engine.spec_of(manifest).inputs_for(mode)}
        wanted = [key for key in exc.needs_input if key in declared]
        if wanted:
            raise _needs_input(manifest, wanted, str(exc)) from exc
        raise HTTPException(status_code=502, detail=f"{manifest.name}: {exc}") from exc

    schema = _ensure_sheet(db, current_user.id, engine.spec_of(manifest).sheet)
    sheet = core._validated_document(schema)
    data, unmatched = importing.build_data(db, current_user.id, sheet, mapped["fields"])

    name_field = core._name_field(sheet)
    name = str(mapped.get("name") or (data.get(name_field) if name_field else "") or "")
    row = Character(
        user_id=current_user.id,
        schema_ref=schema.schema_id,
        name=name.strip()[:200],
        data=core._starting_data(sheet, data, name),
        campaign_id=body.campaign_id,
    )
    db.add(row)
    db.flush()
    portrait = importing.decode_portrait(mapped.get("portrait"))
    if portrait:
        store_portrait(row, *portrait)
    db.commit()
    db.refresh(row)

    payload = core._serialize_character(
        row, schema, detail=True, db=db, viewer_id=current_user.id
    )
    payload["importer_id"] = manifest.id
    payload["importer_name"] = manifest.name
    payload["unmatched"] = sorted(set(unmatched))
    return payload
