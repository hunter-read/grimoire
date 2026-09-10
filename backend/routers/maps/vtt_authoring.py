"""Authored Universal VTT geometry — validation, normalisation, export shaping.

Backs the in-app map editor (issues #126 and #127). The editor draws walls,
doors and lights over a raster map; this module is what the drawing is stored
as, and what turns it into the ``line_of_sight`` / ``portals`` / ``lights``
arrays of an exported ``.uvtt``.

Two decisions shape everything here.

**Nothing is ever written next to the user's map.** The library is routinely
mounted read-only, and a sidecar ``.uvtt`` beside every edited image would be
both unwritable and unwanted. Authored geometry lives in ``generic_maps
.vtt_data``; the export endpoint assembles a fresh file on demand.

**Geometry is stored in grid units, not pixels.** That is the unit the format
itself uses, so export is a copy rather than a conversion, and a re-detected
grid does not silently move every wall. The pixel-space conversion happens once,
in the editor, against ``pixels_per_grid`` — which is stored alongside the
geometry precisely because everything is scale-relative: replacing the source
image with a differently-sized copy would otherwise invalidate every wall with
no way to notice.

What the format cannot carry, and so is deliberately absent: wall thickness or
type, blocks-movement-but-not-sight, one-way or directional walls, secret or
locked doors, wall height, light animation, falloff curves, and the dim/bright
radius split (importers derive that themselves). Adding UI for any of it would
promise something no exported file could express.

Format reference: https://arkenforge.com/universal-vtt-files/
"""
import math
import re
from typing import Any, Optional

# The document revision stored in ``vtt_data["version"]``. Bumped only if the
# stored shape changes incompatibly, so a reader can tell what it is holding.
VTT_DOC_VERSION = 1

# Coordinates are in grid squares and may be fractional. The bound is a sanity
# limit, not a real one: no battlemap is 4000 cells across, and it keeps a
# corrupt or hostile payload from producing absurd geometry.
_MAX_COORD = 4000.0

# Lights: range is in grid squares (not pixels, and not feet). intensity has no
# agreed scale across VTTs -- Foundry, Roll20 and FGU each read it differently
# -- so it is stored as authored and exported verbatim rather than normalised.
_MAX_RANGE = 1000.0
_MAX_INTENSITY = 100.0

# Colours are 8-digit ARGB hex with no leading '#', alpha first: ``ffeccd8b`` is
# opaque warm yellow. Getting the channel order backwards is the single most
# common bug in UVTT tooling, so the stored form is normalised to exactly this.
_HEX8 = re.compile(r"^[0-9a-f]{8}$")
DEFAULT_LIGHT_COLOR = "ffffffff"
DEFAULT_AMBIENT_LIGHT = "00000000"

# Per-map caps. Generous enough for a dense dungeon, low enough that a runaway
# client cannot store an unbounded document.
MAX_POLYLINES = 5000
MAX_POINTS_PER_POLYLINE = 2000
MAX_PORTALS = 2000
MAX_LIGHTS = 2000


class VttDataError(ValueError):
    """A stored/submitted authoring document that cannot be accepted."""


def _num(value: Any, limit: float, field: str) -> float:
    """A finite number within +/- limit, rounded to the stored precision.

    bool is rejected explicitly: it is an int subclass in Python, and a stray
    ``true`` in a coordinate should be a hard error rather than silently 1.0.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise VttDataError(f"{field} must be a number")
    v = float(value)
    if v != v or v in (float("inf"), float("-inf")):
        raise VttDataError(f"{field} must be a finite number")
    if abs(v) > limit:
        raise VttDataError(f"{field} is out of range")
    # 4dp: at a 140px cell that is sub-pixel, so rounding never moves a wall
    # visibly, and it keeps stored documents compact.
    return round(v, 4)


def _point(value: Any, field: str) -> dict:
    if not isinstance(value, dict):
        raise VttDataError(f"{field} must be an object with x and y")
    return {"x": _num(value.get("x"), _MAX_COORD, f"{field}.x"),
            "y": _num(value.get("y"), _MAX_COORD, f"{field}.y")}


def _color(value: Any, default: str) -> str:
    """Normalise to bare 8-digit lowercase ARGB hex.

    Accepts what the editor and pasted values realistically carry: with or
    without '#', and 6-digit RGB (assumed fully opaque). Anything else is an
    error rather than a silent default -- a mistyped colour that exports as
    white is worse than one that refuses to save.
    """
    if value is None:
        return default
    if not isinstance(value, str):
        raise VttDataError("color must be a hex string")
    v = value.strip().lstrip("#").lower()
    if len(v) == 6:
        v = "ff" + v
    if not _HEX8.match(v):
        raise VttDataError("color must be 6- or 8-digit hex (ARGB, alpha first)")
    return v


def _bool(value: Any, default: bool) -> bool:
    return default if value is None else bool(value)


def _polyline(value: Any, field: str) -> list[dict]:
    """One wall run: an ordered list of points.

    A closed room is expressed by repeating the first point at the end, which is
    the format's own convention; nothing here closes it implicitly.
    """
    if not isinstance(value, list):
        raise VttDataError(f"{field} must be a list of points")
    if len(value) < 2:
        raise VttDataError(f"{field} needs at least two points")
    if len(value) > MAX_POINTS_PER_POLYLINE:
        raise VttDataError(f"{field} has too many points")
    return [_point(p, f"{field}[{i}]") for i, p in enumerate(value)]


def _polylines(value: Any, field: str) -> list[list[dict]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise VttDataError(f"{field} must be a list of polylines")
    if len(value) > MAX_POLYLINES:
        raise VttDataError(f"{field} has too many wall runs")
    return [_polyline(line, f"{field}[{i}]") for i, line in enumerate(value)]


def _portal(value: Any, field: str) -> dict:
    """A door or window.

    ``bounds`` -- the two endpoints of the door line -- is the load-bearing
    field: several importers ignore ``position`` entirely, and ``rotation`` is
    redundant with the bounds. All three are emitted on export, with position
    and rotation *derived* from bounds so they cannot disagree.

    ``closed`` is the door/window discriminator, exactly as Roll20 reads it:
    True is a door (blocks sight until opened), False a window (see-through).
    ``freestanding`` marks a portal not embedded in a wall.
    """
    if not isinstance(value, dict):
        raise VttDataError(f"{field} must be an object")
    bounds = value.get("bounds")
    if not isinstance(bounds, list) or len(bounds) != 2:
        raise VttDataError(f"{field}.bounds must be exactly two points")
    return {
        "bounds": [_point(b, f"{field}.bounds[{i}]") for i, b in enumerate(bounds)],
        "closed": _bool(value.get("closed"), True),
        "freestanding": _bool(value.get("freestanding"), False),
    }


def _light(value: Any, field: str) -> dict:
    if not isinstance(value, dict):
        raise VttDataError(f"{field} must be an object")
    return {
        "position": _point(value.get("position"), f"{field}.position"),
        "range": _num(value.get("range", 0), _MAX_RANGE, f"{field}.range"),
        "intensity": _num(value.get("intensity", 1), _MAX_INTENSITY, f"{field}.intensity"),
        "color": _color(value.get("color"), DEFAULT_LIGHT_COLOR),
        "shadows": _bool(value.get("shadows"), True),
    }


def _listed(value: Any, field: str, cap: int, fn: Any) -> list[dict]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise VttDataError(f"{field} must be a list")
    if len(value) > cap:
        raise VttDataError(f"{field} has too many entries")
    return [fn(item, f"{field}[{i}]") for i, item in enumerate(value)]


def normalize_vtt_data(payload: Any) -> Optional[dict]:
    """Validate and canonicalise an authoring document for storage.

    Returns None for an empty document -- nothing authored -- so clearing the
    editor stores NULL rather than a husk of empty arrays.

    Raises VttDataError with a specific message on anything malformed; the
    router turns that into a 400. Validation is strict on purpose: this is the
    only gate between a client payload and a file another program will parse.
    """
    if payload is None:
        return None
    if not isinstance(payload, dict):
        raise VttDataError("Universal VTT data must be an object")

    env = payload.get("environment")
    env = env if isinstance(env, dict) else {}
    offset = payload.get("grid_offset")
    offset = offset if isinstance(offset, dict) else {}

    doc = {
        "version": VTT_DOC_VERSION,
        # The grid the geometry was drawn against. Without it, a later grid
        # correction or a resized image would move every authored wall.
        "pixels_per_grid": _num(payload.get("pixels_per_grid", 0), 20000, "pixels_per_grid"),
        # Pixel offset of the grid's top-left intersection, from the calibration
        # step. Kept so re-opening the editor redraws the same overlay.
        "grid_offset": {
            "x": _num(offset.get("x", 0), 20000, "grid_offset.x"),
            "y": _num(offset.get("y", 0), 20000, "grid_offset.y"),
        },
        "line_of_sight": _polylines(payload.get("line_of_sight"), "line_of_sight"),
        # Kept distinct from walls rather than merged: importers treat them
        # differently (Roll20 makes these transparent barriers, not solid
        # walls), so furniture and pillars want their own tool.
        "objects_line_of_sight": _polylines(
            payload.get("objects_line_of_sight"), "objects_line_of_sight"
        ),
        "portals": _listed(payload.get("portals"), "portals", MAX_PORTALS, _portal),
        "lights": _listed(payload.get("lights"), "lights", MAX_LIGHTS, _light),
        "environment": {
            # True means the lighting is already painted into the image, and
            # importers may then ignore or dampen authored lights.
            "baked_lighting": _bool(env.get("baked_lighting"), False),
            "ambient_light": _color(env.get("ambient_light"), DEFAULT_AMBIENT_LIGHT),
        },
    }
    return None if is_empty_doc(doc) else doc


def is_empty_doc(doc: Optional[dict]) -> bool:
    """True when a document carries no authored content worth storing.

    Environment counts: a GM who only marks a map as baked-lit or sets an
    ambient colour has authored something real, even with no geometry.
    """
    if not doc:
        return True
    if any(
        doc.get(key)
        for key in ("line_of_sight", "objects_line_of_sight", "portals", "lights")
    ):
        return False
    env = doc.get("environment") or {}
    return not env.get("baked_lighting") and (
        env.get("ambient_light", DEFAULT_AMBIENT_LIGHT) == DEFAULT_AMBIENT_LIGHT
    )


def doc_counts(doc: Optional[dict]) -> dict:
    """Feature counts for the UI, without shipping the geometry itself."""
    doc = doc or {}
    return {
        "wall_count": len(doc.get("line_of_sight") or []),
        "object_wall_count": len(doc.get("objects_line_of_sight") or []),
        "portal_count": len(doc.get("portals") or []),
        "light_count": len(doc.get("lights") or []),
    }


def _portal_export(portal: dict) -> dict:
    """One portal in export form, with position and rotation derived.

    ``bounds`` is the truth. ``position`` is its midpoint and ``rotation`` the
    angle of the line in radians -- both emitted because exporters in the wild
    write all three and some importers read one or the other, and both derived
    so they can never contradict the bounds.
    """
    (a, b) = portal["bounds"]
    return {
        "position": {
            "x": round((a["x"] + b["x"]) / 2, 4),
            "y": round((a["y"] + b["y"]) / 2, 4),
        },
        "bounds": [dict(a), dict(b)],
        "rotation": round(math.atan2(b["y"] - a["y"], b["x"] - a["x"]), 6),
        "closed": bool(portal.get("closed", True)),
        "freestanding": bool(portal.get("freestanding", False)),
    }


def export_features(doc: Optional[dict]) -> dict:
    """The authored feature arrays, shaped for the Universal VTT envelope.

    Returns the empty-but-present arrays a file needs when nothing is authored,
    so the envelope shape does not depend on whether a map has been edited.
    """
    doc = doc or {}
    env = doc.get("environment") or {}
    return {
        "line_of_sight": [
            [dict(p) for p in line] for line in (doc.get("line_of_sight") or [])
        ],
        "objects_line_of_sight": [
            [dict(p) for p in line] for line in (doc.get("objects_line_of_sight") or [])
        ],
        "portals": [_portal_export(p) for p in (doc.get("portals") or [])],
        "lights": [
            {
                "position": dict(light["position"]),
                "range": light["range"],
                "intensity": light["intensity"],
                "color": light["color"],
                "shadows": bool(light.get("shadows", True)),
            }
            for light in (doc.get("lights") or [])
        ],
        "environment": {
            "baked_lighting": bool(env.get("baked_lighting", False)),
            "ambient_light": env.get("ambient_light") or DEFAULT_AMBIENT_LIGHT,
        },
    }
