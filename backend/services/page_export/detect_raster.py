"""Finding tokens on a page that is one flat picture (issue #207).

Plenty of token sheets are exported from an image editor as a single
page-sized image: the tokens are just pixels on a white page, so the PDF holds
nothing ``detect`` can read. This pass looks at the pixels instead.

It needs only Pillow. The page is rendered small, everything that is not the
page's plain background colour is foreground, enclosed holes are filled (a
token with white sky inside it is still one token), and the foreground is
eroded a little so tokens that touch or barely overlap come apart. Connected
regions are then labelled from runs of pixels per row - a union-find over runs,
with the run-finding done by a compiled regex - so no Python loop ever walks
individual pixels. Each region's box is refined from a sharper render of just
that area, so a cut-out exported at 300 dpi is tight to the token's edge.

A page without a plain background (a full-bleed illustration, a noisy scan)
yields nothing rather than a guess.
"""
import math
import re
from dataclasses import dataclass, field

import fitz  # type: ignore[import-untyped]
from PIL import Image, ImageChops, ImageDraw, ImageFilter  # type: ignore[import-untyped]

from .spec import Shape

# Long side of the analysis render, in pixels. About 0.75 px per point on a
# letter page: small enough to label quickly, large enough to keep tokens apart.
_LONG_SIDE = 600
# Each region's box is re-measured at this many times the analysis scale.
_REFINE = 4
# A channel this far from the background colour counts as foreground. Loose
# enough to ignore JPEG noise in a white margin, tight enough to keep a pale edge.
_THRESHOLD = 28
# Pixels eroded before labelling, which is how far two tokens may overlap and
# still be found separately.
_ERODE = 2
# At least this share of the page border must be the background colour, or the
# page has no plain background to separate anything from.
_MIN_BORDER_SHARE = 0.5
# A region filling less than this share of its box is round, not square
# (a circle fills pi/4, about 0.785).
_ROUND_FILL = 0.89
_ROUND_ASPECT = (0.85, 1.18)
# A region in a round box is one disc when at most this share of its box
# disagrees with the circle inscribed in it. Fill alone cannot tell: a 3 x 3
# block of touching tokens fills its box exactly as much as one big token.
_DISC_MISMATCH = 0.12
# The furthest a region is eroded while trying to split it, in analysis pixels.
_MAX_ERODE = 12
# The smallest piece worth keeping, as a share of the page's short side - the
# same floor the structural pass uses.
_MIN_SIDE_SHARE = 0.04

_FG_RUN = re.compile(rb"[^\x00]+")
_BG_RUN = re.compile(rb"\x00+")


@dataclass
class Region:
    """A connected run-set: its box in analysis pixels and the runs it holds."""

    x0: int
    y0: int
    x1: int
    y1: int
    runs: list[tuple[int, int, int]] = field(default_factory=list)


def _background(img: Image.Image) -> tuple[int, int, int] | None:
    """The page's plain background colour, read from its border, if it has one."""
    w, h = img.size
    inset = 2
    if w <= inset * 4 or h <= inset * 4:
        return None
    strips = [
        img.crop((0, inset, w, inset + 1)),
        img.crop((0, h - inset - 1, w, h - inset)),
        img.crop((inset, 0, inset + 1, h)),
        img.crop((w - inset - 1, 0, w - inset, h)),
    ]
    samples: list[tuple[int, int, int]] = []
    for strip in strips:
        samples.extend(strip.getdata())
    counts: dict[tuple[int, int, int], int] = {}
    for r, g, b in samples:
        key = (r // 8, g // 8, b // 8)
        counts[key] = counts.get(key, 0) + 1
    key = max(counts, key=lambda k: counts[k])
    bg = (key[0] * 8 + 4, key[1] * 8 + 4, key[2] * 8 + 4)
    near = sum(
        1
        for r, g, b in samples
        if max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2])) <= _THRESHOLD
    )
    return bg if near >= len(samples) * _MIN_BORDER_SHARE else None


def _foreground(img: Image.Image, bg: tuple[int, int, int]) -> Image.Image:
    """An 'L' mask: 255 where a pixel differs from the background, else 0."""
    diff = ImageChops.difference(img, Image.new("RGB", img.size, bg))
    r, g, b = diff.split()
    strongest = ImageChops.lighter(ImageChops.lighter(r, g), b)
    return strongest.point(lambda v: 255 if v > _THRESHOLD else 0)


def _label(mask: bytes, w: int, h: int, pattern: "re.Pattern[bytes]") -> list[Region]:
    """Connected regions (4-connected) of the runs `pattern` matches, row by row."""
    parent: list[int] = []
    runs: list[tuple[int, int, int]] = []

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    prev: list[tuple[int, int, int]] = []
    for y in range(h):
        base = y * w
        cur: list[tuple[int, int, int]] = []
        j = 0
        for m in pattern.finditer(mask, base, base + w):
            a, b = m.start() - base, m.end() - base
            rid = len(parent)
            parent.append(rid)
            runs.append((y, a, b))
            # Skip previous-row runs that end before this one starts; they end
            # before every later run in this row too.
            while j < len(prev) and prev[j][1] <= a:
                j += 1
            k = j
            while k < len(prev) and prev[k][0] < b:
                ra, rb = find(rid), find(prev[k][2])
                if ra != rb:
                    parent[ra] = rb
                k += 1
            cur.append((a, b, rid))
        prev = cur

    regions: dict[int, Region] = {}
    for rid, (y, a, b) in enumerate(runs):
        root = find(rid)
        reg = regions.get(root)
        if reg is None:
            regions[root] = Region(a, y, b, y + 1, [(y, a, b)])
        else:
            reg.x0, reg.x1 = min(reg.x0, a), max(reg.x1, b)
            reg.y1 = y + 1
            reg.runs.append((y, a, b))
    return list(regions.values())


def _fill_holes(fg: Image.Image) -> Image.Image:
    """Foreground with every background area not reachable from the border filled in."""
    w, h = fg.size
    data = fg.tobytes()
    filled = bytearray(b"\xff" * (w * h))
    for reg in _label(data, w, h, _BG_RUN):
        if reg.x0 == 0 or reg.y0 == 0 or reg.x1 == w or reg.y1 == h:
            for y, a, b in reg.runs:
                filled[y * w + a : y * w + b] = bytes(b - a)
    return Image.frombytes("L", (w, h), bytes(filled))


def _region_mask(reg: Region, box: tuple[int, int, int, int]) -> Image.Image:
    """The region's own pixels, as an 'L' image covering `box`."""
    bx0, by0, bx1, by1 = box
    w, h = bx1 - bx0, by1 - by0
    buf = bytearray(w * h)
    for y, a, b in reg.runs:
        row = (y - by0) * w
        buf[row + a - bx0 : row + b - bx0] = b"\xff" * (b - a)
    return Image.frombytes("L", (w, h), bytes(buf))


def _shape_stats(mask: Image.Image) -> tuple[tuple[int, int, int, int] | None, float, float]:
    """A mask's bounding box, how much of that box it fills, and the box's aspect."""
    bb = mask.getbbox()
    if not bb:
        return None, 0.0, 0.0
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    return bb, mask.histogram()[255] / max(1, bw * bh), bw / max(1, bh)


def _is_clean(mask: Image.Image) -> bool:
    """Whether a region already reads as one piece: a disc, or a solid rectangle.

    Judged with the piece's own holes filled, so a token whose art is white
    in places still reads as the disc it is.
    """
    mask = _fill_holes(mask)
    bb, fill, aspect = _shape_stats(mask)
    if bb is None or fill >= _ROUND_FILL:
        return True
    if not _ROUND_ASPECT[0] <= aspect <= _ROUND_ASPECT[1]:
        return False
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    disc = Image.new("L", (bw, bh), 0)
    ImageDraw.Draw(disc).ellipse((0, 0, bw - 1, bh - 1), fill=255)
    mismatch = ImageChops.difference(mask.crop(bb), disc).histogram()[255]
    return mismatch <= _DISC_MISMATCH * bw * bh


def _split(mask: Image.Image, min_area: int, erode: int = _ERODE) -> list[Image.Image]:
    """Break a region of touching pieces apart; a clean region comes back as itself.

    Erodes just this region harder, a pixel at a time, until it falls into two
    or more substantial parts, then grows each part back inside the original
    outline and splits those in turn. Tokens printed edge to edge in a grid
    touch along a line too wide for the page-wide erosion to cut; this is a
    small watershed that cuts it without eating into every other piece.

    `mask` is the region's foreground *without* holes filled: in a grid of
    tokens touching on all sides, the gaps between them are enclosed, and
    filling them would weld the grid into one solid block.
    """
    if _is_clean(mask):
        return [mask]
    w, h = mask.size
    for step in range(erode + 1, _MAX_ERODE + 1):
        eroded = mask.filter(ImageFilter.MinFilter(step * 2 + 1))
        parts = [
            r
            for r in _label(eroded.tobytes(), w, h, _FG_RUN)
            if sum(b - a for _, a, b in r.runs) >= min_area
        ]
        if not parts:
            break
        if len(parts) >= 2:
            pieces: list[Image.Image] = []
            for part in parts:
                own = _region_mask(part, (0, 0, w, h)).filter(
                    ImageFilter.MaxFilter((step + 1) * 2 + 1)
                )
                pieces.extend(_split(ImageChops.multiply(mask, own), min_area, step))
            return pieces
    return [mask]


def detect_raster_shapes(page: fitz.Page) -> list[tuple[fitz.Rect, Shape]]:
    """Suggested cut-outs for a page whose content is pixels, in page points."""
    prect = page.rect
    scale = _LONG_SIDE / max(prect.width, prect.height)
    zoom = scale * _REFINE
    # One render, at the sharp scale; the analysis image is a reduction of it.
    # Rendering again per piece would decode a page-sized image every time.
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    hi = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    del pix
    w, h = max(1, round(hi.width / _REFINE)), max(1, round(hi.height / _REFINE))
    img = hi.resize((w, h), Image.Resampling.BOX)
    bg = _background(img)
    if bg is None:
        return []

    fg = _foreground(img, bg)
    filled = _fill_holes(fg)
    fg_hi = _foreground(hi, bg)
    eroded = filled.filter(ImageFilter.MinFilter(_ERODE * 2 + 1))
    grow = _ERODE + 1
    pad = grow + 1
    short = min(w, h)
    min_area = max(4, int((short * _MIN_SIDE_SHARE) ** 2 * 0.5))

    found: list[tuple[fitz.Rect, Shape]] = []
    for reg in _label(eroded.tobytes(), w, h, _FG_RUN):
        box = (
            max(0, reg.x0 - pad),
            max(0, reg.y0 - pad),
            min(w, reg.x1 + pad),
            min(h, reg.y1 + pad),
        )
        # The region grown back past the erosion: the piece's outline, without
        # its neighbours. Split on the unfilled foreground inside it.
        own = _region_mask(reg, box).filter(ImageFilter.MaxFilter(grow * 2 + 1))
        for part in _split(ImageChops.multiply(fg.crop(box), own), min_area):
            piece = _fill_holes(part)
            bb, fill, aspect = _shape_stats(piece)
            if bb is None:
                continue
            round_ = _ROUND_ASPECT[0] <= aspect <= _ROUND_ASPECT[1] and fill < _ROUND_FILL
            rect = _measure(fg_hi, piece, box, scale, round_) or fitz.Rect(
                prect.x0 + (box[0] + bb[0]) / scale,
                prect.y0 + (box[1] + bb[1]) / scale,
                prect.x0 + (box[0] + bb[2]) / scale,
                prect.y0 + (box[1] + bb[3]) / scale,
            )
            found.append((rect, "ellipse" if round_ else "rect"))
    return found


def _measure(
    fg_hi: Image.Image,
    piece: Image.Image,
    box: tuple[int, int, int, int],
    scale: float,
    round_: bool,
) -> fitz.Rect | None:
    """Re-measure a piece's box against the sharp render, in page points.

    Only sharp foreground inside the piece's own outline (grown by a pixel, to
    take in its anti-aliased edge) counts, so a neighbour reaching into the
    padding does not stretch the box much - but a token split from one it
    touched still carries a sliver of it along the contact line. A disc is
    square on the page, so a round piece is squared up: its shorter extent is
    the clean diameter, and the longer axis is centred on its widest chord.
    """
    k = _REFINE
    crop = fg_hi.crop((box[0] * k, box[1] * k, box[2] * k, box[3] * k))
    own = piece.filter(ImageFilter.MaxFilter(3)).resize(crop.size, Image.Resampling.NEAREST)
    shape = ImageChops.multiply(crop, own)
    bb = shape.getbbox()
    if not bb:
        return None
    if round_:
        bb = _square_disc(shape, bb)
    zoom = scale * k
    return fitz.Rect(
        (box[0] * k + bb[0]) / zoom,
        (box[1] * k + bb[1]) / zoom,
        (box[0] * k + bb[2]) / zoom,
        (box[1] * k + bb[3]) / zoom,
    )


def _square_disc(
    shape: Image.Image, bb: tuple[int, int, int, int]
) -> tuple[int, int, int, int]:
    """A round piece's true circle, from its area and centroid.

    A token cut from neighbours on every side carries a sliver of each, so
    neither its width nor its height is the diameter. Its area and centre
    hardly move: the slivers are thin, and they sit opposite each other.
    """
    solid = _fill_holes(shape.crop(bb))
    area = solid.histogram()[255]
    if not area:
        return bb
    diameter = 2 * math.sqrt(area / math.pi)
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    # A clean disc's box already matches its area to within a pixel or two;
    # anything wider is carrying a neighbour.
    if max(bw, bh) <= diameter + max(2.0, diameter * 0.01):
        return bb
    # Centroid from the row and column sums, each a 1-pixel-wide reduction.
    cols = list(solid.resize((bw, 1), Image.Resampling.BOX).getdata())
    rows = list(solid.resize((1, bh), Image.Resampling.BOX).getdata())
    cx = sum((i + 0.5) * v for i, v in enumerate(cols)) / max(1, sum(cols))
    cy = sum((i + 0.5) * v for i, v in enumerate(rows)) / max(1, sum(rows))
    half = diameter / 2
    return (
        round(bb[0] + cx - half),
        round(bb[1] + cy - half),
        round(bb[0] + cx + half),
        round(bb[1] + cy + half),
    )
