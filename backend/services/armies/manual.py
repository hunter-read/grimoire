"""Hand-built army lists: validating what the army builder sends.

An army entered by hand has the same document shape as an imported roster
(``battlescribe.parse_roster``), trimmed to what a person types: forces of units
with a name, a model count, points and categories. Stat lines and rules belong
to rosters; a hand-built list cites its books through notes.
"""
from __future__ import annotations

import uuid
from typing import Any

MAX_UNITS = 500
MAX_TEXT = 500


class ManualListError(ValueError):
    """The submitted list is malformed. The message says where."""


def _text(value: Any, field: str, limit: int = MAX_TEXT) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ManualListError(f"{field} must be text")
    return value.strip()[:limit]


def _unit(raw: Any, cost_name: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ManualListError("Each unit must be an object")
    name = _text(raw.get("name"), "A unit's name")
    if not name:
        raise ManualListError("Every unit needs a name")
    try:
        number = max(1, int(raw.get("number") or 1))
        points = max(0, int(raw.get("points") or 0))
    except (TypeError, ValueError) as exc:
        raise ManualListError(f"{name}: model count and points must be numbers") from exc
    categories = raw.get("categories") or []
    if not isinstance(categories, list):
        raise ManualListError(f"{name}: categories must be a list")
    return {
        "id": _text(raw.get("id"), "A unit's id", 64) or uuid.uuid4().hex,
        "name": name,
        "type": "unit",
        "number": number,
        "costs": [{"name": cost_name, "value": points}],
        "categories": [_text(c, "A category", 100) for c in categories if c],
        "primary_category": _text(raw.get("category") or "", "A category", 100),
        "profiles": [],
        "rules": [],
        "publication": "",
        "page": "",
        "notes": _text(raw.get("notes"), "A unit's notes", 2000),
        "children": [],
    }


def build_manual(units: Any, cost_name: str = "pts") -> dict[str, Any]:
    """The army document for a hand-built list of units."""
    if not isinstance(units, list):
        raise ManualListError("units must be a list")
    if len(units) > MAX_UNITS:
        raise ManualListError(f"A list holds at most {MAX_UNITS} units")
    built = [_unit(u, cost_name) for u in units]
    return {
        "format": "manual",
        "name": "",
        "game_system_id": "",
        "game_system_name": "",
        "costs": [{"name": cost_name, "value": sum(u["costs"][0]["value"] for u in built)}],
        "cost_limits": [],
        "forces": [
            {
                "id": "manual",
                "name": "",
                "catalogue": "",
                "catalogue_id": "",
                "units": built,
                "forces": [],
            }
        ],
    }
