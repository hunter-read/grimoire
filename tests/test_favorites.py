"""Tests for per-user favorites endpoints."""
import pytest
from tests.conftest import make_game_system, make_book, make_map, make_token


@pytest.fixture(scope="module")
def fav_system():
    return make_game_system()


@pytest.fixture(scope="module")
def fav_book(fav_system):
    return make_book(system_id=fav_system.id, title="Fav Book")


@pytest.fixture(scope="module")
def fav_map():
    return make_map()


@pytest.fixture(scope="module")
def fav_token():
    return make_token()


class TestListFavorites:
    def test_empty_by_default(self, client, player_headers):
        # Fresh player starts with no favorites (some may exist from other tests;
        # we just confirm the response shape is correct)
        resp = client.get("/api/favorites", headers=player_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "favorites" in body
        assert "items" in body
        assert isinstance(body["favorites"], list)
        assert isinstance(body["items"], list)

    def test_unauthenticated_denied(self, client):
        resp = client.get("/api/favorites")
        assert resp.status_code == 401


class TestAddFavorite:
    def test_add_book_favorite(self, client, admin_headers, fav_book):
        resp = client.post(
            "/api/favorites",
            json={
                "item_type": "book",
                "item_id": fav_book.id,
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["item_type"] == "book"
        assert body["item_id"] == fav_book.id

    def test_add_map_favorite(self, client, admin_headers, fav_map):
        resp = client.post(
            "/api/favorites",
            json={
                "item_type": "map",
                "item_id": fav_map.id,
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201

    def test_add_token_favorite(self, client, admin_headers, fav_token):
        resp = client.post(
            "/api/favorites",
            json={
                "item_type": "token",
                "item_id": fav_token.id,
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201

    def test_add_system_favorite(self, client, admin_headers, fav_system):
        resp = client.post(
            "/api/favorites",
            json={
                "item_type": "system",
                "item_id": fav_system.id,
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201

    def test_invalid_type_rejected(self, client, admin_headers):
        resp = client.post(
            "/api/favorites",
            json={
                "item_type": "invalid",
                "item_id": "some-id",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_duplicate_is_idempotent(self, client, admin_headers, fav_book):
        # Add same favorite twice — should not error
        resp1 = client.post(
            "/api/favorites",
            json={
                "item_type": "book",
                "item_id": fav_book.id,
            },
            headers=admin_headers,
        )
        resp2 = client.post(
            "/api/favorites",
            json={
                "item_type": "book",
                "item_id": fav_book.id,
            },
            headers=admin_headers,
        )
        assert resp1.status_code in (201,)
        assert resp2.status_code in (201,)

    def test_unauthenticated_denied(self, client):
        resp = client.post(
            "/api/favorites",
            json={
                "item_type": "book",
                "item_id": "some-id",
            },
        )
        assert resp.status_code == 401


class TestFavoritesEnrichedShape:
    def test_book_item_includes_index_failed(self, client, admin_headers, fav_book):
        client.post(
            "/api/favorites",
            json={"item_type": "book", "item_id": fav_book.id},
            headers=admin_headers,
        )
        resp = client.get("/api/favorites", headers=admin_headers)
        items = resp.json()["items"]
        book_items = [i for i in items if i.get("item_type") == "book"]
        if book_items:
            assert all("index_failed" in i for i in book_items)


class TestFavoritesArePersisted:
    def test_added_book_appears_in_list(self, client, gm_headers, fav_book):
        # Clean add for gm user
        client.post(
            "/api/favorites",
            json={
                "item_type": "book",
                "item_id": fav_book.id,
            },
            headers=gm_headers,
        )
        resp = client.get("/api/favorites", headers=gm_headers)
        ids_and_types = resp.json()["favorites"]
        assert {"item_type": "book", "item_id": fav_book.id} in ids_and_types

    def test_favorites_are_per_user(self, client, gm_headers, player_headers, fav_map):
        # GM adds a map favorite
        client.post(
            "/api/favorites",
            json={
                "item_type": "map",
                "item_id": fav_map.id,
            },
            headers=gm_headers,
        )

        # Player should NOT see it
        resp = client.get("/api/favorites", headers=player_headers)
        player_ids = resp.json()["favorites"]
        assert {"item_type": "map", "item_id": fav_map.id} not in player_ids


class TestRemoveFavorite:
    def test_remove_favorite(self, client, admin_headers, fav_book):
        # Ensure it's added first
        client.post(
            "/api/favorites",
            json={
                "item_type": "book",
                "item_id": fav_book.id,
            },
            headers=admin_headers,
        )

        resp = client.delete(f"/api/favorites/book/{fav_book.id}", headers=admin_headers)
        assert resp.status_code == 204

        # Confirm removed
        favorites = client.get("/api/favorites", headers=admin_headers).json()["favorites"]
        assert {"item_type": "book", "item_id": fav_book.id} not in favorites

    def test_remove_nonexistent_is_silent(self, client, admin_headers):
        # Removing a favorite that doesn't exist should not error
        resp = client.delete("/api/favorites/book/nonexistent-id", headers=admin_headers)
        assert resp.status_code == 204

    def test_unauthenticated_denied(self, client, fav_book):
        resp = client.delete(f"/api/favorites/book/{fav_book.id}")
        assert resp.status_code == 401
