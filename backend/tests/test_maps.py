"""Tests for map and map folder endpoints."""
import hashlib

import pytest
from backend.tests.conftest import make_map
from backend.config import SessionLocal
from backend.models import MapFolder
from backend.indexer import slugify


@pytest.fixture(scope="module")
def map_entry():
    return make_map(tags=["dungeon", "encounter"])


class TestListMaps:
    def test_returns_list(self, client, admin_headers, map_entry):
        resp = client.get("/api/maps", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "maps" in body
        assert "total" in body

    def test_contains_created_map(self, client, admin_headers, map_entry):
        resp = client.get("/api/maps", headers=admin_headers)
        ids = [m["id"] for m in resp.json()["maps"]]
        assert map_entry.id in ids

    def test_list_includes_is_missing_field(self, client, admin_headers, map_entry):
        resp = client.get("/api/maps", headers=admin_headers)
        assert resp.status_code == 200
        maps = resp.json()["maps"]
        assert len(maps) > 0
        assert all("is_missing" in m for m in maps)
        assert all(isinstance(m["is_missing"], bool) for m in maps)

    def test_player_can_list_maps(self, client, player_headers, map_entry):
        resp = client.get("/api/maps", headers=player_headers)
        assert resp.status_code == 200

    def test_unauthenticated_denied(self, client):
        resp = client.get("/api/maps")
        assert resp.status_code == 401

    def test_pagination(self, client, admin_headers, map_entry):
        resp = client.get("/api/maps?limit=1&offset=0", headers=admin_headers)
        assert resp.status_code == 200
        assert len(resp.json()["maps"]) <= 1


class TestListMapsByFolder:
    @pytest.fixture(scope="class")
    def folder_maps(self):
        # relative_path = <GameSystem>/<Category>/.../<file>; folder is parts[1:-1]
        a1 = make_map(filename="a1.png", relative_path="DnD/Dungeons/a1.png")
        a2 = make_map(filename="a2.png", relative_path="DnD/Dungeons/a2.png")
        b1 = make_map(filename="b1.png", relative_path="DnD/Cities/b1.png")
        return {"a1": a1, "a2": a2, "b1": b1}

    def test_filters_to_matching_folder(self, client, admin_headers, folder_maps):
        resp = client.get("/api/maps?folder=Dungeons", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        ids = {m["id"] for m in body["maps"]}
        assert folder_maps["a1"].id in ids
        assert folder_maps["a2"].id in ids
        assert folder_maps["b1"].id not in ids
        assert body["total"] == len(body["maps"])

    def test_other_folder_excluded(self, client, admin_headers, folder_maps):
        resp = client.get("/api/maps?folder=Cities", headers=admin_headers)
        ids = {m["id"] for m in resp.json()["maps"]}
        assert ids == {folder_maps["b1"].id}

    def test_empty_folder_matches_top_level(self, client, admin_headers, map_entry):
        # map_entry has a bare relative_path, so its folder is "".
        resp = client.get("/api/maps?folder=", headers=admin_headers)
        assert resp.status_code == 200
        ids = {m["id"] for m in resp.json()["maps"]}
        assert map_entry.id in ids

    def test_unknown_folder_returns_empty(self, client, admin_headers, folder_maps):
        resp = client.get("/api/maps?folder=Nope", headers=admin_headers)
        assert resp.json()["maps"] == []
        assert resp.json()["total"] == 0


class TestGetMap:
    def test_get_existing_map(self, client, admin_headers, map_entry):
        resp = client.get(f"/api/maps/{map_entry.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == map_entry.id

    def test_get_map_includes_is_missing(self, client, admin_headers, map_entry):
        resp = client.get(f"/api/maps/{map_entry.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "is_missing" in body
        assert isinstance(body["is_missing"], bool)
        assert body["is_missing"] is False

    def test_get_nonexistent_map(self, client, admin_headers):
        resp = client.get("/api/maps/does-not-exist", headers=admin_headers)
        assert resp.status_code == 404

    def test_raster_map_reports_not_pdf(self, client, admin_headers, map_entry):
        resp = client.get(f"/api/maps/{map_entry.id}", headers=admin_headers)
        body = resp.json()
        assert body["is_pdf"] is False
        assert body["page_count"] is None

    def test_pdf_map_reports_page_count(self, client, admin_headers, tmp_path):
        f = tmp_path / "dungeon.pdf"
        _write_pdf(f, pages=4)
        m = make_map(filename="dungeon.pdf", filepath=str(f))
        resp = client.get(f"/api/maps/{m.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_pdf"] is True
        assert body["page_count"] == 4
        # PDF point dimensions/DPI aren't surfaced as raster info.
        assert body["pixel_width"] is None
        assert body["dpi"] is None


class TestUpdateMap:
    def test_gm_can_update_map(self, client, gm_headers, map_entry):
        resp = client.patch(
            f"/api/maps/{map_entry.id}",
            json={
                "description": "A dark dungeon map",
                "tags": ["dungeon", "dark"],
                "map_type": "dungeon",
            },
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_tags_are_lowercased_on_map_update(self, client, gm_headers):
        m = make_map()
        resp = client.patch(
            f"/api/maps/{m.id}",
            json={"tags": ["Draw Steel", "DUNGEON", "city"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/maps/{m.id}", headers=gm_headers).json()
        assert detail["tags"] == ["draw steel", "dungeon", "city"]

    def test_duplicate_tags_deduplicated_on_map_update(self, client, gm_headers):
        m = make_map()
        resp = client.patch(
            f"/api/maps/{m.id}",
            json={"tags": ["draw steel", "Draw Steel", "DRAW STEEL"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/maps/{m.id}", headers=gm_headers).json()
        assert detail["tags"] == ["draw steel"]

    def test_player_cannot_update_map(self, client, player_headers, map_entry):
        resp = client.patch(
            f"/api/maps/{map_entry.id}",
            json={
                "description": "Player edit attempt",
            },
            headers=player_headers,
        )
        assert resp.status_code == 403


class TestMapFolders:
    @pytest.fixture(scope="class")
    def folder(self):
        db = SessionLocal()
        try:
            f = MapFolder(path="maps/dungeons", tags=["dungeon"])
            db.add(f)
            db.commit()
            db.refresh(f)
            return {"id": f.id, "path": f.path}
        finally:
            db.close()

    def test_list_map_folders(self, client, admin_headers, folder):
        resp = client.get("/api/map-folders", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "folders" in body
        assert isinstance(body["folders"], list)

    def test_contains_created_folder(self, client, admin_headers, folder):
        resp = client.get("/api/map-folders", headers=admin_headers)
        paths = [f["path"] for f in resp.json()["folders"]]
        assert "maps/dungeons" in paths

    def test_gm_can_update_folder_tags(self, client, gm_headers, folder):
        resp = client.patch(
            "/api/map-folders",
            json={
                "path": "maps/dungeons",
                "tags": ["dungeon", "underground"],
            },
            headers=gm_headers,
        )
        assert resp.status_code == 200

    def test_folder_tags_are_lowercased(self, client, gm_headers):
        resp = client.patch(
            "/api/map-folders",
            json={"path": "maps/case-test", "tags": ["Draw Steel", "DUNGEON"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["tags"] == ["draw steel", "dungeon"]

    def test_folder_tags_deduplicated_after_lowercase(self, client, gm_headers):
        resp = client.patch(
            "/api/map-folders",
            json={"path": "maps/dedup-test", "tags": ["draw steel", "Draw Steel"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["tags"] == ["draw steel"]

    def test_player_cannot_update_folder_tags(self, client, player_headers):
        resp = client.patch(
            "/api/map-folders",
            json={
                "path": "maps/test",
                "tags": ["test"],
            },
            headers=player_headers,
        )
        assert resp.status_code == 403


class TestServeMapFile:
    def test_serves_existing_file(self, client, admin_headers, tmp_path):
        f = tmp_path / "battle.png"
        f.write_bytes(b"fake-png-bytes")
        m = make_map(filename="battle.png", filepath=str(f))
        resp = client.get(f"/api/maps/{m.id}/file", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content == b"fake-png-bytes"

    def test_pdf_map_served_as_pdf(self, client, admin_headers, tmp_path):
        f = tmp_path / "atlas.pdf"
        f.write_bytes(b"%PDF-1.4")
        m = make_map(filename="atlas.pdf", filepath=str(f))
        resp = client.get(f"/api/maps/{m.id}/file", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"

    def test_missing_map_returns_404(self, client, admin_headers):
        resp = client.get("/api/maps/does-not-exist/file", headers=admin_headers)
        assert resp.status_code == 404

    def test_file_absent_from_disk_marks_missing(self, client, admin_headers, tmp_path):
        gone = tmp_path / "gone.png"
        m = make_map(filename="gone.png", filepath=str(gone))
        resp = client.get(f"/api/maps/{m.id}/file", headers=admin_headers)
        assert resp.status_code == 404
        db = SessionLocal()
        try:
            from backend.models import GenericMap

            assert db.query(GenericMap).filter_by(id=m.id).first().is_missing
        finally:
            db.close()


def _write_pdf(path, pages=1):
    """Create a real multi-page PDF on disk so PyMuPDF can render it."""
    import fitz

    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 72), f"Map page {i + 1}")
    doc.save(str(path))
    doc.close()


class TestServeMapPage:
    def test_image_map_page1_returns_file(self, client, admin_headers, tmp_path):
        f = tmp_path / "battle.png"
        f.write_bytes(b"fake-png-bytes")
        m = make_map(filename="battle.png", filepath=str(f))
        resp = client.get(f"/api/maps/{m.id}/page/1", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content == b"fake-png-bytes"

    def test_image_map_page_beyond_1_is_400(self, client, admin_headers, tmp_path):
        f = tmp_path / "battle.png"
        f.write_bytes(b"fake-png-bytes")
        m = make_map(filename="battle.png", filepath=str(f))
        resp = client.get(f"/api/maps/{m.id}/page/2", headers=admin_headers)
        assert resp.status_code == 400

    def test_pdf_map_page_rendered_as_webp(self, client, admin_headers, tmp_path):
        f = tmp_path / "atlas.pdf"
        _write_pdf(f, pages=3)
        m = make_map(filename="atlas.pdf", filepath=str(f))
        resp = client.get(f"/api/maps/{m.id}/page/2", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/webp"
        assert resp.content[:4] == b"RIFF"  # WebP container magic

    def test_pdf_map_page_out_of_range_is_400(self, client, admin_headers, tmp_path):
        f = tmp_path / "atlas.pdf"
        _write_pdf(f, pages=1)
        m = make_map(filename="atlas.pdf", filepath=str(f))
        resp = client.get(f"/api/maps/{m.id}/page/5", headers=admin_headers)
        assert resp.status_code == 400

    def test_missing_map_returns_404(self, client, admin_headers):
        resp = client.get("/api/maps/nope/page/1", headers=admin_headers)
        assert resp.status_code == 404

    def test_file_absent_from_disk_marks_missing(self, client, admin_headers, tmp_path):
        gone = tmp_path / "gone.pdf"
        m = make_map(filename="gone.pdf", filepath=str(gone))
        resp = client.get(f"/api/maps/{m.id}/page/1", headers=admin_headers)
        assert resp.status_code == 404
        db = SessionLocal()
        try:
            from backend.models import GenericMap

            assert db.query(GenericMap).filter_by(id=m.id).first().is_missing
        finally:
            db.close()


class TestServeMapThumbnail:
    def test_returns_thumbnail_when_present(self, client, admin_headers, tmp_path, monkeypatch):
        from backend.routers.maps import core

        thumb_root = tmp_path / "thumbs"
        (thumb_root / "maps").mkdir(parents=True)
        monkeypatch.setattr(core, "THUMB_DIR", str(thumb_root))

        m = make_map(filename="cave-map.png", filepath=str(tmp_path / "cave-map.png"))
        slug = slugify("cave map")
        fhash = hashlib.md5(m.filepath.encode()).hexdigest()[:8]
        (thumb_root / "maps" / f"{slug}_{fhash}.webp").write_bytes(b"webp")

        resp = client.get(f"/api/maps/{m.id}/thumbnail", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/webp"

    def test_missing_thumbnail_returns_404(self, client, admin_headers, tmp_path, monkeypatch):
        from backend.routers.maps import core

        monkeypatch.setattr(core, "THUMB_DIR", str(tmp_path / "empty"))
        m = make_map(filename="no-thumb.png")
        resp = client.get(f"/api/maps/{m.id}/thumbnail", headers=admin_headers)
        assert resp.status_code == 404

    def test_unknown_map_returns_404(self, client, admin_headers):
        resp = client.get("/api/maps/nope/thumbnail", headers=admin_headers)
        assert resp.status_code == 404
