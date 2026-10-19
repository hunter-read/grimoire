"""The public side of share links (issue #541): serving, passwords, and every
way a link stops working."""
import base64
import io
import json

import pytest
from PIL import Image

from backend import config
from backend.config import SessionLocal
from backend.models import ShareLink, User
from backend.security import limiter
from backend.tests.conftest import (
    make_audio,
    make_book,
    make_game_system,
    make_map,
    make_model3d,
    make_token,
)
from backend.tests.share_link_helpers import (
    create,
    past,
    png,
    set_link,
    set_override,
    token_of,
)

# The share-link fixtures (shared_map, and the autouse fixture that puts the
# session users' permissions back) live in a plugin, not in conftest, so they
# only run for these tests.
pytest_plugins = ["backend.tests.share_link_helpers"]


@pytest.fixture
def link(client, gm_headers, shared_map):
    return create(client, gm_headers, "map", shared_map.id).json()


def _fetch(client, link, suffix="", **kw):
    return client.get(f"/api/share/{token_of(link)}{suffix}", **kw)


class TestServing:
    def test_serves_the_file_with_public_headers(self, client, link):
        r = _fetch(client, link, "/old-tavern.png")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/png"
        assert r.headers["access-control-allow-origin"] == "*"
        assert r.headers["cross-origin-resource-policy"] == "cross-origin"
        assert r.headers["x-robots-tag"] == "noindex, nofollow"
        assert r.headers["referrer-policy"] == "no-referrer"
        assert r.headers["cache-control"] == "private, max-age=300"
        assert r.headers["content-disposition"] == 'inline; filename="old-tavern.png"'
        with Image.open(io.BytesIO(r.content)) as img:
            assert img.size == (280, 140)

    def test_any_filename_and_no_filename_serve_the_same(self, client, link):
        assert _fetch(client, link).content == _fetch(client, link, "/whatever.jpg").content

    def test_download_flag_makes_an_attachment(self, client, link):
        r = _fetch(client, link, params={"download": 1})
        assert r.headers["content-disposition"].startswith("attachment;")

    def test_needs_no_login(self, client, link):
        client.cookies.clear()
        assert _fetch(client, link).status_code == 200

    def test_counts_gets_but_not_heads(self, client, link):
        client.head(f"/api/share/{token_of(link)}")
        _fetch(client, link)
        _fetch(client, link)
        db = SessionLocal()
        row = db.query(ShareLink).filter_by(id=link["id"]).first()
        assert row.use_count == 2
        assert row.last_used_at is not None
        db.close()

    def test_head_works(self, client, link):
        r = client.head(f"/api/share/{token_of(link)}/x.png")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/png"

    def test_meta(self, client, link):
        meta = _fetch(client, link, "/meta").json()
        assert meta["password_required"] is False
        assert meta["unlocked"] is True
        assert meta["name"] == "Old Tavern"
        assert meta["media_kind"] == "image"
        assert meta["file_url"].endswith("/old-tavern.png")
        assert meta["download_url"].endswith("?download=1")


class TestTypes:
    def test_book(self, client, gm_headers, tmp_path):
        import fitz

        path = tmp_path / "Rules.pdf"
        doc = fitz.open()
        doc.new_page()
        doc.save(str(path))
        doc.close()
        system = make_game_system()
        book = make_book(system.id, filename="Rules.pdf", filepath=str(path), title="The Rules")
        link = create(client, gm_headers, "book", book.id).json()
        assert link["resource_name"] == "The Rules"
        r = _fetch(client, link)
        assert r.headers["content-type"] == "application/pdf"
        assert _fetch(client, link, "/meta").json()["media_kind"] == "pdf"

    def test_pdf_map_serves_its_first_page(self, client, gm_headers, tmp_path):
        import fitz

        path = tmp_path / "Atlas.pdf"
        doc = fitz.open()
        doc.new_page()
        doc.save(str(path))
        doc.close()
        m = make_map(filename="Atlas.pdf", filepath=str(path))
        link = create(client, gm_headers, "map", m.id).json()
        assert link["file_url"].endswith("/atlas.webp")
        r = _fetch(client, link)
        assert r.headers["content-type"] == "image/webp"
        assert _fetch(client, link, "/meta").json()["media_type"] == "image/webp"

    def test_uvtt_map_serves_its_embedded_picture(self, client, gm_headers, tmp_path):
        buf = io.BytesIO()
        Image.new("RGB", (60, 40)).save(buf, "JPEG")
        path = tmp_path / "Keep.uvtt"
        path.write_text(json.dumps({"format": 0.3, "image": base64.b64encode(buf.getvalue()).decode()}))
        m = make_map(filename="Keep.uvtt", filepath=str(path))
        link = create(client, gm_headers, "map", m.id).json()
        assert link["file_url"].endswith("/keep.jpg")
        r = _fetch(client, link)
        assert r.headers["content-type"] == "image/jpeg"
        assert _fetch(client, link, "/meta").json()["media_type"] == "image/jpeg"

    def test_uvtt_without_a_picture_is_404(self, client, gm_headers, tmp_path):
        path = tmp_path / "Empty.uvtt"
        path.write_text(json.dumps({"format": 0.3}))
        m = make_map(filename="Empty.uvtt", filepath=str(path))
        link = create(client, gm_headers, "map", m.id).json()
        assert link["file_url"].endswith("/empty.png")
        assert _fetch(client, link).status_code == 404

    def test_token(self, client, gm_headers, tmp_path):
        t = make_token(filename="Goblin.jpg", filepath=png(tmp_path / "Goblin.jpg"))
        link = create(client, gm_headers, "token", t.id).json()
        r = _fetch(client, link)
        assert r.headers["content-type"] == "image/jpeg"
        assert "sandbox" not in r.headers["content-security-policy"]

    def test_svg_is_served_as_an_inert_document(self, client, gm_headers, tmp_path):
        path = tmp_path / "Rune.svg"
        path.write_bytes(b'<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>')
        for kind, record in (
            ("token", make_token(filename="Rune.svg", filepath=str(path))),
            ("map", make_map(filename="Rune.svg", filepath=str(path))),
        ):
            link = create(client, gm_headers, kind, record.id).json()
            r = _fetch(client, link)
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("image/svg+xml")
            assert "sandbox" in r.headers["content-security-policy"]
            # Cross-origin readers can still load it as an image.
            assert r.headers["access-control-allow-origin"] == "*"

    def test_audio_supports_ranges_without_counting_seeks(self, client, gm_headers, tmp_path):
        path = tmp_path / "Theme.mp3"
        path.write_bytes(b"ID3" + b"\x00" * 2000)
        track = make_audio(filename="Theme.mp3", filepath=str(path), title="Main Theme")
        link = create(client, gm_headers, "audio", track.id).json()
        assert link["resource_name"] == "Main Theme"
        r = _fetch(client, link, headers={"Range": "bytes=100-199"})
        assert r.status_code == 206
        assert len(r.content) == 100
        _fetch(client, link, headers={"Range": "bytes=0-99"})
        db = SessionLocal()
        assert db.query(ShareLink).filter_by(id=link["id"]).first().use_count == 1
        db.close()
        assert _fetch(client, link, "/meta").json()["media_kind"] == "audio"

    def test_model(self, client, gm_headers, tmp_path):
        path = tmp_path / "Dragon.stl"
        path.write_bytes(b"solid dragon\nendsolid dragon\n")
        model = make_model3d(filename="Dragon.stl", filepath=str(path))
        link = create(client, gm_headers, "model", model.id).json()
        assert _fetch(client, link).status_code == 200
        assert _fetch(client, link, "/meta").json()["media_kind"] == "model"

    def test_archive(self, client, gm_headers, tmp_path):
        import zipfile

        path = tmp_path / "Pack.zip"
        with zipfile.ZipFile(path, "w") as z:
            z.writestr("a.txt", "a")
        t = make_token(filename="Pack.zip", filepath=str(path))
        link = create(client, gm_headers, "token", t.id).json()
        assert _fetch(client, link).headers["content-type"] == "application/zip"
        assert _fetch(client, link, "/meta").json()["media_kind"] == "file"


class TestStopsWorking:
    def test_unknown_token(self, client):
        assert client.get("/api/share/not-a-real-token").status_code == 404

    def test_expired(self, client, link):
        set_link(link["id"], expires_at=past())
        assert _fetch(client, link).status_code == 404
        assert _fetch(client, link, "/meta").status_code == 404

    def test_revoked(self, client, gm_headers, link):
        client.post(f"/api/share-links/{link['id']}/revoke", headers=gm_headers)
        assert _fetch(client, link).status_code == 404

    def test_creator_loses_and_regains_permission(self, client, link, gm_id):
        set_override(gm_id, False)
        assert _fetch(client, link).status_code == 404
        # Not deleted: the link comes back with the permission.
        set_override(gm_id, None)
        assert _fetch(client, link).status_code == 200

    def test_creator_loses_read_access(self, client, gm_headers, gm_id, tmp_path):
        t = make_token(filename="n.png", filepath=png(tmp_path / "n.png"), is_explicit=True)
        link = create(client, gm_headers, "token", t.id).json()
        db = SessionLocal()
        db.query(User).filter_by(id=gm_id).update({"allow_explicit": False})
        db.commit()
        db.close()
        assert _fetch(client, link).status_code == 404
        listed = {item["id"]: item for item in client.get("/api/share-links", headers=gm_headers).json()}
        assert listed[link["id"]]["state"] == "unavailable"

    def test_file_missing_on_disk(self, client, link, shared_map):
        import os

        os.unlink(shared_map.filepath)
        assert _fetch(client, link).status_code == 404

    def test_item_deleted(self, client, link, shared_map):
        from backend.models import GenericMap

        db = SessionLocal()
        db.query(GenericMap).filter_by(id=shared_map.id).delete()
        db.commit()
        db.close()
        assert _fetch(client, link).status_code == 404

    def test_instance_switch(self, client, gm_headers, link, monkeypatch):
        monkeypatch.setattr(config, "SHARE_LINKS_ENABLED", False)
        assert _fetch(client, link).status_code == 404
        listed = {item["id"]: item for item in client.get("/api/share-links", headers=gm_headers).json()}
        assert listed[link["id"]]["state"] == "disabled"


class TestPassword:
    @pytest.fixture
    def locked(self, client, gm_headers, shared_map):
        return create(client, gm_headers, "map", shared_map.id, password="open sesame").json()

    def test_meta_withholds_the_item(self, client, locked):
        meta = _fetch(client, locked, "/meta").json()
        assert meta == {"password_required": True, "unlocked": False} | {
            k: None
            for k in (
                "resource_type",
                "name",
                "label",
                "filename",
                "media_type",
                "media_kind",
                "file_size",
                "file_url",
                "download_url",
                "expires_at",
            )
        }

    def test_content_needs_the_password(self, client, locked):
        assert _fetch(client, locked).status_code == 401

    def test_wrong_password(self, client, locked):
        r = client.post(f"/api/share/{token_of(locked)}/unlock", json={"password": "nope"})
        assert r.status_code == 403

    def test_right_password_unlocks_this_browser(self, client, locked):
        r = client.post(f"/api/share/{token_of(locked)}/unlock", json={"password": "open sesame"})
        assert r.json() == {"unlocked": True}
        cookie = r.headers["set-cookie"]
        assert "HttpOnly" in cookie
        assert f"Path=/api/share/{token_of(locked)}" in cookie
        content = _fetch(client, locked)
        assert content.status_code == 200
        # Protected content is not offered to other origins or shared caches.
        assert "access-control-allow-origin" not in content.headers
        assert content.headers["cache-control"] == "private, no-store"
        assert _fetch(client, locked, "/meta").json()["name"] == "Old Tavern"

    def test_changing_the_password_locks_it_again(self, client, gm_headers, locked):
        client.post(f"/api/share/{token_of(locked)}/unlock", json={"password": "open sesame"})
        client.patch(f"/api/share-links/{locked['id']}", json={"password": "new pass"}, headers=gm_headers)
        assert _fetch(client, locked).status_code == 401

    def test_unlock_cookie_does_not_open_another_link(self, client, gm_headers, shared_map, locked):
        r = client.post(f"/api/share/{token_of(locked)}/unlock", json={"password": "open sesame"})
        cookie = r.cookies.get("grimoire_share")
        other = create(client, gm_headers, "map", shared_map.id, password="open sesame").json()
        client.cookies.clear()
        r = client.get(f"/api/share/{token_of(other)}", cookies={"grimoire_share": cookie})
        assert r.status_code == 401

    def test_garbage_cookie(self, client, locked):
        client.cookies.clear()
        r = client.get(f"/api/share/{token_of(locked)}", cookies={"grimoire_share": "junk"})
        assert r.status_code == 401

    def test_unlocking_an_open_link_is_a_no_op(self, client, link):
        r = client.post(f"/api/share/{token_of(link)}/unlock", json={"password": "x"})
        assert r.json() == {"unlocked": True}


class TestThrottle:
    @pytest.fixture
    def limited(self):
        limiter.reset()
        limiter.enabled = True
        try:
            yield
        finally:
            limiter.enabled = False
            limiter.reset()

    def test_unknown_tokens_are_throttled(self, client, limited, link):
        for i in range(10):
            assert client.get(f"/api/share/guess-{i}").status_code == 404
        assert client.get("/api/share/guess-final").status_code == 429
        # Once over, even a real link is refused, so a 429 says nothing.
        assert _fetch(client, link).status_code == 429

    def test_dead_known_links_never_throttle(self, client, gm_headers, limited, link, shared_map):
        # A tool re-fetching a revoked link must not lock out its working links.
        dead = create(client, gm_headers, "map", shared_map.id).json()
        client.post(f"/api/share-links/{dead['id']}/revoke", headers=gm_headers)
        for _ in range(15):
            assert _fetch(client, dead).status_code == 404
        assert _fetch(client, link).status_code == 200

    def test_wrong_passwords_are_throttled_per_link(self, client, gm_headers, limited, shared_map):
        locked = create(client, gm_headers, "map", shared_map.id, password="right one").json()
        for _ in range(10):
            client.post(f"/api/share/{token_of(locked)}/unlock", json={"password": "wrong"})
        r = client.post(f"/api/share/{token_of(locked)}/unlock", json={"password": "right one"})
        assert r.status_code == 429

    def test_wrong_passwords_are_counted_per_link_across_addresses(
        self, client, gm_headers, limited, shared_map
    ):
        locked = create(client, gm_headers, "map", shared_map.id, password="right one").json()
        url = f"/api/share/{token_of(locked)}/unlock"
        for i in range(20):
            client.post(url, json={"password": "wrong"}, headers={"X-Forwarded-For": f"203.0.113.{i}"})
        r = client.post(url, json={"password": "right one"}, headers={"X-Forwarded-For": "198.51.100.9"})
        assert r.status_code == 429
        # Other links keep their own count.
        other = create(client, gm_headers, "map", shared_map.id, password="right one").json()
        r = client.post(
            f"/api/share/{token_of(other)}/unlock",
            json={"password": "right one"},
            headers={"X-Forwarded-For": "198.51.100.9"},
        )
        assert r.status_code == 200


class TestOtfbmVariant:
    """A share link can serve a map resized as an OTFBM background (issue #551),
    so Avrae's !map command gets a working -bg URL in one step."""

    @pytest.fixture
    def village(self, tmp_path):
        # 1400x1960 is 10x14 cells at the default 140px/cell.
        return make_map(
            filename="Village.png",
            filepath=png(tmp_path / "Village.png", size=(1400, 1960)),
            relative_path="DnD/Maps/Village.png",
        )

    def test_serves_the_resized_background(self, client, gm_headers, village):
        link = create(client, gm_headers, "map", village.id, variant="otfbm").json()
        assert link["variant"] == "otfbm"
        assert link["variant_options"] == {"cell": 70}
        assert link["file_url"].endswith("/village-10x14c70.jpg")
        r = _fetch(client, link, "/village-10x14c70.jpg")
        assert r.headers["content-type"] == "image/jpeg"
        with Image.open(io.BytesIO(r.content)) as img:
            assert img.size == (700, 980)
        assert _fetch(client, link, "/meta").json()["media_type"] == "image/jpeg"

    def test_takes_a_cell_size(self, client, gm_headers, village):
        link = create(client, gm_headers, "map", village.id, variant="otfbm", cell=50).json()
        assert link["variant_options"] == {"cell": 50}
        with Image.open(io.BytesIO(_fetch(client, link).content)) as img:
            assert img.size == (500, 700)

    def test_transparent_map_is_png(self, client, gm_headers, tmp_path):
        path = tmp_path / "cut.png"
        Image.new("RGBA", (280, 140), (0, 0, 0, 0)).save(str(path))
        m = make_map(filename="cut.png", filepath=str(path))
        link = create(client, gm_headers, "map", m.id, variant="otfbm").json()
        assert link["file_url"].endswith(".png")
        assert _fetch(client, link).headers["content-type"] == "image/png"
        assert _fetch(client, link, "/meta").json()["media_type"] == "image/png"

    def test_only_maps(self, client, gm_headers, tmp_path):
        t = make_token(filename="t.png", filepath=png(tmp_path / "t.png"))
        r = create(client, gm_headers, "token", t.id, variant="otfbm")
        assert r.status_code == 400

    def test_not_for_a_pdf_map(self, client, gm_headers, tmp_path):
        import fitz

        path = tmp_path / "Atlas.pdf"
        doc = fitz.open()
        doc.new_page()
        doc.save(str(path))
        doc.close()
        m = make_map(filename="Atlas.pdf", filepath=str(path))
        assert create(client, gm_headers, "map", m.id, variant="otfbm").status_code == 400

    def test_list_filters_by_variant(self, client, gm_headers, village):
        plain = create(client, gm_headers, "map", village.id).json()
        otfbm = create(client, gm_headers, "map", village.id, variant="otfbm").json()
        listed = client.get(
            "/api/share-links",
            params={"resource_id": village.id, "variant": "otfbm"},
            headers=gm_headers,
        ).json()
        ids = {item["id"] for item in listed}
        assert otfbm["id"] in ids
        assert plain["id"] not in ids

    def test_map_that_can_no_longer_be_resized_is_404(self, client, gm_headers, village, monkeypatch):
        link = create(client, gm_headers, "map", village.id, variant="otfbm").json()
        from backend.routers.maps import otfbm_export
        from fastapi import HTTPException

        def broken(*_a, **_k):
            raise HTTPException(400, "Map image could not be read")

        monkeypatch.setattr(otfbm_export, "otfbm_background", broken)
        assert _fetch(client, link).status_code == 404
