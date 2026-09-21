"""Character and schema endpoints.

Every route is scoped to the calling user. Schemas and characters are per-user,
like themes: installing a sheet cannot affect anyone else's, so there is no
admin curation step and no approval to wait on. A guest — a player invited to a
single campaign — is exactly who most needs a character sheet, so guests are not
excluded here.

Ownership is enforced by filtering every query on ``user_id`` rather than by
fetching and then checking, so there is no path where a row belonging to someone
else is loaded at all.
"""
import logging
from typing import Any, Optional

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Character, CharacterSchema, ContentEntry, Ruleset, RulesetEntry
from ...services.characters import rulesets as rs
from ...services import characters as svc
from ...services.characters import catalogue
from . import _helpers as helpers
from ._schemas import (
    CharacterCreate,
    CharacterImport,
    CharacterUpdate,
    SchemaImport,
)

logger = logging.getLogger("grimoire.characters")


def _slugify(value: str) -> str:
    """A schema id derived from its name, for a document that omits one."""
    cleaned = "".join(char if char.isalnum() else "-" for char in value.lower())
    parts = [part for part in cleaned.split("-") if part]
    return "-".join(parts)[:100] or "sheet"


def _serialize_schema(row: CharacterSchema, *, count: int = 0) -> dict:
    return {
        "id": row.id,
        "schema_id": row.schema_id,
        "name": row.name,
        "system": row.system or "",
        "description": row.description or "",
        "version": row.version or "",
        "source_id": row.source_id,
        "source_url": row.source_url,
        "source_version": row.source_version,
        "is_community": bool(row.source_id),
        "character_count": count,
    }


def _validated_document(row: CharacterSchema) -> dict:
    """Re-validate a stored document on the way out.

    A row edited directly in the database must be no more dangerous than an
    uploaded one — the rule `UserTheme` follows for colour tokens, and it counts
    for more here because a schema carries layout markup. A document that no
    longer validates yields an empty layout rather than raising, so the sheet
    degrades to its raw fields instead of 500ing.
    """
    try:
        return svc.validate_schema(row.document or {})
    except svc.SchemaError:
        logger.warning("Stored schema %s failed re-validation", row.schema_id)
        return {"id": row.schema_id, "name": row.name, "fields": {}, "layout": []}


def list_schemas(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every schema this user has installed."""
    rows = (
        db.query(CharacterSchema)
        .filter_by(user_id=current_user.id)
        .order_by(CharacterSchema.name)
        .all()
    )
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.schema_id] = (
            db.query(Character)
            .filter_by(user_id=current_user.id, schema_ref=row.schema_id)
            .count()
        )
    return {"schemas": [_serialize_schema(row, count=counts[row.schema_id]) for row in rows]}


def get_schema(
    schema_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One schema, with the validated document needed to render its sheet."""
    row = (
        db.query(CharacterSchema)
        .filter_by(user_id=current_user.id, schema_id=schema_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Schema not found")
    payload = _serialize_schema(row)
    payload["document"] = _validated_document(row)
    return payload


def import_schema(
    data: SchemaImport,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Install a pasted schema, replacing this user's copy if it exists.

    Validation happens here rather than at render: a schema that names an
    unknown field type or hides a script in its layout is rejected with a
    message saying so, which is far better than a sheet that draws nothing
    later.
    """
    document = dict(data.document or {})
    if not document.get("id") and isinstance(document.get("name"), str):
        document["id"] = _slugify(document["name"])

    return _store_schema(
        db,
        current_user.id,
        document,
        source_id=data.source_id,
        source_url=data.source_url,
        source_version=data.source_version,
    )


def _store_schema(
    db: Session,
    user_id: str,
    document: dict,
    *,
    source_id: Optional[str] = None,
    source_url: Optional[str] = None,
    source_version: Optional[str] = None,
) -> dict:
    """Validate and save a schema for one user, replacing their copy if any.

    Shared by pasting and by installing from the catalogue so the two cannot
    drift apart on validation or on how provenance is recorded.
    """
    try:
        validated = svc.validate_schema(document)
    except svc.SchemaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    schema_id = validated["id"]
    row = (
        db.query(CharacterSchema)
        .filter_by(user_id=user_id, schema_id=schema_id)
        .first()
    )
    if not row:
        row = CharacterSchema(user_id=user_id, schema_id=schema_id)
        db.add(row)

    row.name = validated["name"]
    row.system = str(document.get("system") or "")[:200]
    row.description = str(document.get("description") or "")
    row.version = str(document.get("version") or "1.0.0")[:20]
    # The author's document is stored, not the normalised one: the derived
    # layout_ast/styles_css are rebuilt on read, so a future parser improvement
    # reaches schemas that are already installed.
    row.document = document
    row.source_id = source_id
    row.source_url = source_url
    row.source_version = source_version

    db.commit()
    db.refresh(row)

    payload = _serialize_schema(row)
    payload["document"] = validated
    return payload


def delete_schema(
    schema_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Uninstall a schema. Characters built on it are deliberately kept.

    Removing a sheet definition must not delete the characters someone wrote
    with it — they open read-only from stored data until the schema is
    reinstalled, which is why ``schema_ref`` is a soft reference.
    """
    row = (
        db.query(CharacterSchema)
        .filter_by(user_id=current_user.id, schema_id=schema_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Schema not found")
    db.delete(row)
    db.commit()
    return {"deleted": True, "schema_id": schema_id}


# --- characters ----------------------------------------------------------


def _schema_for(db: Session, user_id: str, schema_ref: str) -> Optional[CharacterSchema]:
    return (
        db.query(CharacterSchema)
        .filter_by(user_id=user_id, schema_id=schema_ref)
        .first()
    )


def _resolved_entries(db: Session, document: dict, data: dict, user_id: str) -> dict:
    """Catalog entries every reference in a character points at.

    Formulas like `sum_refs(spells, 'level')` need the entries themselves, not
    just their ids. Collected in one query rather than per reference: a sheet
    with twenty spells should cost one lookup.
    """
    fields = document.get("fields") or {}
    wanted: set[str] = set()
    for name, definition in fields.items():
        if not isinstance(definition, dict):
            continue
        if definition.get("type") not in ("content_ref", "content_list"):
            continue
        value = data.get(name)
        items = value if isinstance(value, list) else [value]
        for item in items:
            if isinstance(item, dict) and not item.get("_inline"):
                entry_id = item.get("_ref")
                if isinstance(entry_id, str) and entry_id:
                    wanted.add(entry_id)

    if not wanted:
        return {}

    schema_id = document.get("id") or ""
    resolved = {
        row.entry_id: (row.data if isinstance(row.data, dict) else {})
        for row in db.query(ContentEntry)
        .filter(ContentEntry.schema_id == schema_id)
        .filter(ContentEntry.entry_id.in_(wanted))
        .all()
    }
    # Ruleset entries resolve the same way, so a formula reading a spell's
    # level does not care whether the spell came from a pack or a table's own
    # ruleset.
    for row in (
        db.query(RulesetEntry)
        .join(Ruleset, Ruleset.id == RulesetEntry.ruleset_id)
        .filter(RulesetEntry.schema_id == schema_id)
        .filter(RulesetEntry.entry_id.in_(wanted))
        .filter(rs.readable_filter(db, user_id))
        .all()
    ):
        resolved.setdefault(row.entry_id, row.data if isinstance(row.data, dict) else {})
    return resolved


def _serialize_character(
    row: Character,
    schema: Optional[CharacterSchema],
    *,
    detail: bool = False,
    db: Optional[Session] = None,
    viewer_id: Optional[str] = None,
) -> dict:
    payload: dict[str, Any] = {
        "id": row.id,
        "name": row.name or "",
        "schema_ref": row.schema_ref,
        "schema_name": schema.name if schema else "",
        "system": (schema.system or "") if schema else "",
        "schema_missing": schema is None,
        "campaign_id": row.campaign_id,
        "portrait_path": row.portrait_path,
        # False when reading a party member's sheet: readable, not editable.
        "owned": viewer_id is None or row.user_id == viewer_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
    if detail:
        data = row.data if isinstance(row.data, dict) else {}
        payload["data"] = data
        # Computed values are derived on read, never stored: a corrected formula
        # must fix every character built on it rather than leaving stale numbers.
        # The document is validated once and reused — it is the expensive part.
        document = _validated_document(schema) if schema else None
        # References resolve to their catalog entries so a formula reading an
        # entry's own properties has something to read.
        entries = (
            _resolved_entries(db, document, data, row.user_id)
            if document is not None and db
            else {}
        )
        payload["computed"] = svc.compute_values(document, data, entries) if document else {}
        # The client evaluates validators too, so the sheet reacts as you type.
        # The server reports them as well so a caller that is not the sheet — an
        # export, a future party view — sees the same warnings.
        payload["validators"] = (
            svc.run_validators(document, data, entries) if document else []
        )
        # The entries the sheet needs, so rendering costs no extra request.
        payload["entries"] = entries
    return payload


def list_characters(
    schema_ref: Optional[str] = None,
    campaign_id: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Characters this user can read: their own, plus their parties' sheets."""
    query = db.query(Character).filter(helpers.readable_filter(db, current_user.id))
    if schema_ref:
        query = query.filter(Character.schema_ref == schema_ref)
    if campaign_id:
        query = query.filter(Character.campaign_id == campaign_id)
    rows = query.order_by(Character.updated_at.desc()).all()

    schemas = {
        row.schema_id: row
        for row in db.query(CharacterSchema).filter_by(user_id=current_user.id).all()
    }
    return {
        "characters": [
            _serialize_character(row, schemas.get(row.schema_ref), viewer_id=current_user.id)
            for row in rows
        ]
    }


def get_character(
    character_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One character, with its values and freshly computed derived values.

    A campaign member may read a party member's sheet; only the owner edits it.
    """
    row = helpers.readable_character_or_404(db, character_id, current_user.id)
    # The schema is looked up against the *reader*, who may not have the same
    # sheet installed as the owner; without it the sheet degrades to raw data.
    schema = _schema_for(db, current_user.id, row.schema_ref)
    return _serialize_character(row, schema, detail=True, db=db, viewer_id=current_user.id)


def create_character(
    data: CharacterCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a character against an installed schema."""
    schema = _schema_for(db, current_user.id, data.schema_ref)
    if not schema:
        raise HTTPException(status_code=400, detail="That schema is not installed")

    helpers.assert_in_campaign(db, current_user.id, data.campaign_id)

    document = _validated_document(schema)
    row = Character(
        user_id=current_user.id,
        schema_ref=data.schema_ref,
        name=(data.name or "").strip()[:200],
        data=_coerce_all(document, data.data or {}),
        campaign_id=data.campaign_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_character(row, schema, detail=True, db=db, viewer_id=current_user.id)


def update_character(
    character_id: str,
    data: CharacterUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a character's name and/or field values.

    ``data`` is a partial patch: only the fields it names are touched, so two
    tabs editing different parts of a sheet do not clobber each other.
    """
    row = db.query(Character).filter_by(id=character_id, user_id=current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Character not found")

    schema = _schema_for(db, current_user.id, row.schema_ref)
    if data.name is not None:
        row.name = data.name.strip()[:200]

    if data.campaign_id is not None:
        # An empty string clears it; a real id must be a campaign they are in.
        campaign_id = data.campaign_id or None
        helpers.assert_in_campaign(db, current_user.id, campaign_id)
        row.campaign_id = campaign_id

    if data.data is not None:
        document = _validated_document(schema) if schema else {"fields": {}}
        merged = dict(row.data if isinstance(row.data, dict) else {})
        merged.update(_coerce_all(document, data.data))
        # Reassign rather than mutate: SQLAlchemy does not track in-place edits
        # to a JSON column, so an in-place update would silently not persist.
        row.data = merged

    db.commit()
    db.refresh(row)
    return _serialize_character(row, schema, detail=True, db=db, viewer_id=current_user.id)


def delete_character(
    character_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a character."""
    row = db.query(Character).filter_by(id=character_id, user_id=current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Character not found")
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": character_id}


def _coerce_all(document: dict, submitted: dict) -> dict:
    """Coerce every submitted value to its declared type.

    A value the schema does not declare is dropped rather than stored: it cannot
    be rendered or computed with, so keeping it would only let a client write
    arbitrary JSON into the row.
    """
    fields = document.get("fields") or {}
    return {
        name: svc.coerce_value(fields[name], value)
        for name, value in submitted.items()
        if name in fields
    }


def export_character(
    character_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Export a character as a self-contained file.

    Readable by anyone who can read the sheet, so a GM can archive a party
    member's character. Every reference is denormalised and the schema travels
    with it, which is what makes the file open on an instance that has neither.
    """
    row = helpers.readable_character_or_404(db, character_id, current_user.id)
    schema = _schema_for(db, current_user.id, row.schema_ref)
    document = _validated_document(schema) if schema else {}
    return helpers.export_character(db, row, document, schema_document=document)


def import_character(
    data: CharacterImport,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rebuild a character from an exported file.

    The schema is installed from the file when the importer does not already
    have it — a character is unreadable without one, and asking them to find it
    separately would make sharing a two-step affair. An installed copy is
    preferred: theirs may be newer.
    """
    payload = data.payload or {}
    schema_id = payload.get("schema_id")
    if not isinstance(schema_id, str) or not schema_id.strip():
        raise HTTPException(status_code=400, detail="That file names no schema")

    schema = _schema_for(db, current_user.id, schema_id)
    if not schema:
        embedded = payload.get("schema")
        if not isinstance(embedded, dict) or not embedded:
            raise HTTPException(
                status_code=400,
                detail="That schema is not installed and the file does not carry one",
            )
        try:
            validated = svc.validate_schema(embedded)
        except svc.SchemaError as exc:
            raise HTTPException(
                status_code=400, detail=f"The file's schema is not valid: {exc}"
            ) from exc
        schema = CharacterSchema(
            user_id=current_user.id,
            schema_id=validated["id"],
            name=validated["name"],
            system=str(embedded.get("system") or "")[:200],
            description=str(embedded.get("description") or ""),
            version=str(embedded.get("version") or "1.0.0")[:20],
            document=embedded,
        )
        db.add(schema)
        db.flush()

    document = _validated_document(schema)
    if data.import_entries:
        helpers.import_embedded_entries(
            db,
            payload,
            owner_id=current_user.id,
            schema_id=schema_id,
            document=document,
        )

    row = Character(
        user_id=current_user.id,
        schema_ref=schema_id,
        name=str(payload.get("name") or "")[:200],
        data=_coerce_all(document, payload.get("data") or {}),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_character(row, schema, detail=True, db=db, viewer_id=current_user.id)


def browse_sheets(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The community catalogue of character sheets.

    Any account may browse and install: a sheet lives in one user's account and
    changes nothing for anyone else, so there is no admin step — the same rule
    themes follow.
    """
    # Keyed by (schema id, source URL): two catalogues may each offer a sheet
    # with the same id, and only one of them is the copy actually installed.
    # A hand-written or pasted schema has no source, so it marks every
    # catalogue copy of that id as installed — which is right, since
    # installing any of them would replace it.
    installed = {
        (row.schema_id, row.source_url or "")
        for row in db.query(CharacterSchema.schema_id, CharacterSchema.source_url)
        .filter(CharacterSchema.user_id == current_user.id)
        .all()
    }
    try:
        return catalogue.fetch_catalogue(db, installed_ids=installed)
    except catalogue.CatalogueError as exc:
        # Downloads switched off is a policy answer, not a failure.
        if not catalogue.downloads_enabled():
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def install_sheet(
    sheet_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Install one sheet from the catalogue into this user's account."""
    try:
        listing = catalogue.fetch_catalogue(db)
    except catalogue.CatalogueError as exc:
        status = 403 if not catalogue.downloads_enabled() else 502
        raise HTTPException(status_code=status, detail=str(exc)) from exc

    # The namespaced id identifies one source's copy exactly. A bare id is
    # accepted too, for a link written before a second source was configured,
    # and resolves to the first source offering it.
    entry = next((row for row in listing["sheets"] if row["id"] == sheet_id), None)
    if not entry:
        entry = next((row for row in listing["sheets"] if row["raw_id"] == sheet_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="That sheet is not in the catalogue")

    try:
        document = catalogue.fetch_sheet(db, entry)
    except catalogue.CatalogueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _store_schema(
        db,
        current_user.id,
        document,
        # The sheet's own id, not the namespaced one: provenance should say
        # what the sheet is called, and the URL beside it says where it came
        # from.
        source_id=entry["raw_id"],
        source_url=entry.get("index_url"),
        source_version=entry.get("version"),
    )
