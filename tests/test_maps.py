"""Tests for map and map folder endpoints."""
import pytest
from tests.conftest import make_map
from backend.config import SessionLocal
from backend.models import MapFolder


@pytest.fixture(scope="module")
def map_entry():
    return make_map(tags=["dungeon", "encounter"])


class TestListMaps:
    def test_returns_list(self, client, admin_headers, map_entry):
        resp = client.get("/api/maps", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "maps" in body
        assert "total" in body

    def test_contains_created_map(self, client, admin_headers, map_entry):
        resp = client.get("/api/maps", headers=admin_headers)
        ids = [m["id"] for m in resp.json()["maps"]]
        assert map_entry.id in ids

    def test_list_includes_is_missing_field(self, client, admin_headers, map_entry):
        resp = client.get("/api/maps", headers=admin_headers)
        assert resp.status_code == 200
        maps = resp.json()["maps"]
        assert len(maps) > 0
        assert all("is_missing" in m for m in maps)
        assert all(isinstance(m["is_missing"], bool) for m in maps)

    def test_player_can_list_maps(self, client, player_headers, map_entry):
        resp = client.get("/api/maps", headers=player_headers)
        assert resp.status_code == 200

    def test_unauthenticated_denied(self, client):
        resp = client.get("/api/maps")
        assert resp.status_code == 401

    def test_pagination(self, client, admin_headers, map_entry):
        resp = client.get("/api/maps?limit=1&offset=0", headers=admin_headers)
        assert resp.status_code == 200
        assert len(resp.json()["maps"]) <= 1


class TestGetMap:
    def test_get_existing_map(self, client, admin_headers, map_entry):
        resp = client.get(f"/api/maps/{map_entry.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == map_entry.id

    def test_get_map_includes_is_missing(self, client, admin_headers, map_entry):
        resp = client.get(f"/api/maps/{map_entry.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "is_missing" in body
        assert isinstance(body["is_missing"], bool)
        assert body["is_missing"] is False

    def test_get_nonexistent_map(self, client, admin_headers):
        resp = client.get("/api/maps/does-not-exist", headers=admin_headers)
        assert resp.status_code == 404


class TestUpdateMap:
    def test_gm_can_update_map(self, client, gm_headers, map_entry):
        resp = client.patch(
            f"/api/maps/{map_entry.id}",
            json={
                "description": "A dark dungeon map",
                "tags": ["dungeon", "dark"],
                "map_type": "dungeon",
            },
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_tags_are_lowercased_on_map_update(self, client, gm_headers):
        m = make_map()
        resp = client.patch(
            f"/api/maps/{m.id}",
            json={"tags": ["Draw Steel", "DUNGEON", "city"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/maps/{m.id}", headers=gm_headers).json()
        assert detail["tags"] == ["draw steel", "dungeon", "city"]

    def test_duplicate_tags_deduplicated_on_map_update(self, client, gm_headers):
        m = make_map()
        resp = client.patch(
            f"/api/maps/{m.id}",
            json={"tags": ["draw steel", "Draw Steel", "DRAW STEEL"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/maps/{m.id}", headers=gm_headers).json()
        assert detail["tags"] == ["draw steel"]

    def test_player_cannot_update_map(self, client, player_headers, map_entry):
        resp = client.patch(
            f"/api/maps/{map_entry.id}",
            json={
                "description": "Player edit attempt",
            },
            headers=player_headers,
        )
        assert resp.status_code == 403


class TestMapFolders:
    @pytest.fixture(scope="class")
    def folder(self):
        db = SessionLocal()
        try:
            f = MapFolder(path="maps/dungeons", tags=["dungeon"])
            db.add(f)
            db.commit()
            db.refresh(f)
            return {"id": f.id, "path": f.path}
        finally:
            db.close()

    def test_list_map_folders(self, client, admin_headers, folder):
        resp = client.get("/api/map-folders", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "folders" in body
        assert isinstance(body["folders"], list)

    def test_contains_created_folder(self, client, admin_headers, folder):
        resp = client.get("/api/map-folders", headers=admin_headers)
        paths = [f["path"] for f in resp.json()["folders"]]
        assert "maps/dungeons" in paths

    def test_gm_can_update_folder_tags(self, client, gm_headers, folder):
        resp = client.patch(
            "/api/map-folders",
            json={
                "path": "maps/dungeons",
                "tags": ["dungeon", "underground"],
            },
            headers=gm_headers,
        )
        assert resp.status_code == 200

    def test_folder_tags_are_lowercased(self, client, gm_headers):
        resp = client.patch(
            "/api/map-folders",
            json={"path": "maps/case-test", "tags": ["Draw Steel", "DUNGEON"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["tags"] == ["draw steel", "dungeon"]

    def test_folder_tags_deduplicated_after_lowercase(self, client, gm_headers):
        resp = client.patch(
            "/api/map-folders",
            json={"path": "maps/dedup-test", "tags": ["draw steel", "Draw Steel"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["tags"] == ["draw steel"]

    def test_player_cannot_update_folder_tags(self, client, player_headers):
        resp = client.patch(
            "/api/map-folders",
            json={
                "path": "maps/test",
                "tags": ["test"],
            },
            headers=player_headers,
        )
        assert resp.status_code == 403
