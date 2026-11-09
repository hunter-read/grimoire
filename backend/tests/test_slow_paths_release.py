"""Every route that waits on something slow hands its connection back first (issue #782).

#701 fixed page and tile renders by calling ``release_connection`` before the
wait, but the call is placed route by route, and exports, add-on lookups, pack
installs and map exports were missed. A handful of those at once starved the
rest of the API of connections again.

The ``waits`` guard wraps the places a request actually waits - every render
pool entry point, every outbound HTTP request, the map encoders, and the start
of a streamed or file response - and records whether the request's session
still held a connection at that moment. A streamed body is sent after the
handler returns but before ``get_db`` closes its session, so a bulk archive
that starts streaming while holding one keeps it for the whole download.
Each route below is driven for real through it, so a route that starts waiting
before it lets go fails here, whichever handler or service the wait is in.
"""
import hashlib
import json
import os
import uuid
from pathlib import Path

import pymupdf
import httpx
import pytest
import yaml
from PIL import Image
from starlette.responses import FileResponse, StreamingResponse

from backend import config
from backend.addons import fetch, registry
from backend.addons.constants import (
    SETTING_ALLOW_SCRIPTS,
    SETTING_INDEX_CACHE,
    SETTING_INDEX_URL,
    SETTING_INSTALLED,
)
from backend.config import SessionLocal
from backend.addons.constants import DEFAULT_INDEX_URL
from backend.models import AppSetting, GameSystem, MapFolder
from backend.render import pool as render_pool
from backend.routers import downloads as downloads_pkg
from backend.routers.downloads import core as downloads_core
from backend.routers.maps import core as maps_core
from backend.routers.maps import otfbm_export
from backend.services.characters import pack_catalogue as pc
from backend.services.characters import packs as ps
from backend.services import tag_service
from backend.services.library_fs import paths as fs_paths
from backend.routers.opds import core as opds_core
from backend.services import backup as backup_service
from backend.tests.share_link_helpers import create as create_share_link
from backend.tests.share_link_helpers import png, token_of
from backend.tests.conftest import (
    make_audio,
    make_book,
    make_game_system,
    make_map,
    make_model3d,
    make_token,
)
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

    # A streamed or file body goes out after the handler has returned, for as
    # long as the client takes to read it.
    def wrap_response(cls):
        original = cls.__call__

        async def sent(self, scope, receive, send):
            guard.record(f"send {cls.__name__}")
            return await original(self, scope, receive, send)

        monkeypatch.setattr(cls, "__call__", sent)

    wrap_response(StreamingResponse)
    wrap_response(FileResponse)
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

    def test_it_catches_a_stream_sent_while_holding_a_connection(
        self, client, admin_headers, waits, monkeypatch, library
    ):
        monkeypatch.setattr(downloads_core, "release_connection", lambda db: None)
        r = client.get(
            "/api/downloads/archive", params=ARCHIVES["system"](library), headers=admin_headers
        )
        assert r.status_code == 200, r.text
        with pytest.raises(AssertionError, match="send StreamingResponse"):
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


# One set of library rows covering every archive scope, files on disk under a
# library root of this test's own.
ARCHIVES = {
    "system": lambda lib: {"type": "system", "id": lib["system"]},
    "system_category": lambda lib: {
        "type": "system_category", "id": lib["system"], "category": "core"
    },
    "book_folder": lambda lib: {"type": "book_folder", "id": lib["system"], "folder": "deep"},
    "map_folder": lambda lib: {"type": "map_folder", "folder": "dungeons"},
    "token_folder": lambda lib: {"type": "token_folder", "folder": "goblins"},
    "audio_folder": lambda lib: {"type": "audio_folder", "folder": "ambience"},
    "model_folder": lambda lib: {"type": "model_folder", "folder": "minis"},
    "library_folder": lambda lib: {"type": "library_folder", "folder": "books"},
    "tag": lambda lib: {"type": "tag", "tag": lib["tag"]},
    "tag_type": lambda lib: {"type": "tag_type", "tag": lib["tag"], "resource_type": "map"},
    "tag_folder": lambda lib: {
        "type": "tag_folder", "tag": lib["tag"], "resource_type": "map", "folder": lib["folder"]
    },
}


@pytest.fixture
def library(tmp_path, monkeypatch):
    root = tmp_path / "library"
    uid = uuid.uuid4().hex[:6]

    def file(rel):
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"content")
        return str(path)

    monkeypatch.setattr(downloads_pkg, "_LIBRARY_ROOT", Path(root).resolve())
    monkeypatch.setattr(fs_paths, "LIBRARY_PATH", str(root))

    system = make_game_system(name=f"Archive-{uid}")
    for rel in (f"books/Archive/core/core-{uid}.pdf", f"books/Archive/core/deep/x/deep-{uid}.pdf"):
        make_book(
            system.id,
            title=os.path.basename(rel),
            filename=os.path.basename(rel),
            filepath=file(rel),
            relative_path=rel,
            category="core",
        )
    folder = f"vault_{uid}"
    media = {
        "map": make_map(
            filename=f"m-{uid}.png",
            filepath=file(f"maps/dungeons/m-{uid}.png"),
            relative_path=f"maps/dungeons/m-{uid}.png",
        ),
        "folder_map": make_map(
            filename=f"f-{uid}.png",
            filepath=file(f"maps/{folder}/f-{uid}.png"),
            relative_path=f"maps/{folder}/f-{uid}.png",
        ),
    }
    make_token(
        filename=f"t-{uid}.png",
        filepath=file(f"tokens/goblins/t-{uid}.png"),
        relative_path=f"tokens/goblins/t-{uid}.png",
    )
    make_audio(
        filename=f"a-{uid}.mp3",
        filepath=file(f"audio/ambience/a-{uid}.mp3"),
        relative_path=f"audio/ambience/a-{uid}.mp3",
    )
    make_model3d(
        filename=f"mo-{uid}.stl",
        filepath=file(f"models/minis/mo-{uid}.stl"),
        relative_path=f"models/minis/mo-{uid}.stl",
    )

    tag = f"Archived {uid}"
    session = SessionLocal()
    try:
        tag_service.add_resource_tags(session, "map", media["map"].id, [tag])
        session.add(MapFolder(path=folder, tags=[tag]))
        session.commit()
    finally:
        session.close()
    return {"system": system.id, "tag": tag_service.normalize_internal(tag), "folder": folder}


class TestArchiveDownloads:
    @pytest.mark.parametrize("scope", sorted(ARCHIVES))
    def test_archive(self, client, admin_headers, waits, library, scope):
        r = client.get(
            "/api/downloads/archive", params=ARCHIVES[scope](library), headers=admin_headers
        )
        assert r.status_code == 200, r.text
        assert r.content
        waits.assert_released()


ADDON = {
    "id": "release-demo",
    "name": "Release Demo",
    "kind": "scraper",
    "source": {"url": "https://example.com/d.json", "format": "json"},
    "search": {"fields": [{"field": "name"}], "identity": {"from": "name"}},
    "map": {"license": {"from": "license"}},
}


class TestAddonInstalls:
    @pytest.fixture
    def index(self, waits):
        """An index offering ADDON at whatever version ``publish`` last set."""
        published = {}

        def publish(version):
            body = yaml.safe_dump({**ADDON, "version": version}).encode()
            entry = {
                "id": ADDON["id"],
                "name": ADDON["name"],
                "kind": "scraper",
                "version": version,
                "path": f"scrapers/{ADDON['id']}/{ADDON['id']}.yml",
                "sha256": hashlib.sha256(body).hexdigest(),
            }
            published["index"] = json.dumps({"version": 1, "addons": [entry]}).encode()
            published["manifest"] = body

        def respond(url):
            if url == DEFAULT_INDEX_URL:
                return published["index"]
            if url.endswith(".yml"):
                return published["manifest"]
            return None

        publish("1.0.0")
        waits.respond = respond
        return publish

    def test_refresh(self, client, admin_headers, waits, index):
        r = client.post("/api/addons/refresh", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json()["count"] == 1
        waits.assert_released()

    def test_install(self, client, admin_headers, waits, index):
        assert client.post("/api/addons/refresh", headers=admin_headers).status_code == 200
        waits.seen.clear()
        r = client.post(f"/api/addons/{ADDON['id']}/install", json={}, headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json()["version"] == "1.0.0"
        waits.assert_released()

    def test_update_all(self, client, admin_headers, waits, index):
        assert client.post("/api/addons/refresh", headers=admin_headers).status_code == 200
        r = client.post(f"/api/addons/{ADDON['id']}/install", json={}, headers=admin_headers)
        assert r.status_code == 200, r.text
        index("1.1.0")
        waits.seen.clear()
        r = client.post("/api/addons/update-all", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json()["updated"] == [{"id": ADDON["id"], "from": "1.0.0", "to": "1.1.0"}]
        # The index refresh, then the new manifest.
        assert len(waits.seen) == 2
        waits.assert_released()


class TestFileDownloads:
    """A whole book, an audio stream, a backup: each is sent long after the
    handler returns, so each lets go before it starts."""

    @pytest.fixture
    def media(self, tmp_path):
        def file(name):
            path = tmp_path / f"{uuid.uuid4().hex[:6]}-{name}"
            path.write_bytes(b"content")
            return {"filename": path.name, "filepath": str(path), "relative_path": path.name}

        return {
            "audio": make_audio(**file("track.mp3")).id,
            "maps": make_map(**file("cave.png")).id,
            "models": make_model3d(**file("orc.stl")).id,
            "tokens": make_token(**file("goblin.png")).id,
        }

    def test_book(self, client, admin_headers, waits, pdf_book):
        r = client.get(f"/api/books/{pdf_book.id}/file", headers=admin_headers)
        assert r.status_code == 200, r.text
        waits.assert_released()

    @pytest.mark.parametrize("collection", ["audio", "maps", "models", "tokens"])
    def test_media(self, client, admin_headers, waits, media, collection):
        r = client.get(f"/api/{collection}/{media[collection]}/file", headers=admin_headers)
        assert r.status_code == 200, r.text
        waits.assert_released()

    def test_shared_file(self, client, gm_headers, waits, tmp_path):
        path = png(tmp_path / f"shared-{uuid.uuid4().hex[:6]}.png")
        shared = make_map(filename=os.path.basename(path), filepath=path)
        link = create_share_link(client, gm_headers, "map", shared.id).json()
        waits.seen.clear()
        r = client.get(f"/api/share/{token_of(link)}")
        assert r.status_code == 200, r.text
        waits.assert_released()

    def test_backup(self, client, admin_headers, waits, tmp_path, monkeypatch):
        monkeypatch.setattr(backup_service._config, "BACKUP_DIR", str(tmp_path))
        monkeypatch.setattr(backup_service._config, "BACKUP_DIR_ENV", None)
        created = client.post("/api/backups", headers=admin_headers)
        assert created.status_code == 200, created.text
        waits.seen.clear()
        r = client.get(f"/api/backups/{created.json()['id']}/download", headers=admin_headers)
        assert r.status_code == 200, r.text
        waits.assert_released()

    def test_opds_download(self, monkeypatch, pdf_book):
        """OPDS is mounted on an app of its own, so its handler is called directly."""
        session = SessionLocal()
        try:
            user = session.query(opds_core.User).filter_by(role="admin").first()
            monkeypatch.setattr(opds_core, "_resolve_user", lambda db, token: user)
            response = opds_core.download_book("token", pdf_book.id, session)
            assert response.path == pdf_book.filepath
            assert not session.in_transaction()
        finally:
            session.close()
