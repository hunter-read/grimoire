"""Tests for the full-text search endpoint."""
import pytest
from backend.tests.conftest import make_game_system, make_book
from backend.config import SessionLocal
from sqlalchemy import text


@pytest.fixture(scope="module")
def indexed_book():
    """Create a book and insert FTS content so search can find it."""
    sys = make_game_system()
    book = make_book(
        system_id=sys.id,
        title="Spell Compendium",
        indexed=True,
    )
    # Seed the FTS table so search results are findable
    db = SessionLocal()
    try:
        db.execute(
            text(
                "INSERT INTO book_search (book_id, page_number, content) VALUES (:bid, :pn, :content)"
            ),
            {"bid": book.id, "pn": 1, "content": "fireball spell wizard evocation"},
        )
        db.execute(
            text(
                "INSERT INTO book_search (book_id, page_number, content) VALUES (:bid, :pn, :content)"
            ),
            {"bid": book.id, "pn": 2, "content": "lightning bolt electricity storm"},
        )
        db.commit()
    finally:
        db.close()
    return book


class TestSearch:
    def test_search_returns_results(self, client, admin_headers, indexed_book):
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "results" in body
        assert isinstance(body["results"], list)

    def test_search_finds_indexed_content(self, client, admin_headers, indexed_book):
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        results = resp.json()["results"]
        book_ids = [r["id"] for r in results]
        assert indexed_book.id in book_ids

    def test_search_result_shape(self, client, admin_headers, indexed_book):
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        result = next(r for r in resp.json()["results"] if r["id"] == indexed_book.id)
        assert "id" in result
        assert "title" in result
        assert "page_number" in result
        assert "snippet" in result
        assert "category" in result
        assert "game_system_id" in result

    def test_search_scoped_to_book(self, client, admin_headers, indexed_book):
        resp = client.get(
            f"/api/search?q=fireball&book_id={indexed_book.id}",
            headers=admin_headers,
        )
        assert resp.status_code == 200
        results = resp.json()["results"]
        assert all(r["id"] == indexed_book.id for r in results)

    def test_search_no_results_for_unknown_term(self, client, admin_headers):
        resp = client.get("/api/search?q=xyznonexistenttermqwerty", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["results"] == []

    def test_search_requires_query_param(self, client, admin_headers):
        resp = client.get("/api/search", headers=admin_headers)
        assert resp.status_code == 422

    def test_player_can_search(self, client, player_headers, indexed_book):
        resp = client.get("/api/search?q=fireball", headers=player_headers)
        assert resp.status_code == 200

    def test_unauthenticated_denied(self, client):
        resp = client.get("/api/search?q=fireball")
        assert resp.status_code == 401

    def test_global_search_includes_maps_and_tokens_keys(self, client, admin_headers, indexed_book):
        """Global search response always includes maps and tokens arrays."""
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        body = resp.json()
        assert "maps" in body
        assert "tokens" in body
        assert isinstance(body["maps"], list)
        assert isinstance(body["tokens"], list)

    def test_global_search_finds_map_by_filename(self, client, admin_headers):
        from backend.tests.conftest import make_map

        m = make_map(filename="dragonlair-battlemap.png", relative_path="dragonlair-battlemap.png")
        resp = client.get("/api/search?q=dragonlair", headers=admin_headers)
        body = resp.json()
        assert any(item["id"] == m.id for item in body["maps"])

    def test_global_search_finds_token_by_filename(self, client, admin_headers):
        from backend.tests.conftest import make_token

        t = make_token(filename="shadowgoblintoken.png", relative_path="shadowgoblintoken.png")
        resp = client.get("/api/search?q=shadowgoblintoken", headers=admin_headers)
        body = resp.json()
        assert any(item["id"] == t.id for item in body["tokens"])

    def test_scoped_search_returns_empty_maps_tokens(self, client, admin_headers, indexed_book):
        """When scoped to a system or book, maps and tokens are always empty."""
        resp = client.get(
            f"/api/search?q=fireball&system_id={indexed_book.game_system_id}",
            headers=admin_headers,
        )
        body = resp.json()
        assert body.get("maps", []) == []
        assert body.get("tokens", []) == []

    def test_game_system_id_value_matches_book(self, client, admin_headers, indexed_book):
        """game_system_id in results must equal the book's actual game_system_id."""
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        result = next(r for r in resp.json()["results"] if r["id"] == indexed_book.id)
        assert result["game_system_id"] == indexed_book.game_system_id

    def test_game_system_name_present(self, client, admin_headers, indexed_book):
        """game_system field should be non-empty when the book belongs to a system."""
        resp = client.get("/api/search?q=fireball", headers=admin_headers)
        result = next(r for r in resp.json()["results"] if r["id"] == indexed_book.id)
        assert result["game_system"] != ""

    def test_multiple_pages_from_same_book_all_returned(self, client, admin_headers, indexed_book):
        """Both indexed pages from the same book should appear as separate result rows."""
        resp = client.get("/api/search?q=fireball OR lightning", headers=admin_headers)
        results = resp.json()["results"]
        book_results = [r for r in results if r["id"] == indexed_book.id]
        page_numbers = {r["page_number"] for r in book_results}
        assert 1 in page_numbers, "page 1 (fireball) should be in results"
        assert 2 in page_numbers, "page 2 (lightning bolt) should be in results"

    def test_search_limit_param_respected(self, client, admin_headers, indexed_book):
        """Passing limit=1 should return at most 1 result."""
        resp = client.get("/api/search?q=fireball&limit=1", headers=admin_headers)
        assert resp.status_code == 200
        assert len(resp.json()["results"]) <= 1

    def test_scoped_to_nonexistent_system_returns_empty(self, client, admin_headers):
        """Searching within a system_id that has no books should return empty results."""
        resp = client.get("/api/search?q=fireball&system_id=nonexistent-system-id", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["results"] == []
