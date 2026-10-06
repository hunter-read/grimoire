"""Tests for replacing a book's file by upload (issue #497).

What matters is what survives and what does not. Everything the user attached
to the book is keyed by its id, so the id must not change. Everything read from
the old file - size, hash, pages, cover, search text, the OCR checkpoint - must
be rebuilt, because the new file may differ by one corrected word or by every
page, and a stale leftover is invisible until it returns a wrong search hit.
"""
import io
import os
import shutil
import uuid
from unittest.mock import patch

import fitz  # type: ignore[import-untyped]
import pytest
from sqlalchemy import text

from backend.config import LIBRARY_PATH, SessionLocal
from backend.indexer import refresh_book_file, reset_book_index
from backend.models import Book, Bookmark
from backend.routers.library import _helpers as library_helpers
from backend.services import library_fs as fs
from backend.services import tag_service

from .conftest import make_book, make_game_system

LIB = LIBRARY_PATH


@pytest.fixture
def shelf():
    """A unique system folder with a core category, torn down after each test."""
    stamp = str(uuid.uuid4())[:8]
    rel = f"books/Replace-{stamp}/core"
    os.makedirs(os.path.join(LIB, rel), exist_ok=True)
    system = make_game_system(name=f"Replace-{stamp}")
    yield rel, system
    shutil.rmtree(os.path.join(LIB, f"books/Replace-{stamp}"), ignore_errors=True)


def _pdf(*pages: str) -> bytes:
    doc = fitz.open()
    for body in pages:
        doc.new_page().insert_text((72, 72), body)
    data = doc.tobytes()
    doc.close()
    return data


def _shelve(rel_dir: str, system_id: str, name: str, content: bytes, **fields) -> Book:
    """Write ``content`` to disk and index it as a book."""
    path = os.path.join(LIB, rel_dir, name)
    with open(path, "wb") as f:
        f.write(content)
    return make_book(
        system_id,
        title=fields.pop("title", "Replaceable"),
        filename=name,
        filepath=path,
        relative_path=f"{rel_dir}/{name}",
        **{"file_size": len(content), **fields},
    )


def _replace(client, headers, rel_dir: str, name: str, content: bytes, **form):
    return client.post(
        "/api/files/upload",
        headers=headers,
        data={"destination": rel_dir, "on_conflict": "replace", **form},
        files={"file": (name, content, "application/octet-stream")},
    )


def _search_hits(term: str) -> list[str]:
    db = SessionLocal()
    try:
        rows = db.execute(
            text("SELECT book_id FROM book_search WHERE book_search MATCH :t"), {"t": term}
        ).fetchall()
        return [r[0] for r in rows]
    finally:
        db.close()


class TestReplaceUploadService:
    def test_overwrites_the_file_and_names_the_record(self, shelf):
        rel, system = shelf
        book = _shelve(rel, system.id, "core.pdf", b"old bytes")
        db = SessionLocal()
        try:
            result = fs.replace_upload(db, rel, "core.pdf", io.BytesIO(b"new bytes!"))
        finally:
            db.close()
        assert result == {
            "path": f"{rel}/core.pdf",
            "name": "core.pdf",
            "size": 10,
            "record_id": book.id,
            "replaced": True,
        }
        with open(os.path.join(LIB, rel, "core.pdf"), "rb") as f:
            assert f.read() == b"new bytes!"

    def test_refuses_a_file_that_is_not_indexed(self, shelf):
        """A loose file is not a book; replacing it would be a plain overwrite."""
        rel, _ = shelf
        loose = os.path.join(LIB, rel, "loose.pdf")
        with open(loose, "wb") as f:
            f.write(b"loose")
        db = SessionLocal()
        try:
            with pytest.raises(fs.LibraryFSError) as exc:
                fs.replace_upload(db, rel, "loose.pdf", io.BytesIO(b"new"))
        finally:
            db.close()
        assert exc.value.code == "conflict"
        with open(loose, "rb") as f:
            assert f.read() == b"loose"

    def test_refuses_a_name_with_nothing_there(self, shelf):
        """A typo must not quietly add a second copy of the book."""
        rel, _ = shelf
        db = SessionLocal()
        try:
            with pytest.raises(fs.LibraryFSError) as exc:
                fs.replace_upload(db, rel, "typo.pdf", io.BytesIO(b"new"))
        finally:
            db.close()
        assert exc.value.code == "conflict"
        assert not os.path.exists(os.path.join(LIB, rel, "typo.pdf"))

    def test_refuses_outside_the_books_tree(self):
        stamp = str(uuid.uuid4())[:8]
        rel = f"maps/Replace-{stamp}"
        os.makedirs(os.path.join(LIB, rel), exist_ok=True)
        try:
            with open(os.path.join(LIB, rel, "map.png"), "wb") as f:
                f.write(b"png")
            db = SessionLocal()
            try:
                with pytest.raises(fs.LibraryFSError) as exc:
                    fs.replace_upload(db, rel, "map.png", io.BytesIO(b"new"))
            finally:
                db.close()
            assert exc.value.code == "conflict"
        finally:
            shutil.rmtree(os.path.join(LIB, rel), ignore_errors=True)

    def test_refuses_a_folder_of_the_same_name(self, shelf):
        rel, _ = shelf
        os.makedirs(os.path.join(LIB, rel, "nested.pdf"))
        db = SessionLocal()
        try:
            with pytest.raises(fs.LibraryFSError) as exc:
                fs.replace_upload(db, rel, "nested.pdf", io.BytesIO(b"new"))
        finally:
            db.close()
        assert exc.value.code == "invalid"

    def test_a_missing_relative_dir_is_not_created(self, shelf):
        rel, _ = shelf
        db = SessionLocal()
        try:
            with pytest.raises(fs.LibraryFSError) as exc:
                fs.replace_upload(
                    db, rel, "core.pdf", io.BytesIO(b"new"), relative_dir="nowhere"
                )
        finally:
            db.close()
        assert exc.value.code == "not_found"
        assert not os.path.exists(os.path.join(LIB, rel, "nowhere"))

    def test_resolves_through_an_existing_relative_dir(self, shelf):
        rel, system = shelf
        os.makedirs(os.path.join(LIB, rel, "sub"))
        book = _shelve(f"{rel}/sub", system.id, "deep.pdf", b"old")
        db = SessionLocal()
        try:
            result = fs.replace_upload(
                db, rel, "deep.pdf", io.BytesIO(b"newer"), relative_dir="sub"
            )
        finally:
            db.close()
        assert result["record_id"] == book.id

    def test_an_oversized_upload_leaves_the_original(self, shelf):
        """The new bytes only replace the old ones once they are complete."""
        rel, system = shelf
        _shelve(rel, system.id, "core.pdf", b"original")
        db = SessionLocal()
        try:
            with pytest.raises(fs.LibraryFSError) as exc:
                fs.replace_upload(
                    db, rel, "core.pdf", io.BytesIO(b"x" * 64), max_bytes=10
                )
        finally:
            db.close()
        assert exc.value.code == "too_large"
        with open(os.path.join(LIB, rel, "core.pdf"), "rb") as f:
            assert f.read() == b"original"
        assert not os.path.exists(os.path.join(LIB, rel, ".core.pdf.part"))


class TestReplaceEndpoint:
    def test_keeps_the_record_and_everything_attached(
        self, client, admin_headers, admin_id, shelf
    ):
        rel, system = shelf
        book = _shelve(
            rel,
            system.id,
            "core.pdf",
            _pdf("alpha", "beta", "gamma"),
            title="My Edited Title",
            description="Written by hand",
            page_count=3,
            indexed=True,
            content_hash="0" * 64,
        )
        db = SessionLocal()
        tag_service.set_resource_tags(db, "book", book.id, ["errata"])
        db.add(Bookmark(user_id=admin_id, book_id=book.id, page_number=2, label="Spells"))
        db.commit()
        db.close()

        with patch.object(library_helpers, "rescan_single_book") as rescan:
            resp = _replace(client, admin_headers, rel, "core.pdf", _pdf("revised"))

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["record_id"] == book.id
        assert body["replaced"] is True
        rescan.assert_called_once_with(book.id, refresh_file=False)

        db = SessionLocal()
        try:
            row = db.get(Book, book.id)
            assert row.title == "My Edited Title"
            assert row.description == "Written by hand"
            assert row.page_count == 1
            assert row.file_size == body["size"]
            assert row.content_hash not in (None, "0" * 64)
            assert row.indexed is False  # left for the background index
            assert tag_service.display_tags_for_resource(db, "book", book.id) == ["errata"]
            marks = db.query(Bookmark).filter_by(book_id=book.id).all()
            assert [m.label for m in marks] == ["Spells"]
            assert db.query(Book).filter(Book.relative_path == f"{rel}/core.pdf").count() == 1
        finally:
            db.close()

    def test_old_search_text_is_gone_and_new_text_is_found(
        self, client, admin_headers, shelf
    ):
        """A changed word must stop matching, and its replacement must start."""
        rel, system = shelf
        book = _shelve(rel, system.id, "lore.pdf", _pdf("zymurgical"), indexed=True)
        db = SessionLocal()
        db.execute(
            text(
                "INSERT INTO book_search (book_id, page_number, content) "
                "VALUES (:bid, 1, 'zymurgical')"
            ),
            {"bid": book.id},
        )
        db.commit()
        db.close()
        assert _search_hits("zymurgical") == [book.id]

        # The real background task, so the index is actually rebuilt.
        with patch.object(library_helpers, "run_ocr_queue"):
            resp = _replace(client, admin_headers, rel, "lore.pdf", _pdf("xylographic"))

        assert resp.status_code == 200, resp.text
        assert _search_hits("zymurgical") == []
        assert _search_hits("xylographic") == [book.id]
        db = SessionLocal()
        try:
            assert db.get(Book, book.id).indexed is True
        finally:
            db.close()

    def test_resets_the_ocr_checkpoint_but_keeps_the_dpi_override(
        self, client, admin_headers, shelf
    ):
        """Resuming at the old checkpoint would skip the new file's first pages."""
        rel, system = shelf
        book = _shelve(
            rel,
            system.id,
            "scan.pdf",
            _pdf("one", "two"),
            ocr_pending=True,
            ocr_pages_done=5,
            ocr_pages_skipped=2,
            ocr_dpi=400,
            index_failed=True,
            index_error="timed out",
        )
        with patch.object(library_helpers, "rescan_single_book"):
            resp = _replace(client, admin_headers, rel, "scan.pdf", _pdf("one"))
        assert resp.status_code == 200, resp.text
        db = SessionLocal()
        try:
            row = db.get(Book, book.id)
            assert (row.ocr_pending, row.ocr_pages_done, row.ocr_pages_skipped) == (False, 0, 0)
            assert (row.index_failed, row.index_error) == (False, "")
            assert row.ocr_dpi == 400
        finally:
            db.close()

    def test_restores_a_missing_book(self, client, admin_headers, shelf):
        rel, system = shelf
        book = _shelve(rel, system.id, "lost.pdf", b"gone", is_missing=True)
        os.unlink(book.filepath)
        with patch.object(library_helpers, "rescan_single_book"):
            resp = _replace(client, admin_headers, rel, "lost.pdf", _pdf("found"))
        assert resp.status_code == 200, resp.text
        db = SessionLocal()
        try:
            assert db.get(Book, book.id).is_missing is False
        finally:
            db.close()
        assert os.path.exists(book.filepath)

    def test_a_format_without_text_is_refreshed_without_indexing(
        self, client, admin_headers, shelf
    ):
        rel, system = shelf
        book = _shelve(
            rel, system.id, "cover.png", b"old", mime_type="image/png", page_count=1
        )
        with patch.object(library_helpers, "rescan_single_book") as rescan, patch(
            "backend.indexer.generate_thumbnail", return_value=True
        ):
            resp = _replace(client, admin_headers, rel, "cover.png", b"\x89PNG new image")
        assert resp.status_code == 200, resp.text
        assert not rescan.called
        db = SessionLocal()
        try:
            row = db.get(Book, book.id)
            assert row.file_size == len(b"\x89PNG new image")
            assert row.has_thumbnail is True
        finally:
            db.close()

    def test_a_failed_re_read_still_reports_the_saved_file(
        self, client, admin_headers, shelf
    ):
        """The file is in place; a later scan sees its new size and rebuilds it."""
        rel, system = shelf
        book = _shelve(rel, system.id, "core.pdf", b"old", file_size=3)
        with patch(
            "backend.routers.files.core.refresh_book_file", side_effect=RuntimeError("boom")
        ), patch.object(library_helpers, "rescan_single_book") as rescan:
            resp = _replace(client, admin_headers, rel, "core.pdf", _pdf("new"))
        assert resp.status_code == 200, resp.text
        assert resp.json()["replaced"] is True
        assert not rescan.called
        db = SessionLocal()
        try:
            assert db.get(Book, book.id).file_size == 3
        finally:
            db.close()

    def test_refused_while_a_scan_runs(self, client, admin_headers, shelf):
        """An OCR worker resuming on the old checkpoint would splice two files."""
        rel, system = shelf
        _shelve(rel, system.id, "core.pdf", b"original")
        with patch.object(library_helpers, "scan_in_progress", return_value=True):
            resp = _replace(client, admin_headers, rel, "core.pdf", b"new")
        assert resp.status_code == 409
        with open(os.path.join(LIB, rel, "core.pdf"), "rb") as f:
            assert f.read() == b"original"

    def test_unindexed_path_is_a_409(self, client, admin_headers, shelf):
        rel, _ = shelf
        resp = _replace(client, admin_headers, rel, "nothing.pdf", b"new")
        assert resp.status_code == 409

    def test_unknown_policy_is_a_400(self, client, admin_headers, shelf):
        rel, _ = shelf
        resp = client.post(
            "/api/files/upload",
            headers=admin_headers,
            data={"destination": rel, "on_conflict": "overwrite"},
            files={"file": ("x.pdf", b"%PDF", "application/pdf")},
        )
        assert resp.status_code == 400
        assert not os.path.exists(os.path.join(LIB, rel, "x.pdf"))

    def test_requires_admin(self, client, gm_headers, shelf):
        rel, system = shelf
        _shelve(rel, system.id, "core.pdf", b"original")
        resp = _replace(client, gm_headers, rel, "core.pdf", b"new")
        assert resp.status_code == 403


class TestRefreshBookFile:
    """The format-agnostic re-read, per format family."""

    def _book(self, shelf, name: str, content: bytes, **fields) -> Book:
        rel, system = shelf
        return _shelve(rel, system.id, name, content, **fields)

    def test_an_image_counts_as_one_page(self, shelf):
        book = self._book(shelf, "art.png", b"img", mime_type="image/png", page_count=0)
        db = SessionLocal()
        try:
            row = db.get(Book, book.id)
            with patch("backend.indexer.generate_thumbnail", return_value=False) as thumb:
                refresh_book_file(row, "/tmp", db)
            assert row.page_count == 1
            assert thumb.called
        finally:
            db.close()

    def test_a_comic_is_counted_and_thumbnailed(self, shelf):
        book = self._book(shelf, "issue.cbz", b"zip", mime_type="application/vnd.comicbook+zip")
        db = SessionLocal()
        try:
            row = db.get(Book, book.id)
            with patch("backend.indexer._book_page_count", return_value=24), patch(
                "backend.indexer.generate_thumbnail", return_value=True
            ):
                refresh_book_file(row, "/tmp", db)
            assert row.page_count == 24
            assert row.has_thumbnail is True
        finally:
            db.close()

    def test_an_opaque_archive_is_neither_counted_nor_thumbnailed(self, shelf):
        book = self._book(shelf, "bundle.zip", b"zip", mime_type="application/zip")
        db = SessionLocal()
        try:
            row = db.get(Book, book.id)
            with patch("backend.indexer._book_page_count") as count, patch(
                "backend.indexer.generate_thumbnail"
            ) as thumb:
                refresh_book_file(row, "/tmp", db)
            assert not count.called
            assert not thumb.called
            assert row.file_size == 3
        finally:
            db.close()

    def test_an_unreadable_page_count_is_logged_not_raised(self, shelf):
        book = self._book(shelf, "broken.pdf", b"not a pdf", page_count=7)
        db = SessionLocal()
        try:
            row = db.get(Book, book.id)
            with patch("backend.indexer._book_page_count", side_effect=RuntimeError("bad")), patch(
                "backend.indexer.generate_thumbnail", return_value=False
            ):
                refresh_book_file(row, "/tmp", db)
            assert row.page_count == 7
        finally:
            db.close()

    def test_reset_clears_search_rows(self, shelf):
        book = self._book(shelf, "core.pdf", b"x", indexed=True)
        db = SessionLocal()
        try:
            db.execute(
                text(
                    "INSERT INTO book_search (book_id, page_number, content) "
                    "VALUES (:bid, 1, 'quillwort')"
                ),
                {"bid": book.id},
            )
            db.commit()
            reset_book_index(db.get(Book, book.id), db)
            assert db.get(Book, book.id).indexed is False
        finally:
            db.close()
        assert _search_hits("quillwort") == []


class TestRescanSingleBookTextOnly:
    def test_indexes_without_re_reading_the_file(self, shelf):
        rel, system = shelf
        book = _shelve(rel, system.id, "core.pdf", b"x")
        with patch.object(library_helpers, "reindex_single_book") as reread, patch.object(
            library_helpers, "index_book_text"
        ) as index, patch.object(library_helpers, "run_ocr_queue"):
            library_helpers.rescan_single_book(book.id, refresh_file=False)
        assert not reread.called
        assert index.call_args.args[0].id == book.id
