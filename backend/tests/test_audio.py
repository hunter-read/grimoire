"""Tests for audio and audio folder endpoints."""
import os
import struct
import tempfile
import wave

import pytest
from PIL import Image

from backend.tests.conftest import make_audio
from backend.config import SessionLocal
from backend.models import Audio, AudioFolder


def _write_wav(path):
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"".join(struct.pack("<h", 0) for _ in range(800)))


@pytest.fixture(scope="module")
def audio_entry():
    return make_audio(tags=["ambient", "tavern"], artist="Bardcore", album="Taverns")


class TestListAudio:
    def test_returns_list(self, client, admin_headers, audio_entry):
        resp = client.get("/api/audio", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "audio" in body
        assert "total" in body

    def test_contains_created_track(self, client, admin_headers, audio_entry):
        resp = client.get("/api/audio", headers=admin_headers)
        ids = [a["id"] for a in resp.json()["audio"]]
        assert audio_entry.id in ids

    def test_list_includes_audio_fields(self, client, admin_headers, audio_entry):
        resp = client.get("/api/audio", headers=admin_headers)
        assert resp.status_code == 200
        tracks = resp.json()["audio"]
        assert len(tracks) > 0
        for a in tracks:
            assert "duration" in a
            assert "title" in a
            assert "has_artwork" in a
            assert "is_missing" in a
            assert isinstance(a["is_missing"], bool)

    def test_player_can_list_audio(self, client, player_headers, audio_entry):
        resp = client.get("/api/audio", headers=player_headers)
        assert resp.status_code == 200

    def test_unauthenticated_denied(self, client):
        resp = client.get("/api/audio")
        assert resp.status_code == 401

    def test_pagination(self, client, admin_headers, audio_entry):
        resp = client.get("/api/audio?limit=1&offset=0", headers=admin_headers)
        assert resp.status_code == 200
        assert len(resp.json()["audio"]) <= 1


class TestGetAudio:
    def test_get_existing_track(self, client, admin_headers, audio_entry):
        resp = client.get(f"/api/audio/{audio_entry.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == audio_entry.id
        assert body["duration"] == 123.5
        assert body["artist"] == "Bardcore"
        assert "folder_tags" in body

    def test_get_nonexistent_track(self, client, admin_headers):
        resp = client.get("/api/audio/does-not-exist", headers=admin_headers)
        assert resp.status_code == 404


class TestUpdateAudio:
    def test_gm_can_update_audio(self, client, gm_headers, audio_entry):
        resp = client.patch(
            f"/api/audio/{audio_entry.id}",
            json={"description": "A cozy tavern loop", "tags": ["ambient", "cozy"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_tags_are_lowercased_on_update(self, client, gm_headers):
        a = make_audio()
        resp = client.patch(
            f"/api/audio/{a.id}",
            json={"tags": ["Ambient", "TAVERN", "loop"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/audio/{a.id}", headers=gm_headers).json()
        assert detail["tags"] == ["ambient", "tavern", "loop"]

    def test_duplicate_tags_deduplicated_on_update(self, client, gm_headers):
        a = make_audio()
        resp = client.patch(
            f"/api/audio/{a.id}",
            json={"tags": ["ambient", "Ambient", "AMBIENT"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/audio/{a.id}", headers=gm_headers).json()
        assert detail["tags"] == ["ambient"]

    def test_player_cannot_update_audio(self, client, player_headers, audio_entry):
        resp = client.patch(
            f"/api/audio/{audio_entry.id}",
            json={"description": "Player edit attempt"},
            headers=player_headers,
        )
        assert resp.status_code == 403


class TestAudioFolders:
    @pytest.fixture(scope="class")
    def folder(self):
        db = SessionLocal()
        try:
            f = AudioFolder(path="audio/Ambient", tags=["ambient"])
            db.add(f)
            db.commit()
            db.refresh(f)
            return {"id": f.id, "path": f.path}
        finally:
            db.close()

    def test_list_audio_folders(self, client, admin_headers, folder):
        resp = client.get("/api/audio-folders", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "folders" in body
        assert isinstance(body["folders"], list)

    def test_contains_created_folder(self, client, admin_headers, folder):
        resp = client.get("/api/audio-folders", headers=admin_headers)
        paths = [f["path"] for f in resp.json()["folders"]]
        assert "audio/Ambient" in paths

    def test_gm_can_update_folder_tags(self, client, gm_headers, folder):
        resp = client.patch(
            "/api/audio-folders",
            json={"path": "audio/Ambient", "tags": ["ambient", "soundscape"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200

    def test_folder_tags_are_lowercased(self, client, gm_headers):
        resp = client.patch(
            "/api/audio-folders",
            json={"path": "audio/case-test", "tags": ["Ambient", "TAVERN"]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["tags"] == ["ambient", "tavern"]

    def test_player_cannot_update_folder_tags(self, client, player_headers):
        resp = client.patch(
            "/api/audio-folders",
            json={"path": "audio/test", "tags": ["test"]},
            headers=player_headers,
        )
        assert resp.status_code == 403


class TestServeAudioFile:
    @pytest.fixture(scope="class")
    def real_track(self):
        """An Audio row backed by a real .wav on disk, plus a folder cover image."""
        tmp = tempfile.mkdtemp()
        wav = os.path.join(tmp, "tone.wav")
        _write_wav(wav)
        Image.new("RGB", (16, 16), (10, 20, 30)).save(os.path.join(tmp, "cover.jpg"))
        a = make_audio(filename="tone.wav", filepath=wav, relative_path="audio/Ambient/tone.wav")
        return a

    def test_streams_existing_file(self, client, admin_headers, real_track):
        resp = client.get(f"/api/audio/{real_track.id}/file", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/wav"
        assert len(resp.content) > 0

    def test_404_for_unknown_id(self, client, admin_headers):
        resp = client.get("/api/audio/does-not-exist/file", headers=admin_headers)
        assert resp.status_code == 404

    def test_missing_file_marks_record_and_404s(self, client, admin_headers):
        a = make_audio(
            filename="gone.mp3",
            filepath="/tmp/definitely-missing-xyz.mp3",
            relative_path="audio/gone.mp3",
        )
        resp = client.get(f"/api/audio/{a.id}/file", headers=admin_headers)
        assert resp.status_code == 404
        db = SessionLocal()
        try:
            assert db.query(Audio).filter_by(id=a.id).first().is_missing is True
        finally:
            db.close()

    def test_artwork_serves_folder_cover(self, client, admin_headers, real_track):
        resp = client.get(f"/api/audio/{real_track.id}/artwork", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("image/")
        assert len(resp.content) > 0

    def test_artwork_404_when_none(self, client, admin_headers):
        # A row with no real file/folder cover and no embedded art.
        a = make_audio(filename="bare.mp3", filepath="/tmp/no-such-bare.mp3")
        resp = client.get(f"/api/audio/{a.id}/artwork", headers=admin_headers)
        assert resp.status_code == 404

    def test_artwork_404_for_unknown_id(self, client, admin_headers):
        resp = client.get("/api/audio/does-not-exist/artwork", headers=admin_headers)
        assert resp.status_code == 404

    def test_update_description_persists(self, client, gm_headers, real_track):
        resp = client.patch(
            f"/api/audio/{real_track.id}",
            json={"description": "A gentle tone"},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/audio/{real_track.id}", headers=gm_headers).json()
        assert detail["description"] == "A gentle tone"

    def test_update_unknown_id_404s(self, client, gm_headers):
        resp = client.patch(
            "/api/audio/does-not-exist", json={"description": "x"}, headers=gm_headers
        )
        assert resp.status_code == 404
