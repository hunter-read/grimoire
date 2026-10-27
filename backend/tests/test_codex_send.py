"""Tests for comparing and sending records to Grimoire Codex DB.

Compare reports what sending would change, so the send form can pre-select the
differences; submit carries the cover, source links and a credit for scraped
fields, and resolves a new book's game system on the way.
"""
import io
import uuid
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image

from backend.codex import client as codex_client
from backend.codex import compare
from backend.config import SessionLocal
from backend.models import Book, GameSystem
from backend.routers.codex import _covers, core
from backend.tests.codex_fake import _codex_id, _link, fake_codex  # noqa: F401  (the "fake" fixture)
from backend.tests.conftest import make_book, make_game_system

SHA = "ab" * 32
KEY = f"covers/{SHA}.webp"

SYSTEM_EXPORT = {
    "codex_id": "sy_cairn01",
    "codex_revision": 3,
    "codex_url": "https://codex.test/systems/sy_cairn01",
    "name": "Cairn",
    "description": "A  tidy\nOSR game.",
    "publishers": [{"name": "Yochai Gal", "url": ""}],
    "urls": [{"label": "Home", "url": "https://cairnrpg.com"}],
    "genres": ["Fantasy"],
    "edition": "1e",
    "year": 2020,
    "tags": [],
    "is_explicit": False,
    "cover_url": f"https://codex.test/{KEY}",
    "attributions": [{"fields": ["description"], "source": "TTRPG Wiki", "url": "https://ttrpgwiki.com/Cairn"}],
}


@pytest.fixture
def cover(monkeypatch):
    """Give every record a cover whose bytes hash to ``SHA`` unless a test says otherwise."""
    found = _covers.Cover(b"image", "image/webp")
    found.sha256 = SHA
    monkeypatch.setattr(core, "local_cover", lambda db, resource, user: found)
    return found


@pytest.fixture
def scrapers(monkeypatch):
    manifests = [
        SimpleNamespace(id="ttrpg-wiki", name="TTRPG Wiki", homepage="https://ttrpgwiki.com"),
        SimpleNamespace(id="rpggeek-system", name="RPGGeek (System)", homepage="https://rpggeek.com"),
    ]
    monkeypatch.setattr(compare.addons, "enabled_for_target", lambda db, target: manifests)


def _name(base: str) -> str:
    """System names are unique, and the test database outlives a test."""
    return f"{base} {uuid.uuid4().hex[:6]}"


def _rows(body: dict) -> dict:
    return {row["field"]: row for row in body["fields"]}


class TestCompare:
    def test_linked_system_reports_each_difference(self, client, gm_headers, fake, cover, scrapers):
        name = _name("Cairn")
        system = make_game_system(
            name=name,
            description="A tidy OSR game.",
            edition="2e",
            urls=[
                {"label": "Home", "url": "https://cairnrpg.com"},
                {"label": "Wiki", "url": "https://www.ttrpgwiki.com/wiki/Cairn"},
            ],
            license="CC-BY-SA",
            tags=["osr"],
        )
        _link(GameSystem, system.id, "sy_cairn01")
        fake.on("GET", "/api/v1/systems/sy_cairn01/grimoire", body={**SYSTEM_EXPORT, "name": name})
        r = client.get(f"/api/codex/systems/{system.id}/compare", headers=gm_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["linked"] is True and body["revision"] == 3
        rows = _rows(body)
        # Whitespace alone is not a change.
        assert rows["description"]["status"] == "same"
        assert rows["name"]["status"] == "same"
        assert rows["edition"] == {"field": "edition", "local": "2e", "remote": "1e", "status": "differs"}
        assert rows["license"]["status"] == "only_local"
        assert rows["tags"]["status"] == "only_local"
        # Links are merged on the other side, so only the one it lacks is a change.
        assert rows["urls"]["status"] == "only_local"
        assert rows["publishers"]["status"] == "only_remote"
        assert "dice_materials" not in rows
        assert body["cover"] == {"local": True, "remote_url": f"https://codex.test/{KEY}", "status": "same"}
        assert body["attributions"][0]["source"] == "TTRPG Wiki"
        assert body["attribution_sources"] == [
            {"id": "ttrpg-wiki", "name": "TTRPG Wiki", "url": "https://www.ttrpgwiki.com/wiki/Cairn"},
            {"id": "rpggeek-system", "name": "RPGGeek", "url": ""},
        ]
        assert body["system"] is None

    def test_new_book_offers_systems_to_join(self, client, gm_headers, fake, monkeypatch, scrapers):
        monkeypatch.setattr(core, "local_cover", lambda db, resource, user: None)
        name = _name("Cairn")
        system = make_game_system(name=name)
        book = make_book(system.id, title="Cairn Core", category="Core Rulebook", page_count=0)
        fake.on(
            "GET",
            "/api/v1/search",
            body={"items": [{"id": "sy_cairn01", "name": "Cairn", "detail": "2020"}, {"name": "no id"}]},
        )
        body = client.get(f"/api/codex/books/{book.id}/compare", headers=gm_headers).json()
        assert body["linked"] is False and body["revision"] is None
        rows = _rows(body)
        assert rows["title"]["status"] == "only_local" and rows["category"]["status"] == "only_local"
        assert "page_count" not in rows
        assert body["cover"] == {"local": False, "remote_url": None, "status": "none"}
        assert body["system"] == {
            "id": system.id,
            "name": name,
            "codex_id": None,
            "candidates": [
                {
                    "codex_id": "sy_cairn01",
                    "name": "Cairn",
                    "label": "Cairn · 2020",
                    "url": "https://codex.test/systems/sy_cairn01",
                }
            ],
        }
        assert fake.last("/api/v1/search").url.params["q"] == name

        _link(GameSystem, system.id, "sy_cairn01")
        fake.requests.clear()
        body = client.get(f"/api/codex/books/{book.id}/compare", headers=gm_headers).json()
        assert body["system"]["codex_id"] == "sy_cairn01" and body["system"]["candidates"] == []
        assert fake.requests == []

    def test_a_missing_record_is_a_404(self, client, gm_headers, fake, cover):
        system = make_game_system()
        _link(GameSystem, system.id, "sy_gone01")
        assert client.get(f"/api/codex/systems/{system.id}/compare", headers=gm_headers).status_code == 404
        assert client.get("/api/codex/books/nope/compare", headers=gm_headers).status_code == 404

    def test_players_cannot_compare(self, client, player_headers, fake):
        system = make_game_system()
        assert client.get(f"/api/codex/systems/{system.id}/compare", headers=player_headers).status_code == 403


class TestSubmitExtras:
    def test_correction_carries_cover_sources_and_credit(self, client, gm_headers, fake, cover):
        system = make_game_system(description="From the wiki")
        _link(GameSystem, system.id, "sy_cairn01")
        fake.on("POST", "/api/v1/uploads", status=201, body={"key": KEY, "url": f"/{KEY}"})
        fake.on(
            "POST",
            "/api/v1/grimoire/systems",
            body={"codex_id": "sy_cairn01", "edit": {"id": "ed_9", "status": "applied"}},
        )
        r = client.post(
            f"/api/codex/systems/{system.id}/submit",
            json={
                "fields": ["description"],
                "cover": True,
                "sources": ["https://ttrpgwiki.com/Cairn", "https://ttrpgwiki.com/Cairn", " "],
                "attribution": {
                    "source": "TTRPG Wiki",
                    "url": "https://ttrpgwiki.com/Cairn",
                    "fields": ["description"],
                },
                "base_revision": 3,
            },
            headers=gm_headers,
        )
        assert r.status_code == 200, r.text
        upload = fake.last("/api/v1/uploads")
        assert upload.content == b"image" and upload.headers["content-type"] == "image/webp"
        sent = fake.body("/api/v1/grimoire/systems")
        assert sent["cover"] == KEY
        assert sent["sources"] == ["https://ttrpgwiki.com/Cairn"]
        assert sent["attributions"] == [
            {"source": "TTRPG Wiki", "url": "https://ttrpgwiki.com/Cairn", "fields": ["description"]}
        ]
        assert sent["base_revision"] == 3 and sent["fields"] == ["description"]

    def test_a_cover_alone_can_be_sent_as_a_correction(self, client, gm_headers, fake, cover):
        system = make_game_system()
        fake.on("POST", "/api/v1/uploads", status=201, body={"key": KEY})
        fake.on(
            "POST",
            "/api/v1/grimoire/systems",
            body={"codex_id": "sy_cairn01", "edit": {"id": "ed_9", "status": "applied"}},
        )
        r = client.post(f"/api/codex/systems/{system.id}/submit", json={"fields": []}, headers=gm_headers)
        assert r.status_code == 400
        _link(GameSystem, system.id, "sy_cairn01")
        r = client.post(
            f"/api/codex/systems/{system.id}/submit", json={"fields": [], "cover": True}, headers=gm_headers
        )
        assert r.status_code == 200
        sent = fake.body("/api/v1/grimoire/systems")
        assert sent["record"] == {} and sent["fields"] == [] and sent["cover"] == KEY

    def test_cover_requested_without_one_is_refused(self, client, gm_headers, fake, monkeypatch):
        monkeypatch.setattr(core, "local_cover", lambda db, resource, user: None)
        system = make_game_system()
        r = client.post(f"/api/codex/systems/{system.id}/submit", json={"cover": True}, headers=gm_headers)
        assert r.status_code == 400
        assert fake.requests == []

    def test_a_rejected_upload_reaches_the_user(self, client, gm_headers, fake, cover):
        system = make_game_system()
        fake.on("POST", "/api/v1/uploads", status=201, body={"url": "/nothing"})
        r = client.post(f"/api/codex/systems/{system.id}/submit", json={"cover": True}, headers=gm_headers)
        assert r.status_code == 502
        assert "cover" in r.json()["detail"]

    @pytest.mark.parametrize(
        "body",
        [
            {"sources": ["ftp://nope"]},
            {"sources": ["https://a b"]},
            {"attribution": {"source": "Wiki", "url": "https://w.test", "fields": ["title"]}},
            {"attribution": {"source": "Wiki", "url": "javascript:alert(1)", "fields": ["tags"]}},
            {"attribution": {"source": "", "url": "https://w.test", "fields": ["tags"]}},
            {"system": {"codex_id": "../x"}},
        ],
    )
    def test_bad_extras_are_refused(self, client, gm_headers, fake, body):
        system = make_game_system()
        book = make_book(system.id)
        assert client.post(f"/api/codex/books/{book.id}/submit", json=body, headers=gm_headers).status_code == 422

    def test_new_book_joins_an_existing_codex_system(self, client, gm_headers, fake):
        system = make_game_system()
        book = make_book(system.id, title="Cairn Core")
        fake.on(
            "POST",
            "/api/v1/grimoire/books",
            body={"codex_id": "bk_core01", "edit": {"id": "ed_4", "status": "applied"}},
        )
        r = client.post(
            f"/api/codex/books/{book.id}/submit",
            json={"system": {"codex_id": "sy_cairn01"}},
            headers=gm_headers,
        )
        assert r.json()["linked"] is True and r.json()["system"] is None
        assert fake.body("/api/v1/grimoire/books")["systems"] == ["sy_cairn01"]
        assert _codex_id(GameSystem, system.id) == "sy_cairn01"
        assert _codex_id(Book, book.id) == "bk_core01"

    def test_joining_a_system_that_codex_refuses_links_nothing(self, client, gm_headers, fake):
        system = make_game_system()
        book = make_book(system.id)
        fake.on("POST", "/api/v1/grimoire/books", status=422, body={"error": "That system does not exist"})
        r = client.post(
            f"/api/codex/books/{book.id}/submit", json={"system": {"codex_id": "sy_gone01"}}, headers=gm_headers
        )
        assert r.status_code == 422
        assert _codex_id(GameSystem, system.id) is None

    def test_new_book_sends_its_new_system_first(self, client, gm_headers, fake, cover):
        name = _name("Cairn")
        system = make_game_system(name=name)
        book = make_book(system.id, title="Cairn Core")
        fake.on("POST", "/api/v1/uploads", status=201, body={"key": KEY})
        fake.on(
            "POST",
            "/api/v1/grimoire/systems",
            body={"codex_id": "sy_new001", "edit": {"id": "ed_5", "status": "applied"}},
        )
        fake.on(
            "POST",
            "/api/v1/grimoire/books",
            status=202,
            body={"codex_id": "bk_new001", "edit": {"id": "ed_6", "status": "pending"}},
        )
        r = client.post(
            f"/api/codex/books/{book.id}/submit",
            json={
                "system": {"create": True},
                "note": "My shelf",
                "sources": ["https://shop.test/cairn"],
                "attribution": {"source": "Shop", "url": "https://shop.test/cairn", "fields": ["description"]},
            },
            headers=gm_headers,
        )
        body = r.json()
        assert body["status"] == "pending" and body["linked"] is False
        assert body["system"] == {
            "status": "applied",
            "codex_id": "sy_new001",
            "linked": True,
            "edit_url": "https://codex.test/edits/ed_5",
        }
        sent_system = fake.body("/api/v1/grimoire/systems")
        assert sent_system["record"]["name"] == name and sent_system["cover"] == KEY
        assert sent_system["note"] == "My shelf" and sent_system["sources"] == ["https://shop.test/cairn"]
        # The book's credit is the book's own.
        assert "attributions" not in sent_system
        sent_book = fake.body("/api/v1/grimoire/books")
        assert sent_book["systems"] == ["sy_new001"] and "cover" not in sent_book
        assert sent_book["attributions"][0]["source"] == "Shop"
        assert _codex_id(GameSystem, system.id) == "sy_new001"

    def test_a_new_system_waiting_for_review_holds_the_book_back(self, client, gm_headers, fake, monkeypatch):
        monkeypatch.setattr(core, "local_cover", lambda db, resource, user: None)
        system = make_game_system()
        book = make_book(system.id)
        fake.on(
            "POST",
            "/api/v1/grimoire/systems",
            status=202,
            body={"codex_id": "sy_new002", "edit": {"id": "ed_7", "status": "pending"}},
        )
        r = client.post(f"/api/codex/books/{book.id}/submit", json={"system": {"create": True}}, headers=gm_headers)
        body = r.json()
        assert body["status"] == "waiting_for_system" and body["codex_id"] is None
        assert body["edit_url"] == "https://codex.test/edits/ed_7"
        assert body["system"]["status"] == "pending"
        assert "cover" not in fake.body("/api/v1/grimoire/systems")
        assert [r.url.path for r in fake.requests] == ["/api/v1/grimoire/systems"]
        assert _codex_id(GameSystem, system.id) is None

    def test_a_linked_system_ignores_the_choice(self, client, gm_headers, fake):
        system = make_game_system()
        _link(GameSystem, system.id, "sy_osr001")
        book = make_book(system.id)
        fake.on(
            "POST",
            "/api/v1/grimoire/books",
            body={"codex_id": "bk_x00001", "edit": {"id": "ed_8", "status": "applied"}},
        )
        client.post(f"/api/codex/books/{book.id}/submit", json={"system": {"create": True}}, headers=gm_headers)
        assert fake.body("/api/v1/grimoire/books")["systems"] == ["sy_osr001"]
        assert [r.url.path for r in fake.requests] == ["/api/v1/grimoire/books"]


# --- Units ---------------------------------------------------------------------------------


def test_field_status():
    assert compare.field_status("title", "", None) is None
    assert compare.field_status("category", "Core Rulebook", "core-rulebook") == "same"
    assert compare.field_status("category", "", "other") == "only_remote"
    assert compare.field_status("isbn", "978-0-9829-35", "9780982935") == "same"
    assert compare.field_status("authors", ["B", "a"], ["A", "b"]) == "same"
    assert compare.field_status("is_explicit", True, False) == "differs"
    assert compare.field_status("is_explicit", False, False) == "same"
    assert compare.field_status("page_count", 44, 16) == "differs"
    assert compare.field_status("urls", [{"url": "https://a.test"}], [{"url": "https://A.test"}, {"url": "x"}]) == "same"


def test_cover_status():
    assert compare.cover_status(None, None) == "none"
    assert compare.cover_status(None, "https://c.test/covers/x.webp") == "only_remote"
    assert compare.cover_status(SHA, None) == "only_local"
    assert compare.cover_status(SHA.upper(), f"https://c.test/{KEY}") == "same"
    assert compare.cover_status(SHA, f"https://c.test/covers/{'cd' * 32}.png") == "differs"


def test_attribution_sources_match_hosts(monkeypatch):
    monkeypatch.setattr(
        compare.addons,
        "enabled_for_target",
        lambda db, target: [
            SimpleNamespace(id="dtrpg", name="DriveThruRPG", homepage="https://www.drivethrurpg.com"),
            SimpleNamespace(id="none", name="(Odd)", homepage=""),
        ],
    )
    book = Book(urls=[{"url": "ftp://x"}, "junk", {"url": "http://[bad"}], publisher_url="https://shop.drivethrurpg.com/p/1")
    assert compare.attribution_sources(None, book, "book") == [
        {"id": "dtrpg", "name": "DriveThruRPG", "url": "https://shop.drivethrurpg.com/p/1"},
        {"id": "none", "name": "(Odd)", "url": ""},
    ]


def _image(fmt: str) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (40, 60), "red").save(out, fmt)
    return out.getvalue()


def test_read_cover_files(tmp_path):
    png = tmp_path / "cover.png"
    png.write_bytes(_image("PNG"))
    assert _covers._read(str(png)).content_type == "image/png"

    bmp = tmp_path / "cover.bmp"
    bmp.write_bytes(_image("BMP"))
    converted = _covers._read(str(bmp))
    assert converted.content_type == "image/webp" and converted.data[8:12] == b"WEBP"

    svg = tmp_path / "cover.svg"
    svg.write_text("<svg/>")
    assert _covers._read(str(svg)) is None
    assert _covers._read(str(tmp_path / "missing.png")) is None


def test_book_cover_renders_the_first_page(tmp_path, monkeypatch):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"%PDF")
    calls = []

    def render(path, page, width, count=True):
        calls.append((path, page, width, count))
        return b"RIFF0000WEBPpage"

    monkeypatch.setattr(_covers.render_pool, "render_page", render)
    book = Book(id="b1", filepath=str(pdf), mime_type="application/pdf")
    assert _covers._book_cover(book).data == b"RIFF0000WEBPpage"
    assert calls == [(str(pdf), 1, _covers.COVER_WIDTH, False)]

    def broken(*_args, **_kwargs):
        raise _covers.RenderError("bad")

    thumb = tmp_path / "thumb.webp"
    thumb.write_bytes(_image("WEBP"))
    monkeypatch.setattr(_covers.render_pool, "render_page", broken)
    monkeypatch.setattr(_covers, "book_thumbnail_path", lambda b: str(thumb))
    assert _covers._book_cover(book).content_type == "image/webp"
    monkeypatch.setattr(_covers, "book_thumbnail_path", lambda b: None)
    assert _covers._book_cover(Book(id="b2", filepath="", mime_type="image/png")) is None


def test_system_cover_prefers_its_own_art(tmp_path, monkeypatch):
    art = tmp_path / "art.png"
    art.write_bytes(_image("PNG"))
    system = make_game_system()
    book = make_book(system.id)
    db = SessionLocal()
    try:
        own = db.get(GameSystem, system.id)
        monkeypatch.setattr(_covers, "resolve_cover_file", lambda s: str(art))
        assert _covers.local_cover(db, own, None).content_type == "image/png"

        monkeypatch.setattr(_covers, "resolve_cover_file", lambda s: None)
        monkeypatch.setattr(_covers, "resolve_cover_book_id", lambda db, s, user: book.id)
        monkeypatch.setattr(_covers, "_book_cover", lambda b: _covers.Cover(b.id.encode(), "image/webp"))
        assert _covers.local_cover(db, own, None).data == book.id.encode()
        assert _covers.local_cover(db, db.get(Book, book.id), None).data == book.id.encode()
        monkeypatch.setattr(_covers, "resolve_cover_book_id", lambda db, s, user: None)
        assert _covers.local_cover(db, own, None) is None
    finally:
        db.close()


def test_upload_cover_needs_a_key(fake):
    from backend import codex

    settings = codex.CodexSettings(url="https://codex.test", token="t", send_hashes=False, locked=frozenset())
    fake.on("POST", "/api/v1/uploads", status=201, body={"key": KEY})
    assert codex_client.upload_cover(settings, b"x", "image/png") == KEY
    fake.on("POST", "/api/v1/uploads", status=201, body=["nope"])
    with pytest.raises(codex.CodexError):
        codex_client.upload_cover(settings, b"x", "image/png")


class TestNoConnectionHeld:
    """Grimoire Codex DB can take seconds to answer; no pooled connection waits on it (issue #701)."""

    def _record(self, fake, sessions, method, path, status=200, body=None):
        seen = []

        def answer(_req):
            seen.append(sessions[-1].in_transaction())
            return httpx.Response(status, json=body)

        fake.routes[(method, path)] = answer
        return seen

    def test_compare(self, client, gm_headers, fake, cover, scrapers, request_sessions):
        system = make_game_system(name=_name("Cairn"))
        _link(GameSystem, system.id, "sy_cairn01")
        seen = self._record(
            fake, request_sessions, "GET", "/api/v1/systems/sy_cairn01/grimoire", body=SYSTEM_EXPORT
        )
        r = client.get(f"/api/codex/systems/{system.id}/compare", headers=gm_headers)
        assert r.status_code == 200
        assert seen == [False]

    def test_submit_with_a_cover(self, client, gm_headers, fake, cover, request_sessions):
        system = make_game_system()
        _link(GameSystem, system.id, "sy_cairn01")
        uploads = self._record(
            fake, request_sessions, "POST", "/api/v1/uploads", status=201, body={"key": KEY}
        )
        submits = self._record(
            fake,
            request_sessions,
            "POST",
            "/api/v1/grimoire/systems",
            body={"codex_id": "sy_cairn01", "edit": {"id": "ed_9", "status": "applied"}},
        )
        r = client.post(
            f"/api/codex/systems/{system.id}/submit",
            json={"fields": [], "cover": True},
            headers=gm_headers,
        )
        assert r.status_code == 200, r.text
        assert uploads == [False] and submits == [False]

    def test_test_connection(self, client, admin_headers, fake, request_sessions):
        seen = self._record(
            fake, request_sessions, "GET", "/api/v1/me", body={"user": {"name": "a", "role": "editor"}}
        )
        r = client.post("/api/codex/test", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert seen == [False]
