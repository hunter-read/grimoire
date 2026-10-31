"""Custom book covers - upload, set from an existing image, remove, and every
place the cover is read (thumbnail route, OPDS, Codex push, image picker,
sidecar export, delete and cleanup paths).
"""
import hashlib
import io
import os
import time

import pytest
from PIL import Image

from backend.config import BOOK_COVER_DIR, THUMB_DIR, SessionLocal
from backend.indexer import slugify
from backend.models import Book
from backend.routers.books import covers as cover_routes
from backend.services.books import covers
from backend.tests.conftest import make_book, make_game_system


def _image_bytes(fmt="PNG", size=(30, 40), color=(120, 90, 200), mode="RGB", **save) -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, color).save(buf, fmt, **save)
    return buf.getvalue()


def _generated_thumb(book: Book) -> str:
    fhash = hashlib.md5(book.filepath.encode()).hexdigest()[:8]
    return os.path.join(THUMB_DIR, "books", f"{slugify(book.title)}_{fhash}.webp")


def _write_generated(book: Book, color=(10, 200, 10)) -> str:
    path = _generated_thumb(book)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(_image_bytes("WEBP", color=color))
    return path


def _load(book_id: str) -> Book:
    db = SessionLocal()
    try:
        book = db.query(Book).filter_by(id=book_id).first()
        db.expunge(book)
        return book
    finally:
        db.close()


def _upload(client, headers, book_id, data=None, name="cover.png", ctype="image/png"):
    return client.post(
        f"/api/books/{book_id}/cover",
        files={"file": (name, data if data is not None else _image_bytes(), ctype)},
        headers=headers,
    )


def _stored(book_id: str) -> list[str]:
    if not os.path.isdir(BOOK_COVER_DIR):
        return []
    return sorted(n for n in os.listdir(BOOK_COVER_DIR) if n.startswith(book_id))


@pytest.fixture
def book():
    system = make_game_system()
    return make_book(system.id, has_thumbnail=True)


class TestUpload:
    def test_stores_a_webp_and_reports_it(self, client, admin_headers, book):
        resp = _upload(client, admin_headers, book.id)
        assert resp.status_code == 200
        body = resp.json()
        assert body["has_custom_cover"] is True
        assert body["has_thumbnail"] is True
        assert body["cover_version"]
        assert body["cover_image"] == f"{book.id}_{body['cover_version']}.webp"
        assert _stored(book.id) == [body["cover_image"]]
        with Image.open(os.path.join(BOOK_COVER_DIR, body["cover_image"])) as img:
            assert img.format == "WEBP"

    def test_a_large_image_is_bounded_to_the_cover_size(self, client, admin_headers, book):
        resp = _upload(client, admin_headers, book.id, _image_bytes("JPEG", size=(1800, 2400)),
                       name="big.jpg", ctype="image/jpeg")
        assert resp.status_code == 200
        with Image.open(os.path.join(BOOK_COVER_DIR, resp.json()["cover_image"])) as img:
            assert img.size == (covers.COVER_MAX_WIDTH, 1200)

    def test_gm_may_upload(self, client, gm_headers, book):
        assert _upload(client, gm_headers, book.id).status_code == 200

    def test_player_may_not(self, client, player_headers, book):
        assert _upload(client, player_headers, book.id).status_code == 403
        assert _stored(book.id) == []

    def test_unauthenticated_is_refused(self, client, book):
        assert _upload(client, {}, book.id).status_code == 401

    def test_unknown_book_is_404(self, client, admin_headers):
        assert _upload(client, admin_headers, "no-such-book").status_code == 404

    def test_rejects_a_non_image_content_type(self, client, admin_headers, book):
        resp = _upload(client, admin_headers, book.id, b"text", name="a.txt", ctype="text/plain")
        assert resp.status_code == 400

    def test_rejects_bytes_that_are_not_an_image(self, client, admin_headers, book):
        resp = _upload(client, admin_headers, book.id, b"definitely not a png")
        assert resp.status_code == 400
        assert _stored(book.id) == []

    def test_rejects_a_format_uploads_do_not_take(self, client, admin_headers, book):
        """A BMP sent as image/png is not one of the upload formats."""
        resp = _upload(client, admin_headers, book.id, _image_bytes("BMP"))
        assert resp.status_code == 400

    def test_rejects_an_empty_file(self, client, admin_headers, book):
        assert _upload(client, admin_headers, book.id, b"").status_code == 400

    def test_rejects_a_file_over_the_limit(self, client, admin_headers, book, monkeypatch):
        monkeypatch.setattr(cover_routes, "_MAX_COVER_BYTES", 10)
        assert _upload(client, admin_headers, book.id).status_code == 413

    def test_replacing_keeps_only_the_new_file(self, client, admin_headers, book):
        first = _upload(client, admin_headers, book.id, _image_bytes(color=(1, 2, 3))).json()
        second = _upload(client, admin_headers, book.id, _image_bytes(color=(200, 2, 3))).json()
        assert first["cover_version"] != second["cover_version"]
        assert _stored(book.id) == [second["cover_image"]]


class TestFromSource:
    def test_copies_another_books_cover(self, client, admin_headers, book):
        source = make_book(book.game_system_id, has_thumbnail=True)
        _write_generated(_load(source.id))
        resp = client.post(
            f"/api/books/{book.id}/cover/from-source",
            json={"source_type": "book", "source_id": source.id},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["has_custom_cover"] is True
        assert _stored(book.id) == [resp.json()["cover_image"]]

    def test_rejects_a_campaign_file_source(self, client, admin_headers, book):
        resp = client.post(
            f"/api/books/{book.id}/cover/from-source",
            json={"source_type": "campaign_file", "source_id": "x"},
            headers=admin_headers,
        )
        assert resp.status_code == 422

    def test_player_may_not(self, client, player_headers, book):
        resp = client.post(
            f"/api/books/{book.id}/cover/from-source",
            json={"source_type": "book", "source_id": book.id},
            headers=player_headers,
        )
        assert resp.status_code == 403


class TestDelete:
    def test_removes_the_file_and_resets_the_book(self, client, admin_headers, book):
        _upload(client, admin_headers, book.id)
        resp = client.delete(f"/api/books/{book.id}/cover", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json() == {
            "cover_image": "",
            "has_custom_cover": False,
            "cover_version": None,
            "has_thumbnail": True,
        }
        assert _stored(book.id) == []
        assert _load(book.id).cover_image == ""

    def test_reports_no_cover_when_none_was_generated(self, client, admin_headers):
        bare = make_book(make_game_system().id, has_thumbnail=False)
        _upload(client, admin_headers, bare.id)
        resp = client.delete(f"/api/books/{bare.id}/cover", headers=admin_headers)
        assert resp.json()["has_thumbnail"] is False

    def test_player_may_not(self, client, player_headers, book):
        assert client.delete(f"/api/books/{book.id}/cover", headers=player_headers).status_code == 403


class TestPayloads:
    def test_detail_reports_the_custom_cover(self, client, admin_headers, book):
        before = client.get(f"/api/books/{book.id}", headers=admin_headers).json()
        assert before["has_custom_cover"] is False
        assert before["cover_version"] is None
        version = _upload(client, admin_headers, book.id).json()["cover_version"]
        after = client.get(f"/api/books/{book.id}", headers=admin_headers).json()
        assert after["has_custom_cover"] is True
        assert after["cover_version"] == version

    def test_a_custom_cover_counts_as_a_thumbnail(self, client, admin_headers):
        bare = make_book(make_game_system().id, has_thumbnail=False)
        _upload(client, admin_headers, bare.id)
        detail = client.get(f"/api/books/{bare.id}", headers=admin_headers).json()
        assert detail["has_thumbnail"] is True

    def test_list_and_system_rows_carry_the_version(self, client, admin_headers, book):
        version = _upload(client, admin_headers, book.id).json()["cover_version"]
        listed = client.get(
            "/api/books", params={"system_id": book.game_system_id}, headers=admin_headers
        ).json()["books"]
        row = next(b for b in listed if b["id"] == book.id)
        assert row["cover_version"] == version
        system = client.get(f"/api/systems/{book.game_system_id}", headers=admin_headers).json()
        srow = next(b for b in system["books"] if b["id"] == book.id)
        assert srow["has_custom_cover"] is True
        assert srow["cover_version"] == version


class TestThumbnailRoute:
    def test_serves_the_custom_cover_over_the_generated_one(self, client, admin_headers, book):
        _write_generated(_load(book.id))
        generated = client.get(f"/api/books/{book.id}/thumbnail", headers=admin_headers)
        assert generated.status_code == 200

        name = _upload(client, admin_headers, book.id).json()["cover_image"]
        custom = client.get(f"/api/books/{book.id}/thumbnail", headers=admin_headers)
        assert custom.status_code == 200
        with open(os.path.join(BOOK_COVER_DIR, name), "rb") as fh:
            assert custom.content == fh.read()
        assert custom.headers["etag"] != generated.headers["etag"]

        client.delete(f"/api/books/{book.id}/cover", headers=admin_headers)
        back = client.get(f"/api/books/{book.id}/thumbnail", headers=admin_headers)
        assert back.content == generated.content
        assert back.headers["etag"] == generated.headers["etag"]

    def test_etag_follows_the_cover_and_revalidates(self, client, admin_headers, book):
        first = _upload(client, admin_headers, book.id, _image_bytes(color=(9, 9, 9))).json()
        resp = client.get(f"/api/books/{book.id}/thumbnail", headers=admin_headers)
        etag = resp.headers["etag"]
        assert first["cover_version"] in etag
        cached = client.get(
            f"/api/books/{book.id}/thumbnail", headers={**admin_headers, "If-None-Match": etag}
        )
        assert cached.status_code == 304

        _upload(client, admin_headers, book.id, _image_bytes(color=(250, 9, 9)))
        stale = client.get(
            f"/api/books/{book.id}/thumbnail", headers={**admin_headers, "If-None-Match": etag}
        )
        assert stale.status_code == 200

    def test_404_with_no_cover_at_all(self, client, admin_headers):
        bare = make_book(make_game_system().id)
        resp = client.get(f"/api/books/{bare.id}/thumbnail", headers=admin_headers)
        assert resp.status_code == 404


class TestService:
    def test_version_and_paths_without_a_cover(self):
        book = Book(id="b0", filepath="/nowhere/x.pdf", title="X", cover_image="")
        assert covers.cover_version(book) is None
        assert covers.custom_cover_path(book) is None
        assert covers.has_custom_cover(book) is False
        assert covers.book_cover_path(book) is None

    def test_a_named_but_missing_file_falls_back(self):
        book = Book(id="b1", filepath="/nowhere/y.pdf", title="Y", cover_image="b1_dead.webp")
        assert covers.cover_version(book) == "dead"
        assert covers.custom_cover_path(book) is None

    def test_generated_thumbnail_found_after_a_rename(self, book):
        loaded = _load(book.id)
        path = _write_generated(loaded)
        loaded.title = "A Title It Was Never Indexed Under"
        assert covers.generated_thumbnail_path(loaded) == path

    def test_encode_applies_exif_rotation(self):
        exif = Image.Exif()
        exif[0x0112] = 6  # rotate 90 degrees clockwise to display
        data = _image_bytes("JPEG", size=(40, 20), exif=exif.tobytes())
        with Image.open(io.BytesIO(covers.encode_cover(data))) as img:
            assert img.size == (20, 40)

    def test_encode_keeps_transparency(self):
        data = _image_bytes("PNG", mode="RGBA", color=(0, 0, 0, 0))
        with Image.open(io.BytesIO(covers.encode_cover(data))) as img:
            assert img.mode == "RGBA"

    def test_encode_keeps_palette_transparency(self):
        img = Image.new("P", (8, 8), 0)
        buf = io.BytesIO()
        img.save(buf, "GIF", transparency=0)
        with Image.open(io.BytesIO(covers.encode_cover(buf.getvalue()))) as out:
            assert out.mode == "RGBA"

    def test_encode_rejects_an_oversized_image(self, monkeypatch):
        monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 10)
        with pytest.raises(covers.CoverImageError):
            covers.encode_cover(_image_bytes(size=(30, 40)))

    def test_remove_cover_files_without_a_directory(self, monkeypatch, tmp_path):
        monkeypatch.setattr(covers, "BOOK_COVER_DIR", str(tmp_path / "absent"))
        assert covers.remove_cover_files("b1") == 0
        assert covers.prune_orphan_covers(SessionLocal()) == 0

    def test_remove_cover_files_reports_a_failure(self, monkeypatch, tmp_path, caplog):
        monkeypatch.setattr(covers, "BOOK_COVER_DIR", str(tmp_path))
        (tmp_path / "b9_aaa.webp").write_bytes(b"x")

        def refuse(_path):
            raise OSError("read-only")

        monkeypatch.setattr(covers.os, "remove", refuse)
        assert covers.remove_cover_files("b9") == 0
        assert "Failed to remove book cover" in caplog.text

    def test_a_failed_write_leaves_no_temp_file(self, monkeypatch, tmp_path):
        monkeypatch.setattr(covers, "BOOK_COVER_DIR", str(tmp_path))

        def boom(_src, _dst):
            raise OSError("disk full")

        monkeypatch.setattr(covers.os, "replace", boom)
        book = Book(id="b5", filepath="/x.pdf", title="T", cover_image="")
        with pytest.raises(OSError):
            covers.store_cover(book, _image_bytes())
        assert os.listdir(tmp_path) == []
        assert book.cover_image == ""

    def test_prune_removes_only_old_orphans(self, monkeypatch, tmp_path, book):
        monkeypatch.setattr(covers, "BOOK_COVER_DIR", str(tmp_path))
        db = SessionLocal()
        try:
            row = db.query(Book).filter_by(id=book.id).first()
            row.cover_image = f"{book.id}_live.webp"
            db.commit()
            old = time.time() - 3600
            for name in (f"{book.id}_live.webp", "gone_old.webp"):
                (tmp_path / name).write_bytes(b"x")
                os.utime(tmp_path / name, (old, old))
            (tmp_path / "gone_new.webp").write_bytes(b"x")
            (tmp_path / "subdir").mkdir()
            assert covers.prune_orphan_covers(db) == 1
            assert sorted(os.listdir(tmp_path)) == [f"{book.id}_live.webp", "gone_new.webp", "subdir"]
        finally:
            db.query(Book).filter_by(id=book.id).update({"cover_image": ""})
            db.commit()
            db.close()

    def test_prune_reports_a_failure(self, monkeypatch, tmp_path, caplog):
        monkeypatch.setattr(covers, "BOOK_COVER_DIR", str(tmp_path))
        (tmp_path / "orphan.webp").write_bytes(b"x")
        old = time.time() - 3600
        os.utime(tmp_path / "orphan.webp", (old, old))

        def refuse(_path):
            raise OSError("read-only")

        monkeypatch.setattr(covers.os, "remove", refuse)
        db = SessionLocal()
        try:
            assert covers.prune_orphan_covers(db) == 0
        finally:
            db.close()
        assert "Failed to remove orphaned book cover" in caplog.text


class TestConsumers:
    def test_codex_push_sends_the_custom_cover(self, client, admin_headers, book, monkeypatch):
        from backend.routers.codex import _covers

        def no_render(*_a, **_k):
            raise AssertionError("a custom cover must not be replaced by a page render")

        monkeypatch.setattr(_covers.render_pool, "render_page", no_render)
        name = _upload(client, admin_headers, book.id).json()["cover_image"]
        loaded = _load(book.id)
        loaded.mime_type = "application/pdf"
        cover = _covers._book_cover(loaded)
        with open(os.path.join(BOOK_COVER_DIR, name), "rb") as fh:
            data = fh.read()
        assert cover.data == data
        assert cover.content_type == "image/webp"
        assert cover.sha256 == hashlib.sha256(data).hexdigest()

    def test_opds_and_image_picker_read_the_custom_cover(self, client, admin_headers, book):
        from backend.routers.books.core import book_thumbnail_path
        from backend.services import image_source

        _write_generated(_load(book.id))
        name = _upload(client, admin_headers, book.id).json()["cover_image"]
        loaded = _load(book.id)
        expected = os.path.join(BOOK_COVER_DIR, name)
        assert book_thumbnail_path(loaded) == expected
        assert image_source._book_thumb_path(loaded) == expected

    def test_sidecar_export_copies_the_custom_cover(self, client, admin_headers, book):
        from backend.metadata import export

        name = _upload(client, admin_headers, book.id).json()["cover_image"]
        assert export._thumbnail_source(_load(book.id)) == os.path.join(BOOK_COVER_DIR, name)

    def test_deleting_a_book_record_removes_its_cover(self, client, admin_headers, book):
        from backend.services.library_fs import deletes

        _upload(client, admin_headers, book.id)
        db = SessionLocal()
        try:
            row = db.query(Book).filter_by(id=book.id).first()
            deletes.delete_record(db, Book, row, delete_file=False)
            db.commit()
        finally:
            db.close()
        assert _stored(book.id) == []

    def test_staged_deletes_remove_the_cover(self, client, admin_headers, book):
        from backend.services.library_fs import deletes

        _upload(client, admin_headers, book.id)
        db = SessionLocal()
        try:
            row = db.query(Book).filter_by(id=book.id).first()
            staged = deletes.delete_records(db, Book, [row], delete_files=False)
            db.commit()
        finally:
            db.close()
        assert _stored(book.id) != []  # the files follow only once the commit is in
        deletes.finish_deletes(staged)
        assert _stored(book.id) == []

    def test_cleanup_prunes_orphaned_covers(self, monkeypatch):
        from backend.services import library_cleanup

        called = []
        monkeypatch.setattr(library_cleanup, "prune_orphan_covers", lambda db: called.append(db) or 0)
        db = SessionLocal()
        try:
            library_cleanup.do_cleanup(db)
        finally:
            db.close()
        assert len(called) == 1

    def test_a_rescan_of_the_book_keeps_the_custom_cover(self, client, admin_headers, tmp_path):
        """Regenerating the thumbnail writes under THUMB_DIR and never touches the cover."""
        from backend.indexer import text_index

        page = tmp_path / "scan.png"
        page.write_bytes(_image_bytes(size=(60, 80)))
        image_book = make_book(
            make_game_system().id, filepath=str(page), filename="scan.png", mime_type="image/png"
        )
        name = _upload(client, admin_headers, image_book.id).json()["cover_image"]
        db = SessionLocal()
        try:
            row = db.query(Book).filter_by(id=image_book.id).first()
            text_index.refresh_book_file(row, os.path.dirname(THUMB_DIR), db)
            db.commit()
        finally:
            db.close()
        refreshed = _load(image_book.id)
        assert refreshed.has_thumbnail is True
        assert os.path.isfile(_generated_thumb(refreshed))
        assert _stored(image_book.id) == [name]
        assert refreshed.cover_image == name
        served = client.get(f"/api/books/{image_book.id}/thumbnail", headers=admin_headers)
        with open(os.path.join(BOOK_COVER_DIR, name), "rb") as fh:
            assert served.content == fh.read()
