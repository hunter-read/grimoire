"""Tests for the genre / system-family lookup API (issue #202)."""
from backend.tests.conftest import make_game_system


class TestGenres:
    def test_defaults_seeded(self, client, admin_headers):
        resp = client.get("/api/genres", headers=admin_headers)
        assert resp.status_code == 200
        names = [g["name"] for g in resp.json()["genres"]]
        assert "Science Fiction" in names
        assert "Cyberpunk" in names

    def test_cyberpunk_nested_under_science_fiction(self, client, admin_headers):
        genres = client.get("/api/genres", headers=admin_headers).json()["genres"]
        by_name = {g["name"]: g for g in genres}
        sci = by_name["Science Fiction"]
        cyber = by_name["Cyberpunk"]
        assert cyber["parent_id"] == sci["id"]

    def test_player_can_read_genres(self, client, player_headers):
        assert client.get("/api/genres", headers=player_headers).status_code == 200

    def test_create_custom_genre_admin(self, client, admin_headers):
        resp = client.post("/api/genres", json={"name": "Solarpunk"}, headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["name"] == "Solarpunk"
        assert resp.json()["is_default"] is False

    def test_create_child_genre(self, client, admin_headers):
        genres = client.get("/api/genres", headers=admin_headers).json()["genres"]
        parent = next(g for g in genres if g["name"] == "Fantasy")
        resp = client.post(
            "/api/genres",
            json={"name": "Grimbright", "parent_id": parent["id"]},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["parent_id"] == parent["id"]

    def test_create_duplicate_rejected(self, client, admin_headers):
        client.post("/api/genres", json={"name": "Noir"}, headers=admin_headers)
        resp = client.post("/api/genres", json={"name": "noir"}, headers=admin_headers)
        assert resp.status_code == 409

    def test_create_blank_rejected(self, client, admin_headers):
        resp = client.post("/api/genres", json={"name": "   "}, headers=admin_headers)
        assert resp.status_code == 422

    def test_create_requires_admin(self, client, gm_headers):
        resp = client.post("/api/genres", json={"name": "Weird"}, headers=gm_headers)
        assert resp.status_code == 403

    def test_delete_unused_genre(self, client, admin_headers):
        created = client.post(
            "/api/genres", json={"name": "Deletable"}, headers=admin_headers
        ).json()
        resp = client.delete(f"/api/genres/{created['id']}", headers=admin_headers)
        assert resp.status_code == 200

    def test_delete_in_use_blocked_without_force(self, client, admin_headers):
        created = client.post(
            "/api/genres", json={"name": "AttachedGenre"}, headers=admin_headers
        ).json()
        make_game_system(genres=["AttachedGenre"])
        resp = client.delete(f"/api/genres/{created['id']}", headers=admin_headers)
        assert resp.status_code == 409
        assert resp.json()["detail"]["usage_count"] >= 1

    def test_delete_in_use_with_force(self, client, admin_headers):
        created = client.post(
            "/api/genres", json={"name": "ForceGenre"}, headers=admin_headers
        ).json()
        make_game_system(genres=["ForceGenre"])
        resp = client.delete(
            f"/api/genres/{created['id']}?force=true", headers=admin_headers
        )
        assert resp.status_code == 200
        assert resp.json()["removed_usage"] >= 1

    def test_delete_missing_genre(self, client, admin_headers):
        resp = client.delete("/api/genres/does-not-exist", headers=admin_headers)
        assert resp.status_code == 404


class TestSystemFamilies:
    def test_defaults_seeded(self, client, admin_headers):
        resp = client.get("/api/system-families", headers=admin_headers)
        assert resp.status_code == 200
        names = [f["name"] for f in resp.json()["families"]]
        assert "Powered by the Apocalypse" in names

    def test_create_custom_family(self, client, admin_headers):
        resp = client.post(
            "/api/system-families", json={"name": "Havoc System"}, headers=admin_headers
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Havoc System"

    def test_create_duplicate_rejected(self, client, admin_headers):
        client.post("/api/system-families", json={"name": "Ubiquity"}, headers=admin_headers)
        resp = client.post(
            "/api/system-families", json={"name": "ubiquity"}, headers=admin_headers
        )
        assert resp.status_code == 409

    def test_delete_in_use_blocked(self, client, admin_headers):
        created = client.post(
            "/api/system-families", json={"name": "AttachedFamily"}, headers=admin_headers
        ).json()
        make_game_system(system_family="AttachedFamily")
        resp = client.delete(f"/api/system-families/{created['id']}", headers=admin_headers)
        assert resp.status_code == 409

    def test_delete_in_use_with_force(self, client, admin_headers):
        created = client.post(
            "/api/system-families", json={"name": "ForceFamily"}, headers=admin_headers
        ).json()
        make_game_system(system_family="ForceFamily")
        resp = client.delete(
            f"/api/system-families/{created['id']}?force=true", headers=admin_headers
        )
        assert resp.status_code == 200

    def test_create_requires_admin(self, client, player_headers):
        resp = client.post(
            "/api/system-families", json={"name": "Nope"}, headers=player_headers
        )
        assert resp.status_code == 403


class TestParentSystems:
    def test_list_empty_by_default(self, client, admin_headers):
        resp = client.get("/api/parent-systems", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["parent_systems"] == []

    def test_create_and_list(self, client, admin_headers):
        created = client.post(
            "/api/parent-systems",
            json={"name": "Dungeons & Dragons"},
            headers=admin_headers,
        )
        assert created.status_code == 200
        assert created.json()["name"] == "Dungeons & Dragons"
        names = [
            p["name"]
            for p in client.get("/api/parent-systems", headers=admin_headers).json()[
                "parent_systems"
            ]
        ]
        assert "Dungeons & Dragons" in names

    def test_create_duplicate_rejected(self, client, admin_headers):
        client.post("/api/parent-systems", json={"name": "Cyberpunk"}, headers=admin_headers)
        resp = client.post(
            "/api/parent-systems", json={"name": "cyberpunk"}, headers=admin_headers
        )
        assert resp.status_code == 409

    def test_player_can_read(self, client, player_headers):
        assert client.get("/api/parent-systems", headers=player_headers).status_code == 200

    def test_create_requires_admin(self, client, gm_headers):
        resp = client.post("/api/parent-systems", json={"name": "Nope"}, headers=gm_headers)
        assert resp.status_code == 403

    def test_delete_in_use_blocked_then_forced(self, client, admin_headers):
        created = client.post(
            "/api/parent-systems", json={"name": "AttachedParent"}, headers=admin_headers
        ).json()
        make_game_system(parent_system="AttachedParent")
        blocked = client.delete(
            f"/api/parent-systems/{created['id']}", headers=admin_headers
        )
        assert blocked.status_code == 409
        forced = client.delete(
            f"/api/parent-systems/{created['id']}?force=true", headers=admin_headers
        )
        assert forced.status_code == 200


class TestLicenses:
    def test_defaults_seeded(self, client, admin_headers):
        resp = client.get("/api/licenses", headers=admin_headers)
        assert resp.status_code == 200
        names = [lic["name"] for lic in resp.json()["licenses"]]
        assert "OGL 1.0a" in names

    def test_create_custom(self, client, admin_headers):
        resp = client.post(
            "/api/licenses", json={"name": "My Homebrew License"}, headers=admin_headers
        )
        assert resp.status_code == 200
        assert resp.json()["is_default"] is False

    def test_delete_in_use_by_system_blocked(self, client, admin_headers):
        created = client.post(
            "/api/licenses", json={"name": "SystemLicense"}, headers=admin_headers
        ).json()
        make_game_system(license="SystemLicense")
        resp = client.delete(f"/api/licenses/{created['id']}", headers=admin_headers)
        assert resp.status_code == 409

    def test_player_can_read(self, client, player_headers):
        assert client.get("/api/licenses", headers=player_headers).status_code == 200

    def test_create_requires_admin(self, client, gm_headers):
        resp = client.post("/api/licenses", json={"name": "Nope"}, headers=gm_headers)
        assert resp.status_code == 403


class TestDiceMaterials:
    def test_defaults_seeded_with_groups(self, client, admin_headers):
        resp = client.get("/api/dice-materials", headers=admin_headers)
        assert resp.status_code == 200
        rows = resp.json()["dice_materials"]
        by_name = {d["name"]: d for d in rows}
        assert "D20" in by_name
        assert by_name["D20"]["group"] == "Dice"
        assert by_name["Tarot Cards"]["group"] == "Cards"

    def test_create_custom_defaults_to_custom_group(self, client, admin_headers):
        resp = client.post(
            "/api/dice-materials", json={"name": "Spinner"}, headers=admin_headers
        )
        assert resp.status_code == 200
        assert resp.json()["group"] == "Custom"

    def test_create_with_group(self, client, admin_headers):
        resp = client.post(
            "/api/dice-materials",
            json={"name": "Fudge Dice", "group": "Dice"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["group"] == "Dice"

    def test_delete_in_use_blocked(self, client, admin_headers):
        created = client.post(
            "/api/dice-materials", json={"name": "AttachedDie"}, headers=admin_headers
        ).json()
        make_game_system(dice_materials=["AttachedDie"])
        resp = client.delete(f"/api/dice-materials/{created['id']}", headers=admin_headers)
        assert resp.status_code == 409

    def test_player_can_read(self, client, player_headers):
        assert client.get("/api/dice-materials", headers=player_headers).status_code == 200

    def test_create_requires_admin(self, client, gm_headers):
        resp = client.post("/api/dice-materials", json={"name": "Nope"}, headers=gm_headers)
        assert resp.status_code == 403
