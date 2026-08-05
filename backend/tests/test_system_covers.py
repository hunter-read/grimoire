"""Tests for system cover art — serve, upload, delete.

A system's cover resolves folder art (a ``cover.*`` in its library folder) ahead
of an uploaded image. Container folders (issues #261/#262) hold no books, so
these are the only cover sources they have.
"""
import io
import os

import pytest
from PIL import Image

from backend.config import SYSTEM_COVER_DIR, SessionLocal
from backend.models import GameSystem
from backend.tests.conftest import make_game_system


def _png_bytes(color=(120, 90, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (10, 14), color).save(buf, "PNG")
    return buf.getvalue()


def _set_folder_cover(system_id: str, rel_path: str) -> None:
    db = SessionLocal()
    try:
        system = db.query(GameSystem).filter_by(id=system_id).first()
        system.folder_cover_path = rel_path
        db.commit()
    finally:
        db.close()


@pytest.fixture
def system():
    # Function-scoped and the suite shares one DB, so let make_game_system
    # generate a unique name/slug per test rather than colliding on a fixed one.
    return make_game_system()


class TestServeCover:
    def test_404_when_system_has_no_cover(self, client, admin_headers, system):
        resp = client.get(f"/api/systems/{system.id}/cover", headers=admin_headers)
        assert resp.status_code == 404

    def test_404_for_unknown_system(self, client, admin_headers):
        resp = client.get("/api/systems/does-not-exist/cover", headers=admin_headers)
        assert resp.status_code == 404

    def test_unauthenticated_denied(self, client, system):
        resp = client.get(f"/api/systems/{system.id}/cover")
        assert resp.status_code == 401


class TestUploadCover:
    def test_upload_stores_and_serves_the_image(self, client, admin_headers, system):
        resp = client.post(
            f"/api/systems/{system.id}/cover",
            files={"file": ("cover.png", _png_bytes(), "image/png")},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["cover_image"] == f"{system.id}.png"

        served = client.get(f"/api/systems/{system.id}/cover", headers=admin_headers)
        assert served.status_code == 200
        assert served.headers["content-type"] == "image/png"

    def test_has_cover_flag_flips_in_the_systems_list(self, client, admin_headers, system):
        before = client.get("/api/systems", headers=admin_headers).json()
        assert next(s for s in before if s["id"] == system.id)["has_cover"] is False

        client.post(
            f"/api/systems/{system.id}/cover",
            files={"file": ("cover.png", _png_bytes(), "image/png")},
            headers=admin_headers,
        )
        after = client.get("/api/systems", headers=admin_headers).json()
        assert next(s for s in after if s["id"] == system.id)["has_cover"] is True

    def test_rejects_a_non_image_content_type(self, client, admin_headers, system):
        resp = client.post(
            f"/api/systems/{system.id}/cover",
            files={"file": ("evil.txt", b"not an image", "text/plain")},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_rejects_bytes_that_are_not_really_an_image(self, client, admin_headers, system):
        resp = client.post(
            f"/api/systems/{system.id}/cover",
            files={"file": ("fake.png", b"definitely not a png", "image/png")},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_rejects_an_empty_file(self, client, admin_headers, system):
        resp = client.post(
            f"/api/systems/{system.id}/cover",
            files={"file": ("empty.png", b"", "image/png")},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_replacing_a_cover_does_not_leave_the_old_file(self, client, admin_headers, system):
        client.post(
            f"/api/systems/{system.id}/cover",
            files={"file": ("a.png", _png_bytes(), "image/png")},
            headers=admin_headers,
        )
        client.post(
            f"/api/systems/{system.id}/cover",
            files={"file": ("b.webp", _png_bytes(), "image/webp")},
            headers=admin_headers,
        )
        stored = [n for n in os.listdir(SYSTEM_COVER_DIR) if n.startswith(system.id)]
        assert stored == [f"{system.id}.webp"]

    def test_player_cannot_upload(self, client, player_headers, system):
        resp = client.post(
            f"/api/systems/{system.id}/cover",
            files={"file": ("cover.png", _png_bytes(), "image/png")},
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_upload_to_unknown_system_404s(self, client, admin_headers):
        resp = client.post(
            "/api/systems/nope/cover",
            files={"file": ("cover.png", _png_bytes(), "image/png")},
            headers=admin_headers,
        )
        assert resp.status_code == 404


class TestDeleteCover:
    def test_delete_removes_the_upload(self, client, admin_headers, system):
        client.post(
            f"/api/systems/{system.id}/cover",
            files={"file": ("cover.png", _png_bytes(), "image/png")},
            headers=admin_headers,
        )
        resp = client.delete(f"/api/systems/{system.id}/cover", headers=admin_headers)
        assert resp.status_code == 200
        assert client.get(f"/api/systems/{system.id}/cover", headers=admin_headers).status_code == 404

    def test_player_cannot_delete(self, client, player_headers, system):
        resp = client.delete(f"/api/systems/{system.id}/cover", headers=player_headers)
        assert resp.status_code == 403


class TestFolderCoverPrecedence:
    def test_folder_cover_is_served_when_present(self, client, admin_headers, system, tmp_path):
        import backend.routers.systems.covers as covers

        # Write a cover into a fake library and point the system at it.
        rel = f"books/{system.slug}/cover.png"
        target = tmp_path / rel
        target.parent.mkdir(parents=True)
        target.write_bytes(_png_bytes(color=(10, 200, 10)))
        _set_folder_cover(system.id, rel)

        original = covers.LIBRARY_PATH
        covers.LIBRARY_PATH = str(tmp_path)
        try:
            resp = client.get(f"/api/systems/{system.id}/cover", headers=admin_headers)
            assert resp.status_code == 200
            assert resp.headers["content-type"] == "image/png"
        finally:
            covers.LIBRARY_PATH = original

    def test_folder_cover_path_escaping_the_library_is_refused(
        self, client, admin_headers, system, tmp_path
    ):
        """A stored path must never be able to read outside the library root."""
        secret = tmp_path / "secret.png"
        secret.write_bytes(_png_bytes())
        lib = tmp_path / "library"
        lib.mkdir()
        _set_folder_cover(system.id, "../secret.png")

        import backend.routers.systems.covers as covers

        original = covers.LIBRARY_PATH
        covers.LIBRARY_PATH = str(lib)
        try:
            resp = client.get(f"/api/systems/{system.id}/cover", headers=admin_headers)
            assert resp.status_code == 404
        finally:
            covers.LIBRARY_PATH = original
