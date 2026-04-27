"""Tests for the tag export endpoint (GET /api/export/tags)."""
import json
import uuid

import pytest

from tests.conftest import make_game_system, make_book, make_map, make_token
from backend.config import SessionLocal
from backend.models import BookFolder, MapFolder, TokenFolder


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_book_folder(path: str, tags: list) -> BookFolder:
    db = SessionLocal()
    row = BookFolder(path=path, tags=tags)
    db.add(row)
    db.commit()
    db.refresh(row)
    db.close()
    return row


def _make_map_folder(path: str, tags: list) -> MapFolder:
    db = SessionLocal()
    row = MapFolder(path=path, tags=tags)
    db.add(row)
    db.commit()
    db.refresh(row)
    db.close()
    return row


def _make_token_folder(path: str, tags: list) -> TokenFolder:
    db = SessionLocal()
    row = TokenFolder(path=path, tags=tags)
    db.add(row)
    db.commit()
    db.refresh(row)
    db.close()
    return row


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def export_system():
    uid = uuid.uuid4().hex[:6]
    return make_game_system(
        name=f"ExportSystem-{uid}",
        slug=f"export-system-{uid}",
        tags=["fantasy", "official"],
    )


@pytest.fixture(scope="module")
def export_book(export_system):
    uid = uuid.uuid4().hex[:6]
    return make_book(
        system_id=export_system.id,
        title=f"Export Book {uid}",
        filename=f"export-book-{uid}.pdf",
        filepath=f"/tmp/export-book-{uid}.pdf",
        relative_path=f"books/core/export-book-{uid}.pdf",
        tags=["core", "phb"],
    )


@pytest.fixture(scope="module")
def export_book_folder():
    uid = uuid.uuid4().hex[:6]
    return _make_book_folder(f"dnd-5e/adventures-{uid}", ["adventure", "al-legal"])


@pytest.fixture(scope="module")
def export_map():
    uid = uuid.uuid4().hex[:6]
    return make_map(
        filename=f"dungeon-{uid}.png",
        filepath=f"/tmp/dungeon-{uid}.png",
        relative_path=f"maps/dungeons/dungeon-{uid}.png",
        tags=["dungeon", "outdoor"],
    )


@pytest.fixture(scope="module")
def export_map_folder():
    uid = uuid.uuid4().hex[:6]
    return _make_map_folder(f"dungeons-{uid}", ["dungeon"])


@pytest.fixture(scope="module")
def export_token():
    uid = uuid.uuid4().hex[:6]
    return make_token(
        filename=f"goblin-{uid}.png",
        filepath=f"/tmp/goblin-{uid}.png",
        relative_path=f"tokens/monsters/goblin-{uid}.png",
        tags=["monster", "cr5"],
    )


@pytest.fixture(scope="module")
def export_token_folder():
    uid = uuid.uuid4().hex[:6]
    return _make_token_folder(f"monsters-{uid}", ["creature"])


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------


class TestExportTagsAuth:
    def test_unauthenticated_rejected(self, client):
        resp = client.get("/api/export/tags")
        assert resp.status_code == 401

    def test_player_forbidden(self, client, player_headers):
        resp = client.get("/api/export/tags", headers=player_headers)
        assert resp.status_code == 403

    def test_gm_forbidden(self, client, gm_headers):
        resp = client.get("/api/export/tags", headers=gm_headers)
        assert resp.status_code == 403

    def test_admin_allowed(self, client, admin_headers):
        resp = client.get("/api/export/tags", headers=admin_headers)
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Response format
# ---------------------------------------------------------------------------


class TestExportTagsFormat:
    def test_content_type_is_json(self, client, admin_headers):
        resp = client.get("/api/export/tags", headers=admin_headers)
        assert "application/json" in resp.headers["content-type"]

    def test_content_disposition_attachment(self, client, admin_headers):
        resp = client.get("/api/export/tags", headers=admin_headers)
        cd = resp.headers["content-disposition"]
        assert "attachment" in cd
        assert "grimoire-tags-" in cd
        assert ".json" in cd

    def test_exported_at_field_present(self, client, admin_headers):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        assert "exported_at" in data

    def test_all_top_level_sections_present_by_default(self, client, admin_headers):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        assert "library" in data
        assert "maps" in data
        assert "tokens" in data

    def test_library_has_expected_keys(self, client, admin_headers):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        lib = data["library"]
        assert "systems" in lib
        assert "books" in lib
        assert "book_folders" in lib

    def test_maps_has_expected_keys(self, client, admin_headers):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        assert "items" in data["maps"]
        assert "folders" in data["maps"]

    def test_tokens_has_expected_keys(self, client, admin_headers):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        assert "items" in data["tokens"]
        assert "folders" in data["tokens"]


# ---------------------------------------------------------------------------
# Data integrity
# ---------------------------------------------------------------------------


class TestExportTagsData:
    def test_system_tags_included(self, client, admin_headers, export_system):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        systems = data["library"]["systems"]
        match = next((s for s in systems if s["slug"] == export_system.slug), None)
        assert match is not None
        assert match["tags"] == export_system.tags

    def test_system_entry_shape(self, client, admin_headers, export_system):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        match = next(
            (s for s in data["library"]["systems"] if s["slug"] == export_system.slug), None
        )
        assert "slug" in match
        assert "name" in match
        assert "tags" in match

    def test_book_tags_included(self, client, admin_headers, export_book):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        books = data["library"]["books"]
        match = next((b for b in books if b["id"] == export_book.id), None)
        assert match is not None
        assert match["tags"] == export_book.tags

    def test_book_entry_shape(self, client, admin_headers, export_book):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        match = next((b for b in data["library"]["books"] if b["id"] == export_book.id), None)
        assert "id" in match
        assert "title" in match
        assert "filepath" in match
        assert "tags" in match

    def test_book_folder_tags_included(self, client, admin_headers, export_book_folder):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        folders = data["library"]["book_folders"]
        match = next((f for f in folders if f["path"] == export_book_folder.path), None)
        assert match is not None
        assert match["tags"] == export_book_folder.tags

    def test_map_tags_included(self, client, admin_headers, export_map):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        maps = data["maps"]["items"]
        match = next((m for m in maps if m["id"] == export_map.id), None)
        assert match is not None
        assert match["tags"] == export_map.tags

    def test_map_entry_shape(self, client, admin_headers, export_map):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        match = next((m for m in data["maps"]["items"] if m["id"] == export_map.id), None)
        assert "id" in match
        assert "name" in match
        assert "folder" in match
        assert "tags" in match

    def test_map_folder_derived_from_relative_path(self, client, admin_headers, export_map):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        match = next((m for m in data["maps"]["items"] if m["id"] == export_map.id), None)
        assert match["folder"] == "maps/dungeons"

    def test_map_folder_tags_included(self, client, admin_headers, export_map_folder):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        folders = data["maps"]["folders"]
        match = next((f for f in folders if f["path"] == export_map_folder.path), None)
        assert match is not None
        assert match["tags"] == export_map_folder.tags

    def test_token_tags_included(self, client, admin_headers, export_token):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        tokens = data["tokens"]["items"]
        match = next((t for t in tokens if t["id"] == export_token.id), None)
        assert match is not None
        assert match["tags"] == export_token.tags

    def test_token_entry_shape(self, client, admin_headers, export_token):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        match = next((t for t in data["tokens"]["items"] if t["id"] == export_token.id), None)
        assert "id" in match
        assert "name" in match
        assert "folder" in match
        assert "tags" in match

    def test_token_folder_tags_included(self, client, admin_headers, export_token_folder):
        data = client.get("/api/export/tags", headers=admin_headers).json()
        folders = data["tokens"]["folders"]
        match = next((f for f in folders if f["path"] == export_token_folder.path), None)
        assert match is not None
        assert match["tags"] == export_token_folder.tags

    def test_empty_tags_included_not_omitted(self, client, admin_headers):
        uid = uuid.uuid4().hex[:6]
        sys = make_game_system(
            name=f"NoTagSystem-{uid}",
            slug=f"no-tag-system-{uid}",
            tags=[],
        )
        data = client.get("/api/export/tags", headers=admin_headers).json()
        match = next((s for s in data["library"]["systems"] if s["slug"] == sys.slug), None)
        assert match is not None
        assert match["tags"] == []

    def test_valid_json_payload(self, client, admin_headers):
        resp = client.get("/api/export/tags", headers=admin_headers)
        parsed = json.loads(resp.content)
        assert isinstance(parsed, dict)


# ---------------------------------------------------------------------------
# Section toggles
# ---------------------------------------------------------------------------


class TestExportTagsToggles:
    def test_exclude_library(self, client, admin_headers):
        data = client.get(
            "/api/export/tags",
            headers=admin_headers,
            params={"include_library": False},
        ).json()
        assert "library" not in data
        assert "maps" in data
        assert "tokens" in data

    def test_exclude_maps(self, client, admin_headers):
        data = client.get(
            "/api/export/tags",
            headers=admin_headers,
            params={"include_maps": False},
        ).json()
        assert "library" in data
        assert "maps" not in data
        assert "tokens" in data

    def test_exclude_tokens(self, client, admin_headers):
        data = client.get(
            "/api/export/tags",
            headers=admin_headers,
            params={"include_tokens": False},
        ).json()
        assert "library" in data
        assert "maps" in data
        assert "tokens" not in data

    def test_exclude_all_sections(self, client, admin_headers):
        data = client.get(
            "/api/export/tags",
            headers=admin_headers,
            params={"include_library": False, "include_maps": False, "include_tokens": False},
        ).json()
        assert "library" not in data
        assert "maps" not in data
        assert "tokens" not in data
        assert "exported_at" in data

    def test_library_only(self, client, admin_headers):
        data = client.get(
            "/api/export/tags",
            headers=admin_headers,
            params={"include_maps": False, "include_tokens": False},
        ).json()
        assert "library" in data
        assert "maps" not in data
        assert "tokens" not in data
