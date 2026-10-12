"""OTFBM export (issue #551): sizing a map for Avrae's ``!map``, and the endpoints.

OTFBM draws the background at its native size under a grid of ``c`` pixels per
cell, so the whole job is resizing the picture until one of its cells is
exactly ``c`` pixels. These tests pin that arithmetic and the limits OTFBM puts
on it (cells 20-100px, at most 99 cells per side, no WebP).
"""
import base64
import io
import json

import pytest
from PIL import Image

from backend.routers.maps.otfbm import (
    MAX_CELL,
    MAX_MAPSIZE,
    MIN_CELL,
    SUGGESTED_CELL,
    plan_otfbm,
    render_otfbm_image,
    suggest_cell,
    whole_cells,
)
from backend.tests.conftest import make_map
from backend.tests.share_link_helpers import set_override, set_role_default

# Restores the session users' share permissions after tests that change them.
pytest_plugins = ["backend.tests.share_link_helpers"]


def _img(path, w, h, mode="RGB", color=(30, 40, 50)):
    Image.new(mode, (w, h), color).save(str(path))
    return str(path)


def _grid(width, height, px, source="manual"):
    return {"width": width, "height": height, "px": px, "source": source}


@pytest.fixture
def raster_map(tmp_path):
    # 1400x1960 is 10x14 cells at the 140px/cell the default grid assumes.
    path = _img(tmp_path / "village.png", 1400, 1960)
    return make_map(
        filename="village.png", filepath=path, relative_path="DnD/Maps/village.png"
    )


class TestWholeCells:
    def test_bleed_rounds_down(self):
        # A quarter-cell margin is not a playable square.
        assert whole_cells(33.25) == 33

    def test_detection_noise_rounds_up(self):
        assert whole_cells(32.97) == 33

    def test_never_below_one(self):
        assert whole_cells(0.2) == 1

    def test_capped_at_otfbm_limit(self):
        assert whole_cells(140) == MAX_MAPSIZE


class TestSuggestCell:
    def test_large_cells_come_down_to_the_suggestion(self):
        assert suggest_cell(140) == SUGGESTED_CELL

    def test_small_cells_are_not_upscaled(self):
        assert suggest_cell(50.4) == 50

    def test_never_below_otfbm_minimum(self):
        assert suggest_cell(8) == MIN_CELL


class TestPlan:
    def test_resizes_so_each_cell_is_the_cell_size(self):
        plan = plan_otfbm(_grid(33, 24, 140), 4620, 3360)
        assert plan["cell"] == 70
        assert (plan["width"], plan["height"]) == (33, 24)
        # Half size: each 140px cell becomes 70px.
        assert (plan["image_width"], plan["image_height"]) == (2310, 1680)
        assert plan["truncated"] is False

    def test_requested_cell_overrides_the_suggestion(self):
        plan = plan_otfbm(_grid(33, 24, 140), 4620, 3360, cell=100)
        assert plan["cell"] == 100
        assert plan["suggested_cell"] == 70
        assert plan["image_width"] == 3300

    def test_requested_cell_is_clamped(self):
        assert plan_otfbm(_grid(10, 10, 140), 1400, 1400, cell=500)["cell"] == MAX_CELL
        assert plan_otfbm(_grid(10, 10, 140), 1400, 1400, cell=5)["cell"] == MIN_CELL

    def test_bleed_keeps_the_full_picture(self):
        # 33.25 cells: the grid is 33 wide, but the sliver of bleed stays in the
        # image rather than being cropped off.
        plan = plan_otfbm(_grid(33.25, 24.25, 140), 4655, 3395)
        assert (plan["width"], plan["height"]) == (33, 24)
        assert plan["image_width"] == round(4655 / 2)

    def test_oversized_map_is_flagged(self):
        plan = plan_otfbm(_grid(120, 50, 100), 12000, 5000)
        assert plan["width"] == MAX_MAPSIZE
        assert plan["truncated"] is True

    def test_reports_source_and_limits(self):
        plan = plan_otfbm(_grid(10, 10, 140, source="filename"), 1400, 1400)
        assert plan["grid_source"] == "filename"
        assert plan["source_px"] == 140
        assert (plan["min_cell"], plan["max_cell"]) == (MIN_CELL, MAX_CELL)

    def test_missing_cell_size_is_derived_from_the_raster(self):
        plan = plan_otfbm({"width": 10, "height": 5, "px": 0}, 1000, 500)
        assert plan["source_px"] == 100


class TestRender:
    def test_opaque_map_is_jpeg_at_the_planned_size(self, tmp_path):
        raw, ext = render_otfbm_image(_img(tmp_path / "a.png", 280, 140), 140, 70)
        assert ext == "jpg"
        with Image.open(io.BytesIO(raw)) as img:
            assert img.format == "JPEG"
            assert img.size == (140, 70)

    def test_opaque_rgba_is_still_jpeg(self, tmp_path):
        # An alpha channel that is fully opaque is no reason to ship a PNG.
        path = _img(tmp_path / "a.png", 100, 100, "RGBA", (1, 2, 3, 255))
        assert render_otfbm_image(path, 50, 50)[1] == "jpg"

    def test_transparent_map_stays_png(self, tmp_path):
        path = _img(tmp_path / "a.png", 100, 100, "RGBA", (1, 2, 3, 0))
        raw, ext = render_otfbm_image(path, 50, 50)
        assert ext == "png"
        with Image.open(io.BytesIO(raw)) as img:
            assert img.mode == "RGBA"

    def test_palette_transparency_stays_png(self, tmp_path):
        img = Image.new("P", (40, 40), 0)
        img.info["transparency"] = 0
        path = tmp_path / "p.png"
        img.save(str(path), transparency=0)
        assert render_otfbm_image(str(path), 20, 20)[1] == "png"

    def test_greyscale_is_converted(self, tmp_path):
        path = _img(tmp_path / "g.png", 40, 40, "L", 128)
        assert render_otfbm_image(path, 40, 40)[1] == "jpg"

    def test_accepts_a_file_object(self, tmp_path):
        buf = io.BytesIO()
        Image.new("RGB", (60, 60)).save(buf, "PNG")
        buf.seek(0)
        assert render_otfbm_image(buf, 30, 30)[1] == "jpg"

    def test_undecodable_raises_value_error(self, tmp_path):
        bad = tmp_path / "bad.png"
        bad.write_bytes(b"not an image")
        with pytest.raises(ValueError):
            render_otfbm_image(str(bad), 10, 10)


class TestPlanEndpoint:
    def test_plans_a_raster_map(self, client, admin_headers, raster_map):
        r = client.get(f"/api/maps/{raster_map.id}/otfbm", headers=admin_headers)
        assert r.status_code == 200
        body = r.json()
        assert (body["width"], body["height"], body["cell"]) == (10, 14, 70)
        assert (body["image_width"], body["image_height"]) == (700, 980)

    def test_uses_the_grid_override(self, client, admin_headers, raster_map):
        client.patch(
            f"/api/maps/{raster_map.id}",
            json={"grid_width": 20, "grid_height": 28},
            headers=admin_headers,
        )
        body = client.get(f"/api/maps/{raster_map.id}/otfbm", headers=admin_headers).json()
        # 70px cells: the override makes them 70 already, so nothing resizes.
        assert (body["width"], body["height"], body["source_px"]) == (20, 28, 70)
        assert (body["image_width"], body["image_height"]) == (1400, 1960)
        assert body["grid_source"] == "manual"

    def test_takes_a_cell_size(self, client, admin_headers, raster_map):
        body = client.get(
            f"/api/maps/{raster_map.id}/otfbm", params={"cell": 40}, headers=admin_headers
        ).json()
        assert body["cell"] == 40
        assert body["image_width"] == 400

    def test_out_of_range_cell_is_rejected(self, client, admin_headers, raster_map):
        r = client.get(
            f"/api/maps/{raster_map.id}/otfbm", params={"cell": 150}, headers=admin_headers
        )
        assert r.status_code == 422

    def test_map_linked_to_a_uvtt_is_allowed(self, client, admin_headers, tmp_path, raster_map):
        # Unlike the .uvtt export: OTFBM has no walls, so a linked file holds
        # nothing ours would be missing.
        from backend.config import SessionLocal
        from backend.models import GenericMap as GM
        from backend.services import variants as vsvc

        vtt = make_map(
            filename="village.uvtt",
            filepath=str(tmp_path / "village.uvtt"),
            relative_path="DnD/Maps/village.uvtt",
        )
        db = SessionLocal()
        vsvc.link(db, GM, raster_map.id, vtt.id, "universal-vtt", resource_type="map")
        db.commit()
        db.close()
        r = client.get(f"/api/maps/{raster_map.id}/otfbm", headers=admin_headers)
        assert r.status_code == 200

    def test_pdf_map_is_rejected(self, client, admin_headers, tmp_path):
        import fitz

        path = tmp_path / "atlas.pdf"
        doc = fitz.open()
        doc.new_page()
        doc.save(str(path))
        doc.close()
        m = make_map(filename="atlas.pdf", filepath=str(path), relative_path="DnD/Maps/atlas.pdf")
        r = client.get(f"/api/maps/{m.id}/otfbm", headers=admin_headers)
        assert r.status_code == 400

    def test_unreadable_image_is_400(self, client, admin_headers, tmp_path):
        bad = tmp_path / "bad.png"
        bad.write_bytes(b"not an image")
        m = make_map(filename="bad.png", filepath=str(bad), relative_path="DnD/Maps/bad.png")
        assert client.get(f"/api/maps/{m.id}/otfbm", headers=admin_headers).status_code == 400

    def test_unknown_map_is_404(self, client, admin_headers):
        assert client.get("/api/maps/nope/otfbm", headers=admin_headers).status_code == 404


class TestImageEndpoint:
    def test_downloads_the_resized_background(self, client, admin_headers, raster_map):
        r = client.get(f"/api/maps/{raster_map.id}/otfbm/image", headers=admin_headers)
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/jpeg"
        assert 'filename="village-10x14c70.jpg"' in r.headers["content-disposition"]
        with Image.open(io.BytesIO(r.content)) as img:
            assert img.size == (700, 980)

    def test_cell_size_changes_size_and_name(self, client, admin_headers, raster_map):
        r = client.get(
            f"/api/maps/{raster_map.id}/otfbm/image",
            params={"cell": 100},
            headers=admin_headers,
        )
        assert "village-10x14c100.jpg" in r.headers["content-disposition"]
        with Image.open(io.BytesIO(r.content)) as img:
            assert img.size == (1000, 1400)

    def test_transparent_map_downloads_as_png(self, client, admin_headers, tmp_path):
        path = _img(tmp_path / "cut.png", 280, 140, "RGBA", (0, 0, 0, 0))
        m = make_map(filename="cut.png", filepath=path, relative_path="DnD/Maps/cut.png")
        r = client.get(f"/api/maps/{m.id}/otfbm/image", headers=admin_headers)
        assert r.headers["content-type"] == "image/png"
        assert r.headers["content-disposition"].endswith('.png"')

    def test_uvtt_uses_its_embedded_picture(self, client, admin_headers, tmp_path):
        buf = io.BytesIO()
        Image.new("RGB", (600, 480), (10, 60, 30)).save(buf, "PNG")
        path = tmp_path / "tavern.uvtt"
        path.write_text(
            json.dumps(
                {
                    "format": 0.3,
                    "resolution": {
                        "map_origin": {"x": 0, "y": 0},
                        "map_size": {"x": 6, "y": 4.8},
                        "pixels_per_grid": 100,
                    },
                    "image": base64.b64encode(buf.getvalue()).decode(),
                }
            )
        )
        m = make_map(
            filename="tavern.uvtt", filepath=str(path), relative_path="DnD/Maps/tavern.uvtt"
        )
        plan = client.get(f"/api/maps/{m.id}/otfbm", headers=admin_headers).json()
        # The file's own 100px/cell wins, so 6 x 4.8 cells -> a 6x4 grid at 70px.
        assert (plan["width"], plan["height"], plan["source_px"]) == (6, 4, 100)
        r = client.get(f"/api/maps/{m.id}/otfbm/image", headers=admin_headers)
        assert r.status_code == 200
        with Image.open(io.BytesIO(r.content)) as img:
            assert img.size == (420, 336)

    def test_uvtt_without_a_picture_is_400(self, client, admin_headers, tmp_path, monkeypatch):
        path = tmp_path / "empty.uvtt"
        path.write_text(json.dumps({"format": 0.3, "resolution": {"pixels_per_grid": 100}}))
        m = make_map(
            filename="empty.uvtt", filepath=str(path), relative_path="DnD/Maps/empty.uvtt"
        )
        # Let it past measurement, so the failure is the decode itself.
        from backend.routers.maps import core

        monkeypatch.setattr(core, "vtt_image_size", lambda _p: (600, 480))
        r = client.get(f"/api/maps/{m.id}/otfbm/image", headers=admin_headers)
        assert r.status_code == 400

    def test_nothing_is_written_beside_the_map(self, client, admin_headers, tmp_path, raster_map):
        before = sorted(p.name for p in tmp_path.iterdir())
        client.get(f"/api/maps/{raster_map.id}/otfbm/image", headers=admin_headers)
        assert sorted(p.name for p in tmp_path.iterdir()) == before


class TestNeedsSharePermission:
    """OTFBM is offered only to users who may create share links (issue #551):
    the point of it is a background OTFBM can fetch, which is a share link."""

    @pytest.mark.parametrize("suffix", ["otfbm", "otfbm/image"])
    def test_player_without_it_is_refused(self, client, player_headers, raster_map, suffix):
        r = client.get(f"/api/maps/{raster_map.id}/{suffix}", headers=player_headers)
        assert r.status_code == 403
        assert "share links" in r.json()["detail"]

    def test_player_granted_it_may(self, client, player_headers, player_id, raster_map):
        set_override(player_id, True)
        assert client.get(f"/api/maps/{raster_map.id}/otfbm", headers=player_headers).status_code == 200

    def test_gm_by_role_may_until_the_role_is_withdrawn(self, client, gm_headers, raster_map):
        assert client.get(f"/api/maps/{raster_map.id}/otfbm", headers=gm_headers).status_code == 200
        set_role_default("gm", False)
        assert client.get(f"/api/maps/{raster_map.id}/otfbm", headers=gm_headers).status_code == 403


class TestBackgroundCache:
    def test_second_render_is_served_from_cache(self, client, admin_headers, raster_map, monkeypatch):
        first = client.get(f"/api/maps/{raster_map.id}/otfbm/image", params={"cell": 33}, headers=admin_headers)
        from backend.routers.maps import otfbm_export

        def refuse(*_a, **_k):
            raise AssertionError("re-rendered a cached background")

        monkeypatch.setattr(otfbm_export, "render_otfbm_image", refuse)
        second = client.get(f"/api/maps/{raster_map.id}/otfbm/image", params={"cell": 33}, headers=admin_headers)
        assert second.status_code == 200
        assert second.content == first.content
        assert second.headers["content-type"] == "image/jpeg"

    def test_cached_png_keeps_its_type(self, client, admin_headers, tmp_path):
        path = _img(tmp_path / "cut.png", 280, 140, "RGBA", (0, 0, 0, 0))
        m = make_map(filename="cut.png", filepath=path, relative_path="DnD/Maps/cut.png")
        client.get(f"/api/maps/{m.id}/otfbm/image", headers=admin_headers)
        again = client.get(f"/api/maps/{m.id}/otfbm/image", headers=admin_headers)
        assert again.headers["content-type"] == "image/png"

    def test_unwritable_cache_still_serves(self, client, admin_headers, raster_map, monkeypatch):
        from backend.routers.maps import otfbm_export

        monkeypatch.setattr(otfbm_export, "PAGE_CACHE_DIR", "/nonexistent/cache")
        r = client.get(f"/api/maps/{raster_map.id}/otfbm/image", params={"cell": 21}, headers=admin_headers)
        assert r.status_code == 200
