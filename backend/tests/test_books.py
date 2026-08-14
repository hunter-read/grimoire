"""Tests for book listing and metadata endpoints.

PDF rendering and page endpoints are not tested here since they require
actual PDF files on disk. Those are better suited for integration tests.
"""
import os
import tempfile
import pytest
from backend.tests.conftest import make_game_system, make_book


@pytest.fixture(scope="module")
def system():
    return make_game_system()


@pytest.fixture(scope="module")
def book(system):
    return make_book(
        system_id=system.id,
        title="Player's Handbook",
        category="core",
        description="The core rulebook.",
        page_count=320,
    )


class TestListBooks:
    def test_returns_list(self, client, admin_headers, book):
        resp = client.get("/api/books", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "books" in body
        assert "total" in body

    def test_contains_created_book(self, client, admin_headers, book):
        resp = client.get("/api/books", headers=admin_headers)
        ids = [b["id"] for b in resp.json()["books"]]
        assert book.id in ids

    def test_list_includes_index_failed_field(self, client, admin_headers, book):
        resp = client.get("/api/books", headers=admin_headers)
        assert resp.status_code == 200
        books = resp.json()["books"]
        assert len(books) > 0
        assert all("index_failed" in b for b in books)

    def test_list_includes_is_missing_field(self, client, admin_headers, book):
        resp = client.get("/api/books", headers=admin_headers)
        assert resp.status_code == 200
        books = resp.json()["books"]
        assert len(books) > 0
        assert all("is_missing" in b for b in books)
        assert all(isinstance(b["is_missing"], bool) for b in books)

    def test_filter_by_category(self, client, admin_headers, book):
        resp = client.get("/api/books?category=core", headers=admin_headers)
        assert resp.status_code == 200
        books = resp.json()["books"]
        assert all(b["category"] == "core" for b in books)

    def test_pagination(self, client, admin_headers, book):
        resp = client.get("/api/books?limit=1&offset=0", headers=admin_headers)
        assert resp.status_code == 200
        assert len(resp.json()["books"]) <= 1

    def test_player_can_list_books(self, client, player_headers, book):
        resp = client.get("/api/books", headers=player_headers)
        assert resp.status_code == 200

    def test_unauthenticated_denied(self, client):
        resp = client.get("/api/books")
        assert resp.status_code == 401


class TestGetBook:
    def test_get_existing_book(self, client, admin_headers, book):
        resp = client.get(f"/api/books/{book.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == book.id
        assert body["title"] == "Player's Handbook"
        assert body["category"] == "core"
        assert body["page_count"] == 320

    def test_get_book_includes_index_failed(self, client, admin_headers, book):
        resp = client.get(f"/api/books/{book.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "index_failed" in body
        assert isinstance(body["index_failed"], bool)
        assert body["index_failed"] is False

    def test_get_book_includes_is_missing(self, client, admin_headers, book):
        resp = client.get(f"/api/books/{book.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "is_missing" in body
        assert isinstance(body["is_missing"], bool)
        assert body["is_missing"] is False

    def test_get_nonexistent_book(self, client, admin_headers):
        resp = client.get("/api/books/does-not-exist", headers=admin_headers)
        assert resp.status_code == 404

    def test_player_can_get_book(self, client, player_headers, book):
        resp = client.get(f"/api/books/{book.id}", headers=player_headers)
        assert resp.status_code == 200


class TestUpdateBook:
    def test_gm_can_update_metadata(self, client, gm_headers, book):
        resp = client.patch(
            f"/api/books/{book.id}",
            json={
                "description": "Updated rulebook description",
                "publisher": "Wizards of the Coast",
            },
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_admin_can_update_metadata(self, client, admin_headers, book):
        resp = client.patch(
            f"/api/books/{book.id}",
            json={
                "title": "Player's Handbook (Revised)",
                "category": "core",
                "authors": ["Jeremy Crawford"],
            },
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_player_cannot_update(self, client, player_headers, book):
        resp = client.patch(
            f"/api/books/{book.id}",
            json={
                "description": "Player sneaks in a change",
            },
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_update_nonexistent_book(self, client, admin_headers):
        resp = client.patch(
            "/api/books/ghost-book",
            json={
                "title": "Ghost",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 404


class TestReindexBook:
    """POST /api/books/{id}/reindex — per-book re-OCR with optional DPI override."""

    def _make_ocr_book(self, system_id, index_error="ocr"):
        """A real on-disk PDF book flagged as OCR-sourced, with a search row."""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b"%PDF-1.4\n%stub\n")
            fpath = f.name
        book = make_book(
            system_id=system_id,
            title="Scanned Book",
            filename="scanned.pdf",
            filepath=fpath,
            mime_type="application/pdf",
            page_count=3,
            indexed=True,
            index_error=index_error,
        )
        # Seed a search row so we can assert it gets cleared.
        from backend.config import SessionLocal
        from sqlalchemy import text as _text

        db = SessionLocal()
        try:
            db.execute(
                _text(
                    "INSERT INTO book_search (book_id, page_number, content) "
                    "VALUES (:b, 1, 'old text')"
                ),
                {"b": book.id},
            )
            db.commit()
        finally:
            db.close()
        return book, fpath

    @pytest.fixture(scope="module")
    def sys(self):
        return make_game_system()

    def _search_count(self, book_id):
        from backend.config import SessionLocal
        from sqlalchemy import text as _text

        db = SessionLocal()
        try:
            return db.execute(
                _text("SELECT COUNT(*) FROM book_search WHERE book_id = :b"),
                {"b": book_id},
            ).scalar()
        finally:
            db.close()

    def _book_row(self, book_id):
        from backend.config import SessionLocal
        from backend.models import Book

        db = SessionLocal()
        try:
            b = db.get(Book, book_id)
            return {
                "ocr_pending": b.ocr_pending,
                "ocr_pages_done": b.ocr_pages_done,
                "ocr_dpi": b.ocr_dpi,
                "indexed": b.indexed,
                "index_error": b.index_error,
            }
        finally:
            db.close()

    def test_requeues_and_clears_index(self, client, admin_headers, sys):
        from unittest.mock import patch as _patch

        book, fpath = self._make_ocr_book(sys.id)
        try:
            with _patch(
                "backend.routers.library._helpers.trigger_ocr_queue"
            ) as m:
                resp = client.post(f"/api/books/{book.id}/reindex", headers=admin_headers)
            assert resp.status_code == 200
            assert resp.json() == {"status": "reindex_queued", "ocr_dpi": None}
            assert m.called  # background drain was scheduled
            assert self._search_count(book.id) == 0  # old index cleared
            row = self._book_row(book.id)
            assert row["ocr_pending"] is True
            assert row["ocr_pages_done"] == 0
            assert row["ocr_dpi"] is None
            assert row["indexed"] is False
            assert row["index_error"] == ""
        finally:
            os.unlink(fpath)

    def test_dpi_override_stored(self, client, admin_headers, sys):
        from unittest.mock import patch as _patch

        book, fpath = self._make_ocr_book(sys.id)
        try:
            with _patch("backend.routers.library._helpers.trigger_ocr_queue"):
                resp = client.post(
                    f"/api/books/{book.id}/reindex?ocr_dpi=300", headers=admin_headers
                )
            assert resp.status_code == 200
            assert resp.json()["ocr_dpi"] == 300
            assert self._book_row(book.id)["ocr_dpi"] == 300
        finally:
            os.unlink(fpath)

    def test_dpi_out_of_range_rejected(self, client, admin_headers, sys):
        from unittest.mock import patch as _patch

        book, fpath = self._make_ocr_book(sys.id)
        try:
            with _patch("backend.routers.library._helpers.trigger_ocr_queue"):
                too_high = client.post(
                    f"/api/books/{book.id}/reindex?ocr_dpi=9000", headers=admin_headers
                )
                too_low = client.post(
                    f"/api/books/{book.id}/reindex?ocr_dpi=10", headers=admin_headers
                )
            assert too_high.status_code == 422
            assert too_low.status_code == 422
        finally:
            os.unlink(fpath)

    def test_text_layer_book_rejected(self, client, admin_headers, sys):
        # A natively-indexed book (index_error == "") has no OCR to redo.
        book, fpath = self._make_ocr_book(sys.id, index_error="")
        try:
            resp = client.post(f"/api/books/{book.id}/reindex", headers=admin_headers)
            assert resp.status_code == 400
        finally:
            os.unlink(fpath)

    def test_player_cannot_reindex(self, client, player_headers, sys):
        book, fpath = self._make_ocr_book(sys.id)
        try:
            resp = client.post(f"/api/books/{book.id}/reindex", headers=player_headers)
            assert resp.status_code == 403
        finally:
            os.unlink(fpath)

    def test_nonexistent_book(self, client, admin_headers):
        resp = client.post("/api/books/ghost/reindex", headers=admin_headers)
        assert resp.status_code == 404

    def test_missing_file_rejected(self, client, admin_headers, sys):
        book, fpath = self._make_ocr_book(sys.id)
        os.unlink(fpath)  # remove the file before the call
        resp = client.post(f"/api/books/{book.id}/reindex", headers=admin_headers)
        assert resp.status_code == 404


class TestRescanBook:
    """POST /api/books/{id}/rescan — general per-book re-read & re-index."""

    def _make_pdf_book(self, system_id, index_error=""):
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b"%PDF-1.4\n%stub\n")
            fpath = f.name
        book = make_book(
            system_id=system_id,
            title="Edited Book",
            filename="edited.pdf",
            filepath=fpath,
            mime_type="application/pdf",
            page_count=3,
            indexed=True,
            index_error=index_error,
        )
        return book, fpath

    @pytest.fixture(scope="module")
    def sys(self):
        return make_game_system()

    def test_queues_rescan_for_text_layer_book(self, client, admin_headers, sys):
        from unittest.mock import patch as _patch

        book, fpath = self._make_pdf_book(sys.id, index_error="")
        try:
            with _patch(
                "backend.routers.library._helpers.rescan_single_book"
            ) as m:
                resp = client.post(f"/api/books/{book.id}/rescan", headers=admin_headers)
            assert resp.status_code == 200
            assert resp.json() == {"status": "rescan_queued"}
            m.assert_called_once_with(book.id)
        finally:
            os.unlink(fpath)

    def test_queues_rescan_for_ocr_book(self, client, admin_headers, sys):
        # Unlike /reindex, /rescan accepts OCR/image-only books too.
        from unittest.mock import patch as _patch

        book, fpath = self._make_pdf_book(sys.id, index_error="ocr")
        try:
            with _patch("backend.routers.library._helpers.rescan_single_book") as m:
                resp = client.post(f"/api/books/{book.id}/rescan", headers=admin_headers)
            assert resp.status_code == 200
            assert m.called
        finally:
            os.unlink(fpath)

    def test_non_pdf_rejected(self, client, admin_headers, sys):
        book = make_book(
            system_id=sys.id,
            title="A Map Archive",
            filename="art.png",
            mime_type="image/png",
        )
        resp = client.post(f"/api/books/{book.id}/rescan", headers=admin_headers)
        assert resp.status_code == 400

    def test_player_cannot_rescan(self, client, player_headers, sys):
        book, fpath = self._make_pdf_book(sys.id)
        try:
            resp = client.post(f"/api/books/{book.id}/rescan", headers=player_headers)
            assert resp.status_code == 403
        finally:
            os.unlink(fpath)

    def test_nonexistent_book(self, client, admin_headers):
        resp = client.post("/api/books/ghost/rescan", headers=admin_headers)
        assert resp.status_code == 404

    def test_missing_file_rejected(self, client, admin_headers, sys):
        book, fpath = self._make_pdf_book(sys.id)
        os.unlink(fpath)
        resp = client.post(f"/api/books/{book.id}/rescan", headers=admin_headers)
        assert resp.status_code == 404


class TestRescanSingleBookHelper:
    """The background helper backend.routers.library._helpers.rescan_single_book."""

    def _make_pdf_book(self, system_id, index_error=""):
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b"%PDF-1.4\n%stub\n")
            fpath = f.name
        book = make_book(
            system_id=system_id,
            title="Helper Book",
            filename="helper.pdf",
            filepath=fpath,
            mime_type="application/pdf",
            page_count=3,
            indexed=True,
            index_error=index_error,
        )
        return book, fpath

    @pytest.fixture(scope="module")
    def sys(self):
        return make_game_system()

    def test_rebuilds_index_via_reindex_single_book(self, sys):
        from unittest.mock import patch as _patch
        from backend.routers.library import _helpers

        book, fpath = self._make_pdf_book(sys.id)
        try:
            with _patch.object(_helpers, "reindex_single_book") as reidx, _patch.object(
                _helpers, "run_ocr_queue"
            ) as drain:
                _helpers.rescan_single_book(book.id)
            assert reidx.called
            # its first positional arg is the freshly-loaded Book
            assert reidx.call_args.args[0].id == book.id
            assert drain.called  # OCR queue drained afterwards
            # status is reset to idle when done
            assert _helpers._get_status()["running"] is False
        finally:
            os.unlink(fpath)

    def test_skips_when_scan_running(self, sys):
        from unittest.mock import patch as _patch
        from backend.routers.library import _helpers

        book, fpath = self._make_pdf_book(sys.id)
        try:
            _helpers._set_status({"running": True})
            try:
                with _patch.object(_helpers, "reindex_single_book") as reidx:
                    _helpers.rescan_single_book(book.id)
                assert not reidx.called  # left for the running scan
            finally:
                _helpers._set_status({"running": False, "phase": None})
        finally:
            os.unlink(fpath)

    def test_missing_book_no_crash(self):
        from unittest.mock import patch as _patch
        from backend.routers.library import _helpers

        with _patch.object(_helpers, "reindex_single_book") as reidx, _patch.object(
            _helpers, "run_ocr_queue"
        ):
            _helpers.rescan_single_book("does-not-exist")
        assert not reidx.called
        assert _helpers._get_status()["running"] is False


class TestImageBookPage:
    IMAGE_TYPES = [
        ("png", "image/png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 8),
        ("jpg", "image/jpeg", b"\xff\xd8\xff\xe0" + b"\x00" * 12),
        ("jpeg", "image/jpeg", b"\xff\xd8\xff\xe0" + b"\x00" * 12),
        ("webp", "image/webp", b"RIFF\x00\x00\x00\x00WEBP"),
        ("gif", "image/gif", b"GIF89a" + b"\x00" * 10),
        ("bmp", "image/bmp", b"BM" + b"\x00" * 10),
    ]

    def _make_image_book(self, system_id, ext, mime_type, content):
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as f:
            f.write(content)
            fpath = f.name
        book = make_book(
            system_id=system_id,
            title=f"Image Book ({ext})",
            filename=f"image.{ext}",
            filepath=fpath,
            mime_type=mime_type,
            page_count=1,
        )
        return book, fpath

    @pytest.fixture(scope="module")
    def sys(self):
        return make_game_system()

    def test_image_book_page1_returns_file(self, client, admin_headers, sys):
        ext, mime_type, content = self.IMAGE_TYPES[0]
        book, fpath = self._make_image_book(sys.id, ext, mime_type, content)
        try:
            resp = client.get(f"/api/books/{book.id}/page/1", headers=admin_headers)
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("image/")
        finally:
            os.unlink(fpath)

    def test_image_book_page_beyond_1_is_400(self, client, admin_headers, sys):
        ext, mime_type, content = self.IMAGE_TYPES[0]
        book, fpath = self._make_image_book(sys.id, ext, mime_type, content)
        try:
            resp = client.get(f"/api/books/{book.id}/page/2", headers=admin_headers)
            assert resp.status_code == 400
        finally:
            os.unlink(fpath)

    def test_all_image_mime_types_served(self, client, admin_headers, sys):
        for ext, mime_type, content in self.IMAGE_TYPES:
            book, fpath = self._make_image_book(sys.id, ext, mime_type, content)
            try:
                resp = client.get(f"/api/books/{book.id}/page/1", headers=admin_headers)
                assert resp.status_code == 200, f"Failed for {ext}: {resp.status_code}"
                assert resp.headers["content-type"].startswith("image/"), f"Wrong content-type for {ext}"
            finally:
                os.unlink(fpath)

    def test_image_book_missing_file_returns_404(self, client, admin_headers, sys):
        book = make_book(
            system_id=sys.id,
            title="Missing Image Book",
            filename="missing.png",
            filepath="/nonexistent/path/missing.png",
            mime_type="image/png",
            page_count=1,
        )
        resp = client.get(f"/api/books/{book.id}/page/1", headers=admin_headers)
        assert resp.status_code == 404

    def test_pdf_book_page_still_404_without_file(self, client, admin_headers, sys):
        book = make_book(
            system_id=sys.id,
            title="Missing PDF",
            filename="missing.pdf",
            filepath="/nonexistent/path/missing.pdf",
            mime_type="application/pdf",
            page_count=10,
        )
        resp = client.get(f"/api/books/{book.id}/page/1", headers=admin_headers)
        assert resp.status_code == 404


class TestServeBookFile:
    """Direct file download endpoint — covers PDFs and archive files (issue #94)."""

    @pytest.fixture(scope="module")
    def sys(self):
        return make_game_system()

    def _make_file_book(self, system_id, suffix, mime_type, content):
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(content)
            fpath = f.name
        book = make_book(
            system_id=system_id,
            title=f"File Book {suffix}",
            filename=f"file{suffix}",
            filepath=fpath,
            mime_type=mime_type,
        )
        return book, fpath

    def test_pdf_file_served(self, client, admin_headers, sys):
        book, fpath = self._make_file_book(sys.id, ".pdf", "application/pdf", b"%PDF-1.4 hi")
        try:
            resp = client.get(f"/api/books/{book.id}/file", headers=admin_headers)
            assert resp.status_code == 200
            assert resp.headers["content-type"] == "application/pdf"
            assert "inline" in resp.headers["content-disposition"]
            # The reader frames this file in a same-origin <iframe> (PDF mode), so
            # the response must relax the global frame-ancestors 'none' to 'self'
            # (which Firefox strictly enforces) while still blocking cross-origin
            # framing. See backend/security.py SAME_ORIGIN_FRAME_HEADERS.
            assert resp.headers["X-Frame-Options"] == "SAMEORIGIN"
            csp = resp.headers["Content-Security-Policy"]
            assert "frame-ancestors 'self'" in csp
            assert "frame-ancestors 'none'" not in csp
        finally:
            os.unlink(fpath)

    def test_archive_file_served(self, client, admin_headers, sys):
        book, fpath = self._make_file_book(
            sys.id, ".zip", "application/zip", b"PK\x03\x04payload"
        )
        try:
            resp = client.get(f"/api/books/{book.id}/file", headers=admin_headers)
            assert resp.status_code == 200
            assert resp.headers["content-type"] == "application/zip"
            assert resp.content == b"PK\x03\x04payload"
        finally:
            os.unlink(fpath)

    def test_nonexistent_book_returns_404(self, client, admin_headers):
        resp = client.get("/api/books/no-such-book/file", headers=admin_headers)
        assert resp.status_code == 404

    def test_missing_file_marks_book_missing(self, client, admin_headers, sys):
        book = make_book(
            system_id=sys.id,
            title="Gone Book",
            filename="gone.zip",
            filepath="/nonexistent/path/gone.zip",
            mime_type="application/zip",
        )
        resp = client.get(f"/api/books/{book.id}/file", headers=admin_headers)
        assert resp.status_code == 404
        detail = client.get(f"/api/books/{book.id}", headers=admin_headers).json()
        assert detail["is_missing"] is True


class TestServeBookThumbnail:
    @pytest.fixture(scope="module")
    def sys(self):
        return make_game_system()

    def test_thumbnail_not_found_returns_404(self, client, admin_headers, sys):
        book = make_book(
            system_id=sys.id,
            title="No Thumb Book",
            filename="nothumb.zip",
            filepath="/tmp/nothumb-unique-xyz.zip",
            mime_type="application/zip",
        )
        resp = client.get(f"/api/books/{book.id}/thumbnail", headers=admin_headers)
        assert resp.status_code == 404

    def test_thumbnail_served_when_present(self, client, admin_headers, sys):
        import hashlib

        from backend.config import THUMB_DIR

        fpath = "/tmp/thumb-present-unique-xyz.cbz"
        book = make_book(
            system_id=sys.id,
            title="Thumb Book",
            filename="thumb.cbz",
            filepath=fpath,
            mime_type="application/vnd.comicbook+zip",
            has_thumbnail=True,
        )
        fhash = hashlib.md5(fpath.encode()).hexdigest()[:8]
        thumb_dir = os.path.join(THUMB_DIR, "books")
        os.makedirs(thumb_dir, exist_ok=True)
        thumb_path = os.path.join(thumb_dir, f"thumb_{fhash}.webp")
        with open(thumb_path, "wb") as f:
            f.write(b"RIFF\x00\x00\x00\x00WEBP")
        try:
            resp = client.get(f"/api/books/{book.id}/thumbnail", headers=admin_headers)
            assert resp.status_code == 200
            assert resp.headers["content-type"] == "image/webp"
        finally:
            os.unlink(thumb_path)

    def test_thumbnail_served_via_reconstructed_filename(self, client, admin_headers, sys):
        # Fast path: when the on-disk file matches "{slugify(title)}_{fhash}.webp"
        # it is served directly without a directory glob.
        import hashlib

        from backend.config import THUMB_DIR

        fpath = "/tmp/thumb-fastpath-unique-xyz.cbz"
        book = make_book(
            system_id=sys.id,
            title="Fast Path Cover",
            filename="fastpath.cbz",
            filepath=fpath,
            mime_type="application/vnd.comicbook+zip",
            has_thumbnail=True,
        )
        fhash = hashlib.md5(fpath.encode()).hexdigest()[:8]
        thumb_dir = os.path.join(THUMB_DIR, "books")
        os.makedirs(thumb_dir, exist_ok=True)
        # slugify("Fast Path Cover") == "fast-path-cover"
        thumb_path = os.path.join(thumb_dir, f"fast-path-cover_{fhash}.webp")
        with open(thumb_path, "wb") as f:
            f.write(b"RIFF\x00\x00\x00\x00WEBP")
        try:
            resp = client.get(f"/api/books/{book.id}/thumbnail", headers=admin_headers)
            assert resp.status_code == 200
            assert resp.headers["content-type"] == "image/webp"
        finally:
            os.unlink(thumb_path)

    def test_thumbnail_nonexistent_book_returns_404(self, client, admin_headers):
        resp = client.get("/api/books/no-such-book/thumbnail", headers=admin_headers)
        assert resp.status_code == 404

    def test_thumbnail_etag_reflects_content_and_revalidates(self, client, admin_headers, sys):
        """The cover is served immutable, so an ETag is the only way a client
        holding the previous cover can learn it is stale."""
        import hashlib

        from backend.config import THUMB_DIR

        fpath = "/tmp/thumb-etag-unique-xyz.cbz"
        book = make_book(
            system_id=sys.id,
            title="Etag Book",
            filename="etag.cbz",
            filepath=fpath,
            mime_type="application/vnd.comicbook+zip",
            has_thumbnail=True,
        )
        fhash = hashlib.md5(fpath.encode()).hexdigest()[:8]
        thumb_dir = os.path.join(THUMB_DIR, "books")
        os.makedirs(thumb_dir, exist_ok=True)
        thumb_path = os.path.join(thumb_dir, f"etag-book_{fhash}.webp")
        with open(thumb_path, "wb") as f:
            f.write(b"RIFF\x00\x00\x00\x00WEBP")
        try:
            first = client.get(f"/api/books/{book.id}/thumbnail", headers=admin_headers)
            assert first.status_code == 200
            etag = first.headers["etag"]

            # A client presenting the same tag is told nothing changed.
            again = client.get(
                f"/api/books/{book.id}/thumbnail",
                headers={**admin_headers, "If-None-Match": etag},
            )
            assert again.status_code == 304

            # A stale tag (what a client holds after the file is replaced) refetches.
            stale = client.get(
                f"/api/books/{book.id}/thumbnail",
                headers={**admin_headers, "If-None-Match": '"outdated"'},
            )
            assert stale.status_code == 200
        finally:
            os.unlink(thumb_path)

    def test_book_detail_exposes_content_token(self, client, admin_headers, book):
        """The reader appends this to page URLs to bust the year-long browser cache."""
        resp = client.get(f"/api/books/{book.id}", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["content_token"]


class TestListBooksMimeType:
    def test_list_includes_mime_type(self, client, admin_headers, book):
        resp = client.get("/api/books", headers=admin_headers)
        assert resp.status_code == 200
        books = resp.json()["books"]
        assert all("mime_type" in b for b in books)
