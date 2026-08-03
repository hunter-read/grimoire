"""Tests for the book metadata-lookup endpoints (issue #203).

Mirrors ``test_addons_api.py`` for the book target, including the read-only
guarantee and the two-stage search→detail flow a query-backed source needs.
"""
import json
import os
import uuid

import pytest
import yaml

from backend.addons import fetch, registry
from backend.addons.constants import (
    SETTING_ALLOW_SCRIPTS,
    SETTING_INDEX_CACHE,
    SETTING_INDEX_URL,
    SETTING_INSTALLED,
)
from backend.config import SessionLocal
from backend.models import AppSetting, Book
from backend.tests.conftest import make_book, make_game_system

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures")

MANIFEST = {
    "id": "drivethrurpg",
    "name": "DriveThruRPG",
    "version": "1.0.0",
    "kind": "scraper",
    "target": "book",
    "attribution": "Data from DriveThruRPG",
    "source": {
        "url": "https://api.drivethrurpg.com/api/vBeta/products?keyword={query}",
        "format": "json",
        "cache_ttl": 3600,
    },
    "detail": {"url": "https://api.drivethrurpg.com/api/vBeta/products/{identity}"},
    "records": {"root": "$", "skip_when": {"field": "isGiftCert", "equals": True}},
    "search": {
        "fields": [
            {"field": "description.name", "weight": 1.0},
            {"field": "publisher.name", "weight": 0.2},
        ],
        "min_score": 0.4,
        "label": {"template": "{description.name} — {publisher.name}"},
        "identity": {"from": "productId"},
        "url": {"template": "https://www.drivethrurpg.com/en/product/{identity}"},
    },
    "map": {
        "title": {"from": "description.name"},
        "authors": {"from": "authors"},
        "artists": {"from": "artists"},
        "publisher": {"from": "publisher.name"},
        "year": {"from": "dateAvailable"},
        "genres": {
            "from": "filters",
            "select": {"field": "parentId", "in": [10, 100]},
            "pluck": {
                "from": "descriptions.name",
                "select": {"field": "languageCode", "equals": "en"},
                "first": True,
            },
        },
    },
}


@pytest.fixture(autouse=True)
def clean_settings():
    yield
    session = SessionLocal()
    for key in (SETTING_INSTALLED, SETTING_INDEX_URL, SETTING_INDEX_CACHE, SETTING_ALLOW_SCRIPTS):
        row = session.query(AppSetting).filter_by(key=key).first()
        if row:
            session.delete(row)
    session.commit()
    session.close()


@pytest.fixture(autouse=True)
def addons_dir(tmp_path, monkeypatch):
    directory = tmp_path / "add-ons"
    directory.mkdir()
    monkeypatch.setattr(registry, "ADDONS_DIR", str(directory))
    monkeypatch.setattr(fetch, "ADDON_CACHE_DIR", str(tmp_path / "cache"))
    return directory


@pytest.fixture
def installed(addons_dir):
    directory = addons_dir / "drivethrurpg"
    directory.mkdir()
    (directory / "drivethrurpg.yml").write_text(yaml.safe_dump(MANIFEST))
    return directory


@pytest.fixture
def source_data(monkeypatch):
    """Serve the checked-in fixtures for both stages of the lookup."""
    with open(os.path.join(FIXTURE_DIR, "drivethrurpg_search.json"), encoding="utf-8") as fh:
        search_doc = json.load(fh)
    with open(os.path.join(FIXTURE_DIR, "drivethrurpg_detail.json"), encoding="utf-8") as fh:
        detail_doc = json.load(fh)
    calls = []

    def fake_fetch_document(url, **kwargs):
        calls.append(url)
        # The detail endpoint ends in the product id; search carries a query.
        return detail_doc if "keyword=" not in url else search_doc

    monkeypatch.setattr("backend.addons.service.fetch.fetch_document", fake_fetch_document)
    return calls


@pytest.fixture
def book():
    system = make_game_system(name=f"System-{uuid.uuid4().hex[:6]}")
    return make_book(system.id, title="Blades in the Dark")


class TestMetadataSources:
    def test_lists_book_sources(self, client, gm_headers, book, installed):
        body = client.get(f"/api/books/{book.id}/metadata-sources", headers=gm_headers).json()
        assert [s["id"] for s in body["sources"]] == ["drivethrurpg"]

    def test_a_system_scraper_is_not_offered_for_books(
        self, client, gm_headers, book, addons_dir
    ):
        """Targets are kept separate: a game-system add-on must not appear here."""
        directory = addons_dir / "ttrpg-wiki"
        directory.mkdir()
        (directory / "ttrpg-wiki.yml").write_text(
            yaml.safe_dump(
                {
                    "id": "ttrpg-wiki",
                    "name": "TTRPG Wiki",
                    "version": "1.0.0",
                    "kind": "scraper",
                    "target": "game-system",
                    "source": {"url": "https://example.com/s.json", "format": "json"},
                    "search": {"fields": [{"field": "name"}], "identity": {"from": "name"}},
                }
            )
        )
        body = client.get(f"/api/books/{book.id}/metadata-sources", headers=gm_headers).json()
        assert body["sources"] == []

    def test_requires_gm_or_admin(self, client, player_headers, book, installed):
        response = client.get(
            f"/api/books/{book.id}/metadata-sources", headers=player_headers
        )
        assert response.status_code == 403

    def test_unknown_book_is_404(self, client, gm_headers, installed):
        assert (
            client.get("/api/books/nope/metadata-sources", headers=gm_headers).status_code
            == 404
        )


class TestMetadataSearch:
    def test_defaults_to_the_book_title(self, client, gm_headers, book, installed, source_data):
        body = client.post(
            f"/api/books/{book.id}/metadata-search",
            json={"source_id": "drivethrurpg"},
            headers=gm_headers,
        ).json()
        assert body["query"] == "Blades in the Dark"
        assert body["results"]

    def test_the_query_reaches_the_source_url(
        self, client, gm_headers, book, installed, source_data
    ):
        """A query-backed source builds a per-query URL rather than downloading
        a whole catalogue."""
        client.post(
            f"/api/books/{book.id}/metadata-search",
            json={"source_id": "drivethrurpg", "query": "Deep Cuts"},
            headers=gm_headers,
        )
        assert any("keyword=Deep%20Cuts" in url for url in source_data)

    def test_no_matches_is_an_empty_list(
        self, client, gm_headers, book, installed, source_data
    ):
        response = client.post(
            f"/api/books/{book.id}/metadata-search",
            json={"source_id": "drivethrurpg", "query": "zzzz nonexistent zzzz"},
            headers=gm_headers,
        )
        assert response.status_code == 200 and response.json()["results"] == []

    def test_requires_gm_or_admin(self, client, player_headers, book, installed):
        response = client.post(
            f"/api/books/{book.id}/metadata-search",
            json={"source_id": "drivethrurpg"},
            headers=player_headers,
        )
        assert response.status_code == 403

    def test_an_unreachable_source_is_502(
        self, client, gm_headers, book, installed, monkeypatch
    ):
        def boom(url, **kwargs):
            raise fetch.AddonFetchError("source timed out")

        monkeypatch.setattr("backend.addons.service.fetch.fetch_document", boom)
        response = client.post(
            f"/api/books/{book.id}/metadata-search",
            json={"source_id": "drivethrurpg"},
            headers=gm_headers,
        )
        assert response.status_code == 502


class TestMetadataFetch:
    def _fetch(self, client, headers, book_id, identity="170689"):
        return client.post(
            f"/api/books/{book_id}/metadata-fetch",
            json={
                "source_id": "drivethrurpg",
                "identity": identity,
                "query": "Blades in the Dark",
            },
            headers=headers,
        )

    def test_returns_a_field_diff(self, client, gm_headers, book, installed, source_data):
        body = self._fetch(client, gm_headers, book.id).json()
        fields = {row["field"]: row for row in body["fields"]}
        assert fields["authors"]["incoming"] == ["John Harper"]
        assert fields["year"]["incoming"] == 2016
        assert fields["publisher"]["incoming"] == "One Seven"
        assert body["attribution"] == "Data from DriveThruRPG"

    def test_it_fetches_the_detail_endpoint(
        self, client, gm_headers, book, installed, source_data
    ):
        """Search results are summaries; the mapped data comes from detail."""
        self._fetch(client, gm_headers, book.id)
        assert any(url.endswith("/products/170689") for url in source_data)

    def test_the_title_already_matches(self, client, gm_headers, book, installed, source_data):
        body = self._fetch(client, gm_headers, book.id).json()
        row = next(r for r in body["fields"] if r["field"] == "title")
        assert row["status"] == "same"

    def test_genres_are_marked_new(self, client, gm_headers, book, installed, source_data):
        body = self._fetch(client, gm_headers, book.id).json()
        row = next(r for r in body["fields"] if r["field"] == "genres")
        assert row["status"] == "only_incoming"
        assert row["incoming"] == ["Fantasy", "Dark Fantasy", "Steampunk"]

    def test_fetch_writes_nothing_to_the_book(
        self, client, gm_headers, book, installed, source_data
    ):
        """The core non-destructive guarantee, for books too."""
        self._fetch(client, gm_headers, book.id)
        session = SessionLocal()
        after = session.query(Book).filter_by(id=book.id).first()
        assert after.authors in ([], None)
        assert after.year is None
        assert after.publisher == ""
        session.close()

    def test_requires_gm_or_admin(self, client, player_headers, book, installed):
        assert self._fetch(client, player_headers, book.id).status_code == 403

    def test_unknown_book_is_404(self, client, gm_headers, installed, source_data):
        assert self._fetch(client, gm_headers, "nope").status_code == 404


class TestApplyingChanges:
    def test_the_user_applies_fields_through_the_existing_patch(
        self, client, gm_headers, book, installed, source_data
    ):
        """End-to-end: fetch proposes, PATCH disposes — and only what was chosen."""
        body = client.post(
            f"/api/books/{book.id}/metadata-fetch",
            json={
                "source_id": "drivethrurpg",
                "identity": "170689",
                "query": "Blades in the Dark",
            },
            headers=gm_headers,
        ).json()

        chosen = {
            row["field"]: row["incoming"]
            for row in body["fields"]
            if row["field"] in ("authors", "year")
        }
        assert (
            client.patch(f"/api/books/{book.id}", json=chosen, headers=gm_headers).status_code
            == 200
        )

        session = SessionLocal()
        after = session.query(Book).filter_by(id=book.id).first()
        assert after.authors == ["John Harper"]
        assert after.year == 2016
        # Fields the user did not select stay untouched.
        assert after.publisher == ""
        session.close()
