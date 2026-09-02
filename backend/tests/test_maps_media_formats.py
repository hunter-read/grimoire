"""Map viewer format support: downscaled previews, video, and Universal VTT.

Covers the viewer-performance fix (serving a small WebP render instead of the
original multi-megabyte file) and the .webm/.mp4/.uvtt formats added to the
map detail view.
"""
import base64
import io
import json
import os

import pytest
from PIL import Image

from backend.tests.conftest import make_map
from backend.routers.maps._helpers import (
    _map_media_type,
    _sniff_image_mime,
    render_map_preview,
    vtt_image_bytes,
    vtt_metadata,
)


def _write_png(path, size=(4000, 3000), color=(30, 90, 140)):
    Image.new("RGB", size, color).save(path)
    return path


def _uvtt_doc(image_bytes=None, **over):
    doc = {
        "format": 0.3,
        "resolution": {
            "map_origin": {"x": 0, "y": 0},
            "map_size": {"x": 20, "y": 16},
            "pixels_per_grid": 100,
        },
        "line_of_sight": [
            [{"x": 1, "y": 1}, {"x": 2, "y": 2}],
            [{"x": 3, "y": 3}, {"x": 4, "y": 4}],
        ],
        "objects_line_of_sight": [[{"x": 0, "y": 0}]],
        "portals": [{"position": {"x": 5, "y": 5}, "closed": True}],
        "lights": [{"position": {"x": 2, "y": 2}, "range": 30}],
    }
    if image_bytes is not None:
        doc["image"] = base64.b64encode(image_bytes).decode()
    doc.update(over)
    return doc


@pytest.fixture
def png_map(tmp_path):
    path = _write_png(str(tmp_path / "big.png"))
    return make_map(filename="big.png", filepath=path, relative_path="DnD/Maps/big.png")


@pytest.fixture
def uvtt_map(tmp_path):
    buf = io.BytesIO()
    Image.new("RGB", (600, 480), (10, 60, 30)).save(buf, "PNG")
    path = tmp_path / "tavern.uvtt"
    path.write_text(json.dumps(_uvtt_doc(buf.getvalue())))
    return make_map(
        filename="tavern.uvtt", filepath=str(path), relative_path="DnD/Maps/tavern.uvtt"
    )


class TestMapMediaType:
    """The old ``f"image/{ext}"`` guess produced unplayable types like image/webm."""

    @pytest.mark.parametrize(
        "name,expected",
        [
            ("a.webm", "video/webm"),
            ("a.mp4", "video/mp4"),
            ("a.uvtt", "application/json"),
            ("a.dd2vtt", "application/json"),
            ("a.pdf", "application/pdf"),
            ("a.jpg", "image/jpeg"),
            ("a.png", "image/png"),
            ("a.svg", "image/svg+xml"),
        ],
    )
    def test_media_type(self, name, expected):
        assert _map_media_type(name) == expected

    def test_extension_case_is_ignored(self):
        assert _map_media_type("A.WEBM") == "video/webm"


class TestSniffImageMime:
    @pytest.mark.parametrize(
        "fmt,expected",
        [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")],
    )
    def test_detects_format(self, fmt, expected):
        buf = io.BytesIO()
        Image.new("RGB", (8, 8)).save(buf, fmt)
        assert _sniff_image_mime(buf.getvalue()) == expected

    def test_unknown_bytes_fall_back(self):
        assert _sniff_image_mime(b"not an image") == "application/octet-stream"


class TestRenderMapPreview:
    def test_downscales_large_map(self, tmp_path):
        path = _write_png(str(tmp_path / "huge.png"), size=(6000, 4000))
        out = render_map_preview(path, 1600)
        img = Image.open(io.BytesIO(out))
        assert img.width == 1600
        assert img.format == "WEBP"
        # The point of the fix: the preview is far smaller than the original.
        assert len(out) < os.path.getsize(path)

    def test_does_not_upscale_small_map(self, tmp_path):
        path = _write_png(str(tmp_path / "small.png"), size=(400, 300))
        img = Image.open(io.BytesIO(render_map_preview(path, 1600)))
        assert img.size == (400, 300)

    def test_second_call_is_cached(self, tmp_path):
        path = _write_png(str(tmp_path / "c.png"), size=(1200, 900))
        first = render_map_preview(path, 800)
        assert render_map_preview(path, 800) == first

    def test_replacing_the_file_invalidates_the_cache(self, tmp_path):
        path = str(tmp_path / "swap.png")
        _write_png(path, size=(1200, 900), color=(200, 10, 10))
        first = render_map_preview(path, 800)
        # A rescan replaces the file in place; the cache key mixes in mtime so the
        # stale render is not served forever.
        os.utime(path, (0, 0))
        _write_png(path, size=(1200, 900), color=(10, 10, 200))
        os.utime(path, (10_000, 10_000))
        assert render_map_preview(path, 800) != first


class TestServeMapPagePreview:
    def test_raster_map_serves_a_webp_preview(self, client, admin_headers, png_map):
        resp = client.get(f"/api/maps/{png_map.id}/page/1", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/webp"
        # Much smaller than streaming the original PNG.
        assert len(resp.content) < os.path.getsize(png_map.filepath)

    def test_preview_is_cached_immutably(self, client, admin_headers, png_map):
        resp = client.get(f"/api/maps/{png_map.id}/page/1", headers=admin_headers)
        assert "immutable" in resp.headers["cache-control"]

    def test_width_is_honoured(self, client, admin_headers, png_map):
        resp = client.get(f"/api/maps/{png_map.id}/page/1?width=800", headers=admin_headers)
        assert Image.open(io.BytesIO(resp.content)).width == 800

    def test_video_map_has_no_page(self, client, admin_headers, tmp_path):
        path = tmp_path / "storm.webm"
        path.write_bytes(b"\x1a\x45\xdf\xa3fake webm")
        m = make_map(
            filename="storm.webm", filepath=str(path), relative_path="DnD/Maps/storm.webm"
        )
        resp = client.get(f"/api/maps/{m.id}/page/1", headers=admin_headers)
        assert resp.status_code == 400

    def test_uvtt_map_has_no_page(self, client, admin_headers, uvtt_map):
        resp = client.get(f"/api/maps/{uvtt_map.id}/page/1", headers=admin_headers)
        assert resp.status_code == 400


class TestServeMapFile:
    def test_video_served_with_playable_mime_and_inline(self, client, admin_headers, tmp_path):
        path = tmp_path / "storm.mp4"
        path.write_bytes(b"\x00\x00\x00\x18ftypmp42")
        m = make_map(filename="storm.mp4", filepath=str(path), relative_path="DnD/Maps/storm.mp4")
        resp = client.get(f"/api/maps/{m.id}/file", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "video/mp4"
        # An attachment disposition would download the file instead of playing it.
        assert "attachment" not in resp.headers.get("content-disposition", "")

    def test_originals_get_a_short_private_cache(self, client, admin_headers, png_map):
        resp = client.get(f"/api/maps/{png_map.id}/file", headers=admin_headers)
        cache = resp.headers["cache-control"]
        assert "private" in cache
        assert "immutable" not in cache


class TestVttParsing:
    def test_metadata_counts_features(self, tmp_path):
        path = tmp_path / "m.uvtt"
        path.write_text(json.dumps(_uvtt_doc(b"")))
        data = vtt_metadata(str(path))
        assert data["grid_width"] == 20
        assert data["grid_height"] == 16
        assert data["pixels_per_grid"] == 100
        assert data["wall_count"] == 2
        assert data["object_wall_count"] == 1
        assert data["portal_count"] == 1
        assert data["light_count"] == 1

    def test_metadata_tolerates_missing_sections(self, tmp_path):
        path = tmp_path / "bare.uvtt"
        path.write_text(json.dumps({"format": 0.2}))
        data = vtt_metadata(str(path))
        assert data["wall_count"] == 0
        assert data["light_count"] == 0
        assert data["has_image"] is False

    def test_image_is_decoded_from_base64(self, tmp_path):
        buf = io.BytesIO()
        Image.new("RGB", (120, 90), (5, 5, 5)).save(buf, "PNG")
        path = tmp_path / "i.uvtt"
        path.write_text(json.dumps(_uvtt_doc(buf.getvalue())))
        assert Image.open(io.BytesIO(vtt_image_bytes(str(path)))).size == (120, 90)

    def test_image_accepts_a_data_uri(self, tmp_path):
        buf = io.BytesIO()
        Image.new("RGB", (60, 40)).save(buf, "PNG")
        doc = _uvtt_doc()
        doc["image"] = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        path = tmp_path / "d.dd2vtt"
        path.write_text(json.dumps(doc))
        assert Image.open(io.BytesIO(vtt_image_bytes(str(path)))).size == (60, 40)

    def test_uppercase_image_key_is_accepted(self, tmp_path):
        buf = io.BytesIO()
        Image.new("RGB", (30, 20)).save(buf, "PNG")
        doc = _uvtt_doc()
        doc["Image"] = base64.b64encode(buf.getvalue()).decode()
        path = tmp_path / "u.uvtt"
        path.write_text(json.dumps(doc))
        assert Image.open(io.BytesIO(vtt_image_bytes(str(path)))).size == (30, 20)

    def test_invalid_json_raises(self, tmp_path):
        path = tmp_path / "bad.uvtt"
        path.write_text("definitely not json")
        with pytest.raises(ValueError):
            vtt_metadata(str(path))

    def test_missing_image_raises(self, tmp_path):
        path = tmp_path / "noimg.uvtt"
        path.write_text(json.dumps(_uvtt_doc()))
        with pytest.raises(ValueError):
            vtt_image_bytes(str(path))


class TestVttEndpoints:
    def test_image_endpoint_returns_a_picture(self, client, admin_headers, uvtt_map):
        resp = client.get(f"/api/maps/{uvtt_map.id}/vtt/image", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert Image.open(io.BytesIO(resp.content)).size == (600, 480)

    def test_data_endpoint_returns_counts_without_the_image(
        self, client, admin_headers, uvtt_map
    ):
        resp = client.get(f"/api/maps/{uvtt_map.id}/vtt/data", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["wall_count"] == 2
        assert body["portal_count"] == 1
        assert body["has_image"] is True
        assert "image" not in body

    def test_rejects_a_non_vtt_map(self, client, admin_headers, png_map):
        assert (
            client.get(f"/api/maps/{png_map.id}/vtt/data", headers=admin_headers).status_code
            == 400
        )

    def test_unknown_map_is_404(self, client, admin_headers):
        resp = client.get("/api/maps/does-not-exist/vtt/data", headers=admin_headers)
        assert resp.status_code == 404

    def test_unauthenticated_denied(self, client, uvtt_map):
        assert client.get(f"/api/maps/{uvtt_map.id}/vtt/image").status_code == 401


class TestMediaKind:
    """`media_kind` tells the frontend which viewer to mount."""

    @pytest.mark.parametrize(
        "name,expected",
        [("a.png", "image"), ("a.webm", "video"), ("a.mp4", "video"), ("a.uvtt", "vtt")],
    )
    def test_detail_reports_media_kind(self, client, admin_headers, tmp_path, name, expected):
        path = tmp_path / name
        path.write_bytes(b"x")
        m = make_map(filename=name, filepath=str(path), relative_path=f"DnD/Maps/{name}")
        resp = client.get(f"/api/maps/{m.id}", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["media_kind"] == expected


class TestVttThumbnail:
    """A UVTT file holds its own cover image, so it thumbnails without a decoder."""

    def test_generates_a_thumbnail_from_the_embedded_image(self, tmp_path):
        from backend.indexer import generate_thumbnail

        buf = io.BytesIO()
        Image.new("RGB", (2000, 1500), (40, 110, 60)).save(buf, "PNG")
        src = tmp_path / "keep.uvtt"
        src.write_text(json.dumps(_uvtt_doc(buf.getvalue())))
        out = tmp_path / "thumbs" / "keep.webp"

        assert generate_thumbnail(str(src), str(out), size=(300, 400)) is True
        thumb = Image.open(out)
        assert thumb.format == "WEBP"
        # Scaled down into the requested box, aspect preserved.
        assert thumb.width <= 300 and thumb.height <= 400

    def test_dd2vtt_is_handled_too(self, tmp_path):
        from backend.indexer import generate_thumbnail

        buf = io.BytesIO()
        Image.new("RGB", (400, 300)).save(buf, "PNG")
        src = tmp_path / "keep.dd2vtt"
        src.write_text(json.dumps(_uvtt_doc(buf.getvalue())))
        out = tmp_path / "t.webp"
        assert generate_thumbnail(str(src), str(out)) is True

    def test_malformed_vtt_yields_no_thumbnail_without_raising(self, tmp_path):
        from backend.indexer import generate_thumbnail

        src = tmp_path / "bad.uvtt"
        src.write_text("not json at all")
        assert generate_thumbnail(str(src), str(tmp_path / "t.webp")) is False

    def test_vtt_without_an_image_yields_no_thumbnail(self, tmp_path):
        from backend.indexer import generate_thumbnail

        src = tmp_path / "noimg.uvtt"
        src.write_text(json.dumps(_uvtt_doc()))
        assert generate_thumbnail(str(src), str(tmp_path / "t.webp")) is False

    def test_video_maps_still_have_no_thumbnail(self, tmp_path):
        """Extracting a frame needs a decoder the image deliberately omits."""
        from backend.indexer import generate_thumbnail

        src = tmp_path / "storm.webm"
        src.write_bytes(b"\x1a\x45\xdf\xa3not a real webm")
        assert generate_thumbnail(str(src), str(tmp_path / "t.webp")) is False
