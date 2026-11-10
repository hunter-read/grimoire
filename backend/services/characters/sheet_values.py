"""Reading a stored sheet back out: its re-validated schema and its references.

The character endpoints and the GM screen's party overview both draw characters
from stored rows, so the two steps they share live here rather than in either
router: re-validating a schema document on the way out, and resolving the
catalog entries a character's references point at.
"""
import logging
from typing import Any

from sqlalchemy.orm import Session

from ...models import CharacterSchema, ContentEntry, Ruleset, RulesetEntry
from . import rulesets as rs
from .schema import SchemaError, validate_schema

logger = logging.getLogger("grimoire.characters")

__all__ = ["validated_document", "resolved_entries"]


def validated_document(row: CharacterSchema) -> dict:
    """Re-validate a stored document on the way out.

    A row edited directly in the database must be no more dangerous than an
    uploaded one — the rule `UserTheme` follows for colour tokens, and it counts
    for more here because a schema carries layout markup. A document that no
    longer validates yields an empty layout rather than raising, so the sheet
    degrades to its raw fields instead of 500ing.
    """
    try:
        return validate_schema(row.document or {})
    except SchemaError:
        logger.warning("Stored schema %s failed re-validation", row.schema_id)
        return {"id": row.schema_id, "name": row.name, "fields": {}, "layout": []}


def resolved_entries(db: Session, document: dict, data: dict, user_id: str) -> dict[str, Any]:
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
