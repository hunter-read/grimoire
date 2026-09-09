"""Universal VTT export — grid resolution, plausibility checks, envelope building.

Kept out of ``_helpers.py``: that module is already the image-metadata and
VTT-reading surface, and export is a distinct concern with its own rules.

The shapes here were checked against a library of 580 Dungeondraft-exported
``.uvtt`` files, which were unanimous: ``format`` 0.3, ``map_origin`` at the
origin, and the embedded image encoded as WebP rather than the PNG the format
is usually described as carrying.
"""
import base64
import io
from typing import Any, Optional

from PIL import Image as PILImage  # type: ignore[import-untyped]

# The ``format`` value every real exporter writes.
UVTT_FORMAT = 0.3

# Fallback cell size when nothing can be detected and the user has set no
# override. 140 rather than the 70 that is often quoted: 140px/cell is what
# current battlemap packs actually ship.
DEFAULT_PIXELS_PER_GRID = 140

# WebP tops out at 16383px per side. Larger maps are downscaled to fit rather
# than failing the export outright; the grid is expressed in cells, so it stays
# correct under scaling.
WEBP_MAX_DIM = 16383

# Encoder settings, chosen by measuring a 4620x6440 battlemap. method rises in
# cost far faster than it pays back: 2 encodes in ~1.3s, while 4 takes ~7.8s to
# land within a few percent of the same size. quality 90 is deliberately avoided
# -- at the fast methods it overflows libwebp's first partition on large
# detailed maps and fails outright, and 85 is visually indistinguishable here.
WEBP_QUALITY = 85
WEBP_METHOD = 2

# How far the two axes' implied cell sizes may diverge before the entered grid
# is called suspicious. A transposed or mistyped digit (23x24 for 33x24) skews
# one axis badly; a partial-cell bleed moves both together and stays well under.
_ASPECT_TOLERANCE = 0.12


def round2(value: float) -> float:
    """Round to 2dp, the stored precision for grid dimensions."""
    return round(float(value), 2)


def resolve_grid(map_row: Any, img_info: dict) -> dict:
    """Grid to export for a map: manual override, else detection, else default.

    Returns ``{"width", "height", "px", "source"}``. ``width``/``height`` are in
    cells and may be fractional; ``px`` is pixels per cell.
    """
    gw, gh, gpx = map_row.grid_width, map_row.grid_height, map_row.grid_px
    pw, ph = img_info.get("pixel_width"), img_info.get("pixel_height")

    if gw and gh:
        # An override may set only the cell counts; derive px from the raster
        # when it was not given, so the export stays self-consistent.
        px = gpx or (round2(pw / gw) if pw else DEFAULT_PIXELS_PER_GRID)
        return {"width": round2(gw), "height": round2(gh), "px": px, "source": "manual"}

    detected = img_info.get("grid")
    if detected:
        px = detected.get("cell_px")
        if not px and pw and detected.get("width"):
            px = round2(pw / detected["width"])
        return {
            "width": round2(detected["width"]),
            "height": round2(detected["height"]),
            "px": px or DEFAULT_PIXELS_PER_GRID,
            "source": detected.get("source", "computed"),
        }

    # Nothing detected: divide the raster by the default cell size so the export
    # still describes the map's real extent.
    px = DEFAULT_PIXELS_PER_GRID
    return {
        "width": round2(pw / px) if pw else 0.0,
        "height": round2(ph / px) if ph else 0.0,
        "px": px,
        "source": "default",
    }


def check_grid_plausible(
    px_w: Optional[int], px_h: Optional[int], grid_w: float, grid_h: float
) -> Optional[dict]:
    """Flag a grid that does not look right for the raster, or None if it does.

    Advisory only — the caller saves the value either way. Maps legitimately
    bleed a fraction of a cell past the grid, so divisibility is not the test:
    what gives away a typo is the two axes disagreeing about the cell size.
    A 4620x3360 map entered as 33x24 implies 140.0 x 140.0 and passes; entered
    as 23x24 it implies 200.9 x 140.0, and that 43% divergence is the tell.
    """
    if not px_w or not px_h or grid_w <= 0 or grid_h <= 0:
        return None
    cell_x = px_w / grid_w
    cell_y = px_h / grid_h
    larger = max(cell_x, cell_y)
    if larger <= 0:
        return None
    divergence = abs(cell_x - cell_y) / larger
    if divergence <= _ASPECT_TOLERANCE:
        return None
    return {
        "code": "aspect_mismatch",
        "cell_x": round2(cell_x),
        "cell_y": round2(cell_y),
        "divergence": round2(divergence * 100),
        # What the raster would imply if the other axis is the correct one.
        "suggested_width": round2(px_w / cell_y),
        "suggested_height": round2(px_h / cell_x),
    }


def encode_map_image(filepath: str, quality: int = WEBP_QUALITY) -> str:
    """Encode a raster map as base64 WebP for the ``image`` field.

    WebP because that is what real ``.uvtt`` files carry, and it is a fraction
    of PNG's size before base64 adds its own third on top. Transparency is
    preserved -- a map exported with an alpha channel keeps it.

    Quality is stepped down on ``PARTITION0_OVERFLOW``: libwebp caps the size of
    a frame's first partition, and a large, highly detailed battlemap can exceed
    it at high quality and fail to encode at all. Dropping quality shrinks the
    partition, so a map that cannot be encoded at 85 still exports rather than
    erroring.
    """
    with PILImage.open(filepath) as img:
        if img.mode == "P":
            img = img.convert("RGBA" if "transparency" in img.info else "RGB")
        elif img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if img.mode in ("LA", "PA") else "RGB")
        if img.width > WEBP_MAX_DIM or img.height > WEBP_MAX_DIM:
            scale = WEBP_MAX_DIM / max(img.width, img.height)
            img = img.resize(
                (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
                PILImage.LANCZOS,
            )
        raw = None
        for attempt_q in (quality, 75, 65):
            buf = io.BytesIO()
            try:
                img.save(buf, format="webp", quality=attempt_q, method=WEBP_METHOD)
            except (ValueError, OSError):
                continue
            raw = buf.getvalue()
            break
        if raw is None:
            raise ValueError("Map image could not be encoded as WebP")
    return base64.b64encode(raw).decode("ascii")


def build_uvtt(filepath: str, grid: dict) -> dict:
    """Assemble the Universal VTT envelope for a raster map.

    Walls, portals and lights are empty: this export carries the image and the
    grid, and authoring those features is the future work tracked under #123.
    """
    return {
        "format": UVTT_FORMAT,
        "resolution": {
            "map_origin": {"x": 0, "y": 0},
            "map_size": {"x": grid["width"], "y": grid["height"]},
            "pixels_per_grid": grid["px"],
        },
        "line_of_sight": [],
        "objects_line_of_sight": [],
        "portals": [],
        "environment": {"baked_lighting": False, "ambient_light": "00000000"},
        "lights": [],
        "image": encode_map_image(filepath),
    }
