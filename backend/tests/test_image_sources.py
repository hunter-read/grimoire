"""Setting images from assets Grimoire already holds (issue #286).

Covers the shared resolver in ``backend.services.image_source`` and the three
endpoints built on it: campaign banner, system cover, and audio cover — plus the
banner focal point that ships with them.
"""

import io
import os

import pytest
from fastapi import HTTPException
from PIL import Image

from backend.config import SessionLocal, THUMB_DIR
from backend.services import image_source
from backend.tests.conftest import (
    make_audio,
    make_book,
    make_campaign,
    make_game_system,
    make_map,
    make_token,
)


def _png_bytes(size=(40, 20), color=(10, 120, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def _write_image(path: str, size=(40, 20)) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(_png_bytes(size))


@pytest.fixture
def image_map(tmp_path):
    """A map backed by a real image file on disk."""
    path = str(tmp_path / "banner-source.png")
    _write_image(path)
    return make_map(filename="banner-source.png", filepath=path, has_thumbnail=True)


# --------------------------------------------------------------------------- #
# The shared resolver
# --------------------------------------------------------------------------- #


class TestLoadSourceImage:
    def test_reads_a_plain_image_map_from_disk(self, image_map, admin_setup):
        db = SessionLocal()
        try:
            user = _admin_user(db, admin_setup)
            data = image_source.load_source_image(db, user, "map", image_map.id)
        finally:
            db.close()
        assert Image.open(io.BytesIO(data)).size == (40, 20)

    def test_falls_back_to_the_thumbnail_for_a_pdf_map(self, tmp_path, admin_setup):
        """A PDF map has no readable image, so the generated thumbnail is used."""
        pdf_path = str(tmp_path / "dungeon.pdf")
        with open(pdf_path, "wb") as f:
            f.write(b"%PDF-1.4 not really a pdf")
        m = make_map(filename="dungeon.pdf", filepath=pdf_path, has_thumbnail=True)
        thumb = image_source._media_thumb_path("map", "dungeon.pdf", pdf_path)
        _write_image(thumb, size=(24, 24))

        db = SessionLocal()
        try:
            data = image_source.load_source_image(db, _admin_user(db, admin_setup), "map", m.id)
        finally:
            db.close()
        assert Image.open(io.BytesIO(data)).size == (24, 24)

    def test_404_when_neither_original_nor_thumbnail_exists(self, admin_setup):
        m = make_map(filename="gone.png", filepath="/tmp/definitely-missing-286.png")
        db = SessionLocal()
        try:
            with pytest.raises(HTTPException) as exc:
                image_source.load_source_image(db, _admin_user(db, admin_setup), "map", m.id)
        finally:
            db.close()
        assert exc.value.status_code == 404

    def test_rejects_an_unknown_source_type(self, admin_setup):
        db = SessionLocal()
        try:
            with pytest.raises(HTTPException) as exc:
                image_source.load_source_image(db, _admin_user(db, admin_setup), "wiki", "x")
        finally:
            db.close()
        assert exc.value.status_code == 400

    def test_campaign_file_source_requires_a_campaign(self, admin_setup):
        db = SessionLocal()
        try:
            with pytest.raises(HTTPException) as exc:
                image_source.load_source_image(
                    db, _admin_user(db, admin_setup), "campaign_file", "x"
                )
        finally:
            db.close()
        assert exc.value.status_code == 400

    def test_book_source_uses_the_cover_thumbnail(self, tmp_path, admin_setup):
        system = make_game_system()
        book_path = str(tmp_path / "rulebook.pdf")
        book = make_book(system.id, title="Rulebook", filepath=book_path, has_thumbnail=True)
        db = SessionLocal()
        try:
            from backend.models import Book

            fresh = db.query(Book).filter_by(id=book.id).first()
            _write_image(image_source._book_thumb_path(fresh) or "", size=(30, 40))
        except Exception:
            # No thumbnail on disk yet — write it at the expected path.
            pass
        finally:
            db.close()

        from backend.indexer import slugify
        import hashlib

        fhash = hashlib.md5(book_path.encode()).hexdigest()[:8]
        _write_image(
            os.path.join(THUMB_DIR, "books", f"{slugify('Rulebook')}_{fhash}.webp"), size=(30, 40)
        )

        db = SessionLocal()
        try:
            data = image_source.load_source_image(db, _admin_user(db, admin_setup), "book", book.id)
        finally:
            db.close()
        assert Image.open(io.BytesIO(data)).size == (30, 40)

    def test_reads_a_campaign_file_image(self, admin_setup, admin_id):
        from backend.config import CAMPAIGN_UPLOAD_DIR
        from backend.models import CampaignFile

        c = make_campaign(admin_id)
        stored = "cf-286.png"
        _write_image(os.path.join(CAMPAIGN_UPLOAD_DIR, "files", stored), size=(16, 16))
        db = SessionLocal()
        try:
            cf = CampaignFile(
                campaign_id=c.id,
                stored_path=stored,
                filename="art.png",
                mime_type="image/png",
                size_bytes=100,
                is_image=True,
            )
            db.add(cf)
            db.commit()
            cf_id = cf.id
            data = image_source.load_source_image(
                db, _admin_user(db, admin_setup), "campaign_file", cf_id, campaign_id=c.id
            )
        finally:
            db.close()
        assert Image.open(io.BytesIO(data)).size == (16, 16)

    def test_campaign_file_must_be_an_image(self, admin_setup, admin_id):
        from backend.models import CampaignFile

        c = make_campaign(admin_id)
        db = SessionLocal()
        try:
            cf = CampaignFile(
                campaign_id=c.id,
                stored_path="notes.pdf",
                filename="notes.pdf",
                mime_type="application/pdf",
                size_bytes=10,
                is_image=False,
            )
            db.add(cf)
            db.commit()
            with pytest.raises(HTTPException) as exc:
                image_source.load_source_image(
                    db, _admin_user(db, admin_setup), "campaign_file", cf.id, campaign_id=c.id
                )
        finally:
            db.close()
        assert exc.value.status_code == 400

    def test_campaign_file_404s_when_unknown(self, admin_setup, admin_id):
        c = make_campaign(admin_id)
        db = SessionLocal()
        try:
            with pytest.raises(HTTPException) as exc:
                image_source.load_source_image(
                    db, _admin_user(db, admin_setup), "campaign_file", "nope", campaign_id=c.id
                )
        finally:
            db.close()
        assert exc.value.status_code == 404

    def test_campaign_file_404s_when_the_bytes_are_gone(self, admin_setup, admin_id):
        """The row survives, but the file behind it does not."""
        from backend.models import CampaignFile

        c = make_campaign(admin_id)
        db = SessionLocal()
        try:
            cf = CampaignFile(
                campaign_id=c.id,
                stored_path="vanished-286.png",
                filename="art.png",
                mime_type="image/png",
                size_bytes=10,
                is_image=True,
            )
            db.add(cf)
            db.commit()
            with pytest.raises(HTTPException) as exc:
                image_source.load_source_image(
                    db, _admin_user(db, admin_setup), "campaign_file", cf.id, campaign_id=c.id
                )
        finally:
            db.close()
        assert exc.value.status_code == 404

    def test_audio_source_uses_folder_artwork(self, tmp_path, admin_setup):
        folder = tmp_path / "ambience"
        folder.mkdir()
        _write_image(str(folder / "cover.png"), size=(18, 18))
        track = make_audio(filepath=str(folder / "rain.mp3"), filename="rain.mp3")

        db = SessionLocal()
        try:
            data = image_source.load_source_image(
                db, _admin_user(db, admin_setup), "audio", track.id
            )
        finally:
            db.close()
        assert Image.open(io.BytesIO(data)).size == (18, 18)

    def test_audio_source_404s_without_artwork(self, tmp_path, admin_setup):
        track = make_audio(filepath=str(tmp_path / "bare.mp3"), filename="bare.mp3")
        db = SessionLocal()
        try:
            with pytest.raises(HTTPException) as exc:
                image_source.load_source_image(
                    db, _admin_user(db, admin_setup), "audio", track.id
                )
        finally:
            db.close()
        assert exc.value.status_code == 404

    def test_audio_source_404s_when_unknown(self, admin_setup):
        db = SessionLocal()
        try:
            with pytest.raises(HTTPException) as exc:
                image_source.load_source_image(db, _admin_user(db, admin_setup), "audio", "nope")
        finally:
            db.close()
        assert exc.value.status_code == 404

    def test_book_source_404s_when_unknown(self, admin_setup):
        db = SessionLocal()
        try:
            with pytest.raises(HTTPException) as exc:
                image_source.load_source_image(db, _admin_user(db, admin_setup), "book", "nope")
        finally:
            db.close()
        assert exc.value.status_code == 404

    def test_book_source_404s_without_a_thumbnail(self, tmp_path, admin_setup):
        system = make_game_system()
        book = make_book(
            system.id, title="No Cover 286", filepath=str(tmp_path / "nocover-286.pdf")
        )
        db = SessionLocal()
        try:
            with pytest.raises(HTTPException) as exc:
                image_source.load_source_image(db, _admin_user(db, admin_setup), "book", book.id)
        finally:
            db.close()
        assert exc.value.status_code == 404

    def test_refuses_a_source_past_the_size_ceiling(self, tmp_path, admin_setup, monkeypatch):
        path = str(tmp_path / "huge.png")
        _write_image(path)
        m = make_map(filename="huge.png", filepath=path, has_thumbnail=True)
        # Far cheaper than writing 60 MB to disk.
        monkeypatch.setattr(image_source, "MAX_SOURCE_BYTES", 1)

        db = SessionLocal()
        try:
            with pytest.raises(HTTPException) as exc:
                image_source.load_source_image(db, _admin_user(db, admin_setup), "map", m.id)
        finally:
            db.close()
        assert exc.value.status_code == 413

    def test_source_ext_matches_the_decoded_format(self):
        assert image_source.source_ext(_png_bytes()) == ".png"
        buf = io.BytesIO()
        Image.new("RGB", (5, 5)).save(buf, "JPEG")
        assert image_source.source_ext(buf.getvalue()) == ".jpg"
        # Undecodable bytes fall back rather than raising — the caller has
        # already validated, and a stored name only has to be *a* name.
        assert image_source.source_ext(b"not an image") == ".png"

    def test_validate_image_rejects_a_disguised_file(self):
        with pytest.raises(HTTPException) as exc:
            image_source.validate_image(b"MZ definitely not an image")
        assert exc.value.status_code == 400


def _admin_user(db, admin_setup):
    from backend.models import User

    _token, user = admin_setup
    return db.query(User).filter_by(id=user["id"]).first()


# --------------------------------------------------------------------------- #
# Campaign banner
# --------------------------------------------------------------------------- #


class TestBannerFromSource:
    def test_sets_the_banner_from_a_library_map(self, client, admin_headers, admin_id, image_map):
        c = make_campaign(admin_id)
        resp = client.post(
            f"/api/campaigns/{c.id}/banner/from-source",
            json={"source_type": "map", "source_id": image_map.id},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        # Copy-on-select: the bytes land in the banner directory, normalised to
        # WebP, and the campaign points at them.
        assert resp.json()["banner_path"].endswith(".webp")

        got = client.get(f"/api/campaigns/{c.id}/banner", headers=admin_headers)
        assert got.status_code == 200

    def test_banner_survives_the_source_being_deleted(
        self, client, admin_headers, admin_id, image_map, tmp_path
    ):
        c = make_campaign(admin_id)
        client.post(
            f"/api/campaigns/{c.id}/banner/from-source",
            json={"source_type": "map", "source_id": image_map.id},
            headers=admin_headers,
        )
        # The whole point of copying rather than referencing.
        os.remove(image_map.filepath)
        assert client.get(f"/api/campaigns/{c.id}/banner", headers=admin_headers).status_code == 200

    def test_rejects_an_unknown_source_type(self, client, admin_headers, admin_id):
        c = make_campaign(admin_id)
        resp = client.post(
            f"/api/campaigns/{c.id}/banner/from-source",
            json={"source_type": "spaceship", "source_id": "x"},
            headers=admin_headers,
        )
        assert resp.status_code == 422

    def test_404_for_a_source_that_does_not_exist(self, client, admin_headers, admin_id):
        c = make_campaign(admin_id)
        resp = client.post(
            f"/api/campaigns/{c.id}/banner/from-source",
            json={"source_type": "map", "source_id": "no-such-map"},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    def test_a_non_owner_may_not_set_the_banner(
        self, client, player_headers, admin_id, image_map
    ):
        c = make_campaign(admin_id)
        resp = client.post(
            f"/api/campaigns/{c.id}/banner/from-source",
            json={"source_type": "map", "source_id": image_map.id},
            headers=player_headers,
        )
        assert resp.status_code in (403, 404)


class TestBannerFocus:
    def test_sets_and_reports_the_focal_point(self, client, admin_headers, admin_id):
        c = make_campaign(admin_id)
        resp = client.put(
            f"/api/campaigns/{c.id}/banner/focus", json={"focus_y": 20}, headers=admin_headers
        )
        assert resp.status_code == 200
        assert resp.json()["banner_focus_y"] == 20
        detail = client.get(f"/api/campaigns/{c.id}", headers=admin_headers).json()
        assert detail["banner_focus_y"] == 20

    def test_defaults_to_centred(self, client, admin_headers, admin_id):
        c = make_campaign(admin_id)
        detail = client.get(f"/api/campaigns/{c.id}", headers=admin_headers).json()
        assert detail["banner_focus_y"] == 50

    @pytest.mark.parametrize("value", [-1, 101])
    def test_rejects_an_out_of_range_focal_point(self, client, admin_headers, admin_id, value):
        c = make_campaign(admin_id)
        resp = client.put(
            f"/api/campaigns/{c.id}/banner/focus", json={"focus_y": value}, headers=admin_headers
        )
        assert resp.status_code == 422

    def test_removing_the_banner_recentres_it(self, client, admin_headers, admin_id, image_map):
        c = make_campaign(admin_id)
        client.post(
            f"/api/campaigns/{c.id}/banner/from-source",
            json={"source_type": "map", "source_id": image_map.id},
            headers=admin_headers,
        )
        client.put(
            f"/api/campaigns/{c.id}/banner/focus", json={"focus_y": 10}, headers=admin_headers
        )
        client.delete(f"/api/campaigns/{c.id}/banner", headers=admin_headers)
        # A stale focal point must not carry over onto the next banner.
        detail = client.get(f"/api/campaigns/{c.id}", headers=admin_headers).json()
        assert detail["banner_focus_y"] == 50


# --------------------------------------------------------------------------- #
# System cover
# --------------------------------------------------------------------------- #


class TestSystemCoverFromSource:
    def test_sets_a_system_cover_from_a_token(self, client, admin_headers, tmp_path):
        system = make_game_system()
        path = str(tmp_path / "hero.png")
        _write_image(path)
        tok = make_token(filename="hero.png", filepath=path, has_thumbnail=True)

        resp = client.post(
            f"/api/systems/{system.id}/cover/from-source",
            json={"source_type": "token", "source_id": tok.id},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["cover_image"].startswith(system.id)
        assert client.get(f"/api/systems/{system.id}/cover", headers=admin_headers).status_code == 200

    def test_campaign_file_is_not_a_valid_system_source(self, client, admin_headers):
        """A system has no campaign context, so that kind is rejected outright."""
        system = make_game_system()
        resp = client.post(
            f"/api/systems/{system.id}/cover/from-source",
            json={"source_type": "campaign_file", "source_id": "x"},
            headers=admin_headers,
        )
        assert resp.status_code == 422

    def test_a_player_may_not_set_a_system_cover(self, client, player_headers, tmp_path):
        system = make_game_system()
        path = str(tmp_path / "art.png")
        _write_image(path)
        tok = make_token(filename="art.png", filepath=path, has_thumbnail=True)
        resp = client.post(
            f"/api/systems/{system.id}/cover/from-source",
            json={"source_type": "token", "source_id": tok.id},
            headers=player_headers,
        )
        assert resp.status_code == 403


# --------------------------------------------------------------------------- #
# Audio cover
# --------------------------------------------------------------------------- #


class TestAudioCover:
    def test_sets_an_audio_cover_from_a_map(self, client, admin_headers, image_map):
        track = make_audio()
        resp = client.post(
            f"/api/audio/{track.id}/cover/from-source",
            json={"source_type": "map", "source_id": image_map.id},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert client.get(f"/api/audio/{track.id}/cover", headers=admin_headers).status_code == 200
        # A set cover is what `/artwork` now serves, and the track reports it.
        detail = client.get(f"/api/audio/{track.id}", headers=admin_headers).json()
        assert detail["has_cover"] is True
        assert detail["has_artwork"] is True

    def test_upload_then_remove_falls_back_to_no_artwork(self, client, admin_headers):
        track = make_audio()
        up = client.post(
            f"/api/audio/{track.id}/cover",
            files={"file": ("cover.png", _png_bytes(), "image/png")},
            headers=admin_headers,
        )
        assert up.status_code == 200
        assert client.get(f"/api/audio/{track.id}", headers=admin_headers).json()["has_cover"]

        client.delete(f"/api/audio/{track.id}/cover", headers=admin_headers)
        detail = client.get(f"/api/audio/{track.id}", headers=admin_headers).json()
        assert detail["has_cover"] is False
        # Nothing else supplies art for this track, so the flag goes back to False
        # rather than leaving the UI requesting a 404.
        assert detail["has_artwork"] is False
        assert client.get(f"/api/audio/{track.id}/cover", headers=admin_headers).status_code == 404

    def test_cover_get_404s_when_none_is_set(self, client, admin_headers):
        track = make_audio()
        assert client.get(f"/api/audio/{track.id}/cover", headers=admin_headers).status_code == 404

    def test_rejects_a_non_image_upload(self, client, admin_headers):
        track = make_audio()
        resp = client.post(
            f"/api/audio/{track.id}/cover",
            files={"file": ("notes.txt", b"hello", "text/plain")},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_a_player_may_not_set_an_audio_cover(self, client, player_headers, image_map):
        track = make_audio()
        resp = client.post(
            f"/api/audio/{track.id}/cover/from-source",
            json={"source_type": "map", "source_id": image_map.id},
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_404_for_an_unknown_track(self, client, admin_headers, image_map):
        resp = client.post(
            "/api/audio/no-such-track/cover/from-source",
            json={"source_type": "map", "source_id": image_map.id},
            headers=admin_headers,
        )
        assert resp.status_code == 404
