"""Authored Universal VTT geometry: normalisation, export shaping, endpoints.

Covers the storage gate for the in-app map editor (issues #126/#127). The rules
under test are the ones the format actually imposes -- ARGB colour order, grid
units rather than pixels, bounds as the truth for a portal -- because those are
where UVTT tooling conventionally goes wrong.
"""
import json

import pytest
from PIL import Image

from backend.routers.maps.vtt_authoring import (
    DEFAULT_AMBIENT_LIGHT,
    MAX_POLYLINES,
    VTT_DOC_VERSION,
    VttDataError,
    doc_counts,
    export_features,
    is_empty_doc,
    normalize_vtt_data,
)
from backend.tests.conftest import make_map


def _doc(**over):
    base = {
        "pixels_per_grid": 140,
        "line_of_sight": [[{"x": 0, "y": 0}, {"x": 5, "y": 0}]],
    }
    base.update(over)
    return base


class TestNormalizeBasics:
    def test_none_stays_none(self):
        assert normalize_vtt_data(None) is None

    def test_non_object_rejected(self):
        with pytest.raises(VttDataError):
            normalize_vtt_data([1, 2, 3])

    def test_empty_document_normalises_to_none(self):
        # Clearing the editor should store NULL, not a husk of empty arrays.
        assert normalize_vtt_data({"pixels_per_grid": 140}) is None

    def test_stamps_version_and_authoring_scale(self):
        doc = normalize_vtt_data(_doc())
        assert doc["version"] == VTT_DOC_VERSION
        # The grid the geometry was drawn against is stored with it: everything
        # is scale-relative, so a resized image would otherwise invalidate the
        # walls with no way to detect it.
        assert doc["pixels_per_grid"] == 140.0

    def test_grid_offset_defaults_to_origin(self):
        assert normalize_vtt_data(_doc())["grid_offset"] == {"x": 0.0, "y": 0.0}

    def test_grid_offset_preserved(self):
        doc = normalize_vtt_data(_doc(grid_offset={"x": 12.5, "y": 7}))
        assert doc["grid_offset"] == {"x": 12.5, "y": 7.0}


class TestNormalizeWalls:
    def test_polyline_points_kept_in_order(self):
        doc = normalize_vtt_data(
            _doc(line_of_sight=[[{"x": 1, "y": 2}, {"x": 3, "y": 4}, {"x": 5, "y": 6}]])
        )
        assert doc["line_of_sight"][0] == [
            {"x": 1.0, "y": 2.0},
            {"x": 3.0, "y": 4.0},
            {"x": 5.0, "y": 6.0},
        ]

    def test_closed_room_is_a_repeated_first_point(self):
        # The format's own convention for a closed run; nothing closes it for you.
        ring = [{"x": 0, "y": 0}, {"x": 2, "y": 0}, {"x": 2, "y": 2}, {"x": 0, "y": 0}]
        doc = normalize_vtt_data(_doc(line_of_sight=[ring]))
        assert doc["line_of_sight"][0][0] == doc["line_of_sight"][0][-1]

    def test_single_point_run_rejected(self):
        with pytest.raises(VttDataError, match="two points"):
            normalize_vtt_data(_doc(line_of_sight=[[{"x": 0, "y": 0}]]))

    def test_object_walls_stay_separate_from_walls(self):
        # Importers treat these differently (Roll20 makes them transparent
        # barriers), so merging them would change what the file means.
        doc = normalize_vtt_data(
            _doc(objects_line_of_sight=[[{"x": 0, "y": 0}, {"x": 1, "y": 1}]])
        )
        assert len(doc["line_of_sight"]) == 1
        assert len(doc["objects_line_of_sight"]) == 1

    def test_fractional_coordinates_survive(self):
        # Free-form walls are not on grid intersections.
        doc = normalize_vtt_data(_doc(line_of_sight=[[{"x": 1.25, "y": 0.5}, {"x": 2, "y": 3}]]))
        assert doc["line_of_sight"][0][0] == {"x": 1.25, "y": 0.5}

    def test_non_numeric_coordinate_rejected(self):
        with pytest.raises(VttDataError, match="number"):
            normalize_vtt_data(_doc(line_of_sight=[[{"x": "5", "y": 0}, {"x": 1, "y": 1}]]))

    def test_boolean_coordinate_rejected(self):
        # bool is an int subclass; a stray `true` must not become 1.0.
        with pytest.raises(VttDataError, match="number"):
            normalize_vtt_data(_doc(line_of_sight=[[{"x": True, "y": 0}, {"x": 1, "y": 1}]]))

    def test_absurd_coordinate_rejected(self):
        with pytest.raises(VttDataError, match="out of range"):
            normalize_vtt_data(_doc(line_of_sight=[[{"x": 0, "y": 0}, {"x": 1e9, "y": 0}]]))

    def test_too_many_runs_rejected(self):
        runs = [[{"x": 0, "y": 0}, {"x": 1, "y": 0}]] * (MAX_POLYLINES + 1)
        with pytest.raises(VttDataError, match="too many"):
            normalize_vtt_data(_doc(line_of_sight=runs))


class TestNormalizePortals:
    def test_bounds_required_as_a_pair(self):
        with pytest.raises(VttDataError, match="two points"):
            normalize_vtt_data(_doc(portals=[{"bounds": [{"x": 0, "y": 0}]}]))

    def test_defaults_to_a_closed_embedded_door(self):
        doc = normalize_vtt_data(
            _doc(portals=[{"bounds": [{"x": 0, "y": 0}, {"x": 1, "y": 0}]}])
        )
        assert doc["portals"][0]["closed"] is True
        assert doc["portals"][0]["freestanding"] is False

    def test_window_is_an_open_portal(self):
        # closed=False is exactly how Roll20 reads a window.
        doc = normalize_vtt_data(
            _doc(portals=[{"bounds": [{"x": 0, "y": 0}, {"x": 1, "y": 0}], "closed": False}])
        )
        assert doc["portals"][0]["closed"] is False


class TestNormalizeLights:
    def test_defaults_applied(self):
        doc = normalize_vtt_data(_doc(lights=[{"position": {"x": 3, "y": 4}}]))
        light = doc["lights"][0]
        assert light["color"] == "ffffffff"
        assert light["shadows"] is True
        assert light["intensity"] == 1.0

    def test_range_is_kept_as_grid_squares(self):
        # Not pixels and not feet — the format counts range in grid squares.
        doc = normalize_vtt_data(_doc(lights=[{"position": {"x": 0, "y": 0}, "range": 4.5}]))
        assert doc["lights"][0]["range"] == 4.5

    def test_missing_position_rejected(self):
        with pytest.raises(VttDataError):
            normalize_vtt_data(_doc(lights=[{"range": 3}]))


class TestColors:
    def test_eight_digit_argb_kept(self):
        doc = normalize_vtt_data(
            _doc(lights=[{"position": {"x": 0, "y": 0}, "color": "ffeccd8b"}])
        )
        assert doc["lights"][0]["color"] == "ffeccd8b"

    def test_hash_prefix_and_case_normalised(self):
        doc = normalize_vtt_data(
            _doc(lights=[{"position": {"x": 0, "y": 0}, "color": "#FFECCD8B"}])
        )
        assert doc["lights"][0]["color"] == "ffeccd8b"

    def test_six_digit_rgb_becomes_opaque_argb(self):
        # Alpha leads in this format; a bare RGB value is fully opaque.
        doc = normalize_vtt_data(
            _doc(lights=[{"position": {"x": 0, "y": 0}, "color": "eccd8b"}])
        )
        assert doc["lights"][0]["color"] == "ffeccd8b"

    def test_garbage_colour_rejected_rather_than_defaulted(self):
        # A mistyped colour that silently exports as white is worse than one
        # that refuses to save.
        with pytest.raises(VttDataError, match="hex"):
            normalize_vtt_data(_doc(lights=[{"position": {"x": 0, "y": 0}, "color": "red"}]))


class TestEnvironment:
    def test_defaults_are_unlit_and_unbaked(self):
        doc = normalize_vtt_data(_doc())
        assert doc["environment"] == {
            "baked_lighting": False,
            "ambient_light": DEFAULT_AMBIENT_LIGHT,
        }

    def test_baked_lighting_alone_is_real_content(self):
        # Marking a map as already-lit is an authored fact even with no geometry.
        doc = normalize_vtt_data({"environment": {"baked_lighting": True}})
        assert doc is not None
        assert doc["environment"]["baked_lighting"] is True

    def test_ambient_colour_alone_is_real_content(self):
        doc = normalize_vtt_data({"environment": {"ambient_light": "40203010"}})
        assert doc is not None
        assert doc["environment"]["ambient_light"] == "40203010"


class TestEmptinessAndCounts:
    def test_is_empty_doc_on_none(self):
        assert is_empty_doc(None) is True

    def test_is_empty_doc_with_geometry(self):
        assert is_empty_doc(normalize_vtt_data(_doc())) is False

    def test_counts_reported_per_feature(self):
        doc = normalize_vtt_data(
            _doc(
                objects_line_of_sight=[[{"x": 0, "y": 0}, {"x": 1, "y": 1}]],
                portals=[{"bounds": [{"x": 0, "y": 0}, {"x": 1, "y": 0}]}],
                lights=[{"position": {"x": 2, "y": 2}}],
            )
        )
        assert doc_counts(doc) == {
            "wall_count": 1,
            "object_wall_count": 1,
            "portal_count": 1,
            "light_count": 1,
        }

    def test_counts_on_none_are_zero(self):
        assert doc_counts(None)["wall_count"] == 0


class TestExportFeatures:
    def test_empty_doc_still_yields_the_full_envelope_shape(self):
        f = export_features(None)
        assert f["line_of_sight"] == []
        assert f["portals"] == []
        assert f["lights"] == []
        assert f["environment"]["ambient_light"] == DEFAULT_AMBIENT_LIGHT

    def test_portal_position_is_the_midpoint_of_bounds(self):
        doc = normalize_vtt_data(
            _doc(portals=[{"bounds": [{"x": 2, "y": 4}, {"x": 6, "y": 4}]}])
        )
        portal = export_features(doc)["portals"][0]
        # position is derived, never stored: importers that read it must agree
        # with the bounds rather than contradict them.
        assert portal["position"] == {"x": 4.0, "y": 4.0}

    def test_portal_rotation_derived_from_bounds(self):
        doc = normalize_vtt_data(
            _doc(portals=[{"bounds": [{"x": 0, "y": 0}, {"x": 0, "y": 3}]}])
        )
        portal = export_features(doc)["portals"][0]
        # A vertical door line is a quarter turn, in radians.
        assert portal["rotation"] == pytest.approx(1.5708, abs=1e-3)

    def test_portal_keeps_all_three_representations(self):
        doc = normalize_vtt_data(
            _doc(portals=[{"bounds": [{"x": 1, "y": 1}, {"x": 2, "y": 1}]}])
        )
        portal = export_features(doc)["portals"][0]
        assert set(portal) == {"position", "bounds", "rotation", "closed", "freestanding"}

    def test_walls_copied_not_aliased(self):
        doc = normalize_vtt_data(_doc())
        out = export_features(doc)
        out["line_of_sight"][0][0]["x"] = 999
        assert doc["line_of_sight"][0][0]["x"] == 0.0


class TestBuildUvttWithAuthoring:
    def test_authored_features_reach_the_envelope(self, tmp_path):
        from backend.routers.maps.uvtt import build_uvtt

        path = str(tmp_path / "m.png")
        Image.new("RGB", (280, 280), (10, 10, 10)).save(path)
        doc = normalize_vtt_data(
            _doc(
                portals=[{"bounds": [{"x": 0, "y": 0}, {"x": 1, "y": 0}]}],
                lights=[{"position": {"x": 1, "y": 1}, "range": 3, "color": "ffeccd8b"}],
                environment={"baked_lighting": True},
            )
        )
        env = build_uvtt(path, {"width": 2, "height": 2, "px": 140}, doc)
        assert len(env["line_of_sight"]) == 1
        assert len(env["portals"]) == 1
        assert env["lights"][0]["color"] == "ffeccd8b"
        assert env["environment"]["baked_lighting"] is True

    def test_no_authoring_exports_empty_arrays(self, tmp_path):
        from backend.routers.maps.uvtt import build_uvtt

        path = str(tmp_path / "m.png")
        Image.new("RGB", (280, 280), (10, 10, 10)).save(path)
        env = build_uvtt(path, {"width": 2, "height": 2, "px": 140}, None)
        assert env["line_of_sight"] == []
        assert env["portals"] == []


@pytest.fixture
def authored_map(tmp_path):
    path = str(tmp_path / "keep.png")
    Image.new("RGB", (1400, 1400), (20, 30, 40)).save(path)
    return make_map(filename="keep.png", filepath=path, relative_path="DnD/Maps/keep.png")


class TestAuthoringEndpoints:
    def test_get_is_empty_before_anything_is_authored(self, client, gm_headers, authored_map):
        r = client.get(f"/api/maps/{authored_map.id}/vtt/authoring", headers=gm_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["data"] is None
        assert body["wall_count"] == 0
        # The grid comes back so the editor can draw its overlay in one request.
        assert body["grid"]["cell_px"]

    def test_put_then_get_round_trips(self, client, gm_headers, authored_map):
        payload = {"data": _doc(lights=[{"position": {"x": 1, "y": 1}, "range": 3}])}
        r = client.put(
            f"/api/maps/{authored_map.id}/vtt/authoring", json=payload, headers=gm_headers
        )
        assert r.status_code == 200
        assert r.json()["wall_count"] == 1
        assert r.json()["light_count"] == 1

        got = client.get(f"/api/maps/{authored_map.id}/vtt/authoring", headers=gm_headers).json()
        assert got["data"]["line_of_sight"][0][1] == {"x": 5.0, "y": 0.0}
        assert got["data"]["lights"][0]["range"] == 3.0

    def test_put_null_clears_everything(self, client, gm_headers, authored_map):
        client.put(
            f"/api/maps/{authored_map.id}/vtt/authoring", json={"data": _doc()}, headers=gm_headers
        )
        r = client.put(
            f"/api/maps/{authored_map.id}/vtt/authoring", json={"data": None}, headers=gm_headers
        )
        assert r.status_code == 200
        got = client.get(f"/api/maps/{authored_map.id}/vtt/authoring", headers=gm_headers).json()
        assert got["data"] is None

    def test_invalid_colour_is_a_400_not_a_500(self, client, gm_headers, authored_map):
        payload = {"data": _doc(lights=[{"position": {"x": 0, "y": 0}, "color": "nope"}])}
        r = client.put(
            f"/api/maps/{authored_map.id}/vtt/authoring", json=payload, headers=gm_headers
        )
        assert r.status_code == 400

    def test_players_cannot_author(self, client, player_headers, authored_map):
        r = client.put(
            f"/api/maps/{authored_map.id}/vtt/authoring",
            json={"data": _doc()},
            headers=player_headers,
        )
        assert r.status_code == 403

    def test_unknown_map_is_404(self, client, gm_headers):
        r = client.put(
            "/api/maps/does-not-exist/vtt/authoring", json={"data": None}, headers=gm_headers
        )
        assert r.status_code == 404

    def test_authored_geometry_reaches_the_export(self, client, gm_headers, authored_map):
        client.put(
            f"/api/maps/{authored_map.id}/vtt/authoring",
            json={
                "data": _doc(
                    portals=[{"bounds": [{"x": 0, "y": 0}, {"x": 1, "y": 0}], "closed": False}]
                )
            },
            headers=gm_headers,
        )
        r = client.get(f"/api/maps/{authored_map.id}/export.uvtt", headers=gm_headers)
        assert r.status_code == 200
        env = json.loads(r.content)
        assert len(env["line_of_sight"]) == 1
        assert env["portals"][0]["closed"] is False
        assert env["portals"][0]["position"] == {"x": 0.5, "y": 0.0}

    def test_editing_invalidates_the_cached_export(self, client, gm_headers, authored_map):
        first = client.get(f"/api/maps/{authored_map.id}/export.uvtt", headers=gm_headers)
        assert len(json.loads(first.content)["lights"]) == 0

        client.put(
            f"/api/maps/{authored_map.id}/vtt/authoring",
            json={"data": _doc(lights=[{"position": {"x": 2, "y": 2}, "range": 4}])},
            headers=gm_headers,
        )
        second = client.get(f"/api/maps/{authored_map.id}/export.uvtt", headers=gm_headers)
        # A stale cached file here would silently drop the GM's lighting work.
        assert len(json.loads(second.content)["lights"]) == 1

    def test_export_writes_nothing_beside_the_source_image(
        self, client, gm_headers, authored_map, tmp_path
    ):
        # The library is routinely mounted read-only: authoring and export must
        # never add a sidecar or touch the user's file.
        before = sorted(p.name for p in tmp_path.iterdir())
        client.put(
            f"/api/maps/{authored_map.id}/vtt/authoring",
            json={"data": _doc()},
            headers=gm_headers,
        )
        client.get(f"/api/maps/{authored_map.id}/export.uvtt", headers=gm_headers)
        assert sorted(p.name for p in tmp_path.iterdir()) == before


def _uvtt_file(tmp_path, name="tavern.uvtt", size=(600, 480), **over):
    """A .uvtt on disk carrying a real embedded image and some geometry."""
    import base64
    import io

    buf = io.BytesIO()
    Image.new("RGB", size, (10, 60, 30)).save(buf, "PNG")
    doc = {
        "format": 0.3,
        "resolution": {
            "map_origin": {"x": 0, "y": 0},
            "map_size": {"x": 6, "y": 4.8},
            "pixels_per_grid": 100,
        },
        "line_of_sight": [[{"x": 1, "y": 1}, {"x": 2, "y": 2}]],
        "objects_line_of_sight": [],
        "portals": [{"bounds": [{"x": 3, "y": 0}, {"x": 4, "y": 0}], "closed": True}],
        "lights": [{"position": {"x": 2, "y": 2}, "range": 3, "color": "ffeccd8b"}],
        "environment": {"baked_lighting": True, "ambient_light": "ff112233"},
        "image": base64.b64encode(buf.getvalue()).decode(),
    }
    doc.update(over)
    path = tmp_path / name
    path.write_text(json.dumps(doc))
    return path


@pytest.fixture
def vtt_map(tmp_path):
    path = _uvtt_file(tmp_path)
    return make_map(
        filename="tavern.uvtt", filepath=str(path), relative_path="DnD/Maps/tavern.uvtt"
    )


class TestEditingAnExistingUvtt:
    """A .uvtt opens on its own geometry rather than a blank overlay.

    Editing one of these files is the whole point of offering the editor on a
    standalone Universal VTT map: what it carries is what the GM wants to change.
    """

    def test_geometry_is_seeded_from_the_file(self, client, gm_headers, vtt_map):
        r = client.get(f"/api/maps/{vtt_map.id}/vtt/authoring", headers=gm_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["is_vtt"] is True
        assert body["seeded_from_file"] is True
        assert body["wall_count"] == 1
        assert body["portal_count"] == 1
        assert body["light_count"] == 1
        assert body["data"]["lights"][0]["color"] == "ffeccd8b"
        assert body["data"]["environment"]["baked_lighting"] is True

    def test_image_url_points_at_the_decoding_endpoint(self, client, gm_headers, vtt_map):
        # A .uvtt's picture is base64 inside the envelope; the page renderer has
        # nothing to render, so the editor must draw against /vtt/image.
        body = client.get(f"/api/maps/{vtt_map.id}/vtt/authoring", headers=gm_headers).json()
        assert body["image_url"] == f"/maps/{vtt_map.id}/vtt/image"

    def test_raster_map_keeps_the_page_url(self, client, gm_headers, authored_map):
        body = client.get(
            f"/api/maps/{authored_map.id}/vtt/authoring", headers=gm_headers
        ).json()
        assert body["image_url"] == f"/maps/{authored_map.id}/page/1"
        assert body["is_vtt"] is False
        assert body["seeded_from_file"] is False

    def test_embedded_image_is_measured_for_the_canvas(self, client, gm_headers, vtt_map):
        # Nothing at the path is an image, so _map_image_info measures nothing.
        # Without this the editor would have no canvas dimensions at all.
        body = client.get(f"/api/maps/{vtt_map.id}/vtt/authoring", headers=gm_headers).json()
        assert body["pixel_width"] == 600
        assert body["pixel_height"] == 480

    def test_grid_comes_from_the_file(self, client, gm_headers, vtt_map):
        # The file states 100px cells; a detected or defaulted grid would draw
        # the file's own walls onto a grid they do not fit.
        grid = client.get(f"/api/maps/{vtt_map.id}/vtt/authoring", headers=gm_headers).json()[
            "grid"
        ]
        assert grid["cell_px"] == 100
        assert grid["width"] == 6
        assert grid["height"] == 4.8

    def test_manual_override_still_wins_over_the_file(self, client, gm_headers, tmp_path):
        # A corrected grid is the user overruling the file, so it outranks what
        # the file claims about its own cell size.
        path = _uvtt_file(tmp_path, name="ov.uvtt")
        m = make_map(
            filename="ov.uvtt",
            filepath=str(path),
            relative_path="D/M/ov.uvtt",
            grid_width=12,
            grid_height=9.6,
            grid_px=50,
        )
        grid = client.get(f"/api/maps/{m.id}/vtt/authoring", headers=gm_headers).json()["grid"]
        assert grid["source"] == "manual"
        assert grid["cell_px"] == 50

    def test_saving_takes_over_from_the_file(self, client, gm_headers, vtt_map):
        client.put(
            f"/api/maps/{vtt_map.id}/vtt/authoring",
            json={"data": _doc(lights=[{"position": {"x": 9, "y": 9}, "range": 7}])},
            headers=gm_headers,
        )
        body = client.get(f"/api/maps/{vtt_map.id}/vtt/authoring", headers=gm_headers).json()
        # Saved geometry is the truth from then on -- re-seeding here would make
        # a deliberately emptied document refill itself on every reload.
        assert body["seeded_from_file"] is False
        assert body["data"]["lights"][0]["range"] == 7.0
        assert body["light_count"] == 1

    def test_clearing_stays_cleared(self, client, gm_headers, vtt_map):
        client.put(
            f"/api/maps/{vtt_map.id}/vtt/authoring", json={"data": None}, headers=gm_headers
        )
        body = client.get(f"/api/maps/{vtt_map.id}/vtt/authoring", headers=gm_headers).json()
        # Clearing stores NULL, which is also "never edited" -- so this map does
        # re-seed. That is the documented trade-off of a single NULL state, and
        # it matches what the file still contains.
        assert body["seeded_from_file"] is True

    def test_malformed_geometry_does_not_break_the_editor(self, client, gm_headers, tmp_path):
        path = _uvtt_file(tmp_path, name="bad.uvtt", line_of_sight=[[{"x": "nope", "y": 0}]])
        m = make_map(filename="bad.uvtt", filepath=str(path), relative_path="D/M/bad.uvtt")
        r = client.get(f"/api/maps/{m.id}/vtt/authoring", headers=gm_headers)
        # The image and grid are still worth editing against; refusing to open
        # the map would be a worse answer than opening it with no geometry.
        assert r.status_code == 200
        assert r.json()["data"] is None

    def test_portal_without_bounds_is_dropped(self, client, gm_headers, tmp_path):
        # bounds is the load-bearing field; a portal without it cannot be placed.
        path = _uvtt_file(
            tmp_path, name="np.uvtt", portals=[{"position": {"x": 5, "y": 5}, "closed": True}]
        )
        m = make_map(filename="np.uvtt", filepath=str(path), relative_path="D/M/np.uvtt")
        body = client.get(f"/api/maps/{m.id}/vtt/authoring", headers=gm_headers).json()
        assert body["data"] is None


class TestVttImageSize:
    """Measuring the raster a .uvtt carries inside its envelope."""

    def test_measures_the_embedded_image(self, tmp_path):
        from backend.routers.maps._helpers import vtt_image_size

        path = _uvtt_file(tmp_path, name="sized.uvtt", size=(320, 240))
        assert vtt_image_size(str(path)) == (320, 240)

    def test_returns_nothing_for_a_file_with_no_image(self, tmp_path):
        from backend.routers.maps._helpers import vtt_image_size

        path = tmp_path / "noimg.uvtt"
        path.write_text(json.dumps({"format": 0.3}))
        # The caller falls back to a grid-derived size rather than failing.
        assert vtt_image_size(str(path)) == (None, None)

    def test_returns_nothing_when_the_image_is_not_decodable(self, tmp_path):
        import base64

        from backend.routers.maps._helpers import vtt_image_size

        path = tmp_path / "junk.uvtt"
        path.write_text(
            json.dumps({"format": 0.3, "image": base64.b64encode(b"not an image").decode()})
        )
        assert vtt_image_size(str(path)) == (None, None)


class TestExportingAnEditedUvtt:
    def test_uvtt_map_exports_rather_than_400ing(self, client, gm_headers, vtt_map):
        r = client.get(f"/api/maps/{vtt_map.id}/export.uvtt", headers=gm_headers)
        assert r.status_code == 200
        env = json.loads(r.content)
        assert len(env["line_of_sight"]) == 1
        assert env["lights"][0]["color"] == "ffeccd8b"

    def test_edits_reach_the_exported_file(self, client, gm_headers, vtt_map):
        client.put(
            f"/api/maps/{vtt_map.id}/vtt/authoring",
            json={"data": _doc(lights=[{"position": {"x": 1, "y": 1}, "range": 9}])},
            headers=gm_headers,
        )
        env = json.loads(client.get(f"/api/maps/{vtt_map.id}/export.uvtt", headers=gm_headers).content)
        assert env["lights"][0]["range"] == 9.0

    def test_embedded_image_is_passed_through_verbatim(self, client, gm_headers, vtt_map):
        import base64

        source = json.loads(open(vtt_map.filepath).read())
        env = json.loads(client.get(f"/api/maps/{vtt_map.id}/export.uvtt", headers=gm_headers).content)
        # Re-encoding an already-web-ready picture would only lose quality, and
        # there is no file at the path for Pillow to open in the first place.
        assert env["image"] == source["image"]
        assert base64.b64decode(env["image"])

    def test_export_leaves_the_source_file_untouched(self, client, gm_headers, vtt_map):
        before = open(vtt_map.filepath, "rb").read()
        client.put(
            f"/api/maps/{vtt_map.id}/vtt/authoring", json={"data": _doc()}, headers=gm_headers
        )
        client.get(f"/api/maps/{vtt_map.id}/export.uvtt", headers=gm_headers)
        # Saving writes to the map row only: the user's own file is never
        # rewritten, which is what keeps a read-only library working.
        assert open(vtt_map.filepath, "rb").read() == before

    def test_uvtt_with_no_image_is_refused(self, client, gm_headers, tmp_path):
        # Nothing to embed and nothing to measure: this is a real 400, not a
        # file we should emit with a missing picture.
        path = tmp_path / "noimg.uvtt"
        path.write_text(json.dumps({"format": 0.3, "line_of_sight": []}))
        m = make_map(filename="noimg.uvtt", filepath=str(path), relative_path="D/M/noimg.uvtt")
        r = client.get(f"/api/maps/{m.id}/export.uvtt", headers=gm_headers)
        assert r.status_code == 400

    def test_export_is_cached_per_document(self, client, gm_headers, vtt_map):
        first = json.loads(
            client.get(f"/api/maps/{vtt_map.id}/export.uvtt", headers=gm_headers).content
        )
        assert first["lights"][0]["range"] == 3.0
        client.put(
            f"/api/maps/{vtt_map.id}/vtt/authoring",
            json={"data": _doc(lights=[{"position": {"x": 2, "y": 2}, "range": 8}])},
            headers=gm_headers,
        )
        second = json.loads(
            client.get(f"/api/maps/{vtt_map.id}/export.uvtt", headers=gm_headers).content
        )
        # A stale cached file here would silently discard the GM's edit.
        assert second["lights"][0]["range"] == 8.0
