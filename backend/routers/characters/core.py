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
from ...models import Character, CharacterSchema
from ...services import characters as svc
from ._schemas import CharacterCreate, CharacterUpdate, SchemaImport

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

    try:
        validated = svc.validate_schema(document)
    except svc.SchemaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    schema_id = validated["id"]
    row = (
        db.query(CharacterSchema)
        .filter_by(user_id=current_user.id, schema_id=schema_id)
        .first()
    )
    if not row:
        row = CharacterSchema(user_id=current_user.id, schema_id=schema_id)
        db.add(row)

    row.name = validated["name"]
    row.system = str(document.get("system") or "")[:200]
    row.description = str(document.get("description") or "")
    row.version = str(document.get("version") or "1.0.0")[:20]
    # The author's document is stored, not the normalised one: the derived
    # layout_ast/styles_css are rebuilt on read, so a future parser improvement
    # reaches schemas that are already installed.
    row.document = document
    row.source_id = data.source_id
    row.source_url = data.source_url
    row.source_version = data.source_version

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


def _serialize_character(
    row: Character, schema: Optional[CharacterSchema], *, detail: bool = False
) -> dict:
    payload: dict[str, Any] = {
        "id": row.id,
        "name": row.name or "",
        "schema_ref": row.schema_ref,
        "schema_name": schema.name if schema else "",
        "system": (schema.system or "") if schema else "",
        "schema_missing": schema is None,
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
        payload["computed"] = svc.compute_values(document, data) if document else {}
        # The client evaluates validators too, so the sheet reacts as you type.
        # The server reports them as well so a caller that is not the sheet — an
        # export, a future party view — sees the same warnings.
        payload["validators"] = svc.run_validators(document, data) if document else []
    return payload


def list_characters(
    schema_ref: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """This user's characters, newest first."""
    query = db.query(Character).filter_by(user_id=current_user.id)
    if schema_ref:
        query = query.filter_by(schema_ref=schema_ref)
    rows = query.order_by(Character.updated_at.desc()).all()

    schemas = {
        row.schema_id: row
        for row in db.query(CharacterSchema).filter_by(user_id=current_user.id).all()
    }
    return {
        "characters": [
            _serialize_character(row, schemas.get(row.schema_ref)) for row in rows
        ]
    }


def get_character(
    character_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One character, with its values and freshly computed derived values."""
    row = db.query(Character).filter_by(id=character_id, user_id=current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Character not found")
    schema = _schema_for(db, current_user.id, row.schema_ref)
    return _serialize_character(row, schema, detail=True)


def create_character(
    data: CharacterCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a character against an installed schema."""
    schema = _schema_for(db, current_user.id, data.schema_ref)
    if not schema:
        raise HTTPException(status_code=400, detail="That schema is not installed")

    document = _validated_document(schema)
    row = Character(
        user_id=current_user.id,
        schema_ref=data.schema_ref,
        name=(data.name or "").strip()[:200],
        data=_coerce_all(document, data.data or {}),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_character(row, schema, detail=True)


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

    if data.data is not None:
        document = _validated_document(schema) if schema else {"fields": {}}
        merged = dict(row.data if isinstance(row.data, dict) else {})
        merged.update(_coerce_all(document, data.data))
        # Reassign rather than mutate: SQLAlchemy does not track in-place edits
        # to a JSON column, so an in-place update would silently not persist.
        row.data = merged

    db.commit()
    db.refresh(row)
    return _serialize_character(row, schema, detail=True)


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
