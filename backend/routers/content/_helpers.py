"""Catalog querying: search, faceted filters, sorting, and display templates."""
import re
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...models import CharacterSchema, ContentEntry
from ...services import characters as svc

#: `{name}` placeholders in a content type's compact_display template.
_DISPLAY_TOKENS = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")

#: A filter facet lists the values actually present. Past this many distinct
#: values a facet stops being a filter and becomes a second search box, so it is
#: omitted rather than rendered unusable.
MAX_FACET_VALUES = 50

MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50


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


def render_display(template: str, data: dict) -> str:
    """Fill a `compact_display` template from an entry's values.

    A token naming something the entry does not have renders empty rather than
    leaving the brace in place: a half-filled entry should read as a gap, not as
    a broken template.
    """
    if not template:
        return ""
    return _DISPLAY_TOKENS.sub(lambda m: _as_text(data.get(m.group(1))), template).strip()


def _as_text(value: Any) -> str:
    if value is None or value is False:
        return ""
    if value is True:
        return "yes"
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)
    return str(value)


def search_entry_ids(db: Session, schema_id: str, content_type: str, query: str) -> list[str]:
    """Entry row ids matching a text search, best match first.

    FTS5's query syntax would let a stray quote or operator raise, so the query
    is reduced to bare terms and each is prefix-matched — which is also what
    someone typing "fire" into a spell list expects.
    """
    terms = [term for term in re.findall(r"[\w']+", query) if term]
    if not terms:
        return []
    match = " ".join(f'"{term}"*' for term in terms)

    rows = db.execute(
        text(
            "SELECT entry_row FROM content_search "
            "WHERE content_search MATCH :match "
            "AND schema_id = :schema_id AND content_type = :content_type "
            "ORDER BY rank"
        ),
        {"match": match, "schema_id": schema_id, "content_type": content_type},
    ).fetchall()
    return [row[0] for row in rows]


def matches_filters(data: dict, filters: dict[str, str]) -> bool:
    """Whether an entry satisfies every requested filter.

    Comparison is by text, case-insensitively: a filter value arrives from a
    query string, so `level=3` must match the number 3, and a list-valued field
    matches when any of its items does.
    """
    for field, wanted in filters.items():
        value = data.get(field)
        target = str(wanted).strip().lower()
        if isinstance(value, list):
            if not any(_as_text(item).strip().lower() == target for item in value):
                return False
        elif _as_text(value).strip().lower() != target:
            return False
    return True


def build_facets(entries: list[ContentEntry], filter_fields: list[str]) -> dict:
    """Count the values present for each filterable field."""
    facets: dict[str, dict[str, int]] = {field: {} for field in filter_fields}
    for entry in entries:
        data = entry.data if isinstance(entry.data, dict) else {}
        for field in filter_fields:
            value = data.get(field)
            if value is None or value == "":
                continue
            values = value if isinstance(value, list) else [value]
            for item in values:
                key = _as_text(item)
                if key:
                    facets[field][key] = facets[field].get(key, 0) + 1

    built = {}
    for field, counts in facets.items():
        if not counts or len(counts) > MAX_FACET_VALUES:
            continue
        built[field] = [
            {"value": value, "count": count}
            for value, count in sorted(counts.items(), key=_facet_order)
        ]
    return built


def _facet_order(item: tuple[str, int]) -> tuple:
    """Numeric values sort numerically, everything else alphabetically.

    A spell-level facet reading 1, 2, 3, 10 rather than 1, 10, 2, 3 is the
    difference between a usable filter and an irritating one.
    """
    value = item[0]
    try:
        return (0, float(value), "")
    except ValueError:
        return (1, 0.0, value.lower())


def sort_entries(entries: list[ContentEntry], sort_fields: list[str]) -> list[ContentEntry]:
    """Order entries by a content type's `sort_default`, falling back to name."""
    if not sort_fields:
        return sorted(entries, key=lambda entry: entry.name.lower())

    def key(entry: ContentEntry) -> tuple:
        data = entry.data if isinstance(entry.data, dict) else {}
        parts: list = []
        for field in sort_fields:
            value = data.get(field)
            # Numbers before text, so a level-then-name sort reads naturally.
            if isinstance(value, bool):
                parts.append((1, 0.0, str(value).lower()))
            elif isinstance(value, (int, float)):
                parts.append((0, float(value), ""))
            else:
                parts.append((1, 0.0, _as_text(value).lower()))
        parts.append((1, 0.0, entry.name.lower()))
        return tuple(parts)

    return sorted(entries, key=key)


def serialize_entry(entry: ContentEntry, type_definition: dict) -> dict:
    data = entry.data if isinstance(entry.data, dict) else {}
    return {
        "entry_id": entry.entry_id,
        "source": entry.source,
        "name": entry.name,
        "content_type": entry.content_type,
        "data": data,
        "display": render_display(type_definition.get("compact_display", ""), data),
    }
