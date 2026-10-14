"""What an export asks for, and the limits it is held to (issue #207).

An export is either a set of whole pages or a set of regions cut out of pages.
Both are described here in plain data so the renderer, the PDF writer and the
router all speak the same vocabulary, and so the parsing rules (page ranges,
spread pairing) can be tested without opening a document.

Region coordinates are fractions (0-1) of the *composite* the region was drawn
on: a single page, or two facing pages laid side by side at the same height. A
map that runs across the gutter of a spread is one region over two pages, not
two halves the user has to stitch back together.
"""
import re
from dataclasses import dataclass
from typing import Literal

Format = Literal["pdf", "png", "jpeg", "webp"]
Shape = Literal["rect", "ellipse"]

IMAGE_FORMATS: tuple[str, ...] = ("png", "jpeg", "webp")

MEDIA_TYPES: dict[str, str] = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "zip": "application/zip",
}

EXTENSIONS: dict[str, str] = {"pdf": "pdf", "png": "png", "jpeg": "jpg", "webp": "webp"}

MIN_DPI = 36
MAX_DPI = 600

# Rasterising is the expensive half: a 300 dpi page is ~25 MP, and every one of
# them is rendered inside the request. A PDF of pages copies objects instead of
# drawing them, so it is held only to the page count of the document itself.
MAX_IMAGE_PAGES = 100
MAX_REGIONS = 200
# One output image. 50 MP is a 300 dpi tabloid spread with room to spare, and
# keeps a single render's buffers in the low hundreds of megabytes.
MAX_OUTPUT_PIXELS = 50_000_000


class ExportError(ValueError):
    """A request that cannot be honoured. The message is shown to the user."""


@dataclass(frozen=True)
class Region:
    """One cut-out: a rectangle or ellipse over one page or a facing pair."""

    pages: tuple[int, ...]
    shape: Shape
    x: float
    y: float
    w: float
    h: float
    name: str = ""


_RANGE = re.compile(r"^(\d+)\s*(?:-\s*(\d+))?$")


def parse_page_spec(spec: str, page_count: int) -> list[int]:
    """Turn ``"12-15, 20"`` into ``[12, 13, 14, 15, 20]``.

    Order is kept as written and repeats are dropped, so ``"20, 12"`` exports
    page 20 first. A backwards range (``15-12``) is read forwards rather than
    rejected - there is only one thing it can mean. En and em dashes are
    accepted because they are what a copied page reference usually contains.
    """
    text = (spec or "").replace("–", "-").replace("—", "-").strip()
    if not text:
        raise ExportError("Choose at least one page")
    pages: list[int] = []
    seen: set[int] = set()
    for part in (p.strip() for p in text.split(",")):
        if not part:
            continue
        match = _RANGE.match(part)
        if not match:
            raise ExportError(f"'{part}' is not a page or a range like 12-15")
        start = int(match.group(1))
        end = int(match.group(2) or start)
        if start > end:
            start, end = end, start
        if start < 1:
            raise ExportError("Pages are numbered from 1")
        if end > page_count:
            raise ExportError(f"Page {end} is past the end - this has {page_count} pages")
        for page in range(start, end + 1):
            if page not in seen:
                seen.add(page)
                pages.append(page)
    if not pages:
        raise ExportError("Choose at least one page")
    return pages


def is_left_page(page: int, spread_offset: int) -> bool:
    """Whether ``page`` opens a spread, matching the reader's pairing.

    With offset 0 the cover stands alone and spreads start on even pages; with
    offset 1 the cover pairs with page 2 and spreads start on odd pages.
    """
    return page % 2 == 1 if spread_offset == 1 else page % 2 == 0


def group_spreads(pages: list[int], spread_offset: int) -> list[tuple[int, ...]]:
    """Pair facing pages the way the reader shows them.

    A page is joined to the next one only when it opens a spread *and* its
    partner is the next page asked for, so a range that starts or ends halfway
    through a spread exports that half on its own instead of borrowing a page
    nobody selected.
    """
    groups: list[tuple[int, ...]] = []
    i = 0
    while i < len(pages):
        page = pages[i]
        if (
            i + 1 < len(pages)
            and pages[i + 1] == page + 1
            and is_left_page(page, spread_offset)
        ):
            groups.append((page, page + 1))
            i += 2
        else:
            groups.append((page,))
            i += 1
    return groups


def page_label(pages: list[int] | tuple[int, ...]) -> str:
    """A short page reference for a filename: ``p12``, ``p12-15``, ``p3-40``."""
    first, last = min(pages), max(pages)
    return f"p{first}" if first == last else f"p{first}-{last}"


def validate_region(region: Region, page_count: int) -> Region:
    """Check a region's pages and clamp its box to the composite it sits on."""
    if not 1 <= len(region.pages) <= 2:
        raise ExportError("A cut-out covers one page or two facing pages")
    if len(region.pages) == 2 and region.pages[1] != region.pages[0] + 1:
        raise ExportError("A cut-out across a spread must cover two consecutive pages")
    for page in region.pages:
        if page < 1 or page > page_count:
            raise ExportError(f"Page {page} is past the end - this has {page_count} pages")
    x0 = min(max(region.x, 0.0), 1.0)
    y0 = min(max(region.y, 0.0), 1.0)
    x1 = min(max(region.x + region.w, 0.0), 1.0)
    y1 = min(max(region.y + region.h, 0.0), 1.0)
    if x1 - x0 <= 0 or y1 - y0 <= 0:
        raise ExportError("A cut-out has no area - draw it again")
    return Region(
        pages=region.pages,
        shape=region.shape,
        x=x0,
        y=y0,
        w=x1 - x0,
        h=y1 - y0,
        name=region.name,
    )
