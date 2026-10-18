"""OTFBM export (issue #551) - sizing a battlemap for Avrae's ``!map``.

OTFBM (On The Fly Battle Maps, otfbm.io) draws a battle grid as an image for
play-by-post games, most often through Avrae's ``!map`` alias on Discord. A map
with its own picture is set up with::

    !map -mapsize 33x24 -options c70 -bg https://example.com/tavern.jpg

What makes that fiddly by hand is that OTFBM draws the background at its native
resolution and lays its own grid over it at ``c`` pixels per cell. Nothing is
scaled to fit, so a 140px/cell battlemap under the default 40px grid lines up
with nothing, and players end up guessing cell sizes until it looks close. The
fix is to resize the picture until one of its cells is exactly ``c`` pixels;
this module works out that size from the map's grid, and does the resize.

The limits come from OTFBM's documentation and its own designer tool: a cell
size of 20-100 (default 40), at most 99 cells per side, and a background that
must be a .png/.jpg/.gif URL -- WebP is not supported. That URL has to be
somewhere OTFBM can fetch it, which a self-hosted Grimoire behind a login is
not, so the export is the resized picture plus the numbers for the command; the
user hosts the picture and supplies the URL.
"""
import io
import math
from typing import IO, Union, cast

from PIL import Image as PILImage  # type: ignore[import-untyped]

# OTFBM's accepted cell sizes, in pixels.
MIN_CELL = 20
MAX_CELL = 100

# The cell size suggested when the map's own cells are larger. Not OTFBM's 40,
# which makes a typical battlemap muddy, nor its 100 maximum, which turns every
# render of a large map into a multi-megapixel image to host and to post. 70 is
# what shared OTFBM maps commonly settle on, as their "...c70" filenames show.
SUGGESTED_CELL = 70

# The most cells OTFBM's column lettering (A..Z, AA..CU) covers per side.
MAX_MAPSIZE = 99

# How close to the next whole cell a fractional grid must be to round up.
# Battlemaps bleed a fraction of a cell past their grid, and that sliver is not
# a playable square -- 33.25 cells is a 33-cell map. Detection noise is the
# other direction: 32.97 is plainly 33, not 32.
_WHOLE_CELL_TOLERANCE = 0.1

# Quality for the JPEG background. The picture is downscaled for a Discord
# render, so 90 is visually lossless there while keeping the file small enough
# for the free image hosts OTFBM users rely on.
JPEG_QUALITY = 90


def whole_cells(cells: float) -> int:
    """A grid dimension as the whole number of cells ``-mapsize`` takes."""
    return max(1, min(MAX_MAPSIZE, math.floor(cells + _WHOLE_CELL_TOLERANCE)))


def suggest_cell(source_px: float) -> int:
    """The cell size to offer first for a map whose cells are ``source_px`` wide.

    Never larger than the map's own cells: upscaling adds file size and no
    detail. Never larger than SUGGESTED_CELL either, for the reasons given
    there, and never below what OTFBM accepts.
    """
    return max(MIN_CELL, min(SUGGESTED_CELL, round(source_px)))


def plan_otfbm(grid: dict, px_w: int, px_h: int, cell: Union[int, None] = None) -> dict:
    """Work out the OTFBM setup for a map.

    ``grid`` is a resolved export grid (``resolve_grid``): ``width``/``height``
    in cells, ``px`` the pixels per cell. ``cell`` is the cell size the user
    asked for, or None to use the suggestion. The background is resized by
    ``cell / px``, which makes each of the map's cells exactly ``cell`` pixels.

    ``truncated`` is set when the map has more cells than OTFBM can show; the
    grid is capped at 99 and the far edge of the map falls outside it.
    """
    source_px = float(grid["px"]) if grid.get("px") else 0.0
    if source_px <= 0:
        # resolve_grid always supplies a cell size; this only guards a caller
        # passing something else, so the arithmetic below cannot divide by 0.
        source_px = float(px_w) / max(float(grid.get("width") or 1), 1.0)
    suggested = suggest_cell(source_px)
    chosen = max(MIN_CELL, min(MAX_CELL, int(cell))) if cell else suggested
    scale = chosen / source_px
    width, height = whole_cells(grid["width"]), whole_cells(grid["height"])
    return {
        "width": width,
        "height": height,
        "cell": chosen,
        "suggested_cell": suggested,
        "source_px": round(source_px, 2),
        "grid_source": grid.get("source", "default"),
        "image_width": max(1, round(px_w * scale)),
        "image_height": max(1, round(px_h * scale)),
        "truncated": math.floor(grid["width"] + _WHOLE_CELL_TOLERANCE) > MAX_MAPSIZE
        or math.floor(grid["height"] + _WHOLE_CELL_TOLERANCE) > MAX_MAPSIZE,
        "min_cell": MIN_CELL,
        "max_cell": MAX_CELL,
    }


def _has_transparency(img: PILImage.Image) -> bool:
    """Whether a picture has pixels that are actually see-through.

    Checked on the pixels rather than the mode: plenty of battlemaps are saved
    as RGBA with a fully opaque alpha channel, and sending those as PNG would
    cost several times the size of a JPEG for nothing.
    """
    if img.mode == "P":
        return "transparency" in img.info
    if img.mode in ("RGBA", "LA", "PA"):
        # A single 8-bit band always reports (min, max) ints.
        extrema = cast(tuple[int, int], img.getchannel("A").getextrema())
        return extrema[0] < 255
    return False


def render_otfbm_image(
    source: Union[str, IO[bytes]], width: int, height: int
) -> tuple[bytes, str]:
    """Resize a map to the OTFBM background size; returns ``(bytes, extension)``.

    ``source`` is a file path, or a file object holding the picture decoded out
    of a ``.uvtt`` envelope. The result is a JPEG, or a PNG when the map has
    real transparency -- both formats OTFBM accepts, unlike the WebP the rest
    of Grimoire serves. Animated GIFs give their first frame.

    Raises ValueError when the picture cannot be decoded.
    """
    try:
        img: PILImage.Image  # convert()/resize() return a plain Image
        with PILImage.open(source) as img:
            transparent = _has_transparency(img)
            img = img.convert("RGBA" if transparent else "RGB")
            if img.size != (width, height):
                # reducing_gap makes a large downscale far cheaper -- a whole
                # battlemap shrinks to a Discord-sized picture here -- at no
                # visible cost against plain LANCZOS.
                img = img.resize((width, height), PILImage.Resampling.LANCZOS, reducing_gap=3.0)
            buf = io.BytesIO()
            if transparent:
                img.save(buf, format="png", optimize=True)
            else:
                img.save(buf, format="jpeg", quality=JPEG_QUALITY, optimize=True)
    except OSError as e:
        raise ValueError("Map image could not be read") from e
    return buf.getvalue(), "png" if transparent else "jpg"
