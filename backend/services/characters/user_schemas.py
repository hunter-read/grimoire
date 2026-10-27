"""The character sheet schemas each user has installed."""
from typing import Optional

from sqlalchemy.orm import Session

from ...models import CharacterSchema
from . import schema as svc


def user_schema_document(db: Session, user_id: str, schema_id: str) -> Optional[dict]:
    """The calling user's copy of a schema, validated.

    Schemas are per user, so the catalog is described by *this* user's copy —
    two people may have different versions of the same sheet installed, and each
    should browse the content types their own copy declares.
    """
    row = (
        db.query(CharacterSchema)
        .filter_by(user_id=user_id, schema_id=schema_id)
        .first()
    )
    if not row:
        return None
    try:
        return svc.validate_schema(row.document or {})
    except svc.SchemaError:
        return None
