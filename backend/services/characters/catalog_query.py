"""Catalog querying: search, faceted filters, sorting, and display templates.

Shared by the two places catalog content is read: a sheet's content browser
(``routers/content``) and a system's compendium (``routers/compendium``). Both
see pack entries and ruleset entries the same way, through ``CatalogRow``.
"""
import re
from typing import Any, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...models.dialect import is_postgres
from .. import pg_search

#: `{name}` placeholders in a content type's compact_display template.
_DISPLAY_TOKENS = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")

#: A facet lists every value present, so a filter over a few hundred subclasses
#: stays usable. Past this many it is omitted rather than sent with every browse
#: response: a field that nearly every entry gives its own value is a search
#: term, not a filter. A `filter_depends` child usually comes back under the cap
#: once its parent is chosen.
MAX_FACET_VALUES = 500

MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50


class CatalogRow:
    """A pack entry or a ruleset entry, seen the same way.

    Ruleset content is first-class: it is the same data, so the catalog should
    not care which table a row came from. This wrapper gives both the handful
    of attributes the sort, filter and serialize helpers read, plus the markers
    the UI uses to label which ruleset a row belongs to. ``schema_id`` and
    ``origin`` say which sheet's types describe the row and where it came from
    (a pack id, or ``ruleset:<id>``), which a compendium spanning several packs
    needs and a sheet's own browser ignores.
    """

    __slots__ = ("id", "entry_id", "source", "name", "data", "content_type",
                 "ruleset", "owner_name", "row_id", "ruleset_id", "ruleset_name",
                 "schema_id", "origin")

    def __init__(
        self,
        *,
        id: str,
        entry_id: str,
        source: str,
        name: str,
        data: dict,
        content_type: str,
        ruleset: bool = False,
        owner_name: str = "",
        row_id: Optional[str] = None,
        ruleset_id: Optional[str] = None,
        ruleset_name: str = "",
        schema_id: str = "",
        origin: str = "",
    ) -> None:
        self.id = id
        self.entry_id = entry_id
        self.source = source
        self.name = name
        self.data = data
        self.content_type = content_type
        self.ruleset = ruleset
        self.owner_name = owner_name
        self.row_id = row_id
        self.ruleset_id = ruleset_id
        self.ruleset_name = ruleset_name
        self.schema_id = schema_id
        self.origin = origin


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
    someone typing "fire" into a spell list expects. PostgreSQL does the same
    over ``content_search.search`` (``services.pg_search.prefix_tsquery``).
    """
    return _fts_entry_ids(
        db,
        query,
        "schema_id = :schema_id AND content_type = :content_type",
        {"schema_id": schema_id, "content_type": content_type},
    )


def search_pack_entry_ids(
    db: Session,
    pack_rows: Sequence[str],
    query: str,
    *,
    content_type: Optional[str] = None,
    limit: Optional[int] = None,
) -> list[str]:
    """Entry row ids in the given packs matching a search, best match first.

    A compendium reads the packs linked to a system rather than everything one
    sheet draws on, so it filters on the pack. ``pack_rows`` are
    ``ContentPack.id`` values; each is bound as its own parameter.
    """
    if not pack_rows:
        return []
    params: dict[str, Any] = {f"pack{index}": row for index, row in enumerate(pack_rows)}
    where = f"pack_row IN ({', '.join(f':{name}' for name in params)})"
    if content_type:
        params["content_type"] = content_type
        where += " AND content_type = :content_type"
    return _fts_entry_ids(db, query, where, params, limit=limit)


def _fts_entry_ids(
    db: Session,
    query: str,
    where: str,
    params: dict[str, Any],
    *,
    limit: Optional[int] = None,
) -> list[str]:
    """Run one prefix-matched catalog search, narrowed by ``where``."""
    terms = [term for term in re.findall(r"[\w']+", query) if term]
    if not terms:
        return []
    params = dict(params)
    if is_postgres(db):
        tsq = pg_search.prefix_tsquery(terms, params)
        if tsq is None:
            return []
        sql = (
            f"WITH q AS (SELECT {tsq} AS q) "
            "SELECT entry_row FROM content_search, q "
            f"WHERE content_search.search @@ q.q AND {where} "
            "ORDER BY ts_rank_cd(content_search.search, q.q, 1) DESC, content_search.id"
        )
    else:
        params["match"] = " ".join(f'"{term}"*' for term in terms)
        sql = (
            "SELECT entry_row FROM content_search "
            f"WHERE content_search MATCH :match AND {where} "
            "ORDER BY rank"
        )
    if limit:
        params["limit"] = int(limit)
        sql += " LIMIT :limit"
    return [row[0] for row in db.execute(text(sql), params).fetchall()]


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


def build_facets(entries: Sequence[Any], filter_fields: list[str]) -> dict:
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


def narrowed_facets(
    entries: Sequence[Any],
    filter_fields: list[str],
    filters: dict[str, str],
    depends: dict[str, str],
) -> dict:
    """Each field's facet, narrowed by every other active filter but not by itself.

    A facet never narrows itself, so the current choice stays reversible, and a
    parent is not narrowed by its `filter_depends` children: picking a
    subclass must not hide the other classes. A chosen value the other filters
    have narrowed out is kept with a count of 0, so the select still shows it
    and it can be cleared.
    """
    whole = build_facets(entries, filter_fields)
    facets: dict = {}
    for field in filter_fields:
        children = {child for child, parent in depends.items() if parent == field}
        others = {
            key: value
            for key, value in filters.items()
            if key != field and key not in children
        }
        if others:
            candidates = [entry for entry in entries if matches_filters(entry.data or {}, others)]
            facets.update(build_facets(candidates, [field]))
        elif field in whole:
            facets[field] = list(whole[field])

        chosen = filters.get(field)
        if not chosen:
            continue
        wanted = chosen.strip().lower()
        if any(option["value"].lower() == wanted for option in facets.get(field, [])):
            continue
        # Echo the stored casing, so `filter[class]=barbarian` selects "Barbarian".
        stored = next(
            (option["value"] for option in whole.get(field, []) if option["value"].lower() == wanted),
            chosen,
        )
        facets.setdefault(field, []).append({"value": stored, "count": 0})
    return facets


def unparented_values(entries: Sequence[Any], depends: dict[str, str]) -> dict[str, bool]:
    """Whether any entry carries a `filter_depends` child without its parent.

    A feature with an origin but no class (a racial trait, a homebrew row) can
    only be found by its origin, so the browser leaves that filter enabled
    before a class is chosen.
    """
    result = {}
    for child, parent in depends.items():
        result[child] = any(
            (entry.data or {}).get(child) and not (entry.data or {}).get(parent)
            for entry in entries
        )
    return result


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


def sort_entries(entries: Sequence[Any], sort_fields: list[str]) -> list[Any]:
    """Order entries by a content type's `sort_default`, falling back to name."""
    if not sort_fields:
        return sorted(entries, key=lambda entry: entry.name.lower())

    def key(entry: Any) -> tuple:
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


def serialize_entry(entry: Any, type_definition: dict) -> dict:
    """Shape a catalog row for the API, pack or ruleset alike."""
    data = entry.data if isinstance(entry.data, dict) else {}
    return {
        "entry_id": entry.entry_id,
        "source": entry.source,
        "name": entry.name,
        "content_type": entry.content_type,
        "data": data,
        "display": render_display(type_definition.get("compact_display", ""), data),
        # The browser labels a ruleset row with the ruleset it came from, so
        # "Fireball (SRD)" and "Fireball (Strahd house rules)" are told apart.
        "ruleset": bool(getattr(entry, "ruleset", False)),
        "owner_name": getattr(entry, "owner_name", ""),
        "row_id": getattr(entry, "row_id", None),
        "ruleset_id": getattr(entry, "ruleset_id", None),
        "ruleset_name": getattr(entry, "ruleset_name", ""),
    }


def matches_text(entry: Any, query: str, search_fields: list[str]) -> bool:
    """Whether an entry matches a search, for rows the FTS index does not cover.

    Homebrew changes on every edit and the visible set is per user and small, so
    it is matched here rather than maintained in FTS. Every term must appear as
    a prefix somewhere in the searchable text, which is what the FTS query does.
    """
    data = entry.data if isinstance(entry.data, dict) else {}
    values = [data.get(field) for field in search_fields] if search_fields else list(data.values())
    haystack = " ".join(
        _as_text(value) for value in [entry.name, *values] if value is not None
    ).lower()
    terms = [term.lower() for term in re.findall(r"[\w']+", query) if term]
    return all(any(word.startswith(term) for word in haystack.split()) for term in terms)
