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
