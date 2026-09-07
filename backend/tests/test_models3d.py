"""Tests for the 3D model and model-folder endpoints."""
import hashlib
import os
import struct

from backend.config import SessionLocal, THUMB_DIR
from backend.indexer import slugify
from backend.models import Model3D, User
from backend.tests.conftest import make_model3d


def _set_explicit_pref(username, allow):
    db = SessionLocal()
    u = db.query(User).filter_by(username=username).first()
    u.allow_explicit = allow
    db.commit()
    db.close()


def _write_stl(path):
    """A one-triangle binary STL — 84 bytes, no fixture file needed."""
    with open(path, "wb") as f:
        f.write(b"\0" * 80)
        f.write(struct.pack("<I", 1))
        f.write(struct.pack("<3f", 0, 0, 1))
        for vertex in ((0, 0, 0), (1, 0, 0), (0, 1, 0)):
            f.write(struct.pack("<3f", *vertex))
        f.write(b"\0\0")


class TestListModels:
    def test_returns_list(self, client, admin_headers):
        make_model3d()
        resp = client.get("/api/models", headers=admin_headers)
        assert resp.status_code == 200
        assert "total" in resp.json() and "models" in resp.json()

    def test_player_can_list(self, client, player_headers):
        make_model3d()
        assert client.get("/api/models", headers=player_headers).status_code == 200

    def test_unauthenticated_denied(self, client):
        client.cookies.clear()
        assert client.get("/api/models").status_code == 401

    def test_pagination(self, client, admin_headers):
        make_model3d()
        resp = client.get("/api/models?limit=1&offset=0", headers=admin_headers)
        assert len(resp.json()["models"]) <= 1

    def test_support_flags_are_two_booleans(self, client, admin_headers):
        """The tri-state column is flattened so a badge can show either state."""
        pre = make_model3d(is_supported=True)
        un = make_model3d(is_supported=False)
        unknown = make_model3d()
        rows = {m["id"]: m for m in client.get("/api/models", headers=admin_headers).json()["models"]}
        assert rows[pre.id]["is_presupported"] and not rows[pre.id]["is_unsupported"]
        assert rows[un.id]["is_unsupported"] and not rows[un.id]["is_presupported"]
        assert not rows[unknown.id]["is_presupported"]
        assert not rows[unknown.id]["is_unsupported"]

    def test_triangle_count_exposed(self, client, admin_headers):
        m = make_model3d(triangle_count=4242)
        rows = {r["id"]: r for r in client.get("/api/models", headers=admin_headers).json()["models"]}
        assert rows[m.id]["triangle_count"] == 4242

    def test_explicit_hidden_when_disallowed(self, client, player_headers):
        m = make_model3d(is_explicit=True)
        _set_explicit_pref("playeruser", False)
        try:
            ids = [r["id"] for r in client.get("/api/models", headers=player_headers).json()["models"]]
            assert m.id not in ids
        finally:
            _set_explicit_pref("playeruser", True)


class TestGetModel:
    def test_returns_detail(self, client, admin_headers):
        m = make_model3d()
        resp = client.get(f"/api/models/{m.id}", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == m.id

    def test_404_for_unknown(self, client, admin_headers):
        assert client.get("/api/models/nope", headers=admin_headers).status_code == 404

    def test_viewer_available_for_stl(self, client, admin_headers):
        m = make_model3d(filename="a.stl", filepath="/tmp/a.stl", file_size=1000)
        body = client.get(f"/api/models/{m.id}", headers=admin_headers).json()
        assert body["viewer_loader"] == "stl"
        assert body["viewer_available"] is True

    def test_viewer_unavailable_for_sliced_format(self, client, admin_headers):
        """A .ctb is an image stack for one printer, not geometry."""
        m = make_model3d(filename="a.ctb", filepath="/tmp/a.ctb", file_size=1000)
        body = client.get(f"/api/models/{m.id}", headers=admin_headers).json()
        assert body["viewer_loader"] == ""
        assert body["viewer_available"] is False

    def test_viewer_unavailable_when_too_large(self, client, admin_headers):
        """Past the cap the viewer does not load on its own."""
        m = make_model3d(filename="big.stl", filepath="/tmp/big.stl", file_size=500 * 1024 * 1024)
        body = client.get(f"/api/models/{m.id}", headers=admin_headers).json()
        assert body["viewer_loader"] == "stl"
        assert body["viewer_available"] is False
        # …but the client may still offer it behind a warning.
        assert body["viewer_oversized"] is True

    def test_oversized_is_false_below_the_cap(self, client, admin_headers):
        m = make_model3d(filename="small.stl", filepath="/tmp/small.stl", file_size=1000)
        body = client.get(f"/api/models/{m.id}", headers=admin_headers).json()
        assert body["viewer_oversized"] is False

    def test_unloadable_format_is_never_oversized(self, client, admin_headers):
        """No amount of consent renders a format with no loader, however small."""
        m = make_model3d(
            filename="big.ctb", filepath="/tmp/big.ctb", file_size=500 * 1024 * 1024
        )
        body = client.get(f"/api/models/{m.id}", headers=admin_headers).json()
        assert body["viewer_available"] is False
        assert body["viewer_oversized"] is False

    def test_is_supported_exposed_as_tristate(self, client, admin_headers):
        m = make_model3d(is_supported=None)
        assert client.get(f"/api/models/{m.id}", headers=admin_headers).json()["is_supported"] is None


class TestServeModelFile:
    def test_streams_the_mesh(self, client, admin_headers, tmp_path):
        path = tmp_path / "mini.stl"
        _write_stl(path)
        m = make_model3d(filename="mini.stl", filepath=str(path))
        resp = client.get(f"/api/models/{m.id}/file", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "model/stl"

    def test_missing_file_flags_the_row(self, client, admin_headers):
        m = make_model3d(filepath="/tmp/definitely-not-here.stl")
        assert client.get(f"/api/models/{m.id}/file", headers=admin_headers).status_code == 404
        db = SessionLocal()
        try:
            assert db.query(Model3D).filter_by(id=m.id).first().is_missing
        finally:
            db.close()

    def test_unknown_format_downloads_as_octet_stream(self, client, admin_headers, tmp_path):
        path = tmp_path / "sliced.ctb"
        path.write_bytes(b"sliced")
        m = make_model3d(filename="sliced.ctb", filepath=str(path))
        resp = client.get(f"/api/models/{m.id}/file", headers=admin_headers)
        assert resp.headers["content-type"] == "application/octet-stream"


class TestServeModelThumbnail:
    def test_serves_generated_thumbnail(self, client, admin_headers, tmp_path):
        from PIL import Image as PILImage

        filepath = str(tmp_path / "mini.stl")
        _write_stl(filepath)
        m = make_model3d(filename="mini.stl", filepath=filepath, has_thumbnail=True)
        title = "mini"
        fhash = hashlib.md5(filepath.encode()).hexdigest()[:8]
        os.makedirs(os.path.join(THUMB_DIR, "models"), exist_ok=True)
        thumb = os.path.join(THUMB_DIR, "models", f"{slugify(title)}_{fhash}.webp")
        PILImage.new("RGB", (10, 10)).save(thumb, "WEBP")
        resp = client.get(f"/api/models/{m.id}/thumbnail", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/webp"

    def test_404_when_not_generated(self, client, admin_headers):
        m = make_model3d()
        assert client.get(f"/api/models/{m.id}/thumbnail", headers=admin_headers).status_code == 404


class TestUpdateModel:
    def test_gm_can_update_description(self, client, gm_headers):
        m = make_model3d()
        resp = client.patch(
            f"/api/models/{m.id}", json={"description": "A goblin"}, headers=gm_headers
        )
        assert resp.status_code == 200
        db = SessionLocal()
        try:
            assert db.query(Model3D).filter_by(id=m.id).first().description == "A goblin"
        finally:
            db.close()

    def test_user_can_correct_the_support_flag(self, client, gm_headers):
        """The scan only guesses from the path, so the user has the final say."""
        m = make_model3d(is_supported=None)
        client.patch(f"/api/models/{m.id}", json={"is_supported": True}, headers=gm_headers)
        db = SessionLocal()
        try:
            assert db.query(Model3D).filter_by(id=m.id).first().is_supported is True
        finally:
            db.close()

    def test_player_denied(self, client, player_headers):
        m = make_model3d()
        resp = client.patch(f"/api/models/{m.id}", json={"description": "x"}, headers=player_headers)
        assert resp.status_code == 403

    def test_404_for_unknown(self, client, gm_headers):
        assert client.patch("/api/models/nope", json={"description": "x"}, headers=gm_headers).status_code == 404

    def test_tags_can_be_set(self, client, gm_headers, admin_headers):
        m = make_model3d()
        client.patch(f"/api/models/{m.id}", json={"tags": ["goblin", "mini"]}, headers=gm_headers)
        body = client.get(f"/api/models/{m.id}", headers=admin_headers).json()
        # Compared case-insensitively: tags are a shared catalog keyed on a
        # lowercased internal key, and the display casing is whichever spelling
        # registered the tag first — possibly in another collection entirely.
        assert sorted(tag.lower() for tag in body["tags"]) == ["goblin", "mini"]


class TestModelFolders:
    def test_list_folders(self, client, admin_headers):
        assert client.get("/api/model-folders", headers=admin_headers).status_code == 200

    def test_gm_can_tag_a_folder(self, client, gm_headers, admin_headers):
        resp = client.patch(
            "/api/model-folders", json={"path": "Goblins", "tags": ["horde"]}, headers=gm_headers
        )
        assert resp.status_code == 200
        folders = client.get("/api/model-folders", headers=admin_headers).json()["folders"]
        assert any(f["path"] == "Goblins" for f in folders)

    def test_player_denied(self, client, player_headers):
        resp = client.patch(
            "/api/model-folders", json={"path": "x", "tags": []}, headers=player_headers
        )
        assert resp.status_code == 403


class TestBulk:
    def test_bulk_update(self, client, gm_headers):
        a, b = make_model3d(), make_model3d()
        resp = client.post(
            "/api/models/bulk",
            json={"items": [{"id": a.id, "description": "A"}, {"id": b.id, "description": "B"}]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert sorted(resp.json()["updated"]) == sorted([a.id, b.id])

    def test_bulk_reports_unknown_ids(self, client, gm_headers):
        resp = client.post(
            "/api/models/bulk", json={"items": [{"id": "nope", "description": "x"}]}, headers=gm_headers
        )
        assert resp.json()["errors"]

    def test_bulk_add_tags(self, client, gm_headers, admin_headers):
        m = make_model3d()
        resp = client.post(
            "/api/models/bulk/tags", json={"ids": [m.id], "tags": ["dragon"]}, headers=gm_headers
        )
        assert resp.status_code == 200
        assert "dragon" in client.get(f"/api/models/{m.id}", headers=admin_headers).json()["tags"]

    def test_bulk_folder_tags(self, client, gm_headers):
        resp = client.post(
            "/api/model-folders/bulk",
            json={"folders": [{"path": "Terrain", "tags": ["scenery"]}]},
            headers=gm_headers,
        )
        assert resp.status_code == 200

    def test_bulk_player_denied(self, client, player_headers):
        resp = client.post("/api/models/bulk", json={"items": []}, headers=player_headers)
        assert resp.status_code == 403
