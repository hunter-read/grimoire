"""The MuPDF work behind a page view, on an already-open document.

Shared by both render paths: a render worker runs these against the documents
it holds open, and the in-process path (``RENDER_WORKERS=0``) runs them inside
``open_pdf()``. Rasterizing and encoding are separate steps so the in-process
path can encode after letting go of the document's lock; a worker does both.

Errors a caller should turn into a 400 are exceptions with plain arguments, so
they cross the process boundary intact: a worker sends the exception itself
back, and the parent raises it.
"""
import io
import math
from typing import Any

import fitz  # PyMuPDF
from PIL import Image

# A zoom tile is at most this many pixels square (issue #574).
TILE_SIZE = 1024

# The narrowest and widest a page may be rendered. MuPDF renders a negative
# zoom at its absolute size, and every width is cached separately, so a width
# outside this range is refused here rather than trusted to each caller's bounds.
MIN_RENDER_WIDTH = 16
MAX_RENDER_WIDTH = 16384

# An XMP packet is a few kilobytes of RDF; one past this carries embedded
# thumbnails or worse, and is not worth sending back from a worker.
MAX_XMP_CHARS = 1024 * 1024


class PageOutOfRange(Exception):
    """The requested page is not in the document."""

    def __init__(self, page_count: int) -> None:
        super().__init__(page_count)
        self.page_count = page_count

    def __str__(self) -> str:
        return f"Page must be between 1 and {self.page_count}"


class TileOutOfRange(Exception):
    """The requested tile is outside the page at this width."""

    def __init__(self, cols: int, rows: int, width: int) -> None:
        super().__init__(cols, rows, width)
        self.cols, self.rows, self.width = cols, rows, width

    def __str__(self) -> str:
        return f"This page has {self.cols}x{self.rows} tiles at width {self.width}"


class WidthOutOfRange(Exception):
    """The requested render width is outside MIN_RENDER_WIDTH..MAX_RENDER_WIDTH."""

    def __init__(self, width: int) -> None:
        super().__init__(width)
        self.width = width

    def __str__(self) -> str:
        return f"Width must be between {MIN_RENDER_WIDTH} and {MAX_RENDER_WIDTH}"


def _check_width(width: int) -> None:
    if not MIN_RENDER_WIDTH <= width <= MAX_RENDER_WIDTH:
        raise WidthOutOfRange(width)


class RenderError(Exception):
    """A render failed: MuPDF raised, or the worker doing it crashed or hung."""


class RenderCrashError(RenderError):
    """The worker process died while the request was in flight."""


class RenderTimeoutError(RenderError):
    """The worker did not answer in time and was stopped."""


def tile_grid(page_rect: fitz.Rect, width: int) -> tuple[int, int]:
    """(columns, rows) of tiles covering the page rendered ``width`` pixels wide."""
    height = page_rect.height * width / page_rect.width
    return math.ceil(width / TILE_SIZE), math.ceil(height / TILE_SIZE)


def tile_clip(page_rect: fitz.Rect, width: int, col: int, row: int) -> fitz.Rect:
    """The area of the page, in page coordinates, that tile ``col``/``row`` shows."""
    scale = width / page_rect.width
    height = page_rect.height * scale
    return fitz.Rect(
        page_rect.x0 + col * TILE_SIZE / scale,
        page_rect.y0 + row * TILE_SIZE / scale,
        page_rect.x0 + min((col + 1) * TILE_SIZE, width) / scale,
        page_rect.y0 + min((row + 1) * TILE_SIZE, height) / scale,
    )


def _page(doc: fitz.Document, page_num: int) -> fitz.Page:
    if page_num < 1 or page_num > len(doc):
        raise PageOutOfRange(len(doc))
    return doc[page_num - 1]


def rasterize_page(doc: fitz.Document, page_num: int, width: int) -> Image.Image:
    """Page ``page_num`` (1-based) as an RGB image ``width`` pixels wide."""
    _check_width(width)
    page = _page(doc, page_num)
    zoom = width / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    # Drop the pixmap now, so its buffer is part of what a reclaim frees.
    del pix, page
    return img


def rasterize_tile(
    doc: fitz.Document, page_num: int, width: int, col: int, row: int
) -> Image.Image:
    """Tile ``col``/``row`` of the page rendered ``width`` pixels wide."""
    _check_width(width)
    page = _page(doc, page_num)
    cols, rows = tile_grid(page.rect, width)
    if col >= cols or row >= rows:
        raise TileOutOfRange(cols, rows, width)
    scale = width / page.rect.width
    pix = page.get_pixmap(
        matrix=fitz.Matrix(scale, scale),
        clip=tile_clip(page.rect, width, col, row),
        alpha=False,
    )
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    del pix, page
    return img


def encode_webp(img: Image.Image, quality: int = 85, method: int = 0) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="webp", quality=quality, method=method)
    return buf.getvalue()


def page_text(doc: fitz.Document, page_num: int) -> str:
    return _page(doc, page_num).get_text("text").strip()


def page_words(doc: fitz.Document, page_num: int) -> dict[str, Any]:
    """The page's size and its words with their boxes, for the text-selection overlay."""
    page = _page(doc, page_num)
    rect = page.rect
    return {
        "width": rect.width,
        "height": rect.height,
        "words": [
            {"x0": w[0], "y0": w[1], "x1": w[2], "y1": w[3], "text": w[4]}
            for w in page.get_text("words")
        ],
    }


def document_info(doc: fitz.Document) -> dict[str, Any]:
    """Page count and the first page's size in points (None for an empty document)."""
    info: dict[str, Any] = {"page_count": len(doc), "width": None, "height": None}
    if len(doc):
        rect = doc[0].rect
        info["width"], info["height"] = rect.width, rect.height
    return info


def document_metadata(doc: fitz.Document) -> dict[str, str]:
    """The document's own info dictionary, plus ``language``, ``isbn`` and ``xmp``.

    ``language`` is the catalog's ``/Lang``, ``isbn`` a custom info-dictionary
    key whose name mentions ISBN (MuPDF's ``metadata`` only has the standard
    ones), and ``xmp`` the XMP packet - empty when it is implausibly large.

    Raw strings only, exactly as the file carries them: deciding which of them
    are worth offering as book fields is ``metadata.embedded``'s job, not MuPDF's.
    """
    info = {k: v for k, v in (doc.metadata or {}).items() if isinstance(v, str)}
    info["language"] = info["isbn"] = info["xmp"] = ""
    if not doc.is_pdf:
        return info
    try:
        kind, value = doc.xref_get_key(doc.pdf_catalog(), "Lang")
        if kind == "string":
            info["language"] = value
    except (RuntimeError, ValueError):
        pass  # a damaged catalog just has no language to offer
    info["isbn"] = _custom_isbn(doc)
    try:
        xmp = doc.get_xml_metadata() or ""
    except (RuntimeError, ValueError):
        xmp = ""  # an unreadable metadata stream is the same as none
    info["xmp"] = xmp if len(xmp) <= MAX_XMP_CHARS else ""
    return info


def _custom_isbn(doc: fitz.Document) -> str:
    """The value of the first ``/Info`` key whose name mentions ISBN, or ""."""
    try:
        kind, ref = doc.xref_get_key(-1, "Info")
        if kind != "xref":
            return ""
        xref = int(ref.split()[0])
        for key in doc.xref_get_keys(xref):
            if "isbn" in key.lower():
                kind, value = doc.xref_get_key(xref, key)
                if kind == "string":
                    return value
    except (RuntimeError, ValueError, IndexError):
        pass  # a damaged trailer or info dictionary has no ISBN to offer
    return ""
