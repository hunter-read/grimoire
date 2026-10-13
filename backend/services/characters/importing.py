"""Turn a character mapped from another tool into data a sheet can store.

An importer - declarative or script - yields ``{field: [values]}`` without
knowing the sheet's types or what content is installed. This is where both
are applied:

* each field's values collapse to its type: a number keeps the first, a
  multiselect all of them, a text field joins them;
* catalog fields match each value **by name** against the installed packs and
  the rulesets this user can read, becoming a reference when one matches and a
  custom (inline) entry when none does, so nothing the player chose is lost;
* everything then goes through ``coerce_value``, the same gate a hand-edited
  sheet passes, so an importer cannot write anything the sheet does not
  declare.
"""
import base64
import binascii
import io
import re
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import ContentEntry, Ruleset, RulesetEntry
from . import rulesets as rs
from .schema import coerce_value

#: Field types that keep every value rather than the first.
_MANY = ("multiselect", "content_list", "list")
_REFS = ("content_ref", "content_list")

#: Image types a portrait may arrive as, mirroring an uploaded portrait.
PORTRAIT_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_PORTRAIT_BYTES = 5 * 1024 * 1024
_DATA_URL = re.compile(r"^data:(image/[a-z+.-]+);base64,", re.I)


def _name_of(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("name")
    return str(value).strip() if isinstance(value, (str, int, float)) else ""


Candidate = tuple[dict[str, str], dict[str, Any]]  # (reference, entry data)


def _catalogue(
    db: Session, user_id: str, schema_id: str, content_type: str, names: set[str]
) -> dict[str, list[Candidate]]:
    """Installed entries of one type whose name is in ``names``, keyed by the
    lowercased name. Pack entries come before ruleset entries of the same name,
    matching what the sheet's own browser lists first."""
    if not names:
        return {}
    lowered = {name.lower() for name in names}
    found: dict[str, list[Candidate]] = {}
    for row in (
        db.query(ContentEntry)
        .filter(ContentEntry.schema_id == schema_id)
        .filter(ContentEntry.content_type == content_type)
        .filter(func.lower(ContentEntry.name).in_(lowered))
        .order_by(ContentEntry.created_at)
        .all()
    ):
        found.setdefault(row.name.lower(), []).append(
            ({"_ref": row.entry_id, "_source": row.source}, _data(row.data))
        )
    for row in (
        db.query(RulesetEntry)
        .join(Ruleset, Ruleset.id == RulesetEntry.ruleset_id)
        .filter(RulesetEntry.schema_id == schema_id)
        .filter(RulesetEntry.content_type == content_type)
        .filter(func.lower(RulesetEntry.name).in_(lowered))
        .filter(rs.readable_filter(db, user_id))
        .all()
    ):
        found.setdefault(row.name.lower(), []).append(
            ({"_ref": row.entry_id, "_source": "ruleset"}, _data(row.data))
        )
    return found


def _data(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _satisfies(data: dict[str, Any], criteria: dict[str, Any]) -> bool:
    return all(
        str(data.get(key, "")).strip().lower() == str(wanted).strip().lower()
        for key, wanted in criteria.items()
    )


def _ref(value: Any, matches: dict[str, list[Candidate]]) -> Optional[dict]:
    name = _name_of(value)
    if not name:
        return None
    criteria = value.get("match") if isinstance(value, dict) else None
    # The sheet's per-entry values - a quantity, a prepared spell - travel as
    # `_per` on either kind of entry; `coerce_value` checks them against the
    # field's `per_entry_fields`.
    per = value.get("per") if isinstance(value, dict) else None
    extra = {"_per": dict(per)} if isinstance(per, dict) and per else {}
    for reference, data in matches.get(name.lower(), []):
        # With criteria, a same-named entry that fails them is someone else's
        # "Skills" - a custom entry is better than the wrong one.
        if not isinstance(criteria, dict) or _satisfies(data, criteria):
            return {**reference, **extra}
    # Not installed: kept as the player's own entry, with whatever text the
    # source carried, rather than dropped.
    inline: dict[str, Any] = {"_inline": True, "name": name[:200]}
    if isinstance(value, dict) and isinstance(value.get("description"), str):
        inline["description"] = value["description"]
    return {**inline, **extra}


def _unique(refs: list[dict]) -> list[dict]:
    """Drop repeats - a source that lists a sense once per feature granting it
    should not put it on the sheet twice."""
    seen: set[str] = set()
    out = []
    for ref in refs:
        key = ref.get("_ref") or f"inline:{str(ref.get('name', '')).lower()}"
        if key not in seen:
            seen.add(key)
            out.append(ref)
    return out


def _collapse(definition: dict, values: list[Any]) -> Any:
    field_type = definition.get("type", "text")
    if field_type in _MANY:
        return values
    scalars = [v for v in values if not isinstance(v, (dict, list))]
    if field_type in ("text", "textarea") and len(scalars) > 1:
        separator = "\n" if field_type == "textarea" else ", "
        return separator.join(str(v) for v in scalars)
    if field_type == "content_ref":
        return values[0] if values else None
    return scalars[0] if scalars else None


def build_data(
    db: Session,
    user_id: str,
    document: dict,
    mapped_fields: dict[str, list[Any]],
) -> tuple[dict[str, Any], list[str]]:
    """Sheet data for a mapped character, and the names left as custom entries.

    ``document`` is the validated sheet. A mapped field the sheet does not
    declare is dropped, the same as a hand-written value would be.
    """
    fields = document.get("fields") or {}
    content_types = document.get("content_types") or {}
    schema_id = str(document.get("id") or "")

    # One query per content type, not per reference.
    wanted: dict[str, set[str]] = {}
    for name, values in mapped_fields.items():
        definition = fields.get(name)
        if isinstance(definition, dict) and definition.get("type") in _REFS:
            content_type = str(definition.get("content_type") or "")
            wanted.setdefault(content_type, set()).update(
                n for n in (_name_of(v) for v in values) if n
            )
    matches = {
        content_type: _catalogue(db, user_id, schema_id, content_type, names)
        for content_type, names in wanted.items()
    }

    data: dict[str, Any] = {}
    unmatched: list[str] = []
    for name, values in mapped_fields.items():
        definition = fields.get(name)
        if not isinstance(definition, dict) or not isinstance(values, list):
            continue
        value = _collapse(definition, values)
        if definition.get("type") in _REFS:
            found = matches.get(str(definition.get("content_type") or ""), {})
            items = value if isinstance(value, list) else [value]
            refs = _unique([ref for ref in (_ref(item, found) for item in items) if ref])
            unmatched.extend(ref["name"] for ref in refs if ref.get("_inline"))
            value = refs if definition.get("type") == "content_list" else (refs[0] if refs else None)
        if value is None:
            continue
        coerced = coerce_value(definition, value, content_types)
        if coerced in (None, "", []):
            continue
        data[name] = coerced
    return data, unmatched


def decode_portrait(value: Optional[str]) -> Optional[tuple[bytes, str]]:
    """A ``data:image/...;base64,`` portrait as ``(bytes, extension)``.

    Anything else - a remote URL included - is ignored: fetching a URL found
    inside an uploaded file would let that file aim the server at any address.
    A script that wants a remote image fetches it and returns a data URL.
    The bytes must really decode as an image, as with an uploaded portrait.
    """
    if not isinstance(value, str):
        return None
    match = _DATA_URL.match(value)
    if not match:
        return None
    extension = PORTRAIT_TYPES.get(match.group(1).lower())
    if not extension:
        return None
    payload = value[match.end():]
    # Base64 is 4/3 the size of what it encodes; refuse before decoding.
    if len(payload) > MAX_PORTRAIT_BYTES * 4 // 3 + 4:
        return None
    try:
        data = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        return None
    if not data:
        return None

    from PIL import Image

    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception:
        return None
    return data, extension
