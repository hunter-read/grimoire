"""Image metadata helpers for map endpoints."""
import base64
import binascii
import hashlib
import json
import io
import os
import re
from pathlib import Path
from typing import Any, Optional

import fitz  # type: ignore[import-untyped]
from PIL import Image as PILImage  # type: ignore[import-untyped]

from ...config import PAGE_CACHE_DIR, _valkey, logger, valkey_cache_set
from ...indexer import MAP_OPAQUE_EXTS, VTT_DATA_EXTS, archive_ext, map_video_mime
from ..books._helpers import _get_pdf_doc, note_page_render


# Universal VTT exports are JSON envelopes; serving them as application/json
# lets the viewer fetch and parse them directly instead of downloading a blob.
_VTT_MIME = "application/json"


def _is_pdf(filepath: str) -> bool:
    return Path(filepath).suffix.lower() == ".pdf"


def _map_media_type(filepath: str) -> str:
    """Content type for a non-archive map file.

    Videos and VTT data need real MIME types — the old ``f"image/{ext}"`` guess
    produced "image/webm"/"image/uvtt", which no browser will play or parse.
    """
    ext = Path(filepath).suffix.lower()
    if ext == ".pdf":
        return "application/pdf"
    video = map_video_mime(ext)
    if video:
        return video
    if ext in VTT_DATA_EXTS:
        return _VTT_MIME
    if ext == ".jpg":
        return "image/jpeg"
    if ext == ".svg":
        return "image/svg+xml"
    if ext == ".tif":
        return "image/tiff"
    return f"image/{ext.lstrip('.')}"


def render_map_pdf_page(filepath: str, page_num: int, width: int) -> bytes:
    """Render one PDF map page to WebP bytes, caching to Valkey/disk like books.

    Mirrors ``books.pages.serve_book_page`` rendering (PyMuPDF → WebP) but without
    the book-specific text/word extraction. ``page_num`` is 1-based.
    """
    valkey_key = f"mappage:{filepath}:{page_num}:{width}"
    if _valkey is not None:
        try:
            cached = _valkey.get(valkey_key)
            if cached:
                return cached
        except Exception as e:
            logger.warning(f"Valkey get error: {e}")

    # Derive cache filename from the DB-sourced filepath (never user input) so no
    # tainted data touches the filesystem path.
    file_hash = hashlib.sha1(filepath.encode()).hexdigest()[:16]
    cache_path = os.path.join(PAGE_CACHE_DIR, f"map_{file_hash}_{page_num}_{width}.webp")
    if os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            data = f.read()
        valkey_cache_set(valkey_key, data)
        return data

    doc = _get_pdf_doc(filepath)
    if page_num < 1 or page_num > len(doc):
        raise ValueError(f"Page must be between 1 and {len(doc)}")
    page = doc[page_num - 1]
    zoom = width / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    buf = io.BytesIO()
    PILImage.frombytes("RGB", (pix.width, pix.height), pix.samples).save(
        buf, format="webp", quality=85, method=0
    )
    img_bytes = buf.getvalue()
    # Shares the books' reclaim counter: both paths rasterize through the same
    # process-global MuPDF store, so they must be accounted for together.
    del pix
    note_page_render()

    if not valkey_cache_set(valkey_key, img_bytes):
        with open(cache_path, "wb") as f:
            f.write(img_bytes)

    return img_bytes


# Matches: (20x25), [30 by 40], 20x25, 20 X 25, 20×25, 20 by 25, 20-by-25
_DIM_RE = re.compile(r"[\(\[]?\b(\d{1,3})\s*(?:[xX×]|(?:[Bb][Yy])|-[Bb][Yy]-)\s*(\d{1,3})\b[\)\]]?")


def _parse_grid_dims(text: str) -> Optional[tuple[int, int]]:
    m = _DIM_RE.search(text)
    if m:
        w, h = int(m.group(1)), int(m.group(2))
        if 2 <= w <= 300 and 2 <= h <= 300:
            return w, h
    return None


def _estimate_grid(
    px_w: int, px_h: int, dpi: Optional[float] = None
) -> Optional[tuple[int, int, int]]:
    """Return (grid_w, grid_h, cell_px) for the best-fitting common cell size."""
    candidates = [50, 70, 100, 140, 150, 200, 250, 300]
    if dpi and int(dpi) not in candidates:
        candidates.append(int(dpi))
    best: Optional[tuple[int, int, int]] = None
    best_err = 0.06
    for cell in sorted(candidates):
        wc = px_w / cell
        hc = px_h / cell
        err = (abs(wc - round(wc)) + abs(hc - round(hc))) / 2
        if err < best_err and round(wc) >= 2 and round(hc) >= 2:
            best_err = err
            best = (round(wc), round(hc), cell)
    return best


def _map_image_info(filepath: str, relative_path: str) -> dict:
    ext = Path(filepath).suffix.lower()
    info: dict = {
        "pixel_width": None,
        "pixel_height": None,
        "dpi": None,
        "grid": None,
        "is_pdf": False,
        "page_count": None,
        # Which viewer the frontend should mount. "image" is the default raster
        # pane; "video" and "vtt" are the animated/Universal-VTT formats.
        "media_kind": (
            "video" if map_video_mime(ext) else "vtt" if ext in VTT_DATA_EXTS else "image"
        ),
    }
    # Archives are opaque blobs — no raster to measure and no grid to infer.
    if archive_ext(filepath):
        info["media_kind"] = "archive"
        return info
    # Videos and VTT envelopes carry no still raster Pillow can measure here; the
    # VTT viewer reports the real pixel size once it parses the embedded image.
    if ext in MAP_OPAQUE_EXTS:
        return info
    if _is_pdf(filepath):
        info["is_pdf"] = True
        try:
            doc = _get_pdf_doc(filepath)
            info["page_count"] = len(doc)
            if len(doc):
                rect = doc[0].rect
                # PDF user-space units are 1/72". Report page-1 pixel size at 72
                # DPI (i.e. the point dimensions) so grid detection can run.
                info["pixel_width"] = round(rect.width)
                info["pixel_height"] = round(rect.height)
                info["dpi"] = 72
        except Exception:
            return info
    else:
        try:
            img = PILImage.open(filepath)
            info["pixel_width"], info["pixel_height"] = img.size
            raw_dpi = img.info.get("dpi")
            if raw_dpi:
                dpi_val = (
                    float(raw_dpi[0]) if isinstance(raw_dpi, (tuple, list)) else float(raw_dpi)
                )
                if 10 < dpi_val < 2000:
                    info["dpi"] = round(dpi_val)
            img.close()
        except Exception:
            return info

    pw, ph = info["pixel_width"], info["pixel_height"]

    # 1. Parse grid dimensions from filename and folder names
    for part in reversed(Path(relative_path).parts):
        dims = _parse_grid_dims(part)
        if dims:
            info["grid"] = {"width": dims[0], "height": dims[1], "source": "filename"}
            break

    if not info["grid"] and pw and ph:
        # 2. DPI-based: TTRPG standard is 1 inch = 1 cell
        if info["dpi"]:
            gw = round(pw / info["dpi"])
            gh = round(ph / info["dpi"])
            err = (abs(pw / info["dpi"] - gw) + abs(ph / info["dpi"] - gh)) / 2
            if 2 <= gw <= 300 and 2 <= gh <= 300 and err < 0.05:
                info["grid"] = {"width": gw, "height": gh, "cell_px": info["dpi"], "source": "dpi"}

        # 3. Estimate from common pixel-per-cell sizes (raster maps only — the
        #    candidate cell sizes are meaningless against PDF point dimensions).
        if not info["grid"] and not info["is_pdf"]:
            est = _estimate_grid(pw, ph, info["dpi"])
            if est:
                info["grid"] = {
                    "width": est[0],
                    "height": est[1],
                    "cell_px": est[2],
                    "source": "computed",
                }

    if info["is_pdf"]:
        # The point-based dimensions and the synthetic 72 DPI were only useful for
        # grid inference; they don't describe a real raster, so don't surface them.
        info["pixel_width"] = None
        info["pixel_height"] = None
        info["dpi"] = None
        if info["grid"] and "cell_px" in info["grid"]:
            info["grid"].pop("cell_px")

    return info


# Raster previews. Viewing a 50MB battlemap used to stream the whole original to
# the browser before anything appeared (issue: slow map viewing). These render a
# downscaled WebP instead — a few hundred KB — cached exactly like PDF map pages,
# so the viewer paints quickly and the original is only fetched on download.
def render_map_preview(filepath: str, width: int) -> bytes:
    """Render a raster map down to ``width`` px as WebP bytes, cached.

    The source is never upscaled: an image already narrower than ``width`` is
    re-encoded at its own size, so a small map costs one cheap conversion rather
    than a blurry enlargement.
    """
    valkey_key = f"mappreview:{filepath}:{width}"
    if _valkey is not None:
        try:
            cached = _valkey.get(valkey_key)
            if cached:
                return cached
        except Exception as e:
            logger.warning(f"Valkey get error: {e}")

    # Hash the DB-sourced filepath (never user input) so no tainted data reaches
    # the filesystem path. mtime is mixed in so replacing the file on disk
    # invalidates the cached preview instead of serving the stale render.
    try:
        mtime = int(os.path.getmtime(filepath))
    except OSError:
        mtime = 0
    file_hash = hashlib.sha1(f"{filepath}:{mtime}".encode()).hexdigest()[:16]
    cache_path = os.path.join(PAGE_CACHE_DIR, f"mapprev_{file_hash}_{width}.webp")
    if os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            data = f.read()
        valkey_cache_set(valkey_key, data)
        return data

    with PILImage.open(filepath) as img:
        img = img.convert("RGB") if img.mode not in ("RGB", "L") else img
        if img.width > width:
            height = round(img.height * width / img.width)
            img = img.resize((width, height), PILImage.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="webp", quality=82, method=0)
    img_bytes = buf.getvalue()

    if not valkey_cache_set(valkey_key, img_bytes):
        with open(cache_path, "wb") as f:
            f.write(img_bytes)
    return img_bytes


# --- Universal VTT ------------------------------------------------------------
# .uvtt/.dd2vtt files (Arkenforge/Dungeondraft) are JSON envelopes: map metadata
# plus the battlemap itself as a base64 "image" field, alongside wall ("line_of
# _sight"), portal, and light data. Key casing differs between exporters, so
# lookups are case-insensitive over the top-level keys.
_VTT_IMAGE_KEYS = ("image", "Image")


def _vtt_get(data: dict, *names: str) -> Any:
    """Fetch the first present key, matching case-insensitively."""
    lowered = {k.lower(): v for k, v in data.items()}
    for name in names:
        if name.lower() in lowered:
            return lowered[name.lower()]
    return None


def _sniff_image_mime(raw: bytes) -> str:
    """Detect the image type of decoded VTT bytes from its magic number.

    The envelope does not name the format and exporters vary (PNG from
    Dungeondraft, WebP/JPEG from others), so sniff rather than assume PNG.
    """
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    if raw[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return "application/octet-stream"


def load_vtt(filepath: str) -> dict:
    """Parse a Universal VTT file, raising ValueError if it is not valid JSON."""
    try:
        with open(filepath, "rb") as f:
            data = json.loads(f.read().decode("utf-8-sig"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ValueError(f"Not a valid Universal VTT file: {e}") from None
    if not isinstance(data, dict):
        raise ValueError("Universal VTT file must contain a JSON object")
    return data


def vtt_image_bytes(filepath: str) -> bytes:
    """Decode the base64 battlemap image embedded in a Universal VTT file.

    Returned as raw bytes so the image is served as a normal picture — the
    browser never has to hold or decode a multi-megabyte base64 string.
    """
    data = load_vtt(filepath)
    raw = _vtt_get(data, *_VTT_IMAGE_KEYS)
    if not isinstance(raw, str) or not raw:
        raise ValueError("Universal VTT file has no embedded image")
    # Some exporters write a full data: URI rather than bare base64.
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]
    try:
        return base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("Universal VTT image is not valid base64") from None


def vtt_metadata(filepath: str) -> dict:
    """Grid/wall/portal/light summary for a Universal VTT file, minus the image.

    The image field is stripped: it is the bulk of the file and is served
    separately by the image endpoint.
    """
    data = load_vtt(filepath)
    resolution = _vtt_get(data, "resolution") or {}
    if not isinstance(resolution, dict):
        resolution = {}
    map_size = _vtt_get(resolution, "map_size") or {}
    map_size = map_size if isinstance(map_size, dict) else {}
    lights = _vtt_get(data, "lights") or []
    portals = _vtt_get(data, "portals") or []
    walls = _vtt_get(data, "line_of_sight") or []
    objects_los = _vtt_get(data, "objects_line_of_sight") or []
    return {
        "format": _vtt_get(data, "format"),
        "pixels_per_grid": _vtt_get(resolution, "pixels_per_grid"),
        "grid_width": map_size.get("x") if isinstance(map_size, dict) else None,
        "grid_height": map_size.get("y") if isinstance(map_size, dict) else None,
        "wall_count": len(walls) if isinstance(walls, list) else 0,
        "object_wall_count": len(objects_los) if isinstance(objects_los, list) else 0,
        "portal_count": len(portals) if isinstance(portals, list) else 0,
        "light_count": len(lights) if isinstance(lights, list) else 0,
        "has_image": bool(_vtt_get(data, *_VTT_IMAGE_KEYS)),
    }
