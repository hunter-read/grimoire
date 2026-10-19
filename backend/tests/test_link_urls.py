"""Metadata links are http(s) only: refused on the way in, blanked on the way out."""
import pytest

from backend.config import SessionLocal
from backend.models import GameSystem
from backend.routers._link_urls import http_url_or_blank, is_http_url, require_http_url
from backend.tests.conftest import make_book, make_game_system

BAD = ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "steam://run/1", " JaVaScRiPt:x"]


@pytest.mark.parametrize("url", ["", "  ", "https://a.example", "HTTP://a.example/x"])
def test_http_urls_accepted(url):
    assert is_http_url(url)
    assert require_http_url(url) == url.strip()


@pytest.mark.parametrize("url", BAD)
def test_other_schemes_refused(url):
    assert not is_http_url(url)
    with pytest.raises(ValueError):
        require_http_url(url)
    assert http_url_or_blank(url) == ""


class TestBookLinks:
    @pytest.mark.parametrize("url", BAD)
    def test_patch_refuses_bad_link(self, client, gm_headers, url):
        book = make_book(make_game_system().id)
        resp = client.patch(
            f"/api/books/{book.id}",
            json={"urls": [{"label": "x", "url": url}]},
            headers=gm_headers,
        )
        assert resp.status_code == 422

    def test_patch_refuses_bad_publisher_url(self, client, gm_headers):
        book = make_book(make_game_system().id)
        resp = client.patch(
            f"/api/books/{book.id}", json={"publisher_url": "javascript:x"}, headers=gm_headers
        )
        assert resp.status_code == 422

    def test_patch_keeps_good_link(self, client, gm_headers):
        book = make_book(make_game_system().id)
        resp = client.patch(
            f"/api/books/{book.id}",
            json={"urls": [{"label": "DTRPG", "url": "https://dtrpg.example/p/1"}]},
            headers=gm_headers,
        )
        assert resp.status_code == 200, resp.text
        got = client.get(f"/api/books/{book.id}", headers=gm_headers).json()
        assert got["urls"] == [{"label": "DTRPG", "url": "https://dtrpg.example/p/1"}]

    def test_stored_bad_link_comes_back_blank(self, client, gm_headers):
        book = make_book(
            make_game_system().id,
            urls=[{"label": "bad", "url": "javascript:alert(1)"},
                  {"label": "ok", "url": "https://ok.example"}],
            publisher_url="data:x",
        )
        got = client.get(f"/api/books/{book.id}", headers=gm_headers)
        assert got.status_code == 200
        assert got.json()["urls"] == [{"label": "bad", "url": ""},
                                      {"label": "ok", "url": "https://ok.example"}]
        assert got.json()["publisher_url"] is None


class TestSystemLinks:
    def test_patch_refuses_bad_links(self, client, gm_headers):
        system = make_game_system()
        for body in (
            {"urls": [{"label": "x", "url": "javascript:x"}]},
            {"character_builder_urls": [{"label": "x", "url": "data:x"}]},
            {"character_builder_url": "vbscript:x"},
            {"publishers": [{"name": "P", "url": "javascript:x"}]},
        ):
            resp = client.patch(f"/api/systems/{system.id}", json=body, headers=gm_headers)
            assert resp.status_code == 422, body

    def test_stored_bad_links_come_back_blank(self, client, gm_headers):
        system = make_game_system()
        db = SessionLocal()
        try:
            db.query(GameSystem).filter_by(id=system.id).update({
                "urls": [{"label": "u", "url": "javascript:x"}],
                "character_builder_urls": [{"label": "c", "url": "data:x"}],
                "publishers": [{"name": "P", "url": "vbscript:x"}],
            })
            db.commit()
        finally:
            db.close()
        got = client.get(f"/api/systems/{system.id}", headers=gm_headers)
        assert got.status_code == 200, got.text
        body = got.json()
        assert body["urls"] == [{"label": "u", "url": ""}]
        assert body["character_builder_urls"] == [{"label": "c", "url": ""}]
        assert body["publishers"] == [{"name": "P", "url": ""}]

