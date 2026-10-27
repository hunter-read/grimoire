"""Tests for the Grimoire Codex DB integration (issue #35).

Grimoire Codex DB is faked with an ``httpx.MockTransport`` so every request Grimoire makes
is recorded and checked: what it sends matters as much as what it does with
the answer (hashes only when opted in, the token on every call, no system
list on a correction). The ``fake`` fixture sets ``GRIMOIRE_CODEX_DB_API_TOKEN``; without
it the integration is off and hidden (``TestUnconfigured``).
"""
import json

import httpx
import pytest

from backend import codex
from backend.codex import client as codex_client
from backend.codex.lookup import resolve_paste
from backend.codex.records import candidate_label, incoming_fields
from backend import config
from backend.config import SessionLocal
from backend.models import AppSetting, Book, GameSystem
from backend.tests.codex_fake import _codex_id, _link, _set, fake_codex  # noqa: F401  (the "fake" fixture)
from backend.tests.conftest import make_book, make_game_system

BOOK_EXPORT = {
    "codex_id": "bk_abc123",
    "codex_revision": 4,
    "codex_url": "https://codex.test/books/bk_abc123",
    "title": "Sailors on the Starless Sea",
    "description": "A funnel adventure.",
    "category": "adventure",
    "authors": ["Harley Stroh"],
    "artists": [],
    "publisher": "Goodman Games",
    "publisher_url": "",
    "urls": [{"label": "Store", "url": "https://goodman-games.com/sailors"}],
    "genres": ["Fantasy"],
    "isbn": "9780982935",
    "product_code": "GMG5067",
    "version": "",
    "language": "en",
    "license": "",
    "year": 2012,
    "month": None,
    "day": None,
    "page_count": 16,
    "tags": [],
    "is_explicit": False,
    "systems": [{"codex_id": "sy_dcc001", "name": "Dungeon Crawl Classics"}],
    "cover_url": None,
}


# --- Settings ------------------------------------------------------------------------------


class TestUnconfigured:
    """Without GRIMOIRE_CODEX_DB_API_TOKEN, Grimoire Codex DB is neither offered nor reachable."""

    def test_nothing_is_offered_or_sent(self, client, admin_headers, gm_headers, fake, monkeypatch):
        monkeypatch.setattr(config, "CODEX_DB_API_TOKEN", "")
        system = make_game_system()
        book = make_book(system.id)
        r = client.get("/api/codex/status", headers=gm_headers)
        assert r.json() == {"enabled": False, "url": "https://codex.test"}

        sources = client.get(f"/api/books/{book.id}/metadata-sources", headers=gm_headers).json()
        assert all(s["id"] != "grimoire-codex" for s in sources["sources"])
        r = client.post(
            f"/api/books/{book.id}/metadata-search",
            json={"source_id": "grimoire-codex", "query": ""},
            headers=gm_headers,
        )
        assert r.status_code == 400
        assert "not configured" in r.json()["detail"]

        for method, path in [
            ("GET", "/api/codex/settings"),
            ("PUT", "/api/codex/settings"),
            ("POST", "/api/codex/test"),
            ("POST", f"/api/codex/systems/{system.id}/submit"),
            ("POST", f"/api/codex/books/{book.id}/submit"),
            ("DELETE", f"/api/codex/systems/{system.id}/link"),
            ("DELETE", f"/api/codex/books/{book.id}/link"),
        ]:
            r = client.request(method, path, json={}, headers=admin_headers)
            assert r.status_code == 404, (method, path)
        assert fake.requests == []

    def test_a_blank_token_counts_as_unset(self, fake, monkeypatch):
        monkeypatch.setenv("GRIMOIRE_CODEX_DB_API_TOKEN", "  ")
        monkeypatch.setattr(config, "CODEX_DB_API_TOKEN", config.env._read_codex_db_api_token())
        db = SessionLocal()
        settings = codex.load(db)
        db.close()
        assert not settings.enabled


class TestSettings:
    def test_defaults_and_the_token_is_never_returned(self, client, admin_headers, fake):
        r = client.get("/api/codex/settings", headers=admin_headers)
        assert r.status_code == 200
        assert r.json() == {
            "url": "https://codex.test",
            "send_hashes": False,
            "locked": [],
        }
        r = client.put(
            "/api/codex/settings",
            json={"url": "https://other.test/", "send_hashes": True},
            headers=admin_headers,
        )
        assert r.status_code == 200
        body = r.json()
        assert "cdx_tok" not in json.dumps(body)
        assert body["send_hashes"] and body["url"] == "https://other.test"

    def test_the_token_cannot_be_set_through_the_api(self, client, admin_headers, fake):
        client.put("/api/codex/settings", json={"api_token": "cdx_other"}, headers=admin_headers)
        db = SessionLocal()
        assert db.query(AppSetting).filter(AppSetting.key.like("%token%")).count() == 0
        db.close()

    def test_rejects_bad_url_and_non_admins(self, client, admin_headers, gm_headers, fake):
        r = client.put("/api/codex/settings", json={"url": "ftp://x"}, headers=admin_headers)
        assert r.status_code == 400
        assert client.get("/api/codex/settings", headers=gm_headers).status_code == 403
        r = client.put("/api/codex/settings", json={"send_hashes": True}, headers=gm_headers)
        assert r.status_code == 403

    def test_environment_pins_a_setting(self, client, admin_headers, fake, monkeypatch):
        monkeypatch.setitem(config.CODEX_DB_ENV, "codex_url", "https://pinned.test/")
        monkeypatch.setitem(config.CODEX_DB_ENV, "codex_send_hashes", "true")
        body = client.get("/api/codex/settings", headers=admin_headers).json()
        assert body["url"] == "https://pinned.test"
        assert body["send_hashes"] is True
        assert body["locked"] == ["send_hashes", "url"]
        r = client.put("/api/codex/settings", json={"url": "https://x.test"}, headers=admin_headers)
        assert r.status_code == 400
        assert "GRIMOIRE_CODEX_DB_URL" in r.json()["detail"]

    def test_invalid_stored_url_falls_back_to_default(self, fake):
        db = SessionLocal()
        db.query(AppSetting).filter_by(key="codex_url").one().value = "not a url"
        db.commit()
        assert codex.load(db).url == codex.DEFAULT_URL
        db.close()

    def test_status_is_visible_to_players(self, client, player_headers, fake):
        r = client.get("/api/codex/status", headers=player_headers)
        assert r.json() == {"enabled": True, "url": "https://codex.test"}

    def test_connection_reports_the_account(self, client, admin_headers, fake):
        fake.on("GET", "/api/v1/me", body={"user": None})
        r = client.post("/api/codex/test", headers=admin_headers)
        assert r.json() == {"ok": True, "url": "https://codex.test", "account": None}

        fake.on("GET", "/api/v1/me", body={"user": {"name": "Hunter", "role": "editor"}})
        r = client.post("/api/codex/test", headers=admin_headers)
        assert r.json()["account"] == {"name": "Hunter", "role": "editor"}
        assert fake.last("/api/v1/me").headers["authorization"] == "Bearer cdx_tok"

        fake.on("GET", "/api/v1/me", status=401, body={"error": "Invalid API token"})
        r = client.post("/api/codex/test", headers=admin_headers)
        assert r.status_code == 400
        assert "GRIMOIRE_CODEX_DB_API_TOKEN" in r.json()["detail"]

    def test_connection_failure_is_a_502(self, client, admin_headers, fake):
        def boom(_req):
            raise httpx.ConnectError("refused")

        fake.routes[("GET", "/api/v1/me")] = boom
        r = client.post("/api/codex/test", headers=admin_headers)
        assert r.status_code == 502
        assert "Could not reach" in r.json()["detail"]


# --- Lookup --------------------------------------------------------------------------------


class TestLookup:
    def test_codex_is_listed_first(self, client, gm_headers, fake):
        system = make_game_system()
        book = make_book(system.id)
        sources = client.get(f"/api/books/{book.id}/metadata-sources", headers=gm_headers).json()
        assert sources["sources"][0]["id"] == "grimoire-codex"
        assert sources["sources"][0]["supports_paste"] is True

    def test_book_search_sends_every_signal_but_hashes(self, client, gm_headers, fake):
        system = make_game_system(name="Dungeon Crawl Classics")
        book = make_book(
            system.id,
            title="Sailors on the Starless Sea",
            isbn="9780982935",
            authors=["Harley Stroh"],
            page_count=16,
            year=2012,
            content_hash="AB" * 32,
        )
        fake.on(
            "POST",
            "/api/v1/match",
            body={
                "best": "bk_abc123",
                "candidates": [
                    {
                        "book": {
                            "id": "bk_abc123",
                            "title": "Sailors on the Starless Sea",
                            "year": 2012,
                            "systems": [{"id": "sy_dcc001", "name": "Dungeon Crawl Classics"}],
                        },
                        "confidence": 0.97,
                        "reasons": ["Same ISBN", "Same author"],
                    }
                ],
            },
        )
        r = client.post(
            f"/api/books/{book.id}/metadata-search",
            json={"source_id": "grimoire-codex", "query": ""},
            headers=gm_headers,
        )
        assert r.status_code == 200
        assert r.json()["results"] == [
            {
                "identity": "bk_abc123",
                "label": "Sailors on the Starless Sea · Dungeon Crawl Classics · 2012 (Same ISBN, Same author)",
                "score": 0.97,
                "url": "https://codex.test/books/bk_abc123",
            }
        ]
        sent = fake.body("/api/v1/match")
        assert sent["isbn"] == "9780982935"
        assert sent["authors"] == ["Harley Stroh"]
        assert sent["systems"] == ["Dungeon Crawl Classics"]
        assert sent["page_count"] == 16
        assert "hashes" not in sent
        assert fake.last("/api/v1/match").headers["authorization"] == "Bearer cdx_tok"

        _set(send_hashes=True)
        client.post(
            f"/api/books/{book.id}/metadata-search",
            json={"source_id": "grimoire-codex", "query": ""},
            headers=gm_headers,
        )
        assert fake.body("/api/v1/match")["hashes"] == [{"algo": "sha256", "hash": "ab" * 32}]

    def test_a_typed_query_drops_the_identifiers(self, client, gm_headers, fake):
        system = make_game_system(name="Mörk Borg")
        book = make_book(system.id, title="wrong", isbn="9780982935")
        fake.on("POST", "/api/v1/match", body={"best": None, "candidates": []})
        r = client.post(
            f"/api/books/{book.id}/metadata-search",
            json={"source_id": "grimoire-codex", "query": "Heretic"},
            headers=gm_headers,
        )
        assert r.json() == {"query": "Heretic", "results": []}
        assert fake.body("/api/v1/match") == {"title": "Heretic", "systems": ["Mörk Borg"], "limit": 10}

    def test_system_search_uses_name_search(self, client, gm_headers, fake):
        system = make_game_system(name="Mothership")
        fake.on(
            "GET",
            "/api/v1/search",
            body={
                "items": [
                    {"type": "system", "id": "sy_moth01", "name": "Mothership", "detail": "1e", "cover": None},
                    {"type": "system", "id": "sy_moth00", "name": "Mothership 0e", "detail": "", "cover": None},
                ]
            },
        )
        r = client.post(
            f"/api/systems/{system.id}/metadata-search",
            json={"source_id": "grimoire-codex", "query": ""},
            headers=gm_headers,
        )
        results = r.json()["results"]
        assert [x["identity"] for x in results] == ["sy_moth01", "sy_moth00"]
        assert results[0]["label"] == "Mothership · 1e"
        assert results[0]["score"] > results[1]["score"]
        params = fake.last("/api/v1/search").url.params
        assert params["q"] == "Mothership" and params["type"] == "system"

    def test_fetch_offers_the_link_and_applying_it_links(self, client, gm_headers, fake):
        system = make_game_system()
        book = make_book(system.id, title="Sailors", publisher="Goodman Games")
        fake.on("GET", "/api/v1/books/bk_abc123/grimoire", body=BOOK_EXPORT)
        r = client.post(
            f"/api/books/{book.id}/metadata-fetch",
            json={"source_id": "grimoire-codex", "identity": "bk_abc123"},
            headers=gm_headers,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["url"] == "https://codex.test/books/bk_abc123"
        rows = {f["field"]: f for f in body["fields"]}
        assert rows["codex_id"]["status"] == "only_incoming"
        assert rows["title"]["status"] == "differs"
        assert rows["publisher"]["status"] == "same"
        # Facts about the local file are not offered: they come from the file.
        assert "page_count" not in rows and "category" not in rows

        r = client.patch(f"/api/books/{book.id}", json={"codex_id": "bk_abc123"}, headers=gm_headers)
        assert r.status_code == 200
        assert client.get(f"/api/books/{book.id}", headers=gm_headers).json()["codex_id"] == "bk_abc123"
        r = client.patch(f"/api/books/{book.id}", json={"codex_id": "../x"}, headers=gm_headers)
        assert r.status_code == 422

    def test_paste_resolves_links_and_ids(self, client, gm_headers, fake):
        system = make_game_system()
        fake.on(
            "GET",
            "/api/v1/systems/sy_dcc001/grimoire",
            body={"codex_id": "sy_dcc001", "codex_url": "https://codex.test/systems/sy_dcc001", "edition": "1e"},
        )
        r = client.post(
            f"/api/systems/{system.id}/metadata-fetch",
            json={"source_id": "grimoire-codex", "paste": "https://codex.test/systems/sy_dcc001?tab=books"},
            headers=gm_headers,
        )
        assert r.status_code == 200
        assert r.json()["identity"] == "sy_dcc001"
        assert {f["field"] for f in r.json()["fields"]} == {"codex_id", "edition"}
        assert client.get(f"/api/systems/{system.id}", headers=gm_headers).json()["codex_id"] is None

        r = client.post(
            f"/api/systems/{system.id}/metadata-fetch",
            json={"source_id": "grimoire-codex", "paste": "https://codex.test/books/bk_abc123"},
            headers=gm_headers,
        )
        assert r.status_code == 400

    def test_missing_record_and_outage(self, client, gm_headers, fake):
        system = make_game_system()
        book = make_book(system.id)
        r = client.post(
            f"/api/books/{book.id}/metadata-fetch",
            json={"source_id": "grimoire-codex", "identity": "bk_gone00"},
            headers=gm_headers,
        )
        assert r.status_code == 404
        r = client.post(
            f"/api/books/{book.id}/metadata-fetch",
            json={"source_id": "grimoire-codex", "identity": ""},
            headers=gm_headers,
        )
        assert r.status_code == 400

        fake.on("POST", "/api/v1/match", status=503, body={"error": "Down for maintenance"})
        r = client.post(
            f"/api/books/{book.id}/metadata-search",
            json={"source_id": "grimoire-codex", "query": ""},
            headers=gm_headers,
        )
        assert r.status_code == 502
        assert r.json()["detail"] == "Down for maintenance"

    @pytest.mark.parametrize("route", ["books", "systems"])
    @pytest.mark.parametrize(
        "identity",
        ["../x", "a/b", "a?b", "a#b", "a\r\nb", "a b c d", ".."],
    )
    def test_fetch_rejects_an_identity_that_is_not_a_record_id(
        self, client, gm_headers, fake, route, identity
    ):
        """The id is part of the request path: anything else is refused before Grimoire Codex DB is called."""
        system = make_game_system()
        resource_id = make_book(system.id).id if route == "books" else system.id
        r = client.post(
            f"/api/{route}/{resource_id}/metadata-fetch",
            json={"source_id": "grimoire-codex", "identity": identity},
            headers=gm_headers,
        )
        assert r.status_code == 400
        assert fake.requests == []

    def test_fetch_accepts_a_padded_record_id(self, client, gm_headers, fake):
        system = make_game_system()
        fake.on("GET", "/api/v1/systems/sy_dcc001/grimoire", body={"codex_id": "sy_dcc001", "edition": "1e"})
        r = client.post(
            f"/api/systems/{system.id}/metadata-fetch",
            json={"source_id": "grimoire-codex", "identity": " sy_dcc001 "},
            headers=gm_headers,
        )
        assert r.status_code == 200
        assert r.json()["identity"] == "sy_dcc001"
        assert [req.url.path for req in fake.requests] == ["/api/v1/systems/sy_dcc001/grimoire"]


# --- Sending records -----------------------------------------------------------------------


class TestSubmit:
    def test_new_system_is_linked_once_applied(self, client, gm_headers, fake):
        system = make_game_system(name="Cairn", edition="2e", tags=["osr"])
        fake.on(
            "POST",
            "/api/v1/grimoire/systems",
            body={"codex_id": "sy_cairn2", "edit": {"id": "ed_1", "status": "applied"}},
        )
        r = client.post(
            f"/api/codex/systems/{system.id}/submit", json={"note": "From my shelf"}, headers=gm_headers
        )
        assert r.json() == {
            "status": "applied",
            "codex_id": "sy_cairn2",
            "linked": True,
            "edit_url": "https://codex.test/edits/ed_1",
            "system": None,
        }
        sent = fake.body("/api/v1/grimoire/systems")
        assert sent["record"]["name"] == "Cairn" and sent["record"]["tags"] == ["osr"]
        assert sent["note"] == "From my shelf"
        assert "codex_id" not in sent and "fields" not in sent
        assert fake.last("/api/v1/grimoire/systems").headers["authorization"] == "Bearer cdx_tok"
        assert _codex_id(GameSystem, system.id) == "sy_cairn2"

    def test_new_book_needs_a_linked_system_and_waits_unlinked(self, client, gm_headers, fake):
        system = make_game_system()
        book = make_book(system.id, title="Tomb of the Serpent Kings", content_hash="cd" * 32)
        r = client.post(f"/api/codex/books/{book.id}/submit", json={}, headers=gm_headers)
        assert r.status_code == 400
        assert "system" in r.json()["detail"]

        _link(GameSystem, system.id, "sy_osr001")
        fake.on(
            "POST",
            "/api/v1/grimoire/books",
            status=202,
            body={"codex_id": "bk_new001", "edit": {"id": "ed_2", "status": "pending"}},
        )
        r = client.post(f"/api/codex/books/{book.id}/submit", json={}, headers=gm_headers)
        assert r.json()["status"] == "pending" and r.json()["linked"] is False
        sent = fake.body("/api/v1/grimoire/books")
        assert sent["systems"] == ["sy_osr001"]
        assert "fingerprints" not in sent
        assert _codex_id(Book, book.id) is None

    def test_correction_sends_only_chosen_fields(self, client, gm_headers, fake):
        _set(send_hashes=True)
        system = make_game_system()
        _link(GameSystem, system.id, "sy_osr001")
        book = make_book(system.id, page_count=44, content_hash="EF" * 32, file_size=1234)
        _link(Book, book.id, "bk_abc123")
        fake.on(
            "POST",
            "/api/v1/grimoire/books",
            body={"codex_id": "bk_abc123", "edit": {"id": "ed_3", "status": "pending"}},
        )
        r = client.post(
            f"/api/codex/books/{book.id}/submit",
            json={"fields": ["page_count", "file_size", "access_level"]},
            headers=gm_headers,
        )
        assert r.json()["linked"] is True
        sent = fake.body("/api/v1/grimoire/books")
        assert sent["codex_id"] == "bk_abc123"
        assert sent["fields"] == ["page_count"]
        assert sent["record"] == {"page_count": 44}
        # A Grimoire Codex DB book can be in several systems; a correction never rewrites them.
        assert "systems" not in sent
        assert sent["fingerprints"] == [{"algo": "sha256", "hash": "ef" * 32, "size": 1234}]

        r = client.post(
            f"/api/codex/books/{book.id}/submit", json={"fields": ["file_size"]}, headers=gm_headers
        )
        assert r.status_code == 400

    def test_codex_validation_errors_reach_the_user(self, client, gm_headers, fake):
        system = make_game_system()
        fake.on("POST", "/api/v1/grimoire/systems", status=422, body={"error": "Name is required"})
        r = client.post(f"/api/codex/systems/{system.id}/submit", json={}, headers=gm_headers)
        assert r.status_code == 422
        assert r.json()["detail"] == "Name is required"

    def test_players_cannot_send_or_unlink(self, client, player_headers, fake):
        system = make_game_system()
        assert client.post(f"/api/codex/systems/{system.id}/submit", json={}, headers=player_headers).status_code == 403
        assert client.delete(f"/api/codex/systems/{system.id}/link", headers=player_headers).status_code == 403

    def test_unlink(self, client, gm_headers, fake):
        system = make_game_system()
        book = make_book(system.id)
        _link(GameSystem, system.id, "sy_osr001")
        _link(Book, book.id, "bk_abc123")
        assert client.delete(f"/api/codex/books/{book.id}/link", headers=gm_headers).status_code == 200
        assert client.delete(f"/api/codex/systems/{system.id}/link", headers=gm_headers).status_code == 200
        assert _codex_id(Book, book.id) is None
        assert _codex_id(GameSystem, system.id) is None
        assert client.delete("/api/codex/books/nope/link", headers=gm_headers).status_code == 404
        assert client.delete("/api/codex/systems/nope/link", headers=gm_headers).status_code == 404


# --- Units ---------------------------------------------------------------------------------


def test_resolve_paste():
    assert resolve_paste("book", "https://db.grimoirecodex.org/books/bk_abc123") == "bk_abc123"
    assert resolve_paste("book", " bk_abc123 ") == "bk_abc123"
    with pytest.raises(ValueError):
        resolve_paste("game-system", "https://db.grimoirecodex.org/books/bk_abc123")
    with pytest.raises(ValueError):
        resolve_paste("book", "not an id!")


def test_candidate_label_and_incoming_fields():
    assert candidate_label({"title": "X", "systems": [], "year": None}) == "X"
    assert candidate_label({"name": "Y", "systems": [{"name": "A"}, {"name": "B"}], "year": 1999}) == "Y · A + B · 1999"
    fields = incoming_fields("game-system", {"codex_id": "sy_1", "name": "Ignored", "edition": "2e"})
    assert fields == {"edition": "2e", "codex_id": "sy_1"}


def test_non_json_and_oversized_responses(fake, monkeypatch):
    settings = codex.CodexSettings(
        url="https://codex.test", token="cdx_tok", send_hashes=False, locked=frozenset()
    )
    fake.routes[("GET", "/api/v1/me")] = lambda _req: httpx.Response(200, content=b"<html>")
    with pytest.raises(codex.CodexError, match="not JSON"):
        codex_client.me(settings)
    monkeypatch.setattr(codex_client, "MAX_BYTES", 4)
    fake.on("GET", "/api/v1/me", body={"user": None})
    with pytest.raises(codex.CodexError, match="too large"):
        codex_client.me(settings)

    def slow(_req):
        raise httpx.ReadTimeout("slow")

    fake.routes[("GET", "/api/v1/me")] = slow
    with pytest.raises(codex.CodexError, match="in time"):
        codex_client.me(settings)
    fake.on("GET", "/api/v1/me", status=500, body=None)
    with pytest.raises(codex.CodexError, match="HTTP 500"):
        codex_client.me(settings)


def test_export_keeps_the_id_inside_its_path_segment(fake):
    """Whatever id ``export`` is given, it stays one path segment."""
    settings = codex.CodexSettings(
        url="https://codex.test", token="cdx_tok", send_hashes=False, locked=frozenset()
    )
    for bad in ("", ".", ".."):
        with pytest.raises(codex.CodexError) as err:
            codex_client.export(settings, "book", bad)
        assert err.value.status == 400
        assert codex.http_error(err.value).status_code == 400
    assert fake.requests == []

    for raw in ("../x#", "a/b?c=d&", "a\r\nb c"):
        with pytest.raises(codex.CodexError):
            codex_client.export(settings, "book", raw)
    paths = [req.url.raw_path.decode() for req in fake.requests]
    assert paths == [
        "/api/v1/books/..%2Fx%23/grimoire",
        "/api/v1/books/a%2Fb%3Fc%3Dd%26/grimoire",
        "/api/v1/books/a%0D%0Ab%20c/grimoire",
    ]


def test_an_invalid_address_is_a_codex_error(fake):
    """httpx raises ``InvalidURL`` (not an ``HTTPError``) for a malformed address; it must not be a 500."""
    settings = codex.CodexSettings(
        url="https://codex.test", token="cdx_tok", send_hashes=False, locked=frozenset()
    )
    with pytest.raises(codex.CodexError, match="not valid") as err:
        codex_client.request(settings, "GET", "/books/a\r\nb/grimoire")
    assert err.value.status is None
    assert fake.requests == []
