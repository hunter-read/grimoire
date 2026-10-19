"""Finding the tokens, cards and pictures on a page (issue #207).

A sheet of tokens is rarely one flat picture. Each token is usually its own
embedded image, often in a circular frame drawn as a vector path or masked to a
circle by a transparency mask. Reading that structure out of the PDF finds the
pieces exactly, with no computer vision and no new dependency.

When the page's structure yields nothing - a token sheet flattened into one
page-sized image, or a scan - ``detect_raster`` looks at the pixels instead.

What comes back is a set of *suggestions*: the user can drop or adjust any of
them before exporting.
"""
import logging
from dataclasses import dataclass

import fitz  # type: ignore[import-untyped]

from .detect_raster import detect_raster_shapes
from .spec import Shape

# Not backend.config's logger (the same one): render workers import this module,
# and they import nothing from the app beyond what rendering needs.
logger = logging.getLogger("grimoire")

# Anything covering more of the page than this is a background or a full-page
# illustration, not a piece to cut out.
_MAX_AREA_FRACTION = 0.6
# The pixel pass runs only on a page that is mostly one picture - a flattened
# sheet or a scan. On a page of text and vector art, the "pieces" it would find
# are words and letters.
_PICTURE_PAGE_FRACTION = 0.5
# Smaller than this fraction of the page's short side is an ornament or a bullet.
_MIN_SIDE_FRACTION = 0.04
# A circle drawn as a bare vector path, with no picture in it, must be larger:
# small ones are letters - the O in a logo set as outlines - not tokens.
_MIN_PATH_SIDE_FRACTION = 0.06
# Width/height inside this band counts as "round enough" to be a circle.
_ROUND_ASPECT = (0.85, 1.18)
# Two boxes overlapping this much (intersection over union) are the same piece.
_SAME_IOU = 0.7
# Images overlapping this much are layers of one piece - a card's art, frame
# and texture stacked in the same spot - and are merged before anything else.
_LAYER_IOU = 0.85
# Two pieces within this area ratio of each other count as "alike", the mark of
# a grid of tokens on a panel rather than a card's own decorations.
_ALIKE_AREA = 0.75
_MAX_SHAPES = 200


@dataclass
class Found:
    """A detected piece, in page points."""

    rect: fitz.Rect
    shape: Shape


def _iou(a: fitz.Rect, b: fitz.Rect) -> float:
    inter = fitz.Rect(a) & b
    if inter.is_empty:
        return 0.0
    ia = inter.width * inter.height
    union = a.width * a.height + b.width * b.height - ia
    return ia / union if union else 0.0


def _contains(outer: fitz.Rect, inner: fitz.Rect, slack: float = 1.0) -> bool:
    return (
        inner.x0 >= outer.x0 - slack
        and inner.y0 >= outer.y0 - slack
        and inner.x1 <= outer.x1 + slack
        and inner.y1 <= outer.y1 + slack
    )


def _is_round(rect: fitz.Rect) -> bool:
    if rect.height <= 0:
        return False
    return _ROUND_ASPECT[0] <= rect.width / rect.height <= _ROUND_ASPECT[1]


def _usable(rect: fitz.Rect, page: fitz.Rect, min_side: float = _MIN_SIDE_FRACTION) -> bool:
    if rect.is_empty or rect.width <= 0 or rect.height <= 0:
        return False
    short = min(page.width, page.height)
    if min(rect.width, rect.height) < short * min_side:
        return False
    return rect.width * rect.height <= page.width * page.height * _MAX_AREA_FRACTION


def _has_round_mask(doc: fitz.Document, xref: int) -> bool:
    """Whether an image's soft mask hides its corners and shows its middle.

    That is how a round token is usually stored: a square picture whose corners
    are transparent. Sampled at a few points rather than analysed, since only
    the corners-versus-centre contrast matters.
    """
    if xref <= 0:
        return False
    try:
        smask = doc.xref_get_key(xref, "SMask")
        if smask[0] != "xref":
            return False
        mask = fitz.Pixmap(doc, int(smask[1].split()[0]))
        w, h = mask.width, mask.height
        if w < 8 or h < 8:
            return False
        inset_x, inset_y = max(1, w // 20), max(1, h // 20)
        corners = [
            (inset_x, inset_y),
            (w - 1 - inset_x, inset_y),
            (inset_x, h - 1 - inset_y),
            (w - 1 - inset_x, h - 1 - inset_y),
        ]
        corner_values = [mask.pixel(x, y)[0] for x, y in corners]
        centre = mask.pixel(w // 2, h // 2)[0]
        return max(corner_values) < 40 and centre > 200
    except (RuntimeError, ValueError, IndexError) as e:
        logger.debug("Could not read soft mask for image xref %s: %s", xref, e)
        return False


def _circle_paths(page: fitz.Page) -> list[fitz.Rect]:
    """Bounding boxes of vector paths that are drawn as circles.

    A circle in PDF is four Bezier curves; a token frame is that, stroked. A
    path made only of curves with a round bounding box is taken as one.
    """
    circles: list[fitz.Rect] = []
    try:
        drawings = page.get_drawings()
    except (RuntimeError, ValueError) as e:
        logger.debug("Could not read drawings on page %s: %s", page.number, e)
        return circles
    for drawing in drawings:
        items = drawing.get("items") or []
        if len(items) < 4 or any(item[0] != "c" for item in items):
            continue
        rect = fitz.Rect(drawing["rect"])
        # The path's box runs through the middle of its stroke; grow it by half
        # the stroke so a frame is cut out whole rather than shaved at the edge.
        half = (drawing.get("width") or 0) / 2 if drawing.get("color") else 0
        rect = fitz.Rect(rect.x0 - half, rect.y0 - half, rect.x1 + half, rect.y1 + half)
        if _is_round(rect):
            circles.append(rect)
    return circles


def detect_shapes(doc: fitz.Document, page_num: int) -> list[Found]:
    """Suggest cut-outs for page ``page_num`` (1-based), in reading order."""
    page = doc[page_num - 1]
    prect = page.rect
    found: list[Found] = []

    infos = page.get_image_info(xrefs=True)
    page_area = prect.width * prect.height
    picture_page = any(
        _area(fitz.Rect(info["bbox"]) & prect) >= page_area * _PICTURE_PAGE_FRACTION
        for info in infos
    )
    for info in infos:
        rect = fitz.Rect(info["bbox"]) & prect
        if not _usable(rect, prect):
            continue
        round_ = _is_round(rect) and _has_round_mask(doc, int(info.get("xref") or 0))
        found.append(Found(rect=rect, shape="ellipse" if round_ else "rect"))

    for circle in _circle_paths(page):
        circle = circle & prect
        if not _usable(circle, prect):
            continue
        match = next((f for f in found if _iou(f.rect, circle) >= _SAME_IOU), None)
        if match is not None:
            # A frame drawn around an image: one round piece the size of both.
            match.rect = fitz.Rect(match.rect) | circle
            match.shape = "ellipse"
        elif _usable(circle, prect, _MIN_PATH_SIDE_FRACTION):
            found.append(Found(rect=circle, shape="ellipse"))

    found = _merge_layers(found)
    found = _drop_containers(found)
    found = _drop_nested(found)
    if not found and picture_page:
        found = [
            Found(rect=rect, shape=shape)
            for rect, shape in detect_raster_shapes(page)
            if _usable(rect, prect)
        ]
        found = _drop_nested(found)
    found.sort(key=lambda f: (round(f.rect.y0 / max(prect.height * 0.05, 1)), f.rect.x0))
    return found[:_MAX_SHAPES]


def _merge_layers(found: list[Found]) -> list[Found]:
    """Merge pieces stacked in (nearly) the same place into one.

    Print-and-play cards are commonly built from several page-sized layers -
    art, frame, texture - each its own image in almost the same box. Left
    separate, each layer "contains" the others, which reads as a panel or a
    nest and loses the card entirely.
    """
    merged: list[Found] = []
    for f in found:
        layer = next((m for m in merged if _iou(m.rect, f.rect) >= _LAYER_IOU), None)
        if layer is None:
            merged.append(Found(rect=fitz.Rect(f.rect), shape=f.shape))
        else:
            layer.rect = fitz.Rect(layer.rect) | f.rect
            if f.shape == "ellipse":
                layer.shape = "ellipse"
    return merged


def _area(r: fitz.Rect) -> float:
    return r.width * r.height


def _is_panel(f: Found, inside: list[Found]) -> bool:
    """Whether `f` is a backdrop for a set of pieces rather than a piece itself.

    A panel holds at least two separate pieces of much the same size - a row of
    tokens on a parchment box. A card holding its own name banner, cost badge
    or art window is not one: those are its decorations, and the card is what
    the user wants to cut out.
    """
    for i, a in enumerate(inside):
        for b in inside[i + 1 :]:
            small, large = sorted((_area(a.rect), _area(b.rect)))
            if large and small / large >= _ALIKE_AREA and _iou(a.rect, b.rect) < _SAME_IOU:
                if (fitz.Rect(a.rect) & b.rect).is_empty:
                    return True
    return False


def _drop_containers(found: list[Found]) -> list[Found]:
    """Drop boxes that are backdrops for several like pieces - panels, not pieces."""
    keep: list[Found] = []
    for f in found:
        inside = [g for g in found if g is not f and _contains(f.rect, g.rect)]
        if not _is_panel(f, inside):
            keep.append(f)
    return keep


def _drop_nested(found: list[Found]) -> list[Found]:
    """Keep the outer box when one piece sits inside another (art inside its frame)."""
    keep: list[Found] = []
    for f in found:
        if any(g is not f and _contains(g.rect, f.rect) and g.rect != f.rect for g in found):
            continue
        if any(_iou(f.rect, k.rect) >= _SAME_IOU for k in keep):
            continue
        keep.append(f)
    return keep
