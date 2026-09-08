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

Measured on an ordinary container: the streaming path sustains ~350k triangles a
second, so a 14M-triangle presupported mini — a 716 MB file — rasterises in ~40s
inside 100 MB of RSS. The buffered path used for small meshes is slower per
triangle (~150k/sec, the tuple-building cost) but only ever sees meshes where
that is a fraction of a second. ``MAX_TRIANGLES`` bounds the worst case, and
binary STL states its triangle count in the header, so an oversized mesh is
rejected before a single vertex is read.

Failure is always None, never an exception: a mesh that cannot be read keeps the
blank tile it had before, exactly like an archive with no readable cover.
"""
import logging
import math
import os
import re
import struct
from typing import Iterator, List, Optional, Sequence, Tuple

logger = logging.getLogger("grimoire.indexer")

# A vertex, a triangle of three vertices, and a triangle projected to screen
# space (x, y, depth). Named so the rasteriser signatures stay readable.
Vertex = Tuple[float, float, float]
Triangle = Tuple[Vertex, Vertex, Vertex]
ScreenPoint = Tuple[float, float, float]

# Ceiling on mesh complexity. A detailed 32 mm miniature is 50-200k triangles;
# A raw photogrammetry scan or a large multi-part terrain piece, and the most the
# deferred queue will attempt within its own timeout. Binary STL declares its
# count in the header, so this is enforced before any vertex is parsed — an
# oversized mesh costs one 84-byte read, not a parse.
#
# Raised from 4M once rendering was streamed rather than buffered. The old cap
# was set by memory, not time: a mesh was materialised as a list of tuples at
# ~531 bytes each, so 4M was already ~2 GB and anything larger was hopeless.
# Streaming holds one chunk at a time (measured 99 MB RSS for a 14M-triangle,
# 716 MB file), which leaves render time as the only real limit — ~350k
# triangles/sec measured, so 20M is ~57s, comfortably inside the queue's
# MODEL_THUMBNAIL_TIMEOUT. Real presupported minis reach 14M+ (measured at 40s),
# and every one of them now gets a preview.
MAX_TRIANGLES = 20_000_000

# Past this a binary STL is streamed rather than loaded. Below it the simpler
# list path is kept: it is one read instead of two, and at these sizes the memory
# it costs is irrelevant.
_STREAM_THRESHOLD = 400_000

# Meshes up to this are rasterised inline during the scan (~6s at the measured
# ~350k triangles/sec once streaming replaced the buffered read). Anything larger
# is flagged and handed to the deferred thumbnail queue instead, so one very
# heavy mesh cannot add half a minute to the walk — the same bargain the
# deferred-OCR queue strikes for image-only PDFs.
#
# 2M rather than 1M because ordinary presupported minis sit between the two
# (1.0-1.9M is typical) and rendered in ~3-6s each; deferring those meant a
# library of minis finished its scan with almost no previews and depended
# entirely on the queue that follows.
INLINE_TRIANGLE_BUDGET = 2_000_000

# Ceiling on a file we read whole, mirroring the caps the text and comic readers
# apply. In practice this now guards only the ASCII spelling: a binary STL is
# streamed once it passes _STREAM_THRESHOLD (~19 MB), so it never reaches the
# buffered read regardless of size. ASCII has no header count to stream against
# and must be parsed in full, which is exactly what needs a byte limit.
MAX_STL_BYTES = 512 * 1024 * 1024

# Fixed 80-byte header then a uint32 triangle count, then 50 bytes each.
_BINARY_HEADER = 84
_BINARY_STRIDE = 50

# View direction, as rotations about X and Y. A straight-on orthographic view of
# a miniature is a silhouette with no depth cue; tilting it reads as a 3D object
# at thumbnail size.
#
# 18 degrees of tilt rather than 30: a mini is a standing figure on a round base,
# and at 30 the camera looks down far enough that the base dominates the frame
# and a crouched or prone model is seen mostly from above, foreshortened into an
# unreadable lump. A shallower angle keeps the silhouette — the part that
# actually identifies the model — while still showing enough of the base to read
# as dimensional.
_ROT_X_DEG = 18.0
_ROT_Y_DEG = 30.0

# Fraction of the frame the mesh spans, leaving a margin so the silhouette is
# not flush against the tile edge.
_FIT = 0.8

# Directional light in *view* space: x right, y up, z into the screen, so a
# surface facing the camera has a negative z normal. The light therefore needs a
# negative z of its own to actually fall on what the viewer can see — over the
# camera's shoulder, thrown down and in from the upper left.
#
# It was previously +z, i.e. pointing away from the camera into the screen, so
# every front-facing surface landed on the ambient floor and only oblique
# geometry — support struts, rim facets — caught any light at all. A solid
# miniature came out as a dark silhouette threaded with bright lines, which read
# as a wireframe rather than as an object.
_LIGHT = (-0.35, 0.45, -0.82)

# Ambient floor, and the share of the remaining range driven by the wrapped
# hemisphere term rather than hard Lambert. Flat Lambert leaves everything past
# the terminator at exactly _AMBIENT, which flattens a mini's shadowed side into
# one dead grey mass; wrapping the falloff keeps that side shaded but still
# legible, which is what makes the form readable at 300px.
_AMBIENT = 0.22
_WRAP = 0.55

_BASE_COLOR = (170, 178, 196)
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
) -> Optional[List[List[ScreenPoint]]]:
    """Screen-space triangles, centred and scaled to fit the frame.

    Only the projected points come back. Shading reads its normal from these
    rather than from the source triangle, so the mesh-space geometry has no
    reader past this point.
    """
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
            # STL for printing is Z-up: Z is the build-plate normal, so the
            # model's "up" is +Z, not +Y. Map world Z to the view's up axis
            # before rotating, or every print-oriented mesh renders lying on its
            # side — a miniature tipped onto its back rather than standing.
            wx, wy, wz = v[0] - cx, v[1] - cy, v[2] - cz
            x, y, z = wx, wz, -wy
            # Yaw about the up axis, then tilt the camera down toward the model.
            x, z = x * cb + z * sb, -x * sb + z * cb
            y, z = y * ca - z * sa, y * sa + z * ca
            # Screen y grows downward, so the world y is negated here.
            # Depth is scaled by the same factor as x and y, not left in model
            # units. Nothing about the z-test needs it — the scale is positive,
            # so the ordering is unchanged — but shading takes its normal from
            # the cross product of these points, and a normal is only meaningful
            # when all three axes share a unit. Leaving z unscaled tilted every
            # normal by an amount that varied with the model's own dimensions,
            # so the same mesh exported in mm and in cm shaded differently.
            pts.append((width / 2 + x * scale, height / 2 - y * scale, z * scale))
        out.append(pts)
    return out


def _shade(pts: Sequence[ScreenPoint]) -> bytes:
    """Wrapped-Lambert colour for one triangle, from its *view-space* normal.

    Shaded from the projected points, not the model-space triangle. The light is
    defined relative to the camera, so the normal it is dotted against has to be
    in the same space; taking the cross product of the raw mesh vertices instead
    lit each face by where it pointed in the *model*, which bears no relation to
    where it points on screen once the view rotation is applied.

    The normal is recomputed here rather than trusted from the STL facet record:
    plenty of exporters write zero or inconsistent normals, and the cross product
    is cheaper than validating theirs.

    ``pts`` carries screen x/y and view-space depth. x and y are scaled uniformly
    and y is flipped, which changes the normal's length and handedness but not
    its direction, and the length is divided out below. The y flip is undone by
    negating the light's y instead of the normal's, so the cross product stays
    three multiplies.

    Wrapped rather than clamped Lambert: ``(n·l + w) / (1 + w)`` lifts the
    terminator so surfaces angled away from the light still separate from each
    other instead of collapsing onto the ambient floor together. On a mini that
    is the difference between a readable shadowed side and a flat grey blob.
    """
    (ax, ay, az), (bx, by, bz), (cx, cy, cz) = pts
    ux, uy, uz = bx - ax, by - ay, bz - az
    vx, vy, vz = cx - ax, cy - ay, cz - az
    nx = uy * vz - uz * vy
    ny = uz * vx - ux * vz
    nz = ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    if length == 0:
        level = _AMBIENT
    else:
        # -_LIGHT[1] undoes the screen-space y flip baked into pts.
        dot = (nx * _LIGHT[0] - ny * _LIGHT[1] + nz * _LIGHT[2]) / length
        lam = max(0.0, (dot + _WRAP) / (1.0 + _WRAP))
        level = _AMBIENT + (1.0 - _AMBIENT) * lam
    return bytes(min(255, int(c * level)) for c in _BASE_COLOR)


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


def _stream_binary_triangles(filepath: str, count: int) -> Iterator[Triangle]:
    """Yield triangles from a binary STL one at a time, in fixed-size chunks.

    The whole point is that nothing accumulates: a 14M-triangle mesh held as a
    list of tuples costs ~7 GB (measured at ~531 bytes/triangle), which no
    thumbnail is worth. Reading a chunk at a time keeps the working set flat
    regardless of mesh size.
    """
    chunk_tris = 8192
    with open(filepath, "rb") as f:
        f.seek(_BINARY_HEADER)
        remaining = count
        while remaining > 0:
            n = min(chunk_tris, remaining)
            block = f.read(n * _BINARY_STRIDE)
            if len(block) < n * _BINARY_STRIDE:
                return
            for i in range(n):
                v = struct.unpack_from("<12f", block, i * _BINARY_STRIDE)
                yield (v[3:6], v[6:9], v[9:12])
            remaining -= n


def _bounds_streaming(
    filepath: str, count: int
) -> Optional[Tuple[float, float, float, float]]:
    """(cx, cy, cz, span) from one streaming pass, or None for a degenerate mesh."""
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for tri in _stream_binary_triangles(filepath, count):
        for v in tri:
            for a in range(3):
                if v[a] < lo[a]:
                    lo[a] = v[a]
                if v[a] > hi[a]:
                    hi[a] = v[a]
    if lo[0] is math.inf or not all(map(math.isfinite, lo + hi)):
        return None
    span = max(hi[a] - lo[a] for a in range(3))
    if span <= 0:
        return None
    return ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2, span)


def _render_streaming(filepath: str, count: int, width: int, height: int) -> Optional[bytes]:
    """Rasterise a binary STL in two streaming passes, holding no mesh in memory.

    Costs a second read of the file to find the bounding box before anything can
    be projected, which is the price of not materialising it. Disk is cheap next
    to gigabytes of tuples.
    """
    bounds = _bounds_streaming(filepath, count)
    if bounds is None:
        return None
    cx, cy, cz, span = bounds
    scale = (min(width, height) * _FIT) / span

    ca = math.cos(math.radians(_ROT_X_DEG))
    sa = math.sin(math.radians(_ROT_X_DEG))
    cb = math.cos(math.radians(_ROT_Y_DEG))
    sb = math.sin(math.radians(_ROT_Y_DEG))

    buf = bytearray(bytes(_BACKGROUND) * (width * height))
    zbuf = [math.inf] * (width * height)
    drawn = 0
    for tri in _stream_binary_triangles(filepath, count):
        pts = []
        for v in tri:
            # Same Z-up mapping as _project; see the comment there.
            wx, wy, wz = v[0] - cx, v[1] - cy, v[2] - cz
            x, y, z = wx, wz, -wy
            x, z = x * cb + z * sb, -x * sb + z * cb
            y, z = y * ca - z * sa, y * sa + z * ca
            # Depth is scaled by the same factor as x and y, not left in model
            # units. Nothing about the z-test needs it — the scale is positive,
            # so the ordering is unchanged — but shading takes its normal from
            # the cross product of these points, and a normal is only meaningful
            # when all three axes share a unit. Leaving z unscaled tilted every
            # normal by an amount that varied with the model's own dimensions,
            # so the same mesh exported in mm and in cm shaded differently.
            pts.append((width / 2 + x * scale, height / 2 - y * scale, z * scale))
        area = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (
            pts[2][0] - pts[0][0]
        ) * (pts[1][1] - pts[0][1])
        if area >= 0:
            continue
        _fill(buf, zbuf, width, height, pts, _shade(pts))
        drawn += 1

    if drawn == 0:
        return None
    return bytes(buf)


def render_stl(filepath: str, width: int = 300, height: int = 300) -> Optional[bytes]:
    """Packed RGB bytes (``width * height * 3``) for an STL, or None.

    The caller wraps the buffer with ``Image.frombytes("RGB", (w, h), buf)`` and
    treats it exactly like the decoded bytes from any other thumbnail source.

    A binary STL past ``_STREAM_THRESHOLD`` is rendered by streaming it twice
    rather than loading it: the list-of-tuples representation costs ~531 bytes a
    triangle, so a heavy mesh would need gigabytes to draw a 300px image.
    """
    count = triangle_count(filepath)
    if count > _STREAM_THRESHOLD:
        if count > MAX_TRIANGLES:
            logger.debug(f"STL has {count} triangles, over the {MAX_TRIANGLES} cap")
            return None
        return _render_streaming(filepath, count, width, height)

    tris = read_stl(filepath)
    if not tris:
        return None
    projected = _project(tris, width, height)
    if projected is None:
        return None

    buf = bytearray(bytes(_BACKGROUND) * (width * height))
    zbuf = [math.inf] * (width * height)
    drawn = 0
    for pts in projected:
        # Backface cull on the projected winding. Roughly halves the fill work on
        # a closed mesh, which every printable model is.
        area = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (
            pts[2][0] - pts[0][0]
        ) * (pts[1][1] - pts[0][1])
        if area >= 0:
            continue
        _fill(buf, zbuf, width, height, pts, _shade(pts))
        drawn += 1

    if drawn == 0:
        return None
    return bytes(buf)
