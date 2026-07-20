"""Tests for token and token-folder endpoints."""
import hashlib

from PIL import Image as PILImage

from backend.config import SessionLocal
from backend.indexer import slugify
from backend.models import Token, User
from backend.tests.conftest import make_token


def _set_explicit_pref(username, allow):
    db = SessionLocal()
    u = db.query(User).filter_by(username=username).first()
    u.allow_explicit = allow
    db.commit()
    db.close()


class TestListTokens:
    def test_returns_list(self, client, admin_headers):
        make_token()
        resp = client.get("/api/tokens", headers=admin_headers)
        assert resp.status_code == 200
        assert "total" in resp.json() and "tokens" in resp.json()

    def test_player_can_list(self, client, player_headers):
        make_token()
        resp = client.get("/api/tokens", headers=player_headers)
        assert resp.status_code == 200

    def test_unauthenticated_denied(self, client):
        client.cookies.clear()
        assert client.get("/api/tokens").status_code == 401

    def test_pagination(self, client, admin_headers):
        make_token()
        resp = client.get("/api/tokens?limit=1&offset=0", headers=admin_headers)
        assert resp.status_code == 200
        assert len(resp.json()["tokens"]) <= 1

    def test_explicit_hidden_when_disabled(self, client, player_headers):
        t = make_token(is_explicit=True)
        _set_explicit_pref("playeruser", False)
        try:
            ids = {
                row["id"]
                for row in client.get("/api/tokens", headers=player_headers).json()["tokens"]
            }
            assert t.id not in ids
        finally:
            _set_explicit_pref("playeruser", True)


class TestTokenFolders:
    def test_list_folders(self, client, admin_headers):
        resp = client.get("/api/token-folders", headers=admin_headers)
        assert resp.status_code == 200
        assert "folders" in resp.json()

    def test_gm_can_set_folder_tags(self, client, gm_headers):
        resp = client.patch(
            "/api/token-folders",
            json={"path": "Goblins", "tags": ["enemy", "horde"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["tags"] == ["enemy", "horde"]
        # Second patch on the same path updates the existing row.
        resp = client.patch(
            "/api/token-folders",
            json={"path": "Goblins", "tags": ["enemy"]},
            headers=gm_headers,
        )
        assert resp.json()["tags"] == ["enemy"]

    def test_player_cannot_set_folder_tags(self, client, player_headers):
        resp = client.patch(
            "/api/token-folders",
            json={"path": "X", "tags": ["y"]},
            headers=player_headers,
        )
        assert resp.status_code == 403


class TestGetToken:
    def test_get_existing(self, client, admin_headers, tmp_path):
        # A real image so the PIL dimension read succeeds.
        f = tmp_path / "orc.png"
        PILImage.new("RGB", (64, 48)).save(str(f))
        t = make_token(filename="orc.png", filepath=str(f), relative_path="Sys/Folder/orc.png")
        resp = client.get(f"/api/tokens/{t.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == t.id
        assert body["pixel_width"] == 64 and body["pixel_height"] == 48
        assert body["folder_path"] == "Folder"

    def test_get_handles_unreadable_image(self, client, admin_headers):
        # filepath doesn't exist → PIL open fails → dimensions None, still 200.
        t = make_token(filepath="/nonexistent/x.png")
        resp = client.get(f"/api/tokens/{t.id}", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["pixel_width"] is None

    def test_nonexistent_returns_404(self, client, admin_headers):
        assert client.get("/api/tokens/nope", headers=admin_headers).status_code == 404

    def test_explicit_denied_when_disabled(self, client, player_headers):
        t = make_token(is_explicit=True)
        _set_explicit_pref("playeruser", False)
        try:
            assert (
                client.get(f"/api/tokens/{t.id}", headers=player_headers).status_code == 403
            )
        finally:
            _set_explicit_pref("playeruser", True)


class TestServeTokenFile:
    def test_serves_existing_file(self, client, admin_headers, tmp_path):
        f = tmp_path / "kobold.png"
        f.write_bytes(b"fake-png")
        t = make_token(filename="kobold.png", filepath=str(f))
        resp = client.get(f"/api/tokens/{t.id}/file", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content == b"fake-png"

    def test_missing_token_returns_404(self, client, admin_headers):
        assert (
            client.get("/api/tokens/does-not-exist/file", headers=admin_headers).status_code
            == 404
        )

    def test_file_absent_marks_missing(self, client, admin_headers, tmp_path):
        t = make_token(filename="gone.png", filepath=str(tmp_path / "gone.png"))
        resp = client.get(f"/api/tokens/{t.id}/file", headers=admin_headers)
        assert resp.status_code == 404
        db = SessionLocal()
        try:
            assert db.query(Token).filter_by(id=t.id).first().is_missing
        finally:
            db.close()


class TestServeTokenThumbnail:
    def test_returns_thumbnail_when_present(self, client, admin_headers, tmp_path, monkeypatch):
        from backend.routers.tokens import core

        thumb_root = tmp_path / "thumbs"
        (thumb_root / "tokens").mkdir(parents=True)
        monkeypatch.setattr(core, "THUMB_DIR", str(thumb_root))

        t = make_token(filename="dragon-token.png", filepath=str(tmp_path / "dragon-token.png"))
        slug = slugify("dragon token")
        fhash = hashlib.md5(t.filepath.encode()).hexdigest()[:8]
        (thumb_root / "tokens" / f"{slug}_{fhash}.webp").write_bytes(b"webp")

        resp = client.get(f"/api/tokens/{t.id}/thumbnail", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/webp"

    def test_missing_thumbnail_returns_404(self, client, admin_headers, tmp_path, monkeypatch):
        from backend.routers.tokens import core

        monkeypatch.setattr(core, "THUMB_DIR", str(tmp_path / "empty"))
        t = make_token(filename="no-thumb.png")
        assert (
            client.get(f"/api/tokens/{t.id}/thumbnail", headers=admin_headers).status_code
            == 404
        )

    def test_unknown_token_returns_404(self, client, admin_headers):
        assert (
            client.get("/api/tokens/nope/thumbnail", headers=admin_headers).status_code == 404
        )


class TestUpdateToken:
    def test_gm_can_update(self, client, gm_headers):
        t = make_token()
        resp = client.patch(
            f"/api/tokens/{t.id}",
            json={"description": "A fierce orc", "tags": ["orc"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/tokens/{t.id}", headers=gm_headers).json()
        assert detail["description"] == "A fierce orc"
        assert detail["tags"] == ["orc"]

    def test_player_cannot_update(self, client, player_headers):
        t = make_token()
        resp = client.patch(
            f"/api/tokens/{t.id}", json={"description": "x"}, headers=player_headers
        )
        assert resp.status_code == 403

    def test_update_nonexistent_returns_404(self, client, gm_headers):
        resp = client.patch(
            "/api/tokens/nope", json={"description": "x"}, headers=gm_headers
        )
        assert resp.status_code == 404
