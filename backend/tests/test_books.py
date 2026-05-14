"""Tests for book listing and metadata endpoints.

PDF rendering and page endpoints are not tested here since they require
actual PDF files on disk. Those are better suited for integration tests.
"""
import os
import tempfile
import pytest
from backend.tests.conftest import make_game_system, make_book


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

    def test_list_includes_is_missing_field(self, client, admin_headers, book):
        resp = client.get("/api/books", headers=admin_headers)
        assert resp.status_code == 200
        books = resp.json()["books"]
        assert len(books) > 0
        assert all("is_missing" in b for b in books)
        assert all(isinstance(b["is_missing"], bool) for b in books)

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

    def test_get_book_includes_is_missing(self, client, admin_headers, book):
        resp = client.get(f"/api/books/{book.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "is_missing" in body
        assert isinstance(body["is_missing"], bool)
        assert body["is_missing"] is False

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


class TestImageBookPage:
    IMAGE_TYPES = [
        ("png", "image/png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 8),
        ("jpg", "image/jpeg", b"\xff\xd8\xff\xe0" + b"\x00" * 12),
        ("jpeg", "image/jpeg", b"\xff\xd8\xff\xe0" + b"\x00" * 12),
        ("webp", "image/webp", b"RIFF\x00\x00\x00\x00WEBP"),
        ("gif", "image/gif", b"GIF89a" + b"\x00" * 10),
        ("bmp", "image/bmp", b"BM" + b"\x00" * 10),
    ]

    def _make_image_book(self, system_id, ext, mime_type, content):
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as f:
            f.write(content)
            fpath = f.name
        book = make_book(
            system_id=system_id,
            title=f"Image Book ({ext})",
            filename=f"image.{ext}",
            filepath=fpath,
            mime_type=mime_type,
            page_count=1,
        )
        return book, fpath

    @pytest.fixture(scope="module")
    def sys(self):
        return make_game_system()

    def test_image_book_page1_returns_file(self, client, admin_headers, sys):
        ext, mime_type, content = self.IMAGE_TYPES[0]
        book, fpath = self._make_image_book(sys.id, ext, mime_type, content)
        try:
            resp = client.get(f"/api/books/{book.id}/page/1", headers=admin_headers)
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("image/")
        finally:
            os.unlink(fpath)

    def test_image_book_page_beyond_1_is_400(self, client, admin_headers, sys):
        ext, mime_type, content = self.IMAGE_TYPES[0]
        book, fpath = self._make_image_book(sys.id, ext, mime_type, content)
        try:
            resp = client.get(f"/api/books/{book.id}/page/2", headers=admin_headers)
            assert resp.status_code == 400
        finally:
            os.unlink(fpath)

    def test_all_image_mime_types_served(self, client, admin_headers, sys):
        for ext, mime_type, content in self.IMAGE_TYPES:
            book, fpath = self._make_image_book(sys.id, ext, mime_type, content)
            try:
                resp = client.get(f"/api/books/{book.id}/page/1", headers=admin_headers)
                assert resp.status_code == 200, f"Failed for {ext}: {resp.status_code}"
                assert resp.headers["content-type"].startswith("image/"), f"Wrong content-type for {ext}"
            finally:
                os.unlink(fpath)

    def test_image_book_missing_file_returns_404(self, client, admin_headers, sys):
        book = make_book(
            system_id=sys.id,
            title="Missing Image Book",
            filename="missing.png",
            filepath="/nonexistent/path/missing.png",
            mime_type="image/png",
            page_count=1,
        )
        resp = client.get(f"/api/books/{book.id}/page/1", headers=admin_headers)
        assert resp.status_code == 404

    def test_pdf_book_page_still_404_without_file(self, client, admin_headers, sys):
        book = make_book(
            system_id=sys.id,
            title="Missing PDF",
            filename="missing.pdf",
            filepath="/nonexistent/path/missing.pdf",
            mime_type="application/pdf",
            page_count=10,
        )
        resp = client.get(f"/api/books/{book.id}/page/1", headers=admin_headers)
        assert resp.status_code == 404
