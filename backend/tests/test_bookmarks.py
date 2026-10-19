"""Tests for the bookmarks CRUD endpoints."""
import pytest
from backend.tests.conftest import make_game_system, make_book


@pytest.fixture(scope="module")
def bm_book():
    sys = make_game_system()
    return make_book(system_id=sys.id, title="Bookmark Test Book")


class TestBookmarks:
    def test_create_page_bookmark(self, client, admin_headers, bm_book):
        resp = client.post(
            "/api/bookmarks",
            json={
                "book_id": bm_book.id,
                "page_number": 5,
                "label": "Chapter 1",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["page_number"] == 5
        assert data["label"] == "Chapter 1"
        assert data["selected_text"] is None
        assert "id" in data
        assert "created_at" in data

    def test_create_text_selection_bookmark(self, client, admin_headers, bm_book):
        resp = client.post(
            "/api/bookmarks",
            json={
                "book_id": bm_book.id,
                "page_number": 10,
                "label": "Key Rule",
                "selected_text": "Roll 2d6 and add your modifier.",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["selected_text"] == "Roll 2d6 and add your modifier."

    def test_list_bookmarks(self, client, admin_headers, bm_book):
        resp = client.get(f"/api/bookmarks?book_id={bm_book.id}", headers=admin_headers)
        assert resp.status_code == 200
        items = resp.json()
        assert isinstance(items, list)
        assert len(items) >= 1

    def test_bookmarks_sorted_by_page(self, client, admin_headers, bm_book):
        resp = client.get(f"/api/bookmarks?book_id={bm_book.id}", headers=admin_headers)
        pages = [b["page_number"] for b in resp.json()]
        assert pages == sorted(pages)

    def test_update_bookmark_label(self, client, admin_headers, bm_book):
        create = client.post(
            "/api/bookmarks",
            json={
                "book_id": bm_book.id,
                "page_number": 20,
                "label": "Old Label",
            },
            headers=admin_headers,
        )
        bm_id = create.json()["id"]

        update = client.patch(
            f"/api/bookmarks/{bm_id}", json={"label": "New Label"}, headers=admin_headers
        )
        assert update.status_code == 200
        assert update.json()["label"] == "New Label"

    def test_delete_bookmark(self, client, admin_headers, bm_book):
        create = client.post(
            "/api/bookmarks",
            json={
                "book_id": bm_book.id,
                "page_number": 99,
                "label": "To Delete",
            },
            headers=admin_headers,
        )
        bm_id = create.json()["id"]

        assert client.delete(f"/api/bookmarks/{bm_id}", headers=admin_headers).status_code == 200

        ids = [
            b["id"]
            for b in client.get(
                f"/api/bookmarks?book_id={bm_book.id}", headers=admin_headers
            ).json()
        ]
        assert bm_id not in ids

    def test_user_isolation_list(self, client, admin_headers, player_headers, bm_book):
        """Player does not see admin's bookmarks."""
        create = client.post(
            "/api/bookmarks",
            json={
                "book_id": bm_book.id,
                "page_number": 42,
                "label": "Admin Only",
            },
            headers=admin_headers,
        )
        bm_id = create.json()["id"]

        player_ids = [
            b["id"]
            for b in client.get(
                f"/api/bookmarks?book_id={bm_book.id}", headers=player_headers
            ).json()
        ]
        assert bm_id not in player_ids

    def test_user_isolation_update(self, client, admin_headers, player_headers, bm_book):
        """Player cannot update admin's bookmark."""
        create = client.post(
            "/api/bookmarks",
            json={
                "book_id": bm_book.id,
                "page_number": 43,
                "label": "Admin Owned",
            },
            headers=admin_headers,
        )
        bm_id = create.json()["id"]

        resp = client.patch(
            f"/api/bookmarks/{bm_id}", json={"label": "Hacked"}, headers=player_headers
        )
        assert resp.status_code == 404

    def test_user_isolation_delete(self, client, admin_headers, player_headers, bm_book):
        """Player cannot delete admin's bookmark."""
        create = client.post(
            "/api/bookmarks",
            json={
                "book_id": bm_book.id,
                "page_number": 44,
                "label": "Admin Protected",
            },
            headers=admin_headers,
        )
        bm_id = create.json()["id"]

        resp = client.delete(f"/api/bookmarks/{bm_id}", headers=player_headers)
        assert resp.status_code == 404

    def test_update_nonexistent_returns_404(self, client, admin_headers):
        resp = client.patch(
            "/api/bookmarks/does-not-exist", json={"label": "x"}, headers=admin_headers
        )
        assert resp.status_code == 404

    def test_delete_nonexistent_returns_404(self, client, admin_headers):
        resp = client.delete("/api/bookmarks/does-not-exist", headers=admin_headers)
        assert resp.status_code == 404

    def test_list_requires_auth(self, client, bm_book):
        resp = client.get(f"/api/bookmarks?book_id={bm_book.id}")
        assert resp.status_code == 401

    def test_create_requires_auth(self, client, bm_book):
        resp = client.post(
            "/api/bookmarks",
            json={
                "book_id": bm_book.id,
                "page_number": 1,
            },
        )
        assert resp.status_code == 401


class TestBookmarkBookAccess:
    """A bookmark can only be made on a book the caller can read, and every refusal
    is the same 404 so bookmarking can't reveal which book ids exist."""

    def test_missing_book_is_404(self, client, player_headers):
        resp = client.post(
            "/api/bookmarks",
            json={"book_id": "no-such-book", "page_number": 1, "label": "x"},
            headers=player_headers,
        )
        assert resp.status_code == 404

    def test_restricted_book_is_404(self, client, player_headers):
        book = make_book(make_game_system().id, access_level="gm")
        resp = client.post(
            "/api/bookmarks",
            json={"book_id": book.id, "page_number": 1, "label": "x"},
            headers=player_headers,
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Book not found"

    def test_readable_book_still_bookmarks(self, client, player_headers):
        book = make_book(make_game_system().id)
        resp = client.post(
            "/api/bookmarks",
            json={"book_id": book.id, "page_number": 1, "label": "x"},
            headers=player_headers,
        )
        assert resp.status_code == 201
