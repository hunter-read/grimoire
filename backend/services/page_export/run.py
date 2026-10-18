"""Running an export, or the reader's export helpers, against an open document.

The HTTP glue in ``routers/_page_export.py`` used to do this inline. It lives
here, on plain arguments, so it can run in a spawned process (issue #615): an
export or a shape detection reads the whole document through MuPDF, and a file
that crashes MuPDF must not take the server down with it.
"""
from typing import Any

import fitz  # type: ignore[import-untyped]

from ...render.ops import PageOutOfRange
from .bundle import ExportFile, export_pages, export_regions, safe_stem
from .detect import detect_shapes
from .spec import Region, page_label, parse_page_spec


def produce(doc: fitz.Document, title: str, spec: dict[str, Any]) -> tuple[list[ExportFile], str]:
    """Run an export, returning its files and the name a zip of them would take.

    ``spec`` is the export request as plain data: ``kind`` ("pages" or
    "regions"), ``format``, ``dpi``, and for pages ``pages``, ``join_spreads``
    and ``spread_offset``, for regions ``regions`` (dicts of Region's fields).
    Raises ExportError for a request the document can't satisfy.
    """
    stem = safe_stem(title)
    if spec["kind"] == "pages":
        pages = parse_page_spec(spec["pages"], len(doc))
        files = export_pages(
            doc,
            title,
            pages,
            spec["format"],
            spec["dpi"],
            spec["join_spreads"],
            spec["spread_offset"],
        )
        return files, f"{stem} ({page_label(pages)})"
    regions = [
        Region(
            pages=tuple(r["pages"]),
            shape=r["shape"],
            x=r["x"],
            y=r["y"],
            w=r["w"],
            h=r["h"],
            name=r["name"],
        )
        for r in spec["regions"]
    ]
    return export_regions(doc, title, regions, spec["format"], spec["dpi"]), f"{stem} (cut-outs)"


def _page(doc: fitz.Document, page_num: int) -> fitz.Page:
    if page_num < 1 or page_num > len(doc):
        raise PageOutOfRange(len(doc))
    return doc[page_num - 1]


def page_size(doc: fitz.Document, page_num: int) -> dict[str, float]:
    """A page's size in PDF points, for showing what a resolution will produce."""
    rect = _page(doc, page_num).rect
    return {"width": rect.width, "height": rect.height}


def detect_page_shapes(doc: fitz.Document, page_num: int) -> list[dict[str, Any]]:
    """Suggested cut-outs for one page, as fractions of the page."""
    rect = _page(doc, page_num).rect
    width, height = rect.width, rect.height
    return [
        {
            "shape": f.shape,
            "x": (f.rect.x0 - rect.x0) / width,
            "y": (f.rect.y0 - rect.y0) / height,
            "w": f.rect.width / width,
            "h": f.rect.height / height,
        }
        for f in detect_shapes(doc, page_num)
    ]
