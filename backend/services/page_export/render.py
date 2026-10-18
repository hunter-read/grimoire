"""Rasterising pages and cut-outs for export (issue #207).

Everything is drawn from the document itself at the requested resolution rather
than cropped out of the reader's cached WebP pages: those are sized for a screen,
and a table or token exported for print needs the vector page rendered sharp.

Only the part of a page that a region covers is rendered (``get_pixmap`` with a
clip), so cutting twenty tokens off one page costs twenty small renders rather
than twenty full ones.
"""
import io
from dataclasses import dataclass

import fitz  # type: ignore[import-untyped]
from PIL import Image, ImageDraw  # type: ignore[import-untyped]

from .spec import MAX_OUTPUT_PIXELS, ExportError, Region

# The ellipse mask is drawn this many times larger and scaled down, which is
# what gives a circular token a smooth edge instead of a stair-stepped one.
_MASK_SUPERSAMPLE = 4


@dataclass(frozen=True)
class Part:
    """One page's place in a composite, in PDF points."""

    page: int
    offset: float
    scale: float


@dataclass(frozen=True)
class Composite:
    """Pages laid side by side at a common height, as the reader shows a spread."""

    parts: tuple[Part, ...]
    width: float
    height: float


def composite_for(doc: fitz.Document, pages: tuple[int, ...]) -> Composite:
    """Lay ``pages`` out left to right, scaling each to the first page's height.

    Facing pages are almost always the same size; scaling covers the odd book
    whose cover or fold-out is not, so a region drawn across them still lines up
    with what the reader displayed.
    """
    height = doc[pages[0] - 1].rect.height
    parts: list[Part] = []
    offset = 0.0
    for page in pages:
        rect = doc[page - 1].rect
        scale = height / rect.height if rect.height else 1.0
        parts.append(Part(page=page, offset=offset, scale=scale))
        offset += rect.width * scale
    return Composite(parts=tuple(parts), width=offset, height=height)


def output_size(composite: Composite, region: Region, dpi: int) -> tuple[int, int]:
    """The pixel size a region renders to at ``dpi``."""
    k = dpi / 72
    return (
        max(1, round(region.w * composite.width * k)),
        max(1, round(region.h * composite.height * k)),
    )


def render_region(doc: fitz.Document, region: Region, dpi: int) -> Image.Image:
    """Render one region to an image: RGB for a rectangle, RGBA for an ellipse."""
    composite = composite_for(doc, region.pages)
    out_w, out_h = output_size(composite, region, dpi)
    if out_w * out_h > MAX_OUTPUT_PIXELS:
        raise ExportError(
            f"That is {out_w} x {out_h} pixels at {dpi} dpi, which is too large - "
            "choose a lower resolution or a smaller area"
        )

    k = dpi / 72
    rx0 = region.x * composite.width
    ry0 = region.y * composite.height
    rx1 = rx0 + region.w * composite.width
    ry1 = ry0 + region.h * composite.height
    canvas = Image.new("RGB", (out_w, out_h), "white")

    for part in composite.parts:
        page = doc[part.page - 1]
        prect = page.rect
        span_x1 = part.offset + prect.width * part.scale
        ix0, ix1 = max(rx0, part.offset), min(rx1, span_x1)
        # The whole pixels this part covers. Neighbouring parts round their shared
        # gutter edge the same way, so they meet exactly (issue #588).
        px0, px1 = round((ix0 - rx0) * k), min(out_w, round((ix1 - rx0) * k))
        if ix1 <= ix0 or px1 <= px0:
            continue
        clip = fitz.Rect(
            prect.x0 + (ix0 - part.offset) / part.scale,
            prect.y0 + ry0 / part.scale,
            prect.x0 + (ix1 - part.offset) / part.scale,
            prect.y0 + ry1 / part.scale,
        )
        # Render the clip to exactly px1 - px0 columns, starting on a whole pixel.
        # At the plain zoom a part whose edge falls mid-pixel ends in a half-
        # covered, half-white column, which shows as a light seam down the gutter
        # of a joined spread. The horizontal stretch this adds is under a pixel.
        zoom_x = (px1 - px0) / clip.width
        zoom_y = k * part.scale
        matrix = fitz.Matrix(zoom_x, 0, 0, zoom_y, -clip.x0 * zoom_x, -clip.y0 * zoom_y)
        pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=False)
        tile = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        del pix
        canvas.paste(tile, (px0, 0))

    if region.shape == "ellipse":
        canvas = _mask_ellipse(canvas)
    return canvas


def _mask_ellipse(image: Image.Image) -> Image.Image:
    """Make everything outside the inscribed ellipse transparent."""
    w, h = image.size
    big = Image.new("L", (w * _MASK_SUPERSAMPLE, h * _MASK_SUPERSAMPLE), 0)
    ImageDraw.Draw(big).ellipse(
        (0, 0, w * _MASK_SUPERSAMPLE - 1, h * _MASK_SUPERSAMPLE - 1), fill=255
    )
    out = image.convert("RGBA")
    out.putalpha(big.resize((w, h), Image.Resampling.LANCZOS))
    return out


def encode(image: Image.Image, fmt: str) -> bytes:
    """Encode for download. JPEG has no alpha, so a circle's corners go white."""
    buf = io.BytesIO()
    if fmt == "jpeg":
        if image.mode == "RGBA":
            flat = Image.new("RGB", image.size, "white")
            flat.paste(image, mask=image.getchannel("A"))
            image = flat
        image.save(buf, format="JPEG", quality=92, optimize=True)
    elif fmt == "webp":
        image.save(buf, format="WEBP", quality=92, method=4)
    else:
        image.save(buf, format="PNG", optimize=False, compress_level=6)
    return buf.getvalue()
