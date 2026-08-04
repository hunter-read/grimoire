"""Comparing fetched metadata against a game system's current values.

The non-destructive half of the feature. Fetching never writes: it reports, per
field, what the system has now and what the source offers, classified so the UI
can pre-select only the safe changes.

    only_incoming  the system has nothing here — safe to fill in
    differs        both have a value and they disagree — needs a human
    same           already matches — nothing to do
"""
from typing import Any, Union

from ..models import Book, GameSystem
from .manifest import INT_FIELDS, LINK_LIST_FIELDS, LIST_FIELDS

STATUS_SAME = "same"
STATUS_DIFFERS = "differs"
STATUS_ONLY_INCOMING = "only_incoming"


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, dict)):
        return len(value) == 0
    return False


def _normalise(field: str, value: Any) -> Any:
    """Reduce a value to a comparable form.

    Lists compare as case-insensitive sets, because order carries no meaning for
    genres or tags and a reordering is not a change worth showing the user.
    """
    if _is_empty(value):
        return None

    if field == "publishers":
        return frozenset(
            str(v.get("name", "")).strip().casefold()
            for v in value
            if isinstance(v, dict) and str(v.get("name", "")).strip()
        )

    if field in LINK_LIST_FIELDS:
        return frozenset(
            str(v.get("url", "")).strip().casefold()
            for v in value
            if isinstance(v, dict) and str(v.get("url", "")).strip()
        )

    if field in LIST_FIELDS:
        if not isinstance(value, list):
            value = [value]
        return frozenset(str(v).strip().casefold() for v in value if str(v).strip())

    if field in INT_FIELDS:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    return str(value).strip().casefold()


def _merge_links(current: Any, incoming: Any) -> list[dict]:
    """Union two link lists, keeping the user's own entries and ordering.

    Links are additive: a source offering its own page should *add* it, never
    replace whatever the user has already collected. Existing entries win on
    label, so a re-fetch cannot quietly relabel a link someone renamed.
    """
    merged: list[dict] = []
    seen: set[str] = set()

    for entry in list(current or []) + list(incoming or []):
        if not isinstance(entry, dict):
            continue
        url = str(entry.get("url", "")).strip()
        if not url:
            continue
        key = url.casefold()
        if key in seen:
            continue
        seen.add(key)
        merged.append({"label": str(entry.get("label", "")), "url": url})
    return merged


def build(
    resource: Union[GameSystem, Book],
    incoming: dict[str, Any],
    current_tags: Any = None,
) -> list[dict]:
    """Per-field comparison of ``incoming`` against a system or book.

    ``current_tags`` supplies the resource's tags, which live in the shared tag
    tables rather than a column on the model.
    """
    rows = []
    for field, new_value in incoming.items():
        if _is_empty(new_value):
            continue

        current = current_tags if field == "tags" else getattr(resource, field, None)

        if field in LINK_LIST_FIELDS:
            # Links accumulate rather than replace: applying must never drop a
            # link the user added themselves, so what is offered is the union.
            # Anything genuinely new then reads as "only_incoming" and is
            # pre-selected, which is the point — a source link should land
            # without the user having to opt in to overwriting their own list.
            merged = _merge_links(current, new_value)
            if _normalise(field, current) == _normalise(field, merged):
                status = STATUS_SAME
            else:
                status = STATUS_ONLY_INCOMING
            new_value = merged
        elif _is_empty(current):
            status = STATUS_ONLY_INCOMING
        elif _normalise(field, current) == _normalise(field, new_value):
            status = STATUS_SAME
        else:
            status = STATUS_DIFFERS

        rows.append(
            {
                "field": field,
                "current": None if _is_empty(current) else current,
                "incoming": new_value,
                "status": status,
            }
        )

    # Stable, useful ordering: things to fill in first, then conflicts, then
    # the already-correct fields the user can ignore.
    order = {STATUS_ONLY_INCOMING: 0, STATUS_DIFFERS: 1, STATUS_SAME: 2}
    rows.sort(key=lambda r: (order[r["status"]], r["field"]))
    return rows
