"""Every route that waits on something slow hands its connection back first (issue #782).

#701 fixed page and tile renders by calling ``release_connection`` before the
wait, but the call is placed route by route, and exports, add-on lookups, pack
installs and map exports were missed. A handful of those at once starved the
rest of the API of connections again.

The ``waits`` guard wraps the places a request actually waits - every render
pool entry point, every outbound HTTP request, and the map encoders - and
records whether the request's session still held a connection at that moment.
Each route below is driven for real through it, so a route that starts waiting
before it lets go fails here, whichever handler or service the wait is in.
"""
import json
import os
import uuid

import pymupdf
import httpx
import pytest
import yaml
from PIL import Image

from backend import config
from backend.addons import fetch, registry
from backend.addons.constants import (
    SETTING_ALLOW_SCRIPTS,
    SETTING_INDEX_CACHE,
    SETTING_INDEX_URL,
    SETTING_INSTALLED,
)
from backend.config import SessionLocal
from backend.models import AppSetting, GameSystem
from backend.render import pool as render_pool
from backend.routers.maps import core as maps_core
from backend.routers.maps import otfbm_export
from backend.services.characters import pack_catalogue as pc
from backend.services.characters import packs as ps
from backend.tests.conftest import make_book, make_game_system, make_map
from backend.tests.test_books_metadata_api import FIXTURE_DIR, MANIFEST
from backend.tests.test_pack_catalogue import BODIES, REPO, _index

# Every render pool function that does work in a worker (or in-process).
RENDER_CALLS = (
    "render_page",
    "render_tile",
    "page_text",
    "page_words",
    "document_info",
    "document_metadata",
    "document_toc",
    "export_page_size",
    "detect_shapes",
    "export",
)


class Waits:
    """What a request waited on, and whether it held a connection while it did."""

    def __init__(self, sessions):
        self._sessions = sessions
        self.seen = []
        # url -> response body, or a callable taking the url; None is a 404.
        self.respond = lambda url: None

    def record(self, what):
        holding = bool(self._sessions) and self._sessions[-1].in_transaction()
        self.seen.append((what, holding))

    def assert_released(self):
        assert self.seen, "the route never reached its slow call"
        held = [what for what, holding in self.seen if holding]
        assert not held, f"waited while holding a database connection: {held}"


@pytest.fixture
def waits(monkeypatch, request_sessions):
    guard = Waits(request_sessions)

    def wrap(module, name):
        original = getattr(module, name)

        def recorded(*args, **kwargs):
            guard.record(name)
            return original(*args, **kwargs)

        monkeypatch.setattr(module, name, recorded)

    for name in RENDER_CALLS:
        wrap(render_pool, name)
    # Encoding a whole battlemap is the slow part of these exports.
    wrap(maps_core, "build_uvtt")
    wrap(otfbm_export, "otfbm_background")

    # Every outbound request goes through Client.send, whoever built the client.
    def send(self, request, **_kwargs):
        url = str(request.url)
        guard.record(f"{request.method} {url}")
        body = guard.respond(url)
        if body is None:
            return httpx.Response(404, request=request)
        return httpx.Response(200, content=body, request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    return guard


@pytest.fixture(autouse=True)
def isolated_addons(tmp_path, monkeypatch):
    """Add-ons and the download cache in a directory of this test's own."""
    directory = tmp_path / "add-ons"
    directory.mkdir()
    monkeypatch.setattr(registry, "ADDONS_DIR", str(directory))
    monkeypatch.setattr(fetch, "ADDON_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(config, "CODEX_DB_API_TOKEN", "")
    yield directory
    session = SessionLocal()
    try:
        for key in (SETTING_INSTALLED, SETTING_INDEX_URL, SETTING_INDEX_CACHE, SETTING_ALLOW_SCRIPTS):
            session.query(AppSetting).filter_by(key=key).delete()
        session.commit()
    finally:
        session.close()


def _pdf(tmp_path):
    path = str(tmp_path / f"slow-{uuid.uuid4().hex[:8]}.pdf")
    doc = pymupdf.open()
    doc.new_page(width=612, height=792).insert_text((72, 72), "Slow")
    doc.set_metadata({"title": "Slow Paths", "author": "Someone"})
    doc.save(path)
    doc.close()
    return path


def _png(tmp_path):
    path = str(tmp_path / f"village-{uuid.uuid4().hex[:8]}.png")
    Image.new("RGB", (700, 980), (30, 40, 50)).save(path)
    return path


@pytest.fixture
def pdf_book(tmp_path):
    path = _pdf(tmp_path)
    system = make_game_system(name=f"System-{uuid.uuid4().hex[:6]}")
    return make_book(
        system.id,
        title="Blades in the Dark",
        filename=os.path.basename(path),
        filepath=path,
        mime_type="application/pdf",
        page_count=1,
    )


@pytest.fixture
def pdf_map(tmp_path):
    path = _pdf(tmp_path)
    name = os.path.basename(path)
    return make_map(filename=name, filepath=path, relative_path=f"Maps/{name}")


@pytest.fixture
def raster_map(tmp_path):
    path = _png(tmp_path)
    name = os.path.basename(path)
    return make_map(filename=name, filepath=path, relative_path=f"Maps/{name}")


EXPORT = {"kind": "pages", "format": "pdf", "pages": "1"}
# Saving renders first; the made-up destination is refused afterwards.
SAVE = {**EXPORT, "destination": "Nowhere/At/All"}

PAGE_EXPORT_ROUTES = [
    ("post", "export", EXPORT),
    ("post", "export/save", SAVE),
    ("get", "page/1/size", None),
    ("get", "page/1/shapes", None),
]


class TestTheGuard:
    def test_it_catches_a_wait_made_while_holding_a_connection(
        self, waits, request_sessions, tmp_path
    ):
        """Without this the rest of the file could pass by never noticing."""
        db = SessionLocal()
        try:
            request_sessions.append(db)
            db.query(GameSystem).first()
            render_pool.page_text(_pdf(tmp_path), 1)
        finally:
            db.close()
        with pytest.raises(AssertionError, match="page_text"):
            waits.assert_released()

    def test_it_catches_a_route_that_never_waited(self, waits):
        with pytest.raises(AssertionError, match="never reached"):
            waits.assert_released()


class TestPageExports:
    @pytest.mark.parametrize("method,path,body", PAGE_EXPORT_ROUTES)
    def test_book(self, client, admin_headers, waits, pdf_book, method, path, body):
        kwargs = {"json": body} if body else {}
        r = getattr(client, method)(
            f"/api/books/{pdf_book.id}/{path}", headers=admin_headers, **kwargs
        )
        assert r.status_code < 500, r.text
        waits.assert_released()

    @pytest.mark.parametrize("method,path,body", PAGE_EXPORT_ROUTES)
    def test_map(self, client, admin_headers, waits, pdf_map, method, path, body):
        kwargs = {"json": body} if body else {}
        r = getattr(client, method)(
            f"/api/maps/{pdf_map.id}/{path}", headers=admin_headers, **kwargs
        )
        assert r.status_code < 500, r.text
        waits.assert_released()


class TestMapExports:
    def test_universal_vtt(self, client, admin_headers, waits, raster_map):
        r = client.get(f"/api/maps/{raster_map.id}/export.uvtt", headers=admin_headers)
        assert r.status_code == 200, r.text
        waits.assert_released()

    def test_otfbm_background(self, client, admin_headers, waits, raster_map):
        r = client.get(f"/api/maps/{raster_map.id}/otfbm/image", headers=admin_headers)
        assert r.status_code == 200, r.text
        waits.assert_released()


class TestMetadataLookups:
    def test_file_metadata_search(self, client, admin_headers, waits, pdf_book):
        r = client.post(
            f"/api/books/{pdf_book.id}/metadata-search",
            json={"source_id": "file-metadata", "query": ""},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["results"]
        waits.assert_released()

    def test_file_metadata_fetch(self, client, admin_headers, waits, pdf_book):
        r = client.post(
            f"/api/books/{pdf_book.id}/metadata-fetch",
            json={"source_id": "file-metadata", "identity": "file"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert any(f["field"] == "authors" for f in r.json()["fields"])
        waits.assert_released()

    @pytest.fixture
    def addon(self, isolated_addons, waits):
        directory = isolated_addons / MANIFEST["id"]
        directory.mkdir()
        (directory / f"{MANIFEST['id']}.yml").write_text(yaml.safe_dump(MANIFEST))
        with open(os.path.join(FIXTURE_DIR, "drivethrurpg_search.json"), "rb") as fh:
            search_doc = fh.read()
        with open(os.path.join(FIXTURE_DIR, "drivethrurpg_detail.json"), "rb") as fh:
            detail_doc = fh.read()
        # The detail endpoint ends in the product id; search carries a query.
        waits.respond = lambda url: search_doc if "keyword=" in url else detail_doc
        return MANIFEST["id"]

    def test_addon_search(self, client, admin_headers, waits, pdf_book, addon):
        r = client.post(
            f"/api/books/{pdf_book.id}/metadata-search",
            json={"source_id": addon},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["results"]
        waits.assert_released()

    def test_addon_fetch(self, client, admin_headers, waits, pdf_book, addon):
        identity = client.post(
            f"/api/books/{pdf_book.id}/metadata-search",
            json={"source_id": addon},
            headers=admin_headers,
        ).json()["results"][0]["identity"]
        waits.seen.clear()
        r = client.post(
            f"/api/books/{pdf_book.id}/metadata-fetch",
            json={"source_id": addon, "identity": identity},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        waits.assert_released()


class TestContentPacks:
    @pytest.fixture
    def catalogue(self, monkeypatch, tmp_path, waits):
        monkeypatch.setattr(pc, "get_index_urls", lambda db: [f"{REPO}/main/index.json"])
        monkeypatch.setattr(ps, "CONTENT_DIR", str(tmp_path / "character-content"))
        index = json.dumps(_index()).encode()

        def respond(url):
            for suffix, body in BODIES.items():
                if url.endswith(suffix):
                    return body
            return index

        waits.respond = respond
        yield
        # The catalog is shared across the session; don't leave the pack installed.
        session = SessionLocal()
        try:
            session.execute(ps.text("DELETE FROM content_search"))
            session.query(ps.ContentEntry).delete()
            session.query(ps.ContentPack).delete()
            session.commit()
        finally:
            session.close()

    def test_browse(self, client, admin_headers, waits, catalogue):
        r = client.get("/api/rulesets/packs/browse", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json()["packs"]
        waits.assert_released()

    def test_install(self, client, admin_headers, waits, catalogue):
        r = client.post("/api/rulesets/packs/install/test-srd", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json()["entry_count"] == 2
        # The catalogue read and both file downloads.
        assert len(waits.seen) == 3
        waits.assert_released()
