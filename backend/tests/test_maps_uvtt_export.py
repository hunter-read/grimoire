"""Universal VTT export: grid resolution, plausibility checks, and the endpoint.

The expected shapes here were taken from real Dungeondraft exports: format 0.3,
a zero map_origin, and a WebP-encoded image rather than the PNG the format is
usually described as carrying.
"""
import base64
import io
import json

import pytest
from PIL import Image

from backend.routers.maps.uvtt import (
    DEFAULT_PIXELS_PER_GRID,
    build_uvtt,
    check_grid_plausible,
    encode_map_image,
    resolve_grid,
    round2,
)
from backend.tests.conftest import make_map


class _Row:
    """Stand-in for a GenericMap row carrying only the override columns."""

    def __init__(self, w=None, h=None, px=None):
        self.grid_width, self.grid_height, self.grid_px = w, h, px


def _img(path, w, h, mode="RGB"):
    Image.new(mode, (w, h), (30, 40, 50) if mode == "RGB" else (30, 40, 50, 255)).save(str(path))
    return str(path)


@pytest.fixture
def raster_map(tmp_path):
    # 1400x1960 is 10x14 cells at the 140px/cell that real battlemaps ship at.
    path = _img(tmp_path / "village.png", 1400, 1960)
    return make_map(
        filename="village.png", filepath=path, relative_path="DnD/Maps/village.png"
    )


class TestRound2:
    def test_rounds_to_two_places(self):
        assert round2(138.94736) == 138.95

    def test_leaves_whole_numbers_clean(self):
        assert round2(33) == 33.0


class TestResolveGrid:
    def test_override_wins(self):
        info = {"pixel_width": 4620, "pixel_height": 3360, "grid": {"width": 66, "height": 48}}
        g = resolve_grid(_Row(33, 24, 140), info)
        assert g == {"width": 33.0, "height": 24.0, "px": 140, "source": "manual"}

    def test_override_without_px_derives_it(self):
        info = {"pixel_width": 4620, "pixel_height": 3360, "grid": None}
        g = resolve_grid(_Row(33, 24, None), info)
        assert g["px"] == 140.0
        assert g["source"] == "manual"

    def test_fractional_override_is_kept(self):
        # A map that bleeds a quarter cell past its grid.
        info = {"pixel_width": 4620, "pixel_height": 3360, "grid": None}
        g = resolve_grid(_Row(33.25, 24.25, None), info)
        assert (g["width"], g["height"]) == (33.25, 24.25)
        assert g["px"] == 138.95

    def test_falls_back_to_detection(self):
        info = {
            "pixel_width": 4620,
            "pixel_height": 6440,
            "grid": {"width": 33, "height": 46, "cell_px": 140, "source": "computed"},
        }
        g = resolve_grid(_Row(), info)
        assert g == {"width": 33.0, "height": 46.0, "px": 140, "source": "computed"}

    def test_detection_without_cell_px_derives_it(self):
        # The filename branch reports no cell size, so it comes from the raster.
        info = {
            "pixel_width": 4620,
            "pixel_height": 6440,
            "grid": {"width": 33, "height": 46, "source": "filename"},
        }
        assert resolve_grid(_Row(), info)["px"] == 140.0

    def test_default_when_nothing_detected(self):
        info = {"pixel_width": 1400, "pixel_height": 700, "grid": None}
        g = resolve_grid(_Row(), info)
        assert g["px"] == DEFAULT_PIXELS_PER_GRID
        assert (g["width"], g["height"]) == (10.0, 5.0)
        assert g["source"] == "default"

    def test_default_with_no_raster_reports_zero(self):
        g = resolve_grid(_Row(), {"pixel_width": None, "pixel_height": None, "grid": None})
        assert (g["width"], g["height"]) == (0.0, 0.0)


class TestCheckGridPlausible:
    def test_correct_grid_is_silent(self):
        # 4620x3360 really is 33x24 at 140px.
        assert check_grid_plausible(4620, 3360, 33, 24) is None

    def test_quarter_cell_bleed_is_accepted(self):
        # Maps often carry a partial cell at each edge; both axes stay in step,
        # so this must not warn.
        assert check_grid_plausible(4620, 3360, 33.25, 24.25) is None

    def test_typo_is_flagged(self):
        # 23x24 for 33x24 skews one axis only: 200.9px vs 140px per cell.
        w = check_grid_plausible(4620, 3360, 23, 24)
        assert w["code"] == "aspect_mismatch"
        assert w["cell_x"] == 200.87
        assert w["cell_y"] == 140.0
        assert w["suggested_width"] == 33.0

    def test_transposed_dimensions_are_flagged(self):
        assert check_grid_plausible(4620, 3360, 33, 42) is not None

    def test_no_warning_without_pixel_dimensions(self):
        assert check_grid_plausible(None, None, 33, 24) is None

    def test_no_warning_for_nonpositive_grid(self):
        assert check_grid_plausible(4620, 3360, 0, 24) is None

    def test_no_warning_for_zero_pixel_height(self):
        assert check_grid_plausible(4620, 0, 33, 24) is None


class TestEncodeMapImage:
    def test_encodes_as_webp(self, tmp_path):
        raw = base64.b64decode(encode_map_image(_img(tmp_path / "m.png", 280, 140)))
        img = Image.open(io.BytesIO(raw))
        assert img.format == "WEBP"
        assert img.size == (280, 140)

    def test_preserves_transparency(self, tmp_path):
        raw = base64.b64decode(encode_map_image(_img(tmp_path / "a.png", 200, 200, "RGBA")))
        assert Image.open(io.BytesIO(raw)).mode in ("RGBA", "RGB")

    def test_converts_palette_images(self, tmp_path):
        path = tmp_path / "p.png"
        Image.new("P", (200, 200)).save(str(path))
        assert Image.open(io.BytesIO(base64.b64decode(encode_map_image(str(path))))).size == (
            200,
            200,
        )

    def test_converts_grayscale(self, tmp_path):
        path = tmp_path / "g.png"
        Image.new("L", (200, 200), 128).save(str(path))
        assert Image.open(io.BytesIO(base64.b64decode(encode_map_image(str(path))))).size == (
            200,
            200,
        )

    def test_steps_quality_down_when_the_encoder_refuses(self, tmp_path, monkeypatch):
        # libwebp overflows its first partition on large detailed maps at high
        # quality. The export must degrade rather than fail, so the first
        # attempt is made to raise and the retry has to carry it.
        real_save = Image.Image.save
        calls = []

        def flaky_save(self, fp, format=None, **kw):
            calls.append(kw.get("quality"))
            if len(calls) == 1:
                raise ValueError("encoding error 6")
            return real_save(self, fp, format=format, **kw)

        # Write the fixture first: the patch below intercepts every Image.save,
        # including the one that would create it.
        path = _img(tmp_path / "q.png", 200, 200)
        monkeypatch.setattr(Image.Image, "save", flaky_save)
        raw = base64.b64decode(encode_map_image(path))
        assert Image.open(io.BytesIO(raw)).format == "WEBP"
        assert calls[0] > calls[1]  # dropped to a lower quality to succeed

    def test_raises_when_every_quality_fails(self, tmp_path, monkeypatch):
        def always_fail(self, fp, format=None, **kw):
            raise ValueError("encoding error 6")

        path = _img(tmp_path / "bad.png", 100, 100)
        monkeypatch.setattr(Image.Image, "save", always_fail)
        with pytest.raises(ValueError, match="could not be encoded"):
            encode_map_image(path)

    def test_downscales_beyond_webp_limit(self, tmp_path, monkeypatch):
        # Patch the cap rather than building a 16k image in a test.
        monkeypatch.setattr("backend.routers.maps.uvtt.WEBP_MAX_DIM", 100)
        raw = base64.b64decode(encode_map_image(_img(tmp_path / "big.png", 400, 200)))
        assert max(Image.open(io.BytesIO(raw)).size) == 100


class TestBuildUvtt:
    def test_envelope_matches_the_real_format(self, tmp_path):
        path = _img(tmp_path / "m.png", 1400, 1960)
        env = build_uvtt(path, {"width": 10.0, "height": 14.0, "px": 140, "source": "computed"})
        assert env["format"] == 0.3
        assert env["resolution"] == {
            "map_origin": {"x": 0, "y": 0},
            "map_size": {"x": 10.0, "y": 14.0},
            "pixels_per_grid": 140,
        }
        assert env["line_of_sight"] == []
        assert env["objects_line_of_sight"] == []
        assert env["portals"] == []
        assert env["lights"] == []
        assert env["environment"] == {"baked_lighting": False, "ambient_light": "00000000"}
        assert Image.open(io.BytesIO(base64.b64decode(env["image"]))).format == "WEBP"


class TestExportEndpoint:
    def test_exports_a_raster_map(self, client, admin_headers, raster_map):
        r = client.get(f"/api/maps/{raster_map.id}/export.uvtt", headers=admin_headers)
        assert r.status_code == 200
        assert r.headers["content-disposition"].startswith("attachment")
        body = json.loads(r.content)
        assert body["format"] == 0.3
        # 1400x1960 detects as 10x14 at 140px/cell.
        assert body["resolution"]["map_size"] == {"x": 10.0, "y": 14.0}
        assert body["resolution"]["pixels_per_grid"] == 140

    def test_export_uses_the_override(self, client, admin_headers, raster_map):
        client.patch(
            f"/api/maps/{raster_map.id}",
            json={"grid_width": 10.5, "grid_height": 14.5},
            headers=admin_headers,
        )
        body = json.loads(
            client.get(f"/api/maps/{raster_map.id}/export.uvtt", headers=admin_headers).content
        )
        assert body["resolution"]["map_size"] == {"x": 10.5, "y": 14.5}

    def test_second_request_is_served_from_cache(self, client, admin_headers, raster_map):
        first = client.get(f"/api/maps/{raster_map.id}/export.uvtt", headers=admin_headers)
        second = client.get(f"/api/maps/{raster_map.id}/export.uvtt", headers=admin_headers)
        assert first.content == second.content

    def test_filename_ends_in_uvtt_not_json(self, client, admin_headers, raster_map):
        # The body is JSON by format, but it is a file to save. Serving it as
        # application/json made the browser offer it as a .json download.
        r = client.get(f"/api/maps/{raster_map.id}/export.uvtt", headers=admin_headers)
        assert r.headers["content-disposition"] == 'attachment; filename="village.uvtt"'
        assert r.headers["content-type"] == "application/octet-stream"

    def test_filename_keeps_its_extension_after_slugifying(
        self, client, admin_headers, tmp_path
    ):
        # slugify strips the dot, so slugifying the whole filename would produce
        # "original-day-bone-milluvtt" -- no extension at all.
        path = _img(tmp_path / "x.png", 280, 140)
        m = make_map(
            filename="Original Day - Bone Mill.png",
            filepath=path,
            relative_path="DnD/Maps/Original Day - Bone Mill.png",
        )
        r = client.get(f"/api/maps/{m.id}/export.uvtt", headers=admin_headers)
        assert r.headers["content-disposition"].endswith('.uvtt"')
        assert "original-day-bone-mill.uvtt" in r.headers["content-disposition"]

    def test_map_linked_to_a_uvtt_is_rejected(self, client, admin_headers, tmp_path):
        # The linked file already carries walls and lights; ours would carry
        # none, so exporting would be a downgrade offered as an upgrade.
        from backend.config import SessionLocal
        from backend.models import GenericMap as GM
        from backend.services import variants as vsvc

        img = make_map(
            filename="keep.png",
            filepath=_img(tmp_path / "keep.png", 280, 140),
            relative_path="DnD/Maps/keep.png",
        )
        vtt = make_map(
            filename="anything-at-all.dat",
            filepath=str(tmp_path / "keep.uvtt"),
            relative_path="DnD/Maps/anything-at-all.dat",
        )
        db = SessionLocal()
        vsvc.link(db, GM, img.id, vtt.id, "universal-vtt", resource_type="map")
        db.commit()
        db.close()

        r = client.get(f"/api/maps/{img.id}/export.uvtt", headers=admin_headers)
        assert r.status_code == 400
        assert "already linked" in r.json()["detail"]

    def test_pdf_map_is_rejected(self, client, admin_headers, tmp_path):
        import fitz

        path = tmp_path / "atlas.pdf"
        doc = fitz.open()
        doc.new_page()
        doc.save(str(path))
        doc.close()
        m = make_map(
            filename="atlas.pdf", filepath=str(path), relative_path="DnD/Maps/atlas.pdf"
        )
        r = client.get(f"/api/maps/{m.id}/export.uvtt", headers=admin_headers)
        assert r.status_code == 400

    def test_missing_file_is_404(self, client, admin_headers):
        m = make_map(
            filename="gone.png",
            filepath="/nonexistent/gone.png",
            relative_path="DnD/Maps/gone.png",
        )
        assert (
            client.get(f"/api/maps/{m.id}/export.uvtt", headers=admin_headers).status_code == 404
        )

    def test_unknown_map_is_404(self, client, admin_headers):
        assert (
            client.get("/api/maps/nope/export.uvtt", headers=admin_headers).status_code == 404
        )


class TestGridOverrideEndpoint:
    def test_saves_and_echoes_the_override(self, client, admin_headers, raster_map):
        r = client.patch(
            f"/api/maps/{raster_map.id}",
            json={"grid_width": 10.5, "grid_height": 14.5, "grid_px": 133.33},
            headers=admin_headers,
        )
        assert r.status_code == 200
        assert r.json()["grid_warning"] is None
        detail = client.get(f"/api/maps/{raster_map.id}", headers=admin_headers).json()
        assert detail["grid_width"] == 10.5
        assert detail["grid"]["source"] == "manual"

    def test_rounds_to_two_decimal_places(self, client, admin_headers, raster_map):
        client.patch(
            f"/api/maps/{raster_map.id}",
            json={"grid_width": 10.126, "grid_height": 14.0},
            headers=admin_headers,
        )
        detail = client.get(f"/api/maps/{raster_map.id}", headers=admin_headers).json()
        assert detail["grid_width"] == 10.13

    def test_implausible_grid_saves_but_warns(self, client, admin_headers, raster_map):
        # 1400x1960 as 20x14 implies 70px on one axis and 140 on the other.
        r = client.patch(
            f"/api/maps/{raster_map.id}",
            json={"grid_width": 20, "grid_height": 14},
            headers=admin_headers,
        )
        assert r.status_code == 200
        assert r.json()["grid_warning"]["code"] == "aspect_mismatch"
        # Saved regardless -- the warning is advisory, not a rejection.
        detail = client.get(f"/api/maps/{raster_map.id}", headers=admin_headers).json()
        assert detail["grid_width"] == 20.0

    def test_zero_clears_the_override(self, client, admin_headers, raster_map):
        client.patch(
            f"/api/maps/{raster_map.id}",
            json={"grid_width": 10.5, "grid_height": 14.5},
            headers=admin_headers,
        )
        client.patch(
            f"/api/maps/{raster_map.id}",
            json={"grid_width": 0, "grid_height": 0},
            headers=admin_headers,
        )
        detail = client.get(f"/api/maps/{raster_map.id}", headers=admin_headers).json()
        assert detail["grid_width"] is None
        # Detection takes over again.
        assert detail["grid"]["source"] == "computed"

    def test_other_fields_leave_the_grid_alone(self, client, admin_headers, raster_map):
        # A PATCH that never mentions the grid must not clear an existing
        # override -- exclude_none drops the absent fields.
        client.patch(
            f"/api/maps/{raster_map.id}",
            json={"grid_width": 10.5, "grid_height": 14.5},
            headers=admin_headers,
        )
        client.patch(
            f"/api/maps/{raster_map.id}", json={"map_type": "dungeon"}, headers=admin_headers
        )
        detail = client.get(f"/api/maps/{raster_map.id}", headers=admin_headers).json()
        assert detail["grid_width"] == 10.5

    def test_rejects_out_of_range_values(self, client, admin_headers, raster_map):
        r = client.patch(
            f"/api/maps/{raster_map.id}", json={"grid_width": 5000}, headers=admin_headers
        )
        assert r.status_code == 422
