"""Tests for game system endpoints."""
import uuid
import pytest
from tests.conftest import make_game_system


@pytest.fixture(scope="module")
def system(admin_headers):
    return make_game_system(
        name="Dungeons & Dragons 5e",
        slug="dnd-5e",
        publishers=[{"name": "Wizards of the Coast", "url": ""}],
        description="The world's most popular TTRPG.",
        genre="fantasy",
        tags=["fantasy", "dungeon-crawl"],
    )


class TestListSystems:
    def test_returns_list(self, client, admin_headers, system):
        resp = client.get("/api/systems", headers=admin_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_contains_created_system(self, client, admin_headers, system):
        resp = client.get("/api/systems", headers=admin_headers)
        ids = [s["id"] for s in resp.json()]
        assert system.id in ids

    def test_player_can_list_systems(self, client, player_headers, system):
        resp = client.get("/api/systems", headers=player_headers)
        assert resp.status_code == 200

    def test_response_shape(self, client, admin_headers, system):
        resp = client.get("/api/systems", headers=admin_headers)
        s = next(s for s in resp.json() if s["id"] == system.id)
        assert s["name"] == "Dungeons & Dragons 5e"
        assert s["slug"] == "dnd-5e"
        assert "book_count" in s
        assert "tags" in s
        assert "is_explicit" in s
        assert s["is_explicit"] is False

    def test_unauthenticated_denied(self, client):
        resp = client.get("/api/systems")
        assert resp.status_code == 401


class TestGetSystem:
    def test_get_existing_system(self, client, admin_headers, system):
        resp = client.get(f"/api/systems/{system.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == system.id
        assert body["name"] == "Dungeons & Dragons 5e"
        assert "is_explicit" in body
        assert body["is_explicit"] is False

    def test_get_system_includes_books(self, client, admin_headers, system):
        resp = client.get(f"/api/systems/{system.id}", headers=admin_headers)
        assert "books" in resp.json()

    def test_system_books_include_index_failed(self, client, admin_headers, system):
        from tests.conftest import make_book
        make_book(system_id=system.id)
        resp = client.get(f"/api/systems/{system.id}", headers=admin_headers)
        books = resp.json()["books"]
        if books:
            assert all("index_failed" in b for b in books)

    def test_get_nonexistent_system(self, client, admin_headers):
        resp = client.get("/api/systems/does-not-exist", headers=admin_headers)
        assert resp.status_code == 404


class TestUpdateSystem:
    def test_gm_can_update_metadata(self, client, gm_headers, system):
        resp = client.patch(
            f"/api/systems/{system.id}",
            json={
                "description": "Updated description",
                "publishers": [{"name": "WotC", "url": ""}],
            },
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_admin_can_update_metadata(self, client, admin_headers, system):
        resp = client.patch(
            f"/api/systems/{system.id}",
            json={
                "genre": "high-fantasy",
                "tags": ["fantasy", "osr"],
            },
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_player_cannot_update(self, client, player_headers, system):
        resp = client.patch(
            f"/api/systems/{system.id}",
            json={
                "description": "Player tries to edit",
            },
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_update_nonexistent_system(self, client, admin_headers):
        resp = client.patch(
            "/api/systems/not-a-real-id",
            json={
                "description": "ghost update",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 404

    def test_gm_can_mark_system_explicit(self, client, gm_headers, system):
        resp = client.patch(
            f"/api/systems/{system.id}", json={"is_explicit": True}, headers=gm_headers
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/systems/{system.id}", headers=gm_headers).json()
        assert detail["is_explicit"] is True
        # clean up
        client.patch(f"/api/systems/{system.id}", json={"is_explicit": False}, headers=gm_headers)

    def test_explicit_flag_persists_after_update(self, client, admin_headers, system):
        client.patch(f"/api/systems/{system.id}", json={"is_explicit": True}, headers=admin_headers)
        detail = client.get(f"/api/systems/{system.id}", headers=admin_headers).json()
        assert detail["is_explicit"] is True
        client.patch(
            f"/api/systems/{system.id}", json={"is_explicit": False}, headers=admin_headers
        )


class TestExplicitFiltering:
    @pytest.fixture(scope="class")
    def explicit_system(self):
        uid = uuid.uuid4().hex[:8]
        return make_game_system(
            name=f"Explicit System {uid}", slug=f"explicit-system-{uid}", is_explicit=True
        )

    @pytest.fixture(scope="class")
    def no_explicit_headers(self, client, admin_headers):
        """Create a player with allow_explicit=False via the users API."""
        uid = uuid.uuid4().hex[:8]
        resp = client.post(
            "/api/users",
            json={
                "username": f"nsfwplayer{uid}",
                "password": "nsfwpass123",
                "role": "player",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201
        user_id = resp.json()["id"]
        client.patch(f"/api/users/{user_id}", json={"allow_explicit": False}, headers=admin_headers)
        username = resp.json()["username"]
        login = client.post(
            "/api/auth/login", json={"username": username, "password": "nsfwpass123"}
        )
        return {"Authorization": f"Bearer {login.json()['token']}"}

    def test_explicit_system_visible_to_admin(self, client, admin_headers, explicit_system):
        resp = client.get("/api/systems", headers=admin_headers)
        ids = [s["id"] for s in resp.json()]
        assert explicit_system.id in ids

    def test_explicit_system_visible_to_allow_explicit_user(
        self, client, player_headers, explicit_system
    ):
        resp = client.get("/api/systems", headers=player_headers)
        ids = [s["id"] for s in resp.json()]
        assert explicit_system.id in ids

    def test_explicit_system_hidden_from_no_explicit_user(
        self, client, no_explicit_headers, explicit_system
    ):
        resp = client.get("/api/systems", headers=no_explicit_headers)
        ids = [s["id"] for s in resp.json()]
        assert explicit_system.id not in ids

    def test_get_explicit_system_blocked_for_no_explicit_user(
        self, client, no_explicit_headers, explicit_system
    ):
        resp = client.get(f"/api/systems/{explicit_system.id}", headers=no_explicit_headers)
        assert resp.status_code == 404

    def test_get_explicit_system_allowed_for_allow_explicit_user(
        self, client, player_headers, explicit_system
    ):
        resp = client.get(f"/api/systems/{explicit_system.id}", headers=player_headers)
        assert resp.status_code == 200

    def test_is_explicit_true_in_response(self, client, admin_headers, explicit_system):
        resp = client.get("/api/systems", headers=admin_headers)
        s = next(s for s in resp.json() if s["id"] == explicit_system.id)
        assert s["is_explicit"] is True

    def test_is_explicit_false_for_normal_system(self, client, admin_headers):
        normal = make_game_system(name="Normal System", slug="normal-system")
        resp = client.get("/api/systems", headers=admin_headers)
        s = next(s for s in resp.json() if s["id"] == normal.id)
        assert s["is_explicit"] is False
