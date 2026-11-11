"""Tests for replacing a map, token, 3D model or audio file by upload (issue #870).

The book case lives in ``test_upload_replace.py``. Here, as there, what matters
is what survives and what does not: the record keeps its id - and with it its
description, tags, variant links and favorites - while everything read from the
old file (size, hash, thumbnail, cached renders, a mesh's triangle count, a
track's duration) is read again from the new one.
"""
import io
import os
import shutil
import struct
import uuid
import wave
from unittest.mock import patch

import pytest
from PIL import Image

from backend.config import LIBRARY_PATH, PAGE_CACHE_DIR, THUMB_DIR, SessionLocal
from backend.indexer import refresh_media_file
from backend.indexer._context import path_hash
from backend.models import Audio, Favorite, GenericMap, Model3D, Token, User
from backend.services import content_cache
from backend.services.library_scan import runner

from .conftest import make_audio, make_map, make_model3d, make_token

LIB = LIBRARY_PATH


@pytest.fixture(autouse=True)
def _idle_background():
    """No job running before and after each test."""

    def reset():
        runner.clear_stop()
        runner.SCAN_JOB._status.clear()
        runner.set_status({**runner.DEFAULT_STATUS})

    reset()
    yield
    reset()


@pytest.fixture
def folder(request):
    """A unique folder in the collection the test asks for, torn down after it."""
    section = request.param
    stamp = str(uuid.uuid4())[:8]
    rel = f"{section}/Replace-{stamp}"
    os.makedirs(os.path.join(LIB, rel), exist_ok=True)
    yield rel
    shutil.rmtree(os.path.join(LIB, rel), ignore_errors=True)


def _png(color: str, size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _stl(triangles: int) -> bytes:
    """A binary STL of ``triangles`` zeroed facets."""
    return b"\0" * 80 + struct.pack("<I", triangles) + b"\0" * (triangles * 50)


def _wav(frames: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\0\0" * frames)
    return buf.getvalue()


def _place(make, rel: str, name: str, content: bytes, **fields):
    """Write ``content`` to disk and register it with ``make``."""
    path = os.path.join(LIB, rel, name)
    with open(path, "wb") as f:
        f.write(content)
    return make(
        filename=name,
        filepath=path,
        relative_path=f"{rel}/{name}",
        file_size=len(content),
        **fields,
    )


def _replace(client, headers, rel: str, name: str, content: bytes):
    return client.post(
        "/api/files/upload",
        headers=headers,
        data={"destination": rel, "on_conflict": "replace"},
        files={"file": (name, content, "application/octet-stream")},
    )


def _thumb(section: str, filepath: str) -> list[str]:
    folder = os.path.join(THUMB_DIR, section)
    if not os.path.isdir(folder):
        return []
    tag = f"_{path_hash(filepath)}.webp"
    return [os.path.join(folder, n) for n in os.listdir(folder) if n.endswith(tag)]


def _get(model, record_id):
    db = SessionLocal()
    try:
        return db.get(model, record_id)
    finally:
        db.close()


class TestReplaceMap:
    @pytest.mark.parametrize("folder", ["maps"], indirect=True)
    def test_keeps_the_record_and_rereads_the_file(self, client, admin_headers, folder):
        original = _place(
            make_map,
            folder,
            "Deep Waters.png",
            _png("blue"),
            description="The gridless cut",
            tags=["coast"],
            grid_width=20.0,
        )
        child = make_map(variant_parent_id=original.id, variant_kind="gridded")
        db = SessionLocal()
        try:
            admin = db.query(User).filter_by(username="admin").first()
            db.add(Favorite(user_id=admin.id, item_type="map", item_id=original.id))
            db.commit()
        finally:
            db.close()

        new = _png("red", size=(80, 60))
        resp = _replace(client, admin_headers, folder, "Deep Waters.png", new)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["record_id"] == original.id
        assert body["record_type"] == "map"
        assert body["replaced"] is True

        m = _get(GenericMap, original.id)
        # What the user attached stays...
        assert m.description == "The gridless cut"
        assert m.grid_width == 20.0
        assert _get(GenericMap, child.id).variant_parent_id == original.id
        db = SessionLocal()
        try:
            assert db.query(Favorite).filter_by(item_type="map", item_id=original.id).count() == 1
        finally:
            db.close()
        tags = client.get(f"/api/maps/{original.id}", headers=admin_headers).json()["tags"]
        assert "coast" in tags
        # ...and what was read from the old file is read again.
        assert m.file_size == len(new)
        assert m.content_hash
        assert m.has_thumbnail
        [thumb] = _thumb("maps", m.filepath)
        with Image.open(thumb) as img:
            assert img.convert("RGB").getpixel((0, 0))[0] > 200  # red, not blue

    @pytest.mark.parametrize("folder", ["maps"], indirect=True)
    def test_the_thumbnail_etag_moves_on(self, client, admin_headers, folder):
        m = _place(make_map, folder, "harbour.png", _png("green"))
        assert _replace(client, admin_headers, folder, "harbour.png", _png("green")).status_code == 200
        first = client.get(f"/api/maps/{m.id}/thumbnail", headers=admin_headers)
        assert first.status_code == 200
        assert _replace(client, admin_headers, folder, "harbour.png", _png("purple")).status_code == 200
        second = client.get(
            f"/api/maps/{m.id}/thumbnail",
            headers={**admin_headers, "If-None-Match": first.headers["etag"]},
        )
        # A browser holding the old thumbnail is told it has changed.
        assert second.status_code == 200
        assert second.headers["etag"] != first.headers["etag"]

    @pytest.mark.parametrize("folder", ["maps"], indirect=True)
    def test_restores_a_missing_map(self, client, admin_headers, folder):
        m = _place(make_map, folder, "lost.png", _png("white"), is_missing=True)
        assert _replace(client, admin_headers, folder, "lost.png", _png("black")).status_code == 200
        assert _get(GenericMap, m.id).is_missing is False

    @pytest.mark.parametrize("folder", ["maps"], indirect=True)
    def test_an_archive_gets_no_thumbnail(self, client, admin_headers, folder):
        m = _place(make_map, folder, "pack.zip", b"PK old", has_thumbnail=False)
        with patch("backend.indexer.generate_thumbnail") as gen:
            assert _replace(client, admin_headers, folder, "pack.zip", b"PK new pack").status_code == 200
        gen.assert_not_called()
        row = _get(GenericMap, m.id)
        assert row.file_size == len(b"PK new pack")
        assert row.has_thumbnail is False

    @pytest.mark.parametrize("folder", ["maps"], indirect=True)
    def test_a_failed_render_drops_the_old_thumbnail(self, client, admin_headers, folder):
        m = _place(make_map, folder, "ruin.png", _png("yellow"))
        assert _replace(client, admin_headers, folder, "ruin.png", _png("yellow")).status_code == 200
        assert _thumb("maps", m.filepath)
        with patch("backend.indexer.generate_thumbnail", return_value=False):
            assert _replace(client, admin_headers, folder, "ruin.png", _png("navy")).status_code == 200
        assert _thumb("maps", m.filepath) == []
        assert _get(GenericMap, m.id).has_thumbnail is False

    @pytest.mark.parametrize("folder", ["maps"], indirect=True)
    def test_unindexed_map_is_a_409(self, client, admin_headers, folder):
        with open(os.path.join(LIB, folder, "loose.png"), "wb") as f:
            f.write(_png("gray"))
        resp = _replace(client, admin_headers, folder, "loose.png", _png("red"))
        assert resp.status_code == 409
        assert "no indexed map named 'loose.png'" in resp.json()["detail"]

    @pytest.mark.parametrize("folder", ["maps"], indirect=True)
    def test_refused_while_a_scan_runs(self, client, admin_headers, folder):
        original = _png("orange")
        _place(make_map, folder, "busy.png", original)
        with patch.object(runner, "scan_in_progress", return_value=True):
            resp = _replace(client, admin_headers, folder, "busy.png", _png("red"))
        assert resp.status_code == 409
        with open(os.path.join(LIB, folder, "busy.png"), "rb") as f:
            assert f.read() == original

    @pytest.mark.parametrize("folder", ["maps"], indirect=True)
    def test_accepted_while_only_the_book_reindex_runs(self, client, admin_headers, folder):
        """The re-index queue reads books alone, so it never blocks a media replace."""
        from backend.services.library_scan import reindex_queue

        _place(make_map, folder, "quiet.png", _png("orange"))
        with (
            patch.object(runner, "scan_in_progress", return_value=True),
            patch.object(reindex_queue, "reindex_running", return_value=True),
        ):
            resp = _replace(client, admin_headers, folder, "quiet.png", _png("red"))
        assert resp.status_code == 200

    @pytest.mark.parametrize("folder", ["maps"], indirect=True)
    def test_a_failed_re_read_still_reports_the_saved_file(self, client, admin_headers, folder):
        m = _place(make_map, folder, "boom.png", _png("orange"))
        with patch(
            "backend.routers.files.replace.refresh_media_file", side_effect=RuntimeError("boom")
        ):
            resp = _replace(client, admin_headers, folder, "boom.png", _png("red"))
        assert resp.status_code == 200
        assert resp.json()["record_id"] == m.id
        with open(os.path.join(LIB, folder, "boom.png"), "rb") as f:
            assert f.read() == _png("red")


class TestReplaceToken:
    @pytest.mark.parametrize("folder", ["tokens"], indirect=True)
    def test_rereads_size_hash_and_thumbnail(self, client, admin_headers, folder):
        t = _place(make_token, folder, "goblin.png", _png("green"), description="Sneaky")
        new = _png("red", size=(120, 120))
        resp = _replace(client, admin_headers, folder, "goblin.png", new)
        assert resp.status_code == 200, resp.text
        assert resp.json()["record_type"] == "token"
        row = _get(Token, t.id)
        assert row.description == "Sneaky"
        assert row.file_size == len(new)
        assert row.content_hash
        assert row.has_thumbnail
        assert len(_thumb("tokens", row.filepath)) == 1


class TestReplaceModel:
    @pytest.mark.parametrize("folder", ["models"], indirect=True)
    def test_rereads_the_triangle_count_and_renders(self, client, admin_headers, folder):
        m = _place(make_model3d, folder, "ogre.stl", _stl(1), is_supported=False)
        with patch("backend.indexer.generate_thumbnail", return_value=True) as gen:
            resp = _replace(client, admin_headers, folder, "ogre.stl", _stl(3))
        assert resp.status_code == 200, resp.text
        assert resp.json()["record_type"] == "model"
        gen.assert_called_once()
        row = _get(Model3D, m.id)
        assert row.triangle_count == 3
        assert row.has_thumbnail
        assert row.thumbnail_pending is False
        # The presupported flag is the user's to correct, not the file's.
        assert row.is_supported is False

    @pytest.mark.parametrize("folder", ["models"], indirect=True)
    def test_a_heavy_mesh_waits_for_the_preview_queue(self, client, admin_headers, folder):
        from backend.indexer.stl_render import INLINE_TRIANGLE_BUDGET

        m = _place(make_model3d, folder, "dragon.stl", _stl(1), has_thumbnail=True)
        heavy = INLINE_TRIANGLE_BUDGET + 1
        # Counted from the header, without writing ~100 MB of facets to disk.
        with (
            patch("backend.indexer.stl_render.triangle_count", return_value=heavy),
            patch("backend.indexer.generate_thumbnail") as gen,
        ):
            assert _replace(client, admin_headers, folder, "dragon.stl", _stl(2)).status_code == 200
        gen.assert_not_called()
        row = _get(Model3D, m.id)
        assert row.triangle_count == INLINE_TRIANGLE_BUDGET + 1
        assert row.thumbnail_pending is True
        assert row.has_thumbnail is False

    @pytest.mark.parametrize("folder", ["models"], indirect=True)
    def test_a_missed_inline_render_is_deferred(self, client, admin_headers, folder):
        m = _place(make_model3d, folder, "imp.stl", _stl(1))
        with patch("backend.indexer.generate_thumbnail", return_value=False):
            assert _replace(client, admin_headers, folder, "imp.stl", _stl(2)).status_code == 200
        assert _get(Model3D, m.id).thumbnail_pending is True


class TestReplaceAudio:
    @pytest.mark.parametrize("folder", ["audio"], indirect=True)
    def test_rereads_the_duration_and_keeps_the_listing(self, client, admin_headers, folder):
        a = _place(
            make_audio,
            folder,
            "tavern.wav",
            _wav(800),
            title="Tavern Night",
            artist="Bardcore",
            duration=0.1,
            has_artwork=True,
        )
        resp = _replace(client, admin_headers, folder, "tavern.wav", _wav(16000))
        assert resp.status_code == 200, resp.text
        assert resp.json()["record_type"] == "audio"
        row = _get(Audio, a.id)
        assert row.duration == pytest.approx(2.0, abs=0.05)
        assert row.title == "Tavern Night"
        assert row.artist == "Bardcore"
        # The new file has no art of its own, and there is no folder cover.
        assert row.has_artwork is False

    @pytest.mark.parametrize("folder", ["audio"], indirect=True)
    def test_a_cover_set_in_the_ui_still_counts(self, client, admin_headers, folder):
        a = _place(make_audio, folder, "storm.wav", _wav(800), cover_image="storm.jpg")
        assert _replace(client, admin_headers, folder, "storm.wav", _wav(1600)).status_code == 200
        assert _get(Audio, a.id).has_artwork is True

    @pytest.mark.parametrize("folder", ["audio"], indirect=True)
    def test_unindexed_audio_names_what_it_looked_for(self, client, admin_headers, folder):
        with open(os.path.join(LIB, folder, "loose.wav"), "wb") as f:
            f.write(_wav(800))
        resp = _replace(client, admin_headers, folder, "loose.wav", _wav(800))
        assert resp.status_code == 409
        assert "no indexed audio file named" in resp.json()["detail"]


class TestRefreshMediaFile:
    def test_refuses_a_books_tree(self):
        with pytest.raises(ValueError):
            refresh_media_file("books", object(), THUMB_DIR)

    def test_an_archived_track_is_left_alone(self, tmp_path):
        path = tmp_path / "set.zip"
        path.write_bytes(b"PK")

        class Row:
            filename = "set.zip"
            filepath = str(path)
            duration = 12.0
            has_artwork = True

        row = Row()
        refresh_media_file("audio", row, str(tmp_path))
        assert row.duration == 12.0
        assert row.has_artwork is True


class TestInvalidateMapRenders:
    def test_purges_the_path_keyed_caches(self):
        filepath = os.path.join(LIB, "maps", "Odd [1] *name?.pdf")
        prefix = f"map_{content_cache.page_cache_prefix(filepath)}_"
        os.makedirs(PAGE_CACHE_DIR, exist_ok=True)
        ours = os.path.join(PAGE_CACHE_DIR, f"{prefix}1_1600.webp")
        theirs = os.path.join(PAGE_CACHE_DIR, "map_0000000000000000_1_1600.webp")
        for p in (ours, theirs):
            with open(p, "wb") as f:
                f.write(b"webp")
        try:
            with (
                patch.object(content_cache, "purge_valkey_keys") as purge,
                patch("backend.render.pool.evict") as evict,
            ):
                content_cache.invalidate_map_renders(filepath)
            patterns = [c.args[0] for c in purge.call_args_list]
            escaped = filepath.replace("[", "\\[").replace("]", "\\]")
            escaped = escaped.replace("*", "\\*").replace("?", "\\?")
            assert patterns == [f"mappreview:{escaped}:*", f"mappage:{escaped}:*"]
            evict.assert_called_once_with(filepath)
            assert not os.path.exists(ours)
            assert os.path.exists(theirs)
        finally:
            for p in (ours, theirs):
                if os.path.exists(p):
                    os.remove(p)

    def test_a_cache_failure_is_not_raised(self):
        with (
            patch.object(content_cache, "purge_valkey_keys", side_effect=RuntimeError("down")),
            patch("backend.render.pool.evict", side_effect=RuntimeError("gone")),
            patch("backend.services.content_cache.os.scandir", side_effect=OSError("no")),
        ):
            content_cache.invalidate_map_renders("/library/maps/x.png")
