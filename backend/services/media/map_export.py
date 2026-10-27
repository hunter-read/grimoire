"""Building a map export (Universal VTT or an OTFBM background) from one picture.

Shared by the maps router's export routes and by share links, which serve an
OTFBM background without a signed-in user.
"""
import hashlib
import io
import os
import threading
from pathlib import Path
from typing import Optional

from fastapi import HTTPException

from ...config import PAGE_CACHE_DIR, logger
from ...indexer import MAP_OPAQUE_EXTS, archive_ext, is_vtt_data, slugify
from ...models import GenericMap
from .maps import (
    is_pdf,
    map_image_info,
    sniff_image_mime,
    vtt_image_bytes,
    vtt_image_size,
    vtt_metadata,
)
from .otfbm import MIN_SOURCE_PX, plan_otfbm, render_otfbm_image
from .uvtt import resolve_grid, round2


def has_single_raster(m: GenericMap) -> bool:
    """Whether a map is one still picture an export can be built from.

    A PDF, video or archive has no single raster to embed. A .uvtt *is* one of
    these files: its picture is inside the envelope, so it qualifies.
    """
    is_vtt = is_vtt_data(m.filename)
    opaque = Path(m.filepath).suffix.lower() in MAP_OPAQUE_EXTS
    return not (is_pdf(m.filepath) or archive_ext(m.filename) or (opaque and not is_vtt))


def export_grid(m: GenericMap, is_vtt: bool) -> tuple[dict, dict]:
    """Measure a map and resolve the grid an export uses: ``(info, grid)``.

    Shared by the Universal VTT and OTFBM exports so the two cannot disagree
    about a map's grid. 400s when the picture cannot be measured.
    """
    info = map_image_info(m.filepath, m.relative_path, (m.grid_width, m.grid_height, m.grid_px))
    # A .uvtt's raster is inside the envelope, so nothing at the path measures.
    if is_vtt and not info.get("pixel_width"):
        px_w, px_h = vtt_image_size(m.filepath)
        if px_w:
            info = {**info, "pixel_width": px_w, "pixel_height": px_h}
    if not info.get("pixel_width"):
        raise HTTPException(400, "Map image could not be read")
    grid = resolve_grid(m, info)
    # As in the authoring handler: the file's own cell size is what its geometry
    # was drawn against, so it wins over detection or a default.
    if is_vtt and grid["source"] != "manual":
        try:
            file_px = (vtt_metadata(m.filepath) or {}).get("pixels_per_grid")
        except ValueError:
            file_px = None
        # The same floor a manual grid has: a file claiming a sub-pixel cell
        # would otherwise scale the OTFBM background up by thousands.
        if isinstance(file_px, (int, float)) and file_px >= MIN_SOURCE_PX:
            grid = {
                "width": round2(info["pixel_width"] / file_px),
                "height": round2(info["pixel_height"] / file_px),
                "px": float(file_px),
                "source": "vtt",
            }
    return info, grid


def otfbm_filename(m: GenericMap, plan: dict, ext: str) -> str:
    """``<slug>-<W>x<H>c<cell>.<ext>``, after the convention shared OTFBM maps
    use, so the file says how to set it up wherever it ends up."""
    stem = slugify(Path(m.filename).stem) or "map"
    return f"{stem}-{plan['width']}x{plan['height']}c{plan['cell']}.{ext}"


def otfbm_plan(m: GenericMap, cell: Optional[int]) -> dict:
    """The OTFBM setup for a map. 400 for a map with no single picture."""
    if not has_single_raster(m):
        raise HTTPException(400, "Only image maps can be exported for OTFBM")
    info, grid = export_grid(m, is_vtt_data(m.filename))
    return plan_otfbm(grid, info["pixel_width"], info["pixel_height"], cell)


# One lock per cache file, so simultaneous cold fetches of the same background
# (a share link posted to a busy channel) render it once rather than once each.
# Handlers run in the threadpool, so a thread lock covers one worker process.
_render_locks: dict[str, threading.Lock] = {}


_render_locks_guard = threading.Lock()


def _render_lock(cache_path: str) -> threading.Lock:
    with _render_locks_guard:
        return _render_locks.setdefault(cache_path, threading.Lock())


def _read_cached(cache_path: str) -> Optional[tuple[bytes, str]]:
    if not os.path.exists(cache_path):
        return None
    with open(cache_path, "rb") as f:
        raw = f.read()
    return raw, "png" if sniff_image_mime(raw) == "image/png" else "jpg"


def otfbm_background(m: GenericMap, cell: Optional[int]) -> tuple[dict, bytes, str]:
    """``(plan, image bytes, extension)`` for a map's OTFBM background.

    Cached on disk, keyed on the file's mtime and the planned sizes, so a
    replaced file or a corrected grid renders afresh. The key is built from DB
    values only, never request input.
    """
    plan = otfbm_plan(m, cell)
    try:
        mtime = int(os.path.getmtime(m.filepath))
    except OSError:
        mtime = 0
    key = (
        f"{m.filepath}:{mtime}:{plan['image_width']}x{plan['image_height']}:"
        f"{plan['width']}x{plan['height']}c{plan['cell']}"
    )
    cache_path = os.path.join(
        PAGE_CACHE_DIR, f"otfbm_{hashlib.sha1(key.encode()).hexdigest()[:16]}.img"
    )
    cached = _read_cached(cache_path)
    if cached:
        return (plan, *cached)

    with _render_lock(cache_path):
        # Another request may have rendered it while this one waited.
        cached = _read_cached(cache_path)
        if cached:
            return (plan, *cached)
        try:
            source = (
                io.BytesIO(vtt_image_bytes(m.filepath)) if is_vtt_data(m.filename) else m.filepath
            )
            raw, ext = render_otfbm_image(source, plan["image_width"], plan["image_height"])
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        try:
            # Written aside and moved into place, so a request reading the cache
            # outside the lock never sees half a file.
            partial = f"{cache_path}.{os.getpid()}.{threading.get_ident()}.tmp"
            with open(partial, "wb") as f:
                f.write(raw)
            os.replace(partial, cache_path)
        except OSError as e:  # a full or read-only cache must not fail the export
            logger.warning(f"Could not cache OTFBM background: {e}")
    return plan, raw, ext
