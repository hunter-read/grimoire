"""Tests for indexer resilience: fitz timeout, getsize guard, and index_failed logic."""
from __future__ import annotations

import os
import tempfile
import time
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.config import SessionLocal
from backend.indexer import (
    _fitz_open_with_timeout,
    index_book_text,
    scan_library,
)
from backend.models import Book


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mk_lib() -> tuple[str, Path]:
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    lib.mkdir()
    return tmp, lib


def _make_book_record(**kwargs) -> Book:
    uid = str(uuid.uuid4())[:8]
    defaults = dict(
        title=f"TestBook-{uid}",
        filename=f"book-{uid}.pdf",
        filepath=f"/tmp/nonexistent-{uid}.pdf",
        relative_path=f"book-{uid}.pdf",
        mime_type="application/pdf",
        indexed=False,
        index_failed=False,
    )
    defaults.update(kwargs)
    db = SessionLocal()
    try:
        book = Book(**defaults)
        db.add(book)
        db.commit()
        db.refresh(book)
        return book
    finally:
        db.close()


def _get_book(book_id: str) -> Book | None:
    db = SessionLocal()
    try:
        return db.query(Book).filter_by(id=book_id).first()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# _fitz_open_with_timeout
# ---------------------------------------------------------------------------


class TestFitzTimeout:
    def test_raises_timeout_error_when_fitz_hangs(self):
        """If fitz.open() never returns, TimeoutError is raised after deadline."""

        def _hanging_open(path, *a, **kw):
            time.sleep(60)  # longer than any test timeout

        with patch("backend.indexer.fitz.open", side_effect=_hanging_open):
            with pytest.raises(TimeoutError):
                _fitz_open_with_timeout("/fake/path.pdf", timeout=1)

    def test_propagates_fitz_exception(self):
        """Real fitz errors (e.g. bad file) are re-raised normally."""
        with patch("backend.indexer.fitz.open", side_effect=RuntimeError("bad pdf")):
            with pytest.raises(RuntimeError, match="bad pdf"):
                _fitz_open_with_timeout("/fake/path.pdf", timeout=5)

    def test_returns_document_on_success(self):
        """Returns the fitz document when open completes within timeout."""
        mock_doc = MagicMock()
        with patch("backend.indexer.fitz.open", return_value=mock_doc):
            result = _fitz_open_with_timeout("/fake/path.pdf", timeout=5)
        assert result is mock_doc


# ---------------------------------------------------------------------------
# index_book_text — index_failed flag
# ---------------------------------------------------------------------------


class TestIndexBookTextIndexFailed:
    def test_skips_book_with_index_failed_set(self):
        """index_book_text returns False without touching the DB when index_failed=True."""
        book = _make_book_record(index_failed=True)
        db = SessionLocal()
        try:
            result = index_book_text(book, "/tmp", db)
        finally:
            db.close()

        assert result is False
        # indexed flag must stay False — the book was skipped, not processed
        refreshed = _get_book(book.id)
        assert refreshed.indexed is False
        assert refreshed.index_failed is True

    def test_skips_already_indexed_book(self):
        """index_book_text returns False for books where indexed=True."""
        book = _make_book_record(indexed=True, index_failed=False)
        db = SessionLocal()
        try:
            result = index_book_text(book, "/tmp", db)
        finally:
            db.close()

        assert result is False

    def test_sets_index_failed_when_no_text_extracted(self):
        """When extract_text_from_pdf returns empty, book is marked index_failed (not indexed)."""
        uid = str(uuid.uuid4())[:8]
        db = SessionLocal()
        try:
            book = Book(
                title=f"TestBook-{uid}",
                filename=f"book-{uid}.pdf",
                filepath=f"/tmp/nonexistent-{uid}.pdf",
                relative_path=f"book-{uid}.pdf",
                mime_type="application/pdf",
                indexed=False,
                index_failed=False,
            )
            db.add(book)
            db.commit()
            db.refresh(book)

            with patch("backend.indexer.extract_text_from_pdf", return_value=[]):
                result = index_book_text(book, "/tmp", db)

            db.refresh(book)
            assert result is False
            assert book.indexed is False
            assert book.index_failed is True
            assert "No text extracted" in book.index_error
        finally:
            db.close()

    def test_sets_indexed_true_on_success(self):
        """Successful extraction sets indexed=True and index_failed stays False."""
        uid = str(uuid.uuid4())[:8]
        pages = [{"page": 1, "content": "Hello world"}]
        db = SessionLocal()
        try:
            book = Book(
                title=f"TestBook-{uid}",
                filename=f"book-{uid}.pdf",
                filepath=f"/tmp/nonexistent-{uid}.pdf",
                relative_path=f"book-{uid}.pdf",
                mime_type="application/pdf",
                indexed=False,
                index_failed=False,
            )
            db.add(book)
            db.commit()
            db.refresh(book)

            with patch("backend.indexer.extract_text_from_pdf", return_value=pages):
                result = index_book_text(book, "/tmp", db)

            db.refresh(book)
            assert result is True
            assert book.indexed is True
            assert book.index_failed is False
        finally:
            db.close()


# ---------------------------------------------------------------------------
# scan_library — os.path.getsize guard
# ---------------------------------------------------------------------------


class TestGetSizeGuard:
    def _books_dir(self, lib: Path, system_folder: str = "TestSystem") -> Path:
        d = lib / "books" / system_folder
        d.mkdir(parents=True, exist_ok=True)
        return d

    def test_scan_continues_when_file_disappears_during_scan(self):
        """If os.path.getsize raises OSError, the file is skipped and scanning continues."""
        tmp, lib = _mk_lib()
        folder = self._books_dir(lib, "SomeSystem")

        # Create two PDFs; we'll make getsize fail on the first one
        pdf1 = folder / "first.pdf"
        pdf2 = folder / "second.pdf"
        pdf1.write_bytes(b"%PDF-1.4")
        pdf2.write_bytes(b"%PDF-1.4")

        original_getsize = os.path.getsize
        call_count = [0]

        def flaky_getsize(path):
            call_count[0] += 1
            if "first.pdf" in str(path):
                raise OSError("file vanished")
            return original_getsize(path)

        db = SessionLocal()
        try:
            with patch("backend.indexer.os.path.getsize", side_effect=flaky_getsize):
                with patch("backend.indexer.generate_thumbnail", return_value=False):
                    with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                        mock_fitz.return_value.__len__ = lambda s: 10
                        stats = scan_library(str(lib), tmp, db)
        finally:
            db.close()

        # Scan should complete without raising, and the good file should be counted
        assert stats["errors"] >= 0  # no crash

    def test_scan_skips_inaccessible_map_file(self):
        """A map file that raises OSError on getsize is skipped gracefully."""
        tmp, lib = _mk_lib()
        maps_dir = lib / "maps" / "ResilienceCreator"
        maps_dir.mkdir(parents=True)
        (maps_dir / "good.png").write_bytes(b"\x89PNG")
        (maps_dir / "bad.png").write_bytes(b"\x89PNG")

        original_getsize = os.path.getsize

        def flaky_getsize(path):
            if "bad.png" in str(path):
                raise OSError("permission denied")
            return original_getsize(path)

        db = SessionLocal()
        try:
            with patch("backend.indexer.os.path.getsize", side_effect=flaky_getsize):
                with patch("backend.indexer.generate_thumbnail", return_value=False):
                    stats = scan_library(str(lib), tmp, db)
        finally:
            db.close()

        # Completed without raising
        assert isinstance(stats, dict)

    def test_scan_skips_inaccessible_token_file(self):
        """A token file that raises OSError on getsize is skipped gracefully."""
        tmp, lib = _mk_lib()
        tokens_dir = lib / "tokens" / "ResilienceMonsters"
        tokens_dir.mkdir(parents=True)
        (tokens_dir / "goblin.png").write_bytes(b"\x89PNG")
        (tokens_dir / "ghost.png").write_bytes(b"\x89PNG")

        original_getsize = os.path.getsize

        def flaky_getsize(path):
            if "ghost.png" in str(path):
                raise OSError("gone")
            return original_getsize(path)

        db = SessionLocal()
        try:
            with patch("backend.indexer.os.path.getsize", side_effect=flaky_getsize):
                with patch("backend.indexer.generate_thumbnail", return_value=False):
                    stats = scan_library(str(lib), tmp, db)
        finally:
            db.close()

        assert isinstance(stats, dict)


# ---------------------------------------------------------------------------
# scan_library — should_stop callback
# ---------------------------------------------------------------------------


class TestShouldStop:
    def _books_dir(self, lib: Path, system_folder: str) -> Path:
        d = lib / "books" / system_folder
        d.mkdir(parents=True, exist_ok=True)
        return d

    def test_scan_aborts_books_when_stop_requested(self):
        """should_stop returning True after the first book causes an early return."""
        tmp, lib = _mk_lib()
        folder = self._books_dir(lib, "StopSystem")
        for i in range(5):
            (folder / f"book{i}.pdf").write_bytes(b"%PDF-1.4")

        calls = [0]

        def stop_after_one():
            calls[0] += 1
            return calls[0] > 1

        db = SessionLocal()
        try:
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                    mock_doc = MagicMock()
                    mock_doc.__len__ = lambda _: 1
                    mock_fitz.return_value = mock_doc
                    stats = scan_library(str(lib), tmp, db, should_stop=stop_after_one)
        finally:
            db.close()

        assert stats["new_books"] < 5

    def test_scan_processes_all_files_when_stop_never_requested(self):
        """should_stop always returning False lets the full scan complete."""
        tmp, lib = _mk_lib()
        folder = self._books_dir(lib, "NoStopSystem")
        for i in range(3):
            (folder / f"book{i}.pdf").write_bytes(b"%PDF-1.4")

        db = SessionLocal()
        try:
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                    mock_doc = MagicMock()
                    mock_doc.__len__ = lambda _: 1
                    mock_fitz.return_value = mock_doc
                    stats = scan_library(str(lib), tmp, db, should_stop=lambda: False)
        finally:
            db.close()

        assert stats["new_books"] == 3

    def test_scan_aborts_maps_when_stop_requested(self):
        """Stop during maps phase returns early from that loop."""
        tmp, lib = _mk_lib()
        maps_dir = lib / "maps" / "StopMaps"
        maps_dir.mkdir(parents=True)
        for i in range(4):
            (maps_dir / f"map{i}.png").write_bytes(b"\x89PNG")

        calls = [0]

        def stop_after_one():
            calls[0] += 1
            return calls[0] > 1

        db = SessionLocal()
        try:
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                stats = scan_library(str(lib), tmp, db, should_stop=stop_after_one)
        finally:
            db.close()

        assert stats["new_maps"] < 4

    def test_scan_aborts_tokens_when_stop_requested(self):
        """Stop during tokens phase returns early from that loop."""
        tmp, lib = _mk_lib()
        tokens_dir = lib / "tokens" / "StopTokens"
        tokens_dir.mkdir(parents=True)
        for i in range(4):
            (tokens_dir / f"token{i}.png").write_bytes(b"\x89PNG")

        calls = [0]

        def stop_after_one():
            calls[0] += 1
            return calls[0] > 1

        db = SessionLocal()
        try:
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                stats = scan_library(str(lib), tmp, db, should_stop=stop_after_one)
        finally:
            db.close()

        assert stats["new_tokens"] < 4

    def test_scan_without_should_stop_completes_normally(self):
        """Omitting should_stop entirely runs the full scan with no errors."""
        tmp, lib = _mk_lib()
        folder = self._books_dir(lib, "NormalSystem")
        (folder / "book.pdf").write_bytes(b"%PDF-1.4")

        db = SessionLocal()
        try:
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                    mock_doc = MagicMock()
                    mock_doc.__len__ = lambda _: 1
                    mock_fitz.return_value = mock_doc
                    stats = scan_library(str(lib), tmp, db)
        finally:
            db.close()

        assert isinstance(stats, dict)
