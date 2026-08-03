"""The declarative scraper engine.

Turns a fetched JSON document plus an ``AddonManifest`` into ranked search
candidates and, for a chosen candidate, a dict of Grimoire game-system fields.

Pure and side-effect free: it takes an already-fetched document and never
touches the network or the database, which is what makes it straightforward to
test against a checked-in fixture.
"""
import re
from difflib import SequenceMatcher
from typing import Any, Optional

from . import transforms
from .constants import MAX_IDENTITY_INPUT, MAX_IDENTITY_LENGTH
from .manifest import (
    INT_FIELDS,
    LINK_LIST_FIELDS,
    LIST_FIELDS,
    AddonManifest,
    MappingEntry,
    PluckSpec,
    SearchSpec,
    SelectSpec,
    ValueSpec,
)

_PLACEHOLDER = re.compile(r"\{([a-zA-Z0-9_.]+)\}")

# What a hand-typed identity may look like: a numeric product id, or a slug.
# Deliberately strict, so pasted prose or an unrelated URL is rejected rather
# than turned into a doomed request.
_BARE_IDENTITY = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}")


class AddonDataError(Exception):
    """The fetched document did not match the shape the manifest describes."""


def _dig(record: Any, path: str) -> Any:
    """Read a dotted path, descending through mappings and lists.

    A path segment applied to a list maps over its elements and flattens the
    result once, so ``filters.descriptions.name`` collects the names from every
    description of every filter. That is what makes deeply-nested catalogue
    payloads reachable without an expression language.
    """
    cur: Any = record
    for part in path.split("."):
        if isinstance(cur, list):
            collected: list[Any] = []
            for item in cur:
                value = _dig(item, part)
                if value is None:
                    continue
                if isinstance(value, list):
                    collected.extend(value)
                else:
                    collected.append(value)
            cur = collected or None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
        if cur is None:
            return None
    return cur


def _select(items: Any, spec: "SelectSpec") -> Any:
    """Keep only the list entries whose ``field`` equals ``equals``.

    Catalogue payloads often carry one entry per language or per variant; this
    picks the relevant ones without needing a query language.
    """
    if not isinstance(items, list):
        return items
    kept = [
        item
        for item in items
        if isinstance(item, dict) and spec.matches(_dig(item, spec.field))
    ]
    return kept or None


def _as_text(value: Any) -> str:
    """Flatten a value to text for matching and templating."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return ""
    if isinstance(value, (list, tuple)):
        return " ".join(_as_text(v) for v in value)
    return str(value)


def _render(template: str, record: dict, extra: Optional[dict] = None) -> str:
    """Substitute ``{field}`` placeholders from the record (and any extras)."""

    def sub(match: "re.Match[str]") -> str:
        key = match.group(1)
        if extra and key in extra:
            return _as_text(extra[key])
        return _as_text(_dig(record, key))

    return _PLACEHOLDER.sub(sub, template).strip()


def _template_has_data(
    template: str, record: dict, extra: Optional[dict] = None
) -> bool:
    """Whether any ``{placeholder}`` in a template resolved to a real value.

    A template with no placeholders at all is a literal, which is always fine.
    """
    keys = _PLACEHOLDER.findall(template)
    if not keys:
        return True
    for key in keys:
        if extra and _as_text(extra.get(key)).strip():
            return True
        if _as_text(_dig(record, key)).strip():
            return True
    return False


def _resolve(spec: ValueSpec, record: dict, extra: Optional[dict] = None) -> str:
    """Resolve a ValueSpec against a record."""
    if spec.template is not None:
        value = _render(spec.template, record, extra)
    else:
        value = _as_text(_dig(record, spec.from_ or ""))
    # Collapse whitespace left behind by a placeholder that resolved to nothing
    # (e.g. "{name} ({edition})" with no edition).
    value = re.sub(r"\s+", " ", value).strip()
    return transforms.apply(value, spec.transform)


def extract_records(document: Any, manifest: AddonManifest) -> list[dict]:
    """Pull the list of records out of a fetched document, applying ``skip_when``."""
    spec = manifest.records
    node = document if spec.root in ("", "$") else _dig(document, spec.root)

    if not isinstance(node, list):
        raise AddonDataError(
            f"expected a list of records at '{spec.root}', "
            f"got {type(node).__name__}"
        )

    records = [r for r in node if isinstance(r, dict)]
    skip = spec.skip_when
    if skip is not None:
        records = [r for r in records if _dig(r, skip.field) != skip.equals]
    return records


def _score_field(query: str, value: str, strategy: str) -> float:
    """Similarity of one record field to the query, in 0..1."""
    if not value or not query:
        return 0.0
    q, v = query.casefold(), value.casefold()
    if strategy == "exact":
        return 1.0 if q == v else 0.0
    if strategy == "contains":
        return 1.0 if q in v else 0.0
    ratio = SequenceMatcher(None, q, v).ratio()
    # A query that is a whole-word prefix of the value ("Pathfinder" vs
    # "Pathfinder 2nd Edition") is a strong match that a raw ratio underrates
    # because of the length difference.
    if v.startswith(q) and (len(v) == len(q) or v[len(q)] in " :-,"):
        ratio = max(ratio, 0.95)
    return ratio


def score_record(query: str, record: dict, search: SearchSpec) -> float:
    """Weighted score for one record.

    The best-matching field sets the score and the remaining fields nudge it, so
    a strong name match is not diluted by a weak edition match — while an
    edition match still breaks ties between otherwise-equal names.
    """
    scored: list[tuple[float, float]] = []
    for field in search.fields:
        value = _as_text(_dig(record, field.field))
        scored.append((_score_field(query, value, field.strategy), field.weight))

    if not scored:
        return 0.0

    primary, primary_weight = max(scored, key=lambda pair: pair[0] * pair[1])
    if primary_weight <= 0:
        return 0.0

    others = [(s, w) for s, w in scored if not (s == primary and w == primary_weight)]
    bonus = sum(s * w for s, w in others)
    bonus_weight = sum(w for _, w in others)
    if bonus_weight > 0:
        # Secondary fields can move the score by at most their share of the
        # total weight, keeping the result inside 0..1.
        share = bonus_weight / (primary_weight + bonus_weight)
        return primary * (1 - share) + (bonus / bonus_weight) * share
    return primary


def _identity_of(record: dict, search: SearchSpec, index: int) -> str:
    """Stable handle for a record, used to re-find it on fetch."""
    if search.identity is not None:
        value = _resolve(search.identity, record)
        if value:
            return value
    # No identity spec (or it resolved empty): fall back to position, which is
    # stable for as long as the cached document is.
    return f"#{index}"


def search(query: str, document: Any, manifest: AddonManifest) -> list[dict]:
    """Rank records against ``query``.  Returns candidate dicts, best first."""
    if manifest.search is None:
        return []
    spec = manifest.search
    records = extract_records(document, manifest)

    scored = []
    for index, record in enumerate(records):
        value = score_record(query, record, spec)
        if value >= spec.min_score:
            scored.append((value, index, record))

    # Sort by score, then by index so equal scores keep the source's own order
    # (which is the site's curation) rather than an arbitrary one.
    scored.sort(key=lambda item: (-item[0], item[1]))

    results = []
    for value, index, record in scored[: spec.limit]:
        identity = _identity_of(record, spec, index)
        label = _resolve(spec.label, record) if spec.label else identity
        url = _resolve(spec.url, record, {"identity": identity}) if spec.url else ""
        results.append(
            {
                "identity": identity,
                "label": label or identity,
                "score": round(value, 4),
                "url": url,
            }
        )
    return results


def find_record(identity: str, document: Any, manifest: AddonManifest) -> Optional[dict]:
    """Locate the record a previous search returned as ``identity``."""
    if manifest.search is None:
        return None
    records = extract_records(document, manifest)
    for index, record in enumerate(records):
        if _identity_of(record, manifest.search, index) == identity:
            return record
    return None


def resolve_identity(text: str, manifest: AddonManifest) -> Optional[str]:
    """Turn pasted text — a source URL or a bare id — into an identity.

    Returns None when the manifest declares no pattern, or the text matches
    neither the pattern nor the shape of a bare identity. The caller decides
    whether that is an error or a cue to fall back to searching.
    """
    text = (text or "").strip()
    if not text or len(text) > MAX_IDENTITY_INPUT:
        return None
    if manifest.search is None or not manifest.search.identity_pattern:
        return None

    match = re.search(manifest.search.identity_pattern, text)
    if match:
        found = (match.group(1) or "").strip()
        return found[:MAX_IDENTITY_LENGTH] if found else None

    # No URL match. A bare id the user typed straight in is still valid, but
    # only if it looks like one — never a stray sentence or a URL for some
    # other site, which would otherwise become a bogus detail request.
    if _BARE_IDENTITY.fullmatch(text):
        return text
    return None


def record_url(record: dict, identity: str, manifest: AddonManifest) -> str:
    """The manifest's "view source" link for a record, or "" when it has none."""
    if manifest.search is None or manifest.search.url is None:
        return ""
    return _resolve(manifest.search.url, record, {"identity": identity})


def _pluck(items: Any, spec: "PluckSpec") -> Any:
    """Read one value out of each object in ``items``.

    Each object may hold its own repeated sub-list (one entry per language, say),
    which ``spec.select`` narrows and ``spec.first`` collapses.
    """
    if not isinstance(items, list):
        items = [items]
    out: list[Any] = []
    for item in items:
        container, _, leaf = spec.from_.rpartition(".")
        node = _dig(item, container) if container else item
        if spec.select is not None:
            node = _select(node, spec.select)
            if node is None:
                continue
        value = _dig(node, leaf)
        if value is None:
            continue
        if isinstance(value, list):
            if spec.first:
                value = value[0] if value else None
                if value is None:
                    continue
                out.append(value)
            else:
                out.extend(value)
        else:
            out.append(value)
    if not out:
        return None
    out = [transforms.apply(_as_text(v).strip(), spec.transform) for v in out]
    return [v for v in out if v] or None


def _entry_value(
    entry: MappingEntry, record: dict, extra: Optional[dict] = None
) -> Any:
    """Resolve one mapping entry to a raw value (scalar or list), or None."""
    if entry.template is not None:
        # A template whose placeholders all resolved to nothing yields only its
        # literal text — a URL with a hole in it. Drop it rather than propose a
        # broken value.
        if not _template_has_data(entry.template, record, extra):
            return None
        raw: Any = _render(entry.template, record, extra)
    elif entry.select is not None and entry.pluck is not None:
        # Two-level: narrow the outer list, then read one value out of each
        # surviving object (which may itself need narrowing).
        narrowed = _select(_dig(record, entry.from_ or ""), entry.select)
        raw = _pluck(narrowed, entry.pluck) if narrowed is not None else None
    elif entry.select is not None:
        # Narrow the list first, then read the field out of what survives. The
        # path is split so ``select`` applies to the container, not the leaf.
        path = entry.from_ or ""
        container, _, leaf = path.rpartition(".")
        narrowed = _select(_dig(record, container) if container else record, entry.select)
        raw = _dig(narrowed, leaf) if narrowed is not None else None
    else:
        raw = _dig(record, entry.from_ or "")

    if raw is None or raw == "" or raw == []:
        return None

    if isinstance(raw, list):
        items = [_as_text(v).strip() for v in raw]
        items = [transforms.apply(v, entry.transform) for v in items if v]
        if not items:
            return None
        # De-duplicate while preserving order: a flattened nested path can yield
        # the same value from several branches.
        seen: set[str] = set()
        deduped: list[str] = []
        for item in items:
            key = item.casefold()
            if key not in seen:
                seen.add(key)
                deduped.append(item)
        return deduped[0] if entry.first else deduped

    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        # Numbers pass through untransformed; year is the only numeric target.
        return raw

    text = _as_text(raw).strip()
    if not text:
        return None
    if entry.split:
        parts = [p.strip() for p in text.split(entry.split)]
        items = [transforms.apply(p, entry.transform) for p in parts if p]
        return items or None
    return transforms.apply(text, entry.transform)


def _coerce(field: str, value: Any, entry: MappingEntry) -> Any:
    """Shape a resolved value to match the Grimoire column it targets."""
    if field == "year":
        # Accepts a bare year or the leading year of an ISO timestamp.
        try:
            return int(str(value).strip()[:4])
        except (TypeError, ValueError):
            return None

    if field in INT_FIELDS:
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return None

    if field == "publishers" or entry.as_ == "link_list":
        items = value if isinstance(value, list) else [value]
        return [{"name": _as_text(v).strip(), "url": ""} for v in items if _as_text(v).strip()]

    if field in LINK_LIST_FIELDS:
        items = value if isinstance(value, list) else [value]
        return [
            {"label": entry.label, "url": _as_text(v).strip()}
            for v in items
            if _as_text(v).strip()
        ]

    if field in LIST_FIELDS:
        return value if isinstance(value, list) else [_as_text(value)]

    # Scalar text target.
    if isinstance(value, list):
        return ", ".join(_as_text(v) for v in value)
    return _as_text(value)


def map_record(
    record: dict, manifest: AddonManifest, identity: str = ""
) -> dict[str, Any]:
    """Apply the manifest's ``map`` block, producing Grimoire field values.

    Fields whose entries all resolve to nothing are omitted entirely rather than
    mapped to an empty value, so a sparse source never proposes blanking a field
    the user has already filled in.

    ``identity`` is exposed to templates as ``{identity}``, so a definition can
    map a link back to the source page even when the identity is derived rather
    than a field on the record.
    """
    out: dict[str, Any] = {}
    extra = {"identity": identity} if identity else None

    for field, mapping in manifest.map.items():
        entries = mapping if isinstance(mapping, list) else [mapping]
        collected: list[Any] = []

        for entry in entries:
            value = _entry_value(entry, record, extra)
            if value is None:
                if entry.when_present:
                    continue
                # A non-optional entry that resolved to nothing contributes
                # nothing; there is simply no data for it.
                continue
            shaped = _coerce(field, value, entry)
            if shaped is None or shaped == "" or shaped == []:
                continue
            if isinstance(shaped, list):
                collected.extend(shaped)
            else:
                collected.append(shaped)

        if not collected:
            continue

        if field in LIST_FIELDS or field in LINK_LIST_FIELDS or field == "publishers":
            out[field] = collected
        else:
            out[field] = collected[0]

    return out
