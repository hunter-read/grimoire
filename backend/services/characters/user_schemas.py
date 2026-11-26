"""The character sheet schemas each user can use: their own, then the server's.

A sheet is installed either by one user for themselves or by an admin for
everyone (a row with no ``user_id``). Someone who installed or edited their own
copy keeps it, so a user's row always wins over the server's for the same
``schema_id``; the server-wide copy is what everyone else gets.
"""
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import CharacterSchema, ContentPack
from . import schema as svc


def schema_row(db: Session, user_id: Optional[str], schema_id: str) -> Optional[CharacterSchema]:
    """The sheet ``user_id`` uses for ``schema_id``: their own copy, else the server's."""
    rows = (
        db.query(CharacterSchema)
        .filter(CharacterSchema.schema_id == schema_id)
        .filter(or_(CharacterSchema.user_id == user_id, CharacterSchema.user_id.is_(None)))
        .all()
    )
    own = next((row for row in rows if row.user_id is not None), None)
    return own or next((row for row in rows if row.user_id is None), None)


def server_schema_row(db: Session, schema_id: str) -> Optional[CharacterSchema]:
    """The server-wide copy of a sheet, if an admin installed one."""
    return (
        db.query(CharacterSchema)
        .filter(CharacterSchema.schema_id == schema_id, CharacterSchema.user_id.is_(None))
        .first()
    )


def user_schema_document(db: Session, user_id: str, schema_id: str) -> Optional[dict]:
    """The sheet this user uses for a schema id, validated.

    Schemas are per user, so the catalog is described by *this* user's copy —
    two people may have different versions of the same sheet installed, and each
    should browse the content types their own copy declares. Someone with no
    copy of their own browses the server-wide one.
    """
    row = schema_row(db, user_id, schema_id)
    if not row:
        return None
    try:
        return svc.validate_schema(row.document or {}, stored=True)
    except svc.SchemaError:
        return None


def pack_declared_types(db: Session, schema_id: str) -> dict:
    """Every content type the installed packs for a schema id declare themselves.

    Packs are loaded in name order and the first declaration of a type wins,
    so the answer does not change with the order the database returns rows in.
    """
    declared: dict = {}
    for pack in (
        db.query(ContentPack)
        .filter(ContentPack.schema_id == schema_id)
        .order_by(ContentPack.name, ContentPack.pack_id)
        .all()
    ):
        for name, definition in (pack.content_types or {}).items():
            if isinstance(definition, dict):
                declared.setdefault(name, definition)
    return declared


def catalog_document(db: Session, user_id: str, schema_id: str) -> Optional[dict]:
    """The content types a schema id offers this user, sheet and packs together.

    The sheet's own document, with the types its packs declare added under it
    (the sheet wins a clash, as it does when a pack loads). With no sheet at
    all, a document holding only the packs' types, so reference material like
    conditions can still be browsed and added to a ruleset. None when neither
    declares anything.
    """
    document = user_schema_document(db, user_id, schema_id)
    declared = pack_declared_types(db, schema_id)
    if document is None:
        return {"id": schema_id, "content_types": declared} if declared else None
    if not declared:
        return document
    merged = dict(declared)
    merged.update(document.get("content_types") or {})
    return {**document, "content_types": merged}
