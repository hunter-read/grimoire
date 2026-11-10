"""The GM screen's panels: what each kind holds, and cleaning what a client sends.

A GM screen is a board of panels on a snap grid, one board per campaign. Every
panel is one of a closed set of built-in tools, and nothing about a game is
named here: a Daggerheart board is a counter titled "Fear" and a list of
countdowns, a Draw Steel one an initiative tracker whose sides take turns. Game
specifics arrive as presets - community add-ons that are data only (see
``presets.py``) - and are configured through the same fields a GM sets by hand.

Each panel carries two documents:

* ``config`` - how the tool is set up: a counter's range, which stats the party
  overview shows, whether it clears at the end of a scene. Copied with a board.
* ``state`` - what is on it now: the counter's value, the countdowns and their
  ticks, the turn order. Reset to defaults when a board is copied.

Both arrive from a client or a downloaded preset, so both are rebuilt here from
the keys each kind declares, with every value bounded. Cleaning is forgiving -
an unreadable value becomes the default rather than an error - because a GM in
the middle of a session should never lose a board over one bad number. The one
thing that is refused is a kind that does not exist.
"""
import re
import uuid
from typing import Any, Optional

__all__ = [
    "PanelError",
    "KINDS",
    "GRID_COLUMNS",
    "RESET_SCOPES",
    "MAX_PANELS",
    "clean_config",
    "clean_state",
    "clean_geometry",
    "clean_title",
    "overlaps",
    "default_size",
    "place",
    "reset_state",
    "scopes_cleared_by",
]


class PanelError(ValueError):
    """A panel names a kind that does not exist, or a board is malformed."""


#: The tools a board can hold.
KINDS: tuple[str, ...] = (
    "note",        # a campaign note pinned to the board
    "party",       # one card per character, showing the stats the GM picks
    "counter",     # one number: Fear, Malice, a doom track
    "clocks",      # countdowns and progress clocks, each a row of boxes
    "pools",       # named token pools, each stepped up and down
    "scratch",     # the GM's own jottings
    "initiative",  # turn order, by score or by sides taking turns
)

#: The grid is twelve columns wide; rows are as many as the board needs.
GRID_COLUMNS = 12
MAX_ROWS = 200
MAX_HEIGHT = 40
#: A board is one screen of tools, not a database. Far above any real board.
MAX_PANELS = 60

#: When a panel's contents clear. Ending a session ends its scene too, so
#: "session" also clears what clears with a scene; a rest is its own thing.
RESET_SCOPES: tuple[str, ...] = ("scene", "session", "rest")

MAX_TITLE = 120
MAX_LABEL = 60
MAX_NAME = 120
MAX_NOTE = 500
MAX_TEXT = 20_000
MAX_ITEMS = 50
MAX_COMBATANTS = 100
MAX_STATS = 12
MAX_SIDES = 4
MAX_BOXES = 30
MAX_COUNT = 9999

_ITEM_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_FIELD_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,99}$")
_SIDE_KEY = re.compile(r"^[a-z0-9_-]{1,30}$")

#: Where a new panel of each kind starts, in grid cells.
_DEFAULT_SIZES: dict[str, tuple[int, int]] = {
    "note": (4, 8),
    "party": (12, 4),
    "counter": (3, 3),
    "clocks": (4, 6),
    "pools": (4, 5),
    "scratch": (4, 6),
    "initiative": (4, 8),
}

#: The two sides an initiative tracker starts with when its sides take turns.
_DEFAULT_SIDES = [{"key": "heroes", "label": "Heroes"}, {"key": "foes", "label": "Foes"}]


# --- primitives ------------------------------------------------------------


def _text(value: Any, limit: int) -> str:
    if value is None or isinstance(value, (dict, list)):
        return ""
    return str(value).strip()[:limit]


def _int(value: Any, default: int, low: int, high: int) -> int:
    """A whole number within bounds; anything unreadable is the default."""
    if isinstance(value, bool):
        return default
    try:
        number = int(float(value))
    except (TypeError, ValueError, OverflowError):
        return default
    return max(low, min(high, number))


def _optional_int(value: Any, low: int, high: int) -> Optional[int]:
    if value in (None, ""):
        return None
    number = _int(value, low - 1, low - 1, high)
    return None if number < low else number


def _bool(value: Any) -> bool:
    return value is True


def _choice(value: Any, options: tuple[str, ...], default: str) -> str:
    return value if isinstance(value, str) and value in options else default


def _resets(value: Any) -> str:
    """When something clears: one of the reset scopes, or "" for never."""
    return _choice(value, RESET_SCOPES, "")


def _item_id(value: Any) -> str:
    """A row's id: kept when it is a plain token, so a client can address it."""
    if isinstance(value, str) and _ITEM_ID.match(value):
        return value
    return uuid.uuid4().hex[:12]


def _rows(value: Any, limit: int) -> list[dict]:
    if not isinstance(value, list):
        return []
    return [row for row in value[:limit] if isinstance(row, dict)]


def _unique_ids(rows: list[dict]) -> list[dict]:
    """Rows with a repeated id given a fresh one, so each stays addressable."""
    seen: set[str] = set()
    for row in rows:
        if row["id"] in seen:
            row["id"] = uuid.uuid4().hex[:12]
        seen.add(row["id"])
    return rows


# --- config ----------------------------------------------------------------


def _note_config(raw: dict) -> dict:
    # `page_id` names a page in this campaign, which the router checks; a
    # preset or a copied board names it by `page_slug` instead, since ids do
    # not travel between campaigns.
    page_id = raw.get("page_id")
    return {
        "page_id": page_id if isinstance(page_id, str) and _ITEM_ID.match(page_id) else None,
        "page_slug": _text(raw.get("page_slug"), 255),
    }


def _stat(raw: dict) -> Optional[dict]:
    value = raw.get("value")
    if not isinstance(value, str) or not _FIELD_NAME.match(value):
        return None
    # `max` is a field or computed name, or a number: the boxes a track has.
    maximum = raw.get("max")
    if isinstance(maximum, str) and _FIELD_NAME.match(maximum):
        max_value: Any = maximum
    else:
        max_value = _optional_int(maximum, 1, MAX_BOXES)
    return {
        "label": _text(raw.get("label"), MAX_LABEL) or value,
        "value": value,
        "max": max_value,
        "style": _choice(raw.get("style"), ("number", "pips"), "number"),
    }


def _party_config(raw: dict) -> dict:
    stats = [stat for stat in (_stat(row) for row in _rows(raw.get("stats"), MAX_STATS)) if stat]
    return {"stats": stats, "include_inactive": _bool(raw.get("include_inactive"))}


def _counter_config(raw: dict) -> dict:
    low = _int(raw.get("min"), 0, -MAX_COUNT, MAX_COUNT)
    high = _optional_int(raw.get("max"), low, MAX_COUNT)
    start = _int(raw.get("start"), low, low, high if high is not None else MAX_COUNT)
    style = _choice(raw.get("style"), ("number", "pips"), "number")
    if style == "pips" and (high is None or high - low > MAX_BOXES):
        # Boxes need a top, and a row of more than thirty is not a track.
        style = "number"
    return {"min": low, "max": high, "start": start, "style": style, "resets": _resets(raw.get("resets"))}


def _clocks_config(raw: dict) -> dict:
    # A countdown says how many boxes are left; a clock how many are filled.
    return {"mode": _choice(raw.get("mode"), ("countdown", "clock"), "countdown")}


def _pools_config(raw: dict) -> dict:
    return {"resets": _resets(raw.get("resets"))}


def _sides(raw: Any) -> list[dict]:
    sides: list[dict] = []
    for row in _rows(raw, MAX_SIDES):
        key = row.get("key")
        if isinstance(key, str) and _SIDE_KEY.match(key) and key not in {s["key"] for s in sides}:
            sides.append({"key": key, "label": _text(row.get("label"), MAX_LABEL) or key})
    return sides if len(sides) >= 2 else [dict(side) for side in _DEFAULT_SIDES]


def _initiative_config(raw: dict) -> dict:
    # `ordered`: one turn after another, highest score first. `sides`: the
    # sides take turns and each combatant is marked once it has acted, until
    # the next round clears the marks.
    mode = _choice(raw.get("mode"), ("ordered", "sides"), "ordered")
    return {
        "mode": mode,
        "sides": _sides(raw.get("sides")),
        "resets": _resets(raw.get("resets")),
    }


_CONFIG = {
    "note": _note_config,
    "party": _party_config,
    "counter": _counter_config,
    "clocks": _clocks_config,
    "pools": _pools_config,
    "scratch": lambda raw: {},
    "initiative": _initiative_config,
}


def _check_kind(kind: Any) -> str:
    if kind not in KINDS:
        raise PanelError(f"Unknown panel kind {kind!r} (expected one of: {', '.join(KINDS)})")
    return kind


def clean_config(kind: str, raw: Any) -> dict:
    """A panel's config, rebuilt from the keys its kind declares."""
    return _CONFIG[_check_kind(kind)](raw if isinstance(raw, dict) else {})


# --- state -----------------------------------------------------------------


def _counter_state(raw: dict, config: dict) -> dict:
    high = config["max"] if config["max"] is not None else MAX_COUNT
    return {"value": _int(raw.get("value"), config["start"], config["min"], high)}


def _clock(raw: dict) -> dict:
    size = _int(raw.get("size"), 4, 1, MAX_BOXES)
    return {
        "id": _item_id(raw.get("id")),
        "name": _text(raw.get("name"), MAX_NAME),
        "size": size,
        "ticks": _int(raw.get("ticks"), 0, 0, size),
        "note": _text(raw.get("note"), MAX_NOTE),
        "resets": _resets(raw.get("resets")),
        # A looping countdown starts again once it triggers.
        "loops": _bool(raw.get("loops")),
    }


def _clocks_state(raw: dict, config: dict) -> dict:
    return {"items": _unique_ids([_clock(row) for row in _rows(raw.get("items"), MAX_ITEMS)])}


def _pool(raw: dict) -> dict:
    return {
        "id": _item_id(raw.get("id")),
        "name": _text(raw.get("name"), MAX_NAME),
        "tokens": _int(raw.get("tokens"), 0, 0, MAX_COUNT),
        "note": _text(raw.get("note"), MAX_NOTE),
    }


def _pools_state(raw: dict, config: dict) -> dict:
    return {"items": _unique_ids([_pool(row) for row in _rows(raw.get("items"), MAX_ITEMS)])}


def _combatant(raw: dict, sides: list[str]) -> dict:
    score = raw.get("score")
    character_id = raw.get("character_id")
    return {
        "id": _item_id(raw.get("id")),
        "name": _text(raw.get("name"), MAX_NAME),
        "score": None if score in (None, "") else _int(score, 0, -MAX_COUNT, MAX_COUNT),
        "side": _choice(raw.get("side"), tuple(sides), sides[0]),
        "acted": _bool(raw.get("acted")),
        "note": _text(raw.get("note"), MAX_NOTE),
        # A party member added from the campaign, so the tracker can show
        # their portrait; a monster has none.
        "character_id": character_id
        if isinstance(character_id, str) and _ITEM_ID.match(character_id)
        else None,
    }


def _initiative_state(raw: dict, config: dict) -> dict:
    sides = [side["key"] for side in config["sides"]]
    entries = _unique_ids(
        [_combatant(row, sides) for row in _rows(raw.get("entries"), MAX_COMBATANTS)]
    )
    return {
        "round": _int(raw.get("round"), 1, 1, MAX_COUNT),
        # Ordered mode: whose turn it is, by position in `entries`.
        "turn": _int(raw.get("turn"), 0, 0, max(0, len(entries) - 1)),
        # Sides mode: which side acts next, and which acts first each round.
        "side": _choice(raw.get("side"), tuple(sides), sides[0]),
        "first": _choice(raw.get("first"), tuple(sides), sides[0]),
        "entries": entries,
    }


def _scratch_text(value: Any) -> str:
    # Not stripped: the GM's own line breaks and indentation are the note.
    return value[:MAX_TEXT] if isinstance(value, str) else ""


_STATE = {
    "note": lambda raw, config: {},
    "party": lambda raw, config: {},
    "counter": _counter_state,
    "clocks": _clocks_state,
    "pools": _pools_state,
    "scratch": lambda raw, config: {"text": _scratch_text(raw.get("text"))},
    "initiative": _initiative_state,
}


def clean_state(kind: str, raw: Any, config: dict) -> dict:
    """A panel's state, rebuilt and bounded against its (already clean) config."""
    return _STATE[_check_kind(kind)](raw if isinstance(raw, dict) else {}, config)


# --- resets ----------------------------------------------------------------


def scopes_cleared_by(scope: str) -> frozenset[str]:
    """The reset scopes one button clears: ending a session ends its scene."""
    if scope not in RESET_SCOPES:
        raise PanelError(f"Unknown reset {scope!r} (expected one of: {', '.join(RESET_SCOPES)})")
    return frozenset({"scene", "session"}) if scope == "session" else frozenset({scope})


def reset_state(kind: str, config: dict, state: dict, scope: str) -> Optional[dict]:
    """The panel's state after ``scope`` ends, or None when it is unaffected.

    What clears is what the GM marked: a counter back to its start, a
    countdown's ticks, a pool's tokens (the pools themselves stay set up), and
    an initiative tracker's combatants once the fight is over.
    """
    cleared = scopes_cleared_by(scope)
    if kind == "counter" and config.get("resets") in cleared:
        return {"value": config["start"]}
    if kind == "pools" and config.get("resets") in cleared:
        return {"items": [{**item, "tokens": 0} for item in state.get("items", [])]}
    if kind == "clocks":
        items = state.get("items", [])
        if not any(item.get("resets") in cleared for item in items):
            return None
        return {
            "items": [
                {**item, "ticks": 0} if item.get("resets") in cleared else item for item in items
            ]
        }
    if kind == "initiative" and config.get("resets") in cleared:
        return clean_state(kind, {}, config)
    return None


# --- geometry --------------------------------------------------------------


def clean_title(value: Any) -> str:
    return _text(value, MAX_TITLE)


def default_size(kind: str) -> tuple[int, int]:
    return _DEFAULT_SIZES[_check_kind(kind)]


def clean_geometry(x: Any, y: Any, w: Any, h: Any, kind: str) -> dict:
    """A panel's cell on the grid, kept inside the board's twelve columns."""
    default_w, default_h = default_size(kind)
    width = _int(w, default_w, 1, GRID_COLUMNS)
    return {
        "x": _int(x, 0, 0, GRID_COLUMNS - width),
        "y": _int(y, 0, 0, MAX_ROWS),
        "w": width,
        "h": _int(h, default_h, 1, MAX_HEIGHT),
    }


def overlaps(a: dict, b: dict) -> bool:
    return (
        a["x"] < b["x"] + b["w"]
        and b["x"] < a["x"] + a["w"]
        and a["y"] < b["y"] + b["h"]
        and b["y"] < a["y"] + a["h"]
    )


def place(taken: list[dict], w: int, h: int) -> dict:
    """The first free cell for a ``w`` x ``h`` panel, reading the board top to bottom.

    A new panel goes into the first gap it fits rather than below everything,
    so a board that lost a panel fills the hole back in.
    """
    width = max(1, min(GRID_COLUMNS, w))
    bottom = max((cell["y"] + cell["h"] for cell in taken), default=0)
    for y in range(0, bottom + 1):
        for x in range(0, GRID_COLUMNS - width + 1):
            candidate = {"x": x, "y": y, "w": width, "h": h}
            if not any(overlaps(candidate, cell) for cell in taken):
                return candidate
    return {"x": 0, "y": bottom, "w": width, "h": h}
