"""A library system's compendium: the rules content linked to it (issue #835).

A compendium belongs to a game system. What fills it is set explicitly on the
system, never inferred: the **content packs** linked to it, plus the
**rulesets** written for the sheets those packs and the system's linked
**character sheets** serve. Nothing here names a game - which types exist and
how an entry reads come from add-ons, the same way a sheet's catalog does:

1. the reader's sheet for the pack's ``schema_id`` (their own copy, else the
   server-wide one), which is what a character's references are shaped by;
2. the content types a pack declares in its own ``_meta.json``, which is how a
   pack carries reference material - conditions, rules, monsters - that no
   sheet picks from;
3. failing both, a read-only definition inferred from the entries themselves,
   so a pack installed before anyone has its sheet still reads as something.

A ruleset entry that is an unchanged copy of a linked pack's entry (a ruleset
the SRD was imported into) is shown once, as the pack's: two identical
Fireballs side by side say nothing.

Access follows the system. A reader who cannot see the system cannot see its
compendium, and ruleset content reaches only those who may read the ruleset
(``rulesets.readable_filter``).
"""
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional, Sequence

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...models import (
    CharacterSchema,
    ContentEntry,
    ContentPack,
    GameSystem,
    Ruleset,
    RulesetEntry,
    SystemCharacterSheet,
    SystemContentPack,
    User,
)
from .. import access_control
from . import catalog_query as query
from . import rulesets as rs
from .catalog_query import CatalogRow
from .user_schemas import catalog_document

__all__ = [
    "Compendium",
    "CompendiumError",
    "readable_system",
    "linked_pack_ids",
    "linked_sheet_ids",
    "set_links",
    "load",
    "content_types",
    "browse",
    "find_entry",
    "search",
    "systems_with_packs",
]

#: Results one search returns, across every content type.
MAX_SEARCH_RESULTS = 50
#: Links one system may carry. A shelf with more packs than this is a mistake.
MAX_LINKS = 50
#: Entries sampled to infer a definition for a type nobody declares.
_INFER_SAMPLE = 50
_RULESET_ORIGIN = "ruleset:"


class CompendiumError(ValueError):
    """A link change could not be made; the message says why."""


@dataclass
class Compendium:
    """Everything one reader's view of one system's compendium is built from."""

    system: GameSystem
    user_id: str
    #: Linked pack ids in link order, including any no longer installed.
    pack_ids: list[str]
    #: The linked packs that are installed.
    packs: list[ContentPack]
    sheet_ids: list[str]
    #: Every schema id the content may be described by, packs' first.
    schema_ids: list[str]
    #: schema id -> its content type table, sheet and pack declarations merged.
    definitions: dict[str, dict] = field(default_factory=dict)

    @property
    def pack_rows(self) -> list[str]:
        return [pack.id for pack in self.packs]


# --- the system and its links -----------------------------------------------


def readable_system(db: Session, system_id: str, user: Any) -> GameSystem:
    """The system, or 404 when it is missing or hidden from ``user``.

    The same two checks the system page makes: access level, and explicit
    content for a user who has it switched off.
    """
    system = db.query(GameSystem).filter_by(id=system_id).first()
    account = access_control.load_user(db, user)
    if not system or not access_control.can_access_system(db, account, system):
        raise HTTPException(404, "System not found")
    if system.is_explicit and not _sees_explicit(account):
        raise HTTPException(404, "System not found")
    return system


def _sees_explicit(account: Optional[User]) -> bool:
    if account is None or account.allow_explicit is None:
        return True
    return bool(account.allow_explicit)


def linked_pack_ids(db: Session, system_id: str) -> list[str]:
    return [
        row.pack_id
        for row in db.query(SystemContentPack)
        .filter_by(game_system_id=system_id)
        .order_by(SystemContentPack.created_at, SystemContentPack.pack_id)
        .all()
    ]


def linked_sheet_ids(db: Session, system_id: str) -> list[str]:
    return [
        row.schema_id
        for row in db.query(SystemCharacterSheet)
        .filter_by(game_system_id=system_id)
        .order_by(SystemCharacterSheet.created_at, SystemCharacterSheet.schema_id)
        .all()
    ]


def set_links(
    db: Session,
    system: GameSystem,
    user_id: str,
    *,
    pack_ids: Optional[Sequence[str]] = None,
    sheet_ids: Optional[Sequence[str]] = None,
) -> None:
    """Replace a system's linked packs and/or sheets. ``None`` leaves one alone.

    A new link must name something that exists: an installed pack, or a sheet
    the editor can use (their own or a server-wide one). A link already in
    place is kept even when what it names has since been uninstalled, so saving
    the form after removing the SRD does not fail on the SRD's old link - it is
    a soft reference, and reinstalling brings the compendium back.
    """
    if pack_ids is not None:
        wanted = _clean_ids(pack_ids, "content packs")
        existing = set(linked_pack_ids(db, system.id))
        installed = {
            row[0]
            for row in db.query(ContentPack.pack_id).filter(ContentPack.pack_id.in_(wanted)).all()
        }
        unknown = [pid for pid in wanted if pid not in installed and pid not in existing]
        if unknown:
            raise CompendiumError(f"Not an installed content pack: {', '.join(unknown)}")
        db.query(SystemContentPack).filter_by(game_system_id=system.id).delete(
            synchronize_session=False
        )
        for pid in wanted:
            db.add(SystemContentPack(game_system_id=system.id, pack_id=pid))

    if sheet_ids is not None:
        wanted = _clean_ids(sheet_ids, "character sheets")
        existing = set(linked_sheet_ids(db, system.id))
        usable = {
            row[0]
            for row in db.query(CharacterSchema.schema_id)
            .filter(CharacterSchema.schema_id.in_(wanted))
            .filter((CharacterSchema.user_id == user_id) | CharacterSchema.user_id.is_(None))
            .all()
        }
        unknown = [sid for sid in wanted if sid not in usable and sid not in existing]
        if unknown:
            raise CompendiumError(f"Not a character sheet you have: {', '.join(unknown)}")
        db.query(SystemCharacterSheet).filter_by(game_system_id=system.id).delete(
            synchronize_session=False
        )
        for sid in wanted:
            db.add(SystemCharacterSheet(game_system_id=system.id, schema_id=sid))
    db.flush()


def _clean_ids(values: Sequence[str], what: str) -> list[str]:
    cleaned = list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))
    if len(cleaned) > MAX_LINKS:
        raise CompendiumError(f"A system can link at most {MAX_LINKS} {what}")
    too_long = [value for value in cleaned if len(value) > 100]
    if too_long:
        raise CompendiumError(f"Not a valid id: {too_long[0][:40]}")
    return cleaned


def systems_with_packs(db: Session) -> dict[str, list[str]]:
    """system id -> its linked pack ids, for every system that has any."""
    linked: dict[str, list[str]] = {}
    for row in db.query(SystemContentPack).order_by(SystemContentPack.created_at).all():
        linked.setdefault(row.game_system_id, []).append(row.pack_id)
    return linked


# --- building one reader's compendium ---------------------------------------


def load(db: Session, system: GameSystem, user_id: str) -> Compendium:
    """Gather the packs, sheets and type definitions behind a system's compendium."""
    pack_ids = linked_pack_ids(db, system.id)
    installed = {
        pack.pack_id: pack
        for pack in db.query(ContentPack).filter(ContentPack.pack_id.in_(pack_ids)).all()
    } if pack_ids else {}
    packs = [installed[pid] for pid in pack_ids if pid in installed]
    sheet_ids = linked_sheet_ids(db, system.id)
    schema_ids = list(dict.fromkeys([pack.schema_id for pack in packs] + sheet_ids))

    definitions: dict[str, dict] = {}
    for schema_id in schema_ids:
        document = catalog_document(db, user_id, schema_id)
        definitions[schema_id] = dict((document or {}).get("content_types") or {})

    return Compendium(
        system=system,
        user_id=user_id,
        pack_ids=pack_ids,
        packs=packs,
        sheet_ids=sheet_ids,
        schema_ids=schema_ids,
        definitions=definitions,
    )


def _pack_rows(
    db: Session, comp: Compendium, content_type: Optional[str] = None,
    row_ids: Optional[Iterable[str]] = None,
) -> list[CatalogRow]:
    if not comp.packs:
        return []
    origin = {pack.id: pack.pack_id for pack in comp.packs}
    q = db.query(ContentEntry).filter(ContentEntry.pack_id.in_(comp.pack_rows))
    if content_type:
        q = q.filter(ContentEntry.content_type == content_type)
    if row_ids is not None:
        wanted = list(row_ids)
        if not wanted:
            return []
        q = q.filter(ContentEntry.id.in_(wanted))
    return [
        CatalogRow(
            id=row.id,
            entry_id=row.entry_id,
            source=row.source,
            name=row.name,
            data=row.data if isinstance(row.data, dict) else {},
            content_type=row.content_type,
            schema_id=row.schema_id,
            origin=origin.get(row.pack_id, ""),
        )
        for row in q.all()
    ]


def _ruleset_rows(
    db: Session, comp: Compendium, content_type: Optional[str] = None
) -> list[CatalogRow]:
    """Readable ruleset entries for the compendium's schemas, minus pack copies."""
    if not comp.schema_ids:
        return []
    q = (
        db.query(RulesetEntry, Ruleset)
        .join(Ruleset, Ruleset.id == RulesetEntry.ruleset_id)
        .filter(RulesetEntry.schema_id.in_(comp.schema_ids))
        .filter(rs.readable_filter(db, comp.user_id))
    )
    if content_type:
        q = q.filter(RulesetEntry.content_type == content_type)
    pairs = [(entry, ruleset) for entry, ruleset in q.all()]
    copies = _pack_copies(db, comp, pairs)
    return [
        CatalogRow(
            id=entry.id,
            entry_id=entry.entry_id,
            source="ruleset",
            name=entry.name,
            data=entry.data if isinstance(entry.data, dict) else {},
            content_type=entry.content_type,
            ruleset=True,
            owner_name=ruleset.name,
            row_id=entry.id,
            ruleset_id=ruleset.id,
            ruleset_name=ruleset.name,
            schema_id=entry.schema_id,
            origin=f"{_RULESET_ORIGIN}{ruleset.id}",
        )
        for entry, ruleset in pairs
        if entry.id not in copies
    ]


def _pack_copies(
    db: Session, comp: Compendium, pairs: list[tuple[RulesetEntry, Ruleset]]
) -> set[str]:
    """Ruleset entry ids that are unchanged copies of a linked pack's entry."""
    linked = {pack.pack_id: pack.id for pack in comp.packs}
    candidates = [
        entry for entry, ruleset in pairs if ruleset.source_pack_id in linked
    ]
    if not candidates:
        return set()
    originals: dict[tuple[str, str, str], Any] = {}
    for row in (
        db.query(ContentEntry)
        .filter(ContentEntry.pack_id.in_(list(linked.values())))
        .filter(ContentEntry.entry_id.in_({entry.entry_id for entry in candidates}))
        .all()
    ):
        originals[(row.pack_id, row.content_type, row.entry_id)] = row.data
    rulesets = {ruleset.id: ruleset for _entry, ruleset in pairs}
    copies = set()
    for entry in candidates:
        pack_row = linked[rulesets[entry.ruleset_id].source_pack_id or ""]
        original = originals.get((pack_row, entry.content_type, entry.entry_id))
        if original is not None and _same_data(original, entry.data):
            copies.add(entry.id)
    return copies


def _same_data(a: Any, b: Any) -> bool:
    """Equal entry data. An import fills declared defaults, so absent == empty."""
    left = a if isinstance(a, dict) else {}
    right = b if isinstance(b, dict) else {}
    for key in set(left) | set(right):
        if key.startswith("_"):
            continue
        if (left.get(key) in (None, "", [], 0, False)) and (right.get(key) in (None, "", [], 0, False)):
            continue
        if left.get(key) != right.get(key):
            return False
    return True


def _rows(db: Session, comp: Compendium, content_type: Optional[str] = None) -> list[CatalogRow]:
    return _pack_rows(db, comp, content_type) + _ruleset_rows(db, comp, content_type)


# --- type definitions --------------------------------------------------------


def definition_for(comp: Compendium, schema_id: str, content_type: str) -> Optional[dict]:
    """The declared definition of a type under one schema, if anyone declares it."""
    definition = comp.definitions.get(schema_id, {}).get(content_type)
    return definition if isinstance(definition, dict) else None


def _primary_definition(
    comp: Compendium, content_type: str, rows: Sequence[CatalogRow]
) -> dict:
    """The definition a type's list is built from: the first schema declaring it.

    Two packs may describe ``spell`` differently (a 2014 and a 2024 sheet on one
    shelf). The list's filters and sort follow the first; each entry still
    renders with its own schema's definition.
    """
    for schema_id in comp.schema_ids:
        definition = definition_for(comp, schema_id, content_type)
        if definition:
            return definition
    return _inferred_definition(content_type, rows)


def _row_definition(comp: Compendium, row: CatalogRow, fallback: dict) -> dict:
    return definition_for(comp, row.schema_id, row.content_type) or fallback


def _inferred_definition(content_type: str, rows: Sequence[CatalogRow]) -> dict:
    """A read-only definition for a type no sheet or pack declares.

    Built from the keys a sample of entries carries, so the entry still shows
    every value it has. Lists are shown as text; long or multi-line strings as
    a text area.
    """
    fields: dict[str, dict] = {}
    for row in list(rows)[:_INFER_SAMPLE]:
        for key, value in (row.data or {}).items():
            if key.startswith("_") or key in fields or not isinstance(key, str):
                continue
            fields[key] = {"type": _inferred_type(value), "label": _label(key)}
    identity = "name" if "name" in fields else ""
    if not identity:
        fields = {"name": {"type": "text", "label": "Name"}, **fields}
        identity = "name"
    return {
        "label": _label(content_type),
        "label_plural": "",
        "identity_field": identity,
        "fields": fields,
        "search_fields": [],
        "filter_fields": [],
        "sort_default": [],
        "inferred": True,
    }


def _inferred_type(value: Any) -> str:
    if isinstance(value, bool):
        return "checkbox"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str) and (len(value) > 120 or "\n" in value):
        return "textarea"
    return "text"


def _label(name: str) -> str:
    words = name.replace("_", " ").replace("-", " ").strip()
    return words[:1].upper() + words[1:] if words else name


def _summary(name: str, definition: dict, count: int) -> dict:
    return {
        "name": name,
        "label": definition.get("label") or _label(name),
        "label_plural": definition.get("label_plural", ""),
        "icon": definition.get("icon", ""),
        "identity_field": definition.get("identity_field", "name"),
        "sort_default": definition.get("sort_default", []),
        "search_fields": definition.get("search_fields", []),
        "filter_fields": definition.get("filter_fields", []),
        "filter_depends": definition.get("filter_depends", {}),
        "compact_display": definition.get("compact_display", ""),
        "fields": definition.get("fields", {}),
        "entry_count": count,
    }


def _serialize(comp: Compendium, row: CatalogRow, fallback: dict) -> dict:
    definition = _row_definition(comp, row, fallback)
    payload = query.serialize_entry(row, definition)
    payload["schema_id"] = row.schema_id
    payload["origin"] = row.origin
    return payload


# --- reading it -------------------------------------------------------------


def content_types(db: Session, comp: Compendium) -> list[dict]:
    """Each content type with entries in this compendium, with its count."""
    counts: dict[str, int] = {}
    if comp.packs:
        for (name,) in (
            db.query(ContentEntry.content_type)
            .filter(ContentEntry.pack_id.in_(comp.pack_rows))
            .all()
        ):
            counts[name] = counts.get(name, 0) + 1
    ruleset_rows = _ruleset_rows(db, comp)
    for row in ruleset_rows:
        counts[row.content_type] = counts.get(row.content_type, 0) + 1

    summaries = []
    for name, count in counts.items():
        sample: list[CatalogRow] = []
        if not any(definition_for(comp, sid, name) for sid in comp.schema_ids):
            sample = _sample_rows(db, comp, name) or [
                row for row in ruleset_rows if row.content_type == name
            ]
        summaries.append(_summary(name, _primary_definition(comp, name, sample), count))
    return sorted(
        summaries, key=lambda item: str(item["label_plural"] or item["label"]).lower()
    )


def _sample_rows(db: Session, comp: Compendium, content_type: str) -> list[CatalogRow]:
    if not comp.packs:
        return []
    ids = [
        row[0]
        for row in db.query(ContentEntry.id)
        .filter(ContentEntry.pack_id.in_(comp.pack_rows))
        .filter(ContentEntry.content_type == content_type)
        .limit(_INFER_SAMPLE)
        .all()
    ]
    return _pack_rows(db, comp, content_type, row_ids=ids)


def browse(
    db: Session,
    comp: Compendium,
    content_type: str,
    *,
    search: str = "",
    sort: str = "",
    filters: Optional[dict[str, str]] = None,
    page: int = 1,
    page_size: int = query.DEFAULT_PAGE_SIZE,
) -> dict:
    """One content type: search, filter, sort, paginate - the sheet browser's rules."""
    rows = _rows(db, comp, content_type)
    definition = _primary_definition(comp, content_type, rows)
    filters = filters or {}

    fields = definition.get("filter_fields", []) or []
    depends = definition.get("filter_depends", {}) or {}
    facets = query.narrowed_facets(rows, fields, filters, depends)
    without_parent = query.unparented_values(rows, depends)
    if filters:
        rows = [row for row in rows if query.matches_filters(row.data or {}, filters)]

    if search.strip():
        ranked = query.search_pack_entry_ids(
            db, comp.pack_rows, search, content_type=content_type
        )
        order = {row_id: index for index, row_id in enumerate(ranked)}
        search_fields = definition.get("search_fields") or []
        rows = [
            row
            for row in rows
            if row.id in order
            or (row.ruleset and query.matches_text(row, search, search_fields))
        ]
        rows.sort(key=lambda row: order.get(row.id, len(order)))
    else:
        sort_fields = (
            [name.strip() for name in sort.split(",") if name.strip()]
            if sort
            else definition.get("sort_default", []) or []
        )
        rows = query.sort_entries(rows, sort_fields)

    total = len(rows)
    size = max(1, min(page_size, query.MAX_PAGE_SIZE))
    current = max(1, page)
    window = rows[(current - 1) * size : current * size]
    return {
        "content_type": _summary(content_type, definition, total),
        "entries": [_serialize(comp, row, definition) for row in window],
        "total": total,
        "page": current,
        "page_size": size,
        "filters_available": facets,
        "filters_without_parent": without_parent,
    }


def find_entry(
    db: Session,
    comp: Compendium,
    content_type: str,
    entry_id: str,
    origin: Optional[str] = None,
) -> Optional[dict]:
    """One entry in full, with the definition it renders by.

    ``origin`` (a pack id, or ``ruleset:<id>``) picks between two entries with
    the same id; without it, a linked pack's entry wins, in link order.
    """
    rows = [row for row in _rows(db, comp, content_type) if row.entry_id == entry_id]
    if origin:
        rows = [row for row in rows if row.origin == origin]
    if not rows:
        return None
    rank = {pid: index for index, pid in enumerate(comp.pack_ids)}
    rows.sort(key=lambda row: (row.ruleset, rank.get(row.origin, len(rank))))
    row = rows[0]
    fallback = _primary_definition(comp, content_type, [row])
    payload = _serialize(comp, row, fallback)
    definition = _row_definition(comp, row, fallback)
    payload["type_definition"] = _summary(content_type, definition, 0)
    return payload


def search(
    db: Session,
    comps: Sequence[Compendium],
    text: str,
    *,
    content_type: Optional[str] = None,
    limit: int = MAX_SEARCH_RESULTS,
) -> list[dict]:
    """Entries matching a search across one or more compendiums, best first.

    Each result names every given system it appears in, so an SRD linked to two
    shelves is one result rather than two. Pack entries are ranked by the full
    text index; ruleset entries are matched on their name and searchable
    fields and follow them.
    """
    if not text.strip() or not comps:
        return []
    limit = max(1, min(limit, MAX_SEARCH_RESULTS))

    # Every pack row across the compendiums, and which systems each reaches.
    by_pack: dict[str, list[Compendium]] = {}
    for comp in comps:
        for pack in comp.packs:
            by_pack.setdefault(pack.id, []).append(comp)

    results: list[dict] = []
    ranked = query.search_pack_entry_ids(
        db, list(by_pack), text, content_type=content_type, limit=limit
    )
    if ranked:
        rows = {
            row.id: row
            for row in db.query(ContentEntry).filter(ContentEntry.id.in_(ranked)).all()
        }
        for row_id in ranked:
            row = rows.get(row_id)
            if row is None:
                continue
            owners = by_pack.get(row.pack_id, [])
            if not owners:
                continue
            first = owners[0]
            origin = next((p.pack_id for p in first.packs if p.id == row.pack_id), "")
            catalog_row = CatalogRow(
                id=row.id,
                entry_id=row.entry_id,
                source=row.source,
                name=row.name,
                data=row.data if isinstance(row.data, dict) else {},
                content_type=row.content_type,
                schema_id=row.schema_id,
                origin=origin,
            )
            results.append(_search_result(first, catalog_row, owners))

    seen = {(item["content_type"], item["entry_id"], item["origin"]) for item in results}
    for comp in comps:
        if len(results) >= limit:
            break
        for hit in _ruleset_rows(db, comp, content_type):
            key = (hit.content_type, hit.entry_id, hit.origin)
            if key in seen:
                continue
            definition = _row_definition(comp, hit, {})
            if query.matches_text(hit, text, definition.get("search_fields") or []):
                seen.add(key)
                owners = [
                    other for other in comps if hit.schema_id in other.schema_ids
                ]
                results.append(_search_result(comp, hit, owners or [comp]))
                if len(results) >= limit:
                    break
    return results[:limit]


def _search_result(comp: Compendium, row: CatalogRow, owners: Sequence[Compendium]) -> dict:
    definition = _row_definition(comp, row, _inferred_definition(row.content_type, [row]))
    payload = _serialize(comp, row, definition)
    payload["type_label"] = definition.get("label") or _label(row.content_type)
    payload["systems"] = [
        {"id": owner.system.id, "name": owner.system.name} for owner in owners
    ]
    return payload
