"""The party overview: every character in a campaign, with the values a GM tracks.

One request rather than a sheet fetch per character, so a party of six costs one
round trip when the GM screen opens. Each character's values are its stored
fields plus its computed ones, worked out against the viewer's copy of the sheet
(the way reading a sheet works), falling back to the player's copy so a GM who
has not installed the sheet still sees Evasion and thresholds.

Only scalar values travel - numbers, short text, ticks - since that is all a
stat on the overview can show. Reading them is no wider than what a campaign's
GM can already read on each sheet.
"""
import math
import os
from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from ...config import CHARACTER_PORTRAIT_DIR
from ...models import Character, CharacterSchema, User
from ..characters import compute_values
from ..characters.sheet_values import resolved_entries, validated_document

__all__ = ["party_overview"]

#: Field types whose values a stat can show.
_SCALAR_TYPES = frozenset({"text", "number", "checkbox", "select"})
_MAX_TEXT = 200
_STATUSES = ("active", "retired", "dead")


def _scalar(value: Any) -> Optional[Any]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        return value[:_MAX_TEXT]
    return None


def _portrait_version(portrait_path: Optional[str]) -> Optional[int]:
    if not portrait_path:
        return None
    try:
        return int(os.stat(os.path.join(CHARACTER_PORTRAIT_DIR, portrait_path)).st_mtime_ns)
    except OSError:
        return None


def _portrait_crop(value: Any) -> Optional[dict]:
    """A stored crop, re-checked on the way out; anything malformed is none."""
    if not isinstance(value, dict):
        return None
    try:
        x, y, zoom = float(value["x"]), float(value["y"]), float(value["zoom"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (0 <= x <= 100 and 0 <= y <= 100 and 1 <= zoom <= 4):
        return None
    return {"x": x, "y": y, "zoom": zoom}


def _label(name: str, definition: Any) -> str:
    if isinstance(definition, dict):
        label = definition.get("label")
        if isinstance(label, str) and label.strip():
            return label.strip()[:_MAX_TEXT]
    return name


def _schemas(db: Session, viewer_id: str, characters: list[Character]) -> dict[tuple[str, str], CharacterSchema]:
    """(user id, schema id) -> installed schema, for the viewer and each player."""
    users = {viewer_id} | {row.user_id for row in characters}
    refs = {row.schema_ref for row in characters}
    if not refs:
        return {}
    rows = (
        db.query(CharacterSchema)
        .filter(CharacterSchema.user_id.in_(users))
        .filter(CharacterSchema.schema_id.in_(refs))
        .all()
    )
    return {(row.user_id, row.schema_id): row for row in rows}


def _owner_names(db: Session, user_ids: Iterable[str]) -> dict[str, str]:
    wanted = set(user_ids)
    if not wanted:
        return {}
    rows = db.query(User.id, User.display_name, User.username).filter(User.id.in_(wanted)).all()
    return {row[0]: row[1] or row[2] for row in rows}


def party_overview(db: Session, campaign_id: str, viewer_id: str) -> dict:
    """The campaign's characters and the stats the overview can be set to show.

    ``fields`` is every scalar field and computed value across the sheets the
    party uses, so the GM picks "Hit Points" once for a table that mixes two
    printings of the same game.
    """
    characters = (
        db.query(Character)
        .filter(Character.campaign_id == campaign_id)
        .order_by(Character.name)
        .all()
    )
    schemas = _schemas(db, viewer_id, characters)
    names = _owner_names(db, (row.user_id for row in characters))

    fields: dict[str, dict] = {}
    documents: dict[tuple[str, str], dict] = {}
    out = []
    for row in characters:
        schema = schemas.get((viewer_id, row.schema_ref)) or schemas.get((row.user_id, row.schema_ref))
        key = (schema.user_id, schema.schema_id) if schema else ("", "")
        if schema and key not in documents:
            documents[key] = validated_document(schema)
        document = documents.get(key) or {"fields": {}, "computed": {}}
        data = row.data if isinstance(row.data, dict) else {}

        values: dict[str, Any] = {}
        for name, definition in (document.get("fields") or {}).items():
            field_type = (definition or {}).get("type", "text") if isinstance(definition, dict) else "text"
            if field_type not in _SCALAR_TYPES:
                continue
            fields.setdefault(
                name,
                {"name": name, "label": _label(name, definition), "type": field_type, "source": "field"},
            )
            if name in data:
                value = _scalar(data[name])
            elif isinstance(definition, dict) and "default" in definition:
                value = _scalar(definition["default"])
            else:
                value = None
            if value is not None:
                values[name] = value
        if document.get("computed"):
            entries = resolved_entries(db, document, data, row.user_id)
            for name, value in compute_values(document, data, entries).items():
                fields.setdefault(
                    name,
                    {
                        "name": name,
                        "label": _label(name, (document.get("computed") or {}).get(name)),
                        "type": "number" if isinstance(value, (int, float)) and not isinstance(value, bool) else "text",
                        "source": "computed",
                    },
                )
                scalar = _scalar(value)
                if scalar is not None:
                    values[name] = scalar

        out.append(
            {
                "id": row.id,
                "name": row.name or "",
                "user_id": row.user_id,
                "owner_name": names.get(row.user_id, ""),
                "status": row.status if row.status in _STATUSES else "active",
                # The GM edits their own characters, and a player's once the
                # player has let the campaign's GM in.
                "editable": row.user_id == viewer_id or bool(row.gm_can_edit),
                "schema_ref": row.schema_ref,
                "schema_name": schema.name if schema else "",
                "portrait_path": row.portrait_path,
                "portrait_version": _portrait_version(row.portrait_path),
                "portrait_crop": _portrait_crop(row.portrait_crop),
                "values": values,
            }
        )
    return {
        "characters": out,
        "fields": sorted(fields.values(), key=lambda item: item["label"].lower()),
    }
