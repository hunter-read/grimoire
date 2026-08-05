"""Image metadata helpers for map endpoints."""
import hashlib
import io
import os
import re
from pathlib import Path
from typing import Optional

import fitz  # type: ignore[import-untyped]
from PIL import Image as PILImage  # type: ignore[import-untyped]

from ...config import PAGE_CACHE_DIR, _valkey, logger
from ...indexer import archive_ext
from ..books._helpers import _get_pdf_doc


def _is_pdf(filepath: str) -> bool:
    return Path(filepath).suffix.lower() == ".pdf"


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
        if _valkey is not None:
            try:
                _valkey.set(valkey_key, data)
            except Exception as e:
                logger.warning(f"Valkey set error: {e}")
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

    if _valkey is not None:
        try:
            _valkey.set(valkey_key, img_bytes)
        except Exception as e:
            logger.warning(f"Valkey set error: {e}")
            with open(cache_path, "wb") as f:
                f.write(img_bytes)
    else:
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
    info: dict = {
        "pixel_width": None,
        "pixel_height": None,
        "dpi": None,
        "grid": None,
        "is_pdf": False,
        "page_count": None,
    }
    # Archives are opaque blobs — no raster to measure and no grid to infer.
    if archive_ext(filepath):
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
