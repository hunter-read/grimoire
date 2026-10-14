"""Writing exported pages and cut-outs as PDF (issue #207).

A PDF export copies the source's page objects rather than rasterising them, so
text stays selectable and a character sheet prints as sharply as the book does.
A rectangular cut-out is a new page the size of the region with the source page
placed into it, clipped - still vector, just smaller.
"""
import fitz  # type: ignore[import-untyped]

from .render import composite_for
from .spec import Region


def as_pdf(doc: fitz.Document) -> fitz.Document:
    """``doc`` itself when it is a PDF, otherwise a PDF conversion of it.

    EPUB, XPS and the other non-PDF formats PyMuPDF reads cannot be copied from
    page by page; converting first gives them the same export as a PDF.
    """
    if doc.is_pdf:
        return doc
    return fitz.open("pdf", doc.convert_to_pdf())


def _runs(pages: list[int]) -> list[tuple[int, int]]:
    """Consecutive stretches of ``pages`` in the order given: [3,4,5,9] -> [(3,5),(9,9)]."""
    runs: list[tuple[int, int]] = []
    for page in pages:
        if runs and page == runs[-1][1] + 1:
            runs[-1] = (runs[-1][0], page)
        else:
            runs.append((page, page))
    return runs


def pages_pdf(doc: fitz.Document, pages: list[int]) -> bytes:
    """A new PDF holding ``pages`` (1-based), in the order given."""
    src = as_pdf(doc)
    out = fitz.open()
    try:
        for first, last in _runs(pages):
            out.insert_pdf(src, from_page=first - 1, to_page=last - 1)
        # garbage=3 drops every object the copied pages do not reference, so a
        # five-page export of a 300 MB book is a five-page-sized file.
        return out.tobytes(garbage=3, deflate=True)
    finally:
        out.close()
        if src is not doc:
            src.close()


def region_pdf(doc: fitz.Document, region: Region) -> bytes:
    """A one-page PDF of a rectangular region, kept as vector content."""
    src = as_pdf(doc)
    out = fitz.open()
    try:
        composite = composite_for(src, region.pages)
        rx0 = region.x * composite.width
        ry0 = region.y * composite.height
        rx1 = rx0 + region.w * composite.width
        ry1 = ry0 + region.h * composite.height
        target_page = out.new_page(width=rx1 - rx0, height=ry1 - ry0)
        for part in composite.parts:
            prect = src[part.page - 1].rect
            span_x1 = part.offset + prect.width * part.scale
            ix0, ix1 = max(rx0, part.offset), min(rx1, span_x1)
            if ix1 <= ix0:
                continue
            clip = fitz.Rect(
                prect.x0 + (ix0 - part.offset) / part.scale,
                prect.y0 + ry0 / part.scale,
                prect.x0 + (ix1 - part.offset) / part.scale,
                prect.y0 + ry1 / part.scale,
            )
            target = fitz.Rect(ix0 - rx0, 0, ix1 - rx0, ry1 - ry0)
            target_page.show_pdf_page(target, src, part.page - 1, clip=clip)
        return out.tobytes(garbage=3, deflate=True)
    finally:
        out.close()
        if src is not doc:
            src.close()
