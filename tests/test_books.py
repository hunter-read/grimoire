"""Tests for book listing and metadata endpoints.

PDF rendering and page endpoints are not tested here since they require
actual PDF files on disk. Those are better suited for integration tests.
"""
import pytest
from tests.conftest import make_game_system, make_book


@pytest.fixture(scope="module")
def system():
    return make_game_system()


@pytest.fixture(scope="module")
def book(system):
    return make_book(
        system_id=system.id,
        title="Player's Handbook",
        category="core",
        description="The core rulebook.",
        page_count=320,
    )


class TestListBooks:
    def test_returns_list(self, client, admin_headers, book):
        resp = client.get("/api/books", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "books" in body
        assert "total" in body

    def test_contains_created_book(self, client, admin_headers, book):
        resp = client.get("/api/books", headers=admin_headers)
        ids = [b["id"] for b in resp.json()["books"]]
        assert book.id in ids

    def test_list_includes_index_failed_field(self, client, admin_headers, book):
        resp = client.get("/api/books", headers=admin_headers)
        assert resp.status_code == 200
        books = resp.json()["books"]
        assert len(books) > 0
        assert all("index_failed" in b for b in books)

    def test_filter_by_category(self, client, admin_headers, book):
        resp = client.get("/api/books?category=core", headers=admin_headers)
        assert resp.status_code == 200
        books = resp.json()["books"]
        assert all(b["category"] == "core" for b in books)

    def test_pagination(self, client, admin_headers, book):
        resp = client.get("/api/books?limit=1&offset=0", headers=admin_headers)
        assert resp.status_code == 200
        assert len(resp.json()["books"]) <= 1

    def test_player_can_list_books(self, client, player_headers, book):
        resp = client.get("/api/books", headers=player_headers)
        assert resp.status_code == 200

    def test_unauthenticated_denied(self, client):
        resp = client.get("/api/books")
        assert resp.status_code == 401


class TestGetBook:
    def test_get_existing_book(self, client, admin_headers, book):
        resp = client.get(f"/api/books/{book.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == book.id
        assert body["title"] == "Player's Handbook"
        assert body["category"] == "core"
        assert body["page_count"] == 320

    def test_get_book_includes_index_failed(self, client, admin_headers, book):
        resp = client.get(f"/api/books/{book.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "index_failed" in body
        assert isinstance(body["index_failed"], bool)
        assert body["index_failed"] is False

    def test_get_nonexistent_book(self, client, admin_headers):
        resp = client.get("/api/books/does-not-exist", headers=admin_headers)
        assert resp.status_code == 404

    def test_player_can_get_book(self, client, player_headers, book):
        resp = client.get(f"/api/books/{book.id}", headers=player_headers)
        assert resp.status_code == 200


class TestUpdateBook:
    def test_gm_can_update_metadata(self, client, gm_headers, book):
        resp = client.patch(
            f"/api/books/{book.id}",
            json={
                "description": "Updated rulebook description",
                "publisher": "Wizards of the Coast",
            },
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_admin_can_update_metadata(self, client, admin_headers, book):
        resp = client.patch(
            f"/api/books/{book.id}",
            json={
                "title": "Player's Handbook (Revised)",
                "category": "core",
                "authors": ["Jeremy Crawford"],
            },
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_player_cannot_update(self, client, player_headers, book):
        resp = client.patch(
            f"/api/books/{book.id}",
            json={
                "description": "Player sneaks in a change",
            },
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_update_nonexistent_book(self, client, admin_headers):
        resp = client.patch(
            "/api/books/ghost-book",
            json={
                "title": "Ghost",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 404
