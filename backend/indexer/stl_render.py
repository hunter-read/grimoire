"""Software rasteriser for STL thumbnails (no GPU, no new dependencies).

Every other thumbnail in the app comes from a decoder that already exists —
PyMuPDF for documents, Pillow for images, the bundled decode-only ffmpeg for
animated maps. A 3D mesh has no such decoder, and the obvious ways to get one
are the same bad bargain ``video_frames`` describes: headless GL needs OSMesa
(not pip-installable, ~200 MB of system libs), and ``trimesh``/``pyrender``
drags in numpy and scipy for what is ultimately a 300x300 grey picture.

STL does not need any of that. The format is a flat list of triangles with a
normal each, so projecting and shading one is a few dozen lines of arithmetic,
and filling the triangles is a scanline loop. This module is that: pure stdlib
maths producing a packed RGB buffer, which the caller hands to Pillow exactly
like the bytes coming out of any other decoder.

Measured on an ordinary container: ~20k triangles in 0.09s, ~80k in 0.26s, and
roughly linear from there (~150k triangle-rasterisations/sec). ``MAX_TRIANGLES``
bounds the worst case, and binary STL states its triangle count in the header,
so an oversized mesh is rejected before a single vertex is read.

Failure is always None, never an exception: a mesh that cannot be read keeps the
blank tile it had before, exactly like an archive with no readable cover.
"""
import logging
import math
import os
import re
import struct
from typing import List, Optional, Sequence, Tuple

logger = logging.getLogger("grimoire.indexer")

# A vertex, a triangle of three vertices, and a triangle projected to screen
# space (x, y, depth). Named so the rasteriser signatures stay readable.
Vertex = Tuple[float, float, float]
Triangle = Tuple[Vertex, Vertex, Vertex]
ScreenPoint = Tuple[float, float, float]

# Ceiling on mesh complexity. A detailed 32 mm miniature is 50-200k triangles;
# 4M is a raw photogrammetry scan or a large multi-part terrain piece, and is the
# most the deferred queue will attempt within its own timeout. Binary STL
# declares its count in the header, so this is enforced before any vertex is
# parsed — an oversized mesh costs one 84-byte read, not a parse.
MAX_TRIANGLES = 4_000_000

# Meshes up to this are rasterised inline during the scan (~7s at the measured
# ~150k triangle-rasterisations/sec). Anything larger is flagged and handed to
# the deferred thumbnail queue instead, so one 4M-triangle scan cannot add half
# a minute to the walk — the same bargain the deferred-OCR queue strikes for
# image-only PDFs.
INLINE_TRIANGLE_BUDGET = 1_000_000

# Ceiling on the file we will read at all, mirroring the caps the text and comic
# readers apply. 50 bytes per binary triangle means MAX_TRIANGLES is ~50 MB; the
# ASCII spelling of the same mesh is far bigger, hence the separate limit.
MAX_STL_BYTES = 512 * 1024 * 1024

# Fixed 80-byte header then a uint32 triangle count, then 50 bytes each.
_BINARY_HEADER = 84
_BINARY_STRIDE = 50

# View direction, as rotations about X and Y. A straight-on orthographic view of
# a miniature is a silhouette with no depth cue; tilting it reads as a 3D object
# at thumbnail size.
_ROT_X_DEG = 30.0
_ROT_Y_DEG = 30.0

# Fraction of the frame the mesh spans, leaving a margin so the silhouette is
# not flush against the tile edge.
_FIT = 0.8

# Directional light in view space, and the ambient floor that keeps faces
# pointing away from it readable rather than black.
_LIGHT = (0.4, 0.5, 0.75)
_AMBIENT = 0.25

_BASE_COLOR = (150, 160, 180)
_BACKGROUND = (30, 32, 38)


def _read_binary(data: bytes) -> Optional[List[Triangle]]:
    """Triangles from a binary STL, or None if the buffer is malformed."""
    if len(data) < _BINARY_HEADER:
        return None
    (count,) = struct.unpack_from("<I", data, 80)
    if count == 0:
        return None
    if count > MAX_TRIANGLES:
        logger.debug(f"STL has {count} triangles, over the {MAX_TRIANGLES} cap")
        return None
    # A truncated file would otherwise raise from unpack_from part-way through.
    if len(data) < _BINARY_HEADER + count * _BINARY_STRIDE:
        return None
    tris = []
    for i in range(count):
        v = struct.unpack_from("<12f", data, _BINARY_HEADER + i * _BINARY_STRIDE)
        tris.append((v[3:6], v[6:9], v[9:12]))
    return tris


_VERTEX_RE = re.compile(
    rb"vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)", re.I
)


def _read_ascii(data: bytes) -> Optional[List[Triangle]]:
    """Triangles from an ASCII STL, or None if no complete facet is found.

    Parsed by pulling every ``vertex`` line and grouping them in threes rather
    than tracking facet blocks: the vertices appear in order regardless of how
    the emitting tool spaced or cased the surrounding keywords, and a trailing
    partial facet is simply dropped.
    """
    verts = _VERTEX_RE.findall(data)
    if len(verts) < 3:
        return None
    if len(verts) // 3 > MAX_TRIANGLES:
        return None
    tris = []
    for i in range(0, len(verts) - 2, 3):
        try:
            tri = tuple(
                tuple(float(c) for c in verts[i + k]) for k in range(3)
            )
        except ValueError:
            return None
        tris.append(tri)
    return tris or None


def read_stl(filepath: str) -> Optional[List[Triangle]]:
    """Triangles from an STL file of either spelling, or None.

    The two spellings are told apart by size rather than by the ``solid`` magic:
    plenty of binary exporters write "solid" into the 80-byte header, so the
    header is not trustworthy, whereas the binary layout's declared triangle
    count either accounts for the file length exactly or it does not.
    """
    try:
        with open(filepath, "rb") as f:
            data = f.read(MAX_STL_BYTES + 1)
    except OSError as e:
        logger.warning(f"Could not read STL {filepath}: {e}")
        return None
    if len(data) > MAX_STL_BYTES:
        logger.debug(f"STL {filepath} exceeds the {MAX_STL_BYTES} byte cap")
        return None

    if len(data) >= _BINARY_HEADER:
        (count,) = struct.unpack_from("<I", data, 80)
        # ">=" rather than "==" so an exporter's trailing padding does not send a
        # perfectly good binary mesh down the ASCII path, which then finds no
        # "vertex" lines and gives up. Matches triangle_count's tolerance.
        if count and len(data) >= _BINARY_HEADER + count * _BINARY_STRIDE:
            return _read_binary(data)
    if data.lstrip()[:5].lower() == b"solid":
        return _read_ascii(data)
    # Not a clean match either way: try binary, since a binary STL with trailing
    # padding is far more common than an ASCII one that never says "solid".
    return _read_binary(data)


def triangle_count(filepath: str) -> int:
    """Triangle count from a binary STL header, or 0 when unavailable.

    Reads 84 bytes rather than the whole mesh, so this is cheap enough to call
    during the scan for every file. ASCII meshes report 0 rather than paying a
    full parse for a metadata field.

    The declared count is accepted when the file is *at least* long enough to
    hold it, not only when the length matches exactly. Plenty of exporters pad
    a few bytes past the last facet, and demanding an exact match reported 0 for
    those — which reads as "weightless" to callers and left heavy meshes neither
    rendered inline nor queued for deferral. A file shorter than its own header
    claims is still rejected: that count is provably wrong.
    """
    try:
        with open(filepath, "rb") as f:
            head = f.read(_BINARY_HEADER)
        if len(head) < _BINARY_HEADER:
            return 0
        size = os.path.getsize(filepath)
    except OSError:
        return 0
    (count,) = struct.unpack_from("<I", head, 80)
    if count and size >= _BINARY_HEADER + count * _BINARY_STRIDE:
        return count
    return 0


def _project(
    tris: Sequence[Triangle], width: int, height: int
) -> Optional[List[Tuple[Triangle, List[ScreenPoint]]]]:
    """Screen-space triangles, centred and scaled to fit the frame."""
    xs = [v[0] for t in tris for v in t]
    ys = [v[1] for t in tris for v in t]
    zs = [v[2] for t in tris for v in t]
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    cz = (min(zs) + max(zs)) / 2
    span = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    if span <= 0:
        return None
    scale = (min(width, height) * _FIT) / span

    ca = math.cos(math.radians(_ROT_X_DEG))
    sa = math.sin(math.radians(_ROT_X_DEG))
    cb = math.cos(math.radians(_ROT_Y_DEG))
    sb = math.sin(math.radians(_ROT_Y_DEG))

    out = []
    for tri in tris:
        pts = []
        for v in tri:
            x, y, z = v[0] - cx, v[1] - cy, v[2] - cz
            x, z = x * cb + z * sb, -x * sb + z * cb
            y, z = y * ca - z * sa, y * sa + z * ca
            # Screen y grows downward, so the world y is negated here.
            pts.append((width / 2 + x * scale, height / 2 - y * scale, z))
        out.append((tri, pts))
    return out


def _shade(tri: Triangle) -> bytes:
    """Flat Lambertian colour for one triangle, from its geometric normal.

    The normal is recomputed from the vertices rather than trusted from the STL
    facet record: plenty of exporters write zero or inconsistent normals, and
    the cross product is cheaper than validating theirs.
    """
    (ax, ay, az), (bx, by, bz), (cx, cy, cz) = tri
    ux, uy, uz = bx - ax, by - ay, bz - az
    vx, vy, vz = cx - ax, cy - ay, cz - az
    nx = uy * vz - uz * vy
    ny = uz * vx - ux * vz
    nz = ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    if length == 0:
        lam = 0.0
    else:
        lam = max(
            0.0,
            (nx * _LIGHT[0] + ny * _LIGHT[1] + nz * _LIGHT[2]) / length,
        )
    level = _AMBIENT + (1.0 - _AMBIENT) * lam
    return bytes(int(c * level) for c in _BASE_COLOR)


def _fill(
    buf: bytearray,
    zbuf: List[float],
    width: int,
    height: int,
    pts: Sequence[ScreenPoint],
    color: bytes,
) -> None:
    """Scanline-fill one screen-space triangle with a per-pixel depth test.

    A Z-buffer rather than a painter's-algorithm depth sort: sorting by centroid
    mis-orders triangles that overlap in screen space, which shows up as
    background bleeding through the silhouette. Testing per pixel is both exact
    and faster here, since it skips the sort entirely.
    """
    (x0, y0, z0), (x1, y1, z1), (x2, y2, z2) = sorted(pts, key=lambda p: p[1])
    if y2 - y0 <= 0:
        return

    def lerp(ya: float, yb: float, a: float, b: float, y: float) -> float:
        return a if yb == ya else a + (b - a) * (y - ya) / (yb - ya)

    top = max(0, int(math.floor(y0)))
    bottom = min(height, int(math.ceil(y2)) + 1)
    for y in range(top, bottom):
        # Sample at the pixel centre; sampling at the integer edge drops
        # scanlines on thin triangles.
        yc = y + 0.5
        if yc < y0 or yc > y2:
            continue
        xa = lerp(y0, y2, x0, x2, yc)
        za = lerp(y0, y2, z0, z2, yc)
        if yc < y1:
            xb = lerp(y0, y1, x0, x1, yc)
            zb = lerp(y0, y1, z0, z1, yc)
        else:
            xb = lerp(y1, y2, x1, x2, yc)
            zb = lerp(y1, y2, z1, z2, yc)
        if xa > xb:
            xa, xb = xb, xa
            za, zb = zb, za
        left = max(0, int(math.floor(xa + 0.5)))
        right = min(width, int(math.floor(xb + 0.5)) + 1)
        if right <= left:
            continue
        span = (xb - xa) or 1.0
        row = y * width
        for x in range(left, right):
            z = za + (zb - za) * ((x + 0.5 - xa) / span)
            i = row + x
            if z < zbuf[i]:
                zbuf[i] = z
                o = i * 3
                buf[o : o + 3] = color


def render_stl(filepath: str, width: int = 300, height: int = 300) -> Optional[bytes]:
    """Packed RGB bytes (``width * height * 3``) for an STL, or None.

    The caller wraps the buffer with ``Image.frombytes("RGB", (w, h), buf)`` and
    treats it exactly like the decoded bytes from any other thumbnail source.
    """
    tris = read_stl(filepath)
    if not tris:
        return None
    projected = _project(tris, width, height)
    if projected is None:
        return None

    buf = bytearray(bytes(_BACKGROUND) * (width * height))
    zbuf = [math.inf] * (width * height)
    drawn = 0
    for tri, pts in projected:
        # Backface cull on the projected winding. Roughly halves the fill work on
        # a closed mesh, which every printable model is.
        area = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (
            pts[2][0] - pts[0][0]
        ) * (pts[1][1] - pts[0][1])
        if area >= 0:
            continue
        _fill(buf, zbuf, width, height, pts, _shade(tri))
        drawn += 1

    if drawn == 0:
        return None
    return bytes(buf)
