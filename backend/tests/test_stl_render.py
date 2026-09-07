"""Tests for the STL software rasteriser (backend/indexer/stl_render.py).

Meshes are generated inline rather than committed as fixtures: a binary STL is
84 bytes plus 50 per triangle, so writing one is cheaper than storing one and
makes the malformed cases (truncated, over-cap, junk) expressible directly.
"""
import math
import os
import struct

from backend.indexer import stl_render
from backend.indexer.stl_render import (
    MAX_TRIANGLES,
    read_stl,
    render_stl,
    triangle_count,
)

BACKGROUND = bytes((30, 32, 38))


def _cube(size=1.0):
    """Twelve triangles with outward winding — a closed, printable solid."""
    h = size / 2
    v = [
        (-h, -h, -h), (h, -h, -h), (h, h, -h), (-h, h, -h),
        (-h, -h, h), (h, -h, h), (h, h, h), (-h, h, h),
    ]
    faces = [
        (0, 3, 2), (0, 2, 1), (4, 5, 6), (4, 6, 7),
        (0, 1, 5), (0, 5, 4), (2, 3, 7), (2, 7, 6),
        (1, 2, 6), (1, 6, 5), (0, 4, 7), (0, 7, 3),
    ]
    return [tuple(v[i] for i in f) for f in faces]


def _write_binary(path, tris, header=b"", normals=(0.0, 0.0, 0.0)):
    with open(path, "wb") as f:
        f.write(header.ljust(80, b"\0"))
        f.write(struct.pack("<I", len(tris)))
        for tri in tris:
            f.write(struct.pack("<3f", *normals))
            for vertex in tri:
                f.write(struct.pack("<3f", *vertex))
            f.write(b"\0\0")
    return path


def _write_ascii(path, tris):
    with open(path, "w") as f:
        f.write("solid test\n")
        for tri in tris:
            f.write(" facet normal 0 0 0\n  outer loop\n")
            for x, y, z in tri:
                f.write(f"   vertex {x:.6f} {y:.6f} {z:.6f}\n")
            f.write("  endloop\n endfacet\n")
        f.write("endsolid test\n")
    return path


def _non_background_pixels(buf):
    return sum(1 for i in range(0, len(buf), 3) if buf[i : i + 3] != BACKGROUND)


class TestReadStl:
    def test_reads_binary(self, tmp_path):
        mesh = _cube()
        got = read_stl(_write_binary(str(tmp_path / "cube.stl"), mesh))
        assert got is not None
        assert len(got) == len(mesh)

    def test_reads_ascii(self, tmp_path):
        mesh = _cube()
        got = read_stl(_write_ascii(str(tmp_path / "cube.stl"), mesh))
        assert got is not None
        assert len(got) == len(mesh)

    def test_binary_and_ascii_agree(self, tmp_path):
        mesh = _cube()
        a = read_stl(_write_binary(str(tmp_path / "b.stl"), mesh))
        b = read_stl(_write_ascii(str(tmp_path / "a.stl"), mesh))
        assert a is not None and b is not None
        for tri_a, tri_b in zip(a, b):
            for va, vb in zip(tri_a, tri_b):
                assert all(abs(x - y) < 1e-5 for x, y in zip(va, vb))

    def test_binary_header_saying_solid_is_still_binary(self, tmp_path):
        """A binary file whose header starts with "solid" must not be read as ASCII.

        Common in the wild — several exporters write a description there — and
        the reason the format is detected by length arithmetic, not the magic.
        """
        path = _write_binary(str(tmp_path / "c.stl"), _cube(), header=b"solid exported")
        got = read_stl(path)
        assert got is not None
        assert len(got) == 12

    def test_missing_file(self, tmp_path):
        assert read_stl(str(tmp_path / "nope.stl")) is None

    def test_empty_file(self, tmp_path):
        path = tmp_path / "empty.stl"
        path.write_bytes(b"")
        assert read_stl(str(path)) is None

    def test_junk_file(self, tmp_path):
        path = tmp_path / "junk.stl"
        path.write_bytes(b"definitely not a mesh")
        assert read_stl(str(path)) is None

    def test_truncated_binary(self, tmp_path):
        path = _write_binary(str(tmp_path / "t.stl"), _cube())
        data = open(path, "rb").read()
        open(path, "wb").write(data[: len(data) // 2])
        assert read_stl(path) is None

    def test_zero_triangle_binary(self, tmp_path):
        path = tmp_path / "z.stl"
        path.write_bytes(b"\0" * 80 + struct.pack("<I", 0))
        assert read_stl(str(path)) is None

    def test_over_triangle_cap_is_rejected_without_parsing(self, tmp_path):
        """The declared count is checked before any vertex is read.

        The file here is only 84 bytes, so a reader that trusted the count and
        started unpacking would fail differently (or hang on a real 50 MB file).
        """
        path = tmp_path / "huge.stl"
        path.write_bytes(b"\0" * 80 + struct.pack("<I", MAX_TRIANGLES + 1))
        assert read_stl(str(path)) is None

    def test_ascii_with_no_complete_facet(self, tmp_path):
        path = tmp_path / "partial.stl"
        path.write_bytes(b"solid x\n facet normal 0 0 0\n  outer loop\n"
                         b"   vertex 0 0 0\n  endloop\n endfacet\nendsolid x\n")
        assert read_stl(str(path)) is None

    def test_ascii_over_triangle_cap(self, tmp_path, monkeypatch):
        monkeypatch.setattr(stl_render, "MAX_TRIANGLES", 2)
        path = _write_ascii(str(tmp_path / "many.stl"), _cube())
        assert read_stl(path) is None

    def test_ascii_with_unparseable_coordinate(self, tmp_path):
        """A vertex line that matches the shape but is not a number."""
        path = tmp_path / "bad.stl"
        path.write_bytes(
            b"solid x\n facet normal 0 0 0\n  outer loop\n"
            b"   vertex 0 0 0\n   vertex 1 0 0\n   vertex 1e 0 0\n"
            b"  endloop\n endfacet\nendsolid x\n"
        )
        assert read_stl(str(path)) is None

    def test_oversized_file_is_skipped(self, tmp_path, monkeypatch):
        monkeypatch.setattr(stl_render, "MAX_STL_BYTES", 16)
        path = _write_binary(str(tmp_path / "big.stl"), _cube())
        assert read_stl(path) is None

    def test_binary_with_trailing_padding_is_parsed(self, tmp_path):
        """Padding must not push a binary mesh down the ASCII path.

        That path finds no "vertex" lines in binary data and returns None, so
        the mesh failed to render despite being perfectly well-formed.
        """
        path = _write_binary(str(tmp_path / "pad.stl"), _cube())
        with open(path, "ab") as f:
            f.write(b"\0" * 7)
        tris = read_stl(path)
        assert tris is not None
        assert len(tris) == 12


class TestTriangleCount:
    def test_binary_count_from_header(self, tmp_path):
        path = _write_binary(str(tmp_path / "c.stl"), _cube())
        assert triangle_count(path) == 12

    def test_ascii_returns_zero(self, tmp_path):
        """ASCII has no header count, and a full parse is not worth a metadata field."""
        assert triangle_count(_write_ascii(str(tmp_path / "c.stl"), _cube())) == 0

    def test_missing_file(self, tmp_path):
        assert triangle_count(str(tmp_path / "nope.stl")) == 0

    def test_short_file(self, tmp_path):
        path = tmp_path / "s.stl"
        path.write_bytes(b"\0" * 10)
        assert triangle_count(str(path)) == 0

    def test_trailing_padding_still_counts(self, tmp_path):
        """Regression: exporters pad past the last facet.

        Demanding size == 84 + 50n reported 0 for these, and 0 reads as
        "weightless" to _enrich_model — so a padded mesh over the inline budget
        was neither rendered during the scan nor queued for deferral, and simply
        never got a thumbnail.
        """
        path = _write_binary(str(tmp_path / "pad.stl"), _cube())
        with open(path, "ab") as f:
            f.write(b"\n")
        assert triangle_count(path) == 12

    def test_file_shorter_than_declared_count(self, tmp_path):
        """A count the file cannot possibly hold is still rejected."""
        path = tmp_path / "lying.stl"
        path.write_bytes(b"\0" * 80 + struct.pack("<I", 5000) + b"\0" * 100)
        assert triangle_count(str(path)) == 0


class TestRenderStl:
    def test_returns_packed_rgb_buffer(self, tmp_path):
        path = _write_binary(str(tmp_path / "c.stl"), _cube())
        buf = render_stl(path, 64, 64)
        assert buf is not None
        assert len(buf) == 64 * 64 * 3

    def test_draws_something(self, tmp_path):
        path = _write_binary(str(tmp_path / "c.stl"), _cube())
        buf = render_stl(path, 64, 64)
        assert _non_background_pixels(buf) > 100

    def test_centre_is_covered(self, tmp_path):
        """The mesh is fitted around the frame centre, so that pixel is on it."""
        path = _write_binary(str(tmp_path / "c.stl"), _cube())
        buf = render_stl(path, 64, 64)
        i = ((32 * 64) + 32) * 3
        assert buf[i : i + 3] != BACKGROUND

    def test_corners_stay_background(self, tmp_path):
        """_FIT leaves a margin, so the extreme corners are never painted."""
        path = _write_binary(str(tmp_path / "c.stl"), _cube())
        buf = render_stl(path, 64, 64)
        assert buf[0:3] == BACKGROUND
        assert buf[-3:] == BACKGROUND

    def test_scale_invariant(self, tmp_path):
        """A cube and the same cube 100x larger fill the frame identically."""
        small = render_stl(_write_binary(str(tmp_path / "s.stl"), _cube(1.0)), 64, 64)
        large = render_stl(_write_binary(str(tmp_path / "l.stl"), _cube(100.0)), 64, 64)
        assert small == large

    def test_ignores_stored_normals(self, tmp_path):
        """Shading is recomputed, so exporters that write garbage normals are fine."""
        mesh = _cube()
        zeros = render_stl(_write_binary(str(tmp_path / "z.stl"), mesh), 64, 64)
        wrong = render_stl(
            _write_binary(str(tmp_path / "w.stl"), mesh, normals=(9.0, -3.0, 7.0)),
            64,
            64,
        )
        assert zeros == wrong

    def test_faces_are_shaded_differently(self, tmp_path):
        """Distinct colours across the visible faces — the 3D read at card size."""
        path = _write_binary(str(tmp_path / "c.stl"), _cube())
        buf = render_stl(path, 64, 64)
        shades = {buf[i : i + 3] for i in range(0, len(buf), 3)}
        assert len(shades - {BACKGROUND}) >= 2

    def test_no_background_holes_in_a_closed_mesh(self, tmp_path):
        """Regression: painter's algorithm let background bleed through the solid.

        A sphere's silhouette is where centroid depth-sorting mis-ordered
        overlapping triangles; the Z-buffer must leave the interior solid. Scans
        a horizontal band through the middle and asserts one unbroken run.
        """
        tris = []
        rings = segments = 24
        for i in range(rings):
            t0, t1 = math.pi * i / rings, math.pi * (i + 1) / rings
            for j in range(segments):
                p0, p1 = 2 * math.pi * j / segments, 2 * math.pi * (j + 1) / segments

                def point(t, p):
                    return (
                        math.sin(t) * math.cos(p),
                        math.sin(t) * math.sin(p),
                        math.cos(t),
                    )

                a, b = point(t0, p0), point(t0, p1)
                c, d = point(t1, p1), point(t1, p0)
                tris.extend([(a, b, c), (a, c, d)])

        buf = render_stl(_write_binary(str(tmp_path / "sph.stl"), tris), 64, 64)
        row = 32
        painted = [
            buf[((row * 64) + x) * 3 : ((row * 64) + x) * 3 + 3] != BACKGROUND
            for x in range(64)
        ]
        runs = sum(
            1 for x in range(1, 64) if painted[x] and not painted[x - 1]
        ) + int(painted[0])
        assert runs == 1, "background bled through the interior of a closed mesh"

    def test_degenerate_mesh_returns_none(self, tmp_path):
        """All vertices coincident: zero extent, nothing to fit or draw."""
        flat = [(((0.0, 0.0, 0.0),) * 3)]
        assert render_stl(_write_binary(str(tmp_path / "d.stl"), flat), 64, 64) is None

    def test_zero_area_triangle_is_survivable(self, tmp_path):
        """Collinear vertices give a zero-length normal; shading must not divide by it."""
        sliver = [((0.0, 0.0, 0.0), (1.0, 1.0, 1.0), (2.0, 2.0, 2.0))]
        assert render_stl(_write_binary(str(tmp_path / "sl.stl"), sliver), 64, 64) is None

    def test_unreadable_file_returns_none(self, tmp_path):
        path = tmp_path / "junk.stl"
        path.write_bytes(b"nope")
        assert render_stl(str(path), 64, 64) is None

    def test_inverted_winding_still_renders(self, tmp_path):
        """A cube wound inside-out still draws — culling reveals its far side.

        Worth pinning: a closed solid cannot cull to nothing whichever way it is
        wound, so an exporter that flipped its winding produces a usable
        thumbnail rather than a blank tile.
        """
        inverted = [tuple(reversed(tri)) for tri in _cube()]
        buf = render_stl(_write_binary(str(tmp_path / "inv.stl"), inverted), 64, 64)
        assert buf is not None
        assert _non_background_pixels(buf) > 100

    def test_single_backfacing_triangle_returns_none(self, tmp_path):
        """Every face culled means nothing was drawn, which is a failure."""
        facing_away = [((-1.0, -1.0, 0.0), (1.0, -1.0, 0.0), (0.0, 1.0, 0.0))]
        path = _write_binary(str(tmp_path / "one.stl"), facing_away)
        flipped = [tuple(reversed(facing_away[0]))]
        other = _write_binary(str(tmp_path / "two.stl"), flipped)
        # Exactly one of the two windings is culled; the other draws.
        results = [render_stl(path, 64, 64), render_stl(other, 64, 64)]
        assert sum(r is None for r in results) == 1


class TestThumbnailIntegration:
    def test_generate_thumbnail_writes_a_webp(self, tmp_path):
        """The rasteriser reaches disk through the normal thumbnail entry point."""
        from backend.indexer.thumbnails import generate_thumbnail

        src = _write_binary(str(tmp_path / "mini.stl"), _cube())
        out = str(tmp_path / "mini.webp")
        assert generate_thumbnail(src, out, (300, 300)) is True
        assert os.path.getsize(out) > 0

    def test_opaque_model_format_is_declined(self, tmp_path):
        """A sliced printer file is registered but has no thumbnail path."""
        from backend.indexer.thumbnails import generate_thumbnail

        src = tmp_path / "mini.ctb"
        src.write_bytes(b"sliced voxel data")
        assert generate_thumbnail(str(src), str(tmp_path / "o.webp"), (300, 300)) is False
