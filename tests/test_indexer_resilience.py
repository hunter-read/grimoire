"""Tests for indexer resilience: fitz timeout, getsize guard, index_failed, scan_failed, and is_missing logic."""
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
from backend.models import Book, GenericMap, Token


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


# ---------------------------------------------------------------------------
# scan_library — scan_failed / early-commit / resume behaviour
# ---------------------------------------------------------------------------


class TestScanFailed:
    """Tests for the scan_failed flag and the early-commit ordering that prevents
    the infinite-hang loop when a worker is killed mid-operation."""

    def _books_dir(self, lib: Path, system_folder: str = "ScanFailSystem") -> Path:
        d = lib / "books" / system_folder
        d.mkdir(parents=True, exist_ok=True)
        return d

    def test_book_committed_before_thumbnail(self):
        """The book record exists in the DB before generate_thumbnail is called,
        so a worker kill during the thumbnail hang doesn't lose the file."""
        tmp, lib = _mk_lib()
        folder = self._books_dir(lib, "EarlyCommitSystem")
        (folder / "book.pdf").write_bytes(b"%PDF-1.4")

        committed_before_thumb = []

        db = SessionLocal()
        try:
            def check_committed(filepath, *args, **kwargs):
                # At this point the book should already be in the DB
                exists = db.query(Book).filter_by(filepath=filepath).first()
                committed_before_thumb.append(exists is not None)
                return False

            with patch("backend.indexer.generate_thumbnail", side_effect=check_committed):
                with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                    mock_doc = MagicMock()
                    mock_doc.__len__ = lambda _: 1
                    mock_fitz.return_value = mock_doc
                    scan_library(str(lib), tmp, db)
        finally:
            db.close()

        assert committed_before_thumb, "generate_thumbnail was never called"
        assert all(committed_before_thumb), "book was not in DB before thumbnail was attempted"

    def test_scan_failed_set_before_thumbnail_hang(self):
        """scan_failed=True is committed before generate_thumbnail runs, so a
        worker kill mid-hang leaves the flag set and prevents infinite retries."""
        tmp, lib = _mk_lib()
        folder = self._books_dir(lib, "ScanFailBefore")
        pdf_path = str(folder / "hang.pdf")
        (folder / "hang.pdf").write_bytes(b"%PDF-1.4")

        scan_failed_before_thumb = []

        db = SessionLocal()
        try:
            def check_scan_failed(filepath, *args, **kwargs):
                book = db.query(Book).filter_by(filepath=filepath).first()
                if book:
                    db.refresh(book)
                    scan_failed_before_thumb.append(book.scan_failed)
                return False

            with patch("backend.indexer.generate_thumbnail", side_effect=check_scan_failed):
                with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                    mock_doc = MagicMock()
                    mock_doc.__len__ = lambda _: 1
                    mock_fitz.return_value = mock_doc
                    scan_library(str(lib), tmp, db)
        finally:
            db.close()

        assert scan_failed_before_thumb, "generate_thumbnail was never called"
        assert all(scan_failed_before_thumb), "scan_failed was not True before thumbnail attempt"

    def test_scan_failed_cleared_after_successful_scan(self):
        """After a clean scan completes, scan_failed is False on the saved book."""
        tmp, lib = _mk_lib()
        folder = self._books_dir(lib, "ScanFailClear")
        (folder / "good.pdf").write_bytes(b"%PDF-1.4")

        db = SessionLocal()
        try:
            with patch("backend.indexer.generate_thumbnail", return_value=True):
                with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                    mock_doc = MagicMock()
                    mock_doc.__len__ = lambda _: 5
                    mock_fitz.return_value = mock_doc
                    scan_library(str(lib), tmp, db)

            book = db.query(Book).filter_by(filename="good.pdf").first()
            assert book is not None
            assert book.scan_failed is False
            assert book.page_count == 5
        finally:
            db.close()

    def test_book_with_scan_failed_skipped_on_rescan(self):
        """A book with scan_failed=True is skipped entirely on subsequent scans
        — it does not cause a hang retry."""
        tmp, lib = _mk_lib()
        folder = self._books_dir(lib, "ScanFailSkip")
        pdf = folder / "problematic.pdf"
        pdf.write_bytes(b"%PDF-1.4")

        # Pre-seed the DB with scan_failed=True (simulates a prior killed worker)
        db = SessionLocal()
        try:
            book = Book(
                title="Problematic",
                filename="problematic.pdf",
                filepath=str(pdf),
                relative_path=os.path.relpath(str(pdf), str(lib)),
                mime_type="application/pdf",
                scan_failed=True,
            )
            db.add(book)
            db.commit()

            thumb_calls = []
            fitz_calls = []

            with patch("backend.indexer.generate_thumbnail", side_effect=lambda *a, **kw: thumb_calls.append(1) or False):
                with patch("backend.indexer._fitz_open_with_timeout", side_effect=lambda *a, **kw: fitz_calls.append(1)):
                    scan_library(str(lib), tmp, db)

            assert len(thumb_calls) == 0, "generate_thumbnail should not be called for scan_failed book"
            assert len(fitz_calls) == 0, "fitz should not be called for scan_failed book"
        finally:
            db.close()

    def test_cancelled_scan_clears_scan_failed_for_resume(self):
        """When a scan is cancelled via should_stop, scan_failed is cleared so the
        file will be retried on the next scan rather than treated as broken."""
        tmp, lib = _mk_lib()
        folder = self._books_dir(lib, "CancelResume")
        pdf = folder / "resumable.pdf"
        pdf.write_bytes(b"%PDF-1.4")

        db = SessionLocal()
        try:
            # Stop immediately after thumbnail starts (simulates cancel mid-hang)
            stop_now = [False]

            def cancelling_thumbnail(filepath, output_path, should_stop=None, **kwargs):
                stop_now[0] = True  # signal stop
                return False

            def should_stop():
                return stop_now[0]

            with patch("backend.indexer.generate_thumbnail", side_effect=cancelling_thumbnail):
                with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                    mock_doc = MagicMock()
                    mock_doc.__len__ = lambda _: 1
                    mock_fitz.return_value = mock_doc
                    scan_library(str(lib), tmp, db, should_stop=should_stop)

            book = db.query(Book).filter_by(filename="resumable.pdf").first()
            assert book is not None, "book should be in DB after cancelled scan"
            assert book.scan_failed is False, "scan_failed must be cleared on cancel so file is resumed next scan"
        finally:
            db.close()

    def test_resume_completes_missing_thumbnail_after_cancel(self):
        """A book saved without a thumbnail (due to cancel) gets its thumbnail
        generated on the next scan."""
        tmp, lib = _mk_lib()
        folder = self._books_dir(lib, "ResumeThumb")
        pdf = folder / "needs_thumb.pdf"
        pdf.write_bytes(b"%PDF-1.4")

        db = SessionLocal()
        try:
            # First scan: commit book but simulate cancel before thumbnail completes
            book = Book(
                title="NeedsThumb",
                filename="needs_thumb.pdf",
                filepath=str(pdf),
                relative_path=os.path.relpath(str(pdf), str(lib)),
                mime_type="application/pdf",
                has_thumbnail=False,
                page_count=0,
                scan_failed=False,
            )
            db.add(book)
            db.commit()

            # Second scan: should pick up the incomplete book and generate thumbnail
            thumb_calls = []

            def record_thumb(filepath, output_path, should_stop=None, **kwargs):
                thumb_calls.append(filepath)
                return True

            with patch("backend.indexer.generate_thumbnail", side_effect=record_thumb):
                with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                    mock_doc = MagicMock()
                    mock_doc.__len__ = lambda _: 3
                    mock_fitz.return_value = mock_doc
                    scan_library(str(lib), tmp, db)

            assert any("needs_thumb.pdf" in c for c in thumb_calls), \
                "thumbnail should be generated for incomplete book on rescan"

            db.refresh(book)
            assert book.has_thumbnail is True
            assert book.page_count == 3
            assert book.scan_failed is False
        finally:
            db.close()

    def test_resume_skips_book_with_index_error_already_set(self):
        """A book that failed page-count extraction (index_error set) is not
        retried for page count on rescan — only thumbnail is retried if missing."""
        tmp, lib = _mk_lib()
        folder = self._books_dir(lib, "ResumeIndexError")
        pdf = folder / "broken.pdf"
        pdf.write_bytes(b"%PDF-1.4")

        db = SessionLocal()
        try:
            book = Book(
                title="Broken",
                filename="broken.pdf",
                filepath=str(pdf),
                relative_path=os.path.relpath(str(pdf), str(lib)),
                mime_type="application/pdf",
                has_thumbnail=True,
                page_count=0,
                index_error="fitz.open() timed out",
                scan_failed=False,
            )
            db.add(book)
            db.commit()

            fitz_calls = []

            with patch("backend.indexer.generate_thumbnail", return_value=False):
                with patch("backend.indexer._fitz_open_with_timeout",
                           side_effect=lambda *a, **kw: fitz_calls.append(1)):
                    scan_library(str(lib), tmp, db)

            assert len(fitz_calls) == 0, "page count should not be retried when index_error is already set"
        finally:
            db.close()


# ---------------------------------------------------------------------------
# scan_library — is_missing detection
# ---------------------------------------------------------------------------


class TestMissingFiles:
    """Tests for the is_missing flag set/cleared during rescan."""

    def _mk_lib(self) -> tuple[str, Path]:
        tmp = tempfile.mkdtemp()
        lib = Path(tmp) / "library"
        lib.mkdir()
        return tmp, lib

    def test_missing_book_flagged_after_file_deleted(self):
        """A book whose file is removed between scans gets is_missing=True on rescan."""
        tmp, lib = self._mk_lib()
        books_dir = lib / "books" / "LostSystem"
        books_dir.mkdir(parents=True)
        pdf = books_dir / "vanished.pdf"
        pdf.write_bytes(b"%PDF-1.4")

        db = SessionLocal()
        try:
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                    mock_doc = MagicMock()
                    mock_doc.__len__ = lambda _: 1
                    mock_fitz.return_value = mock_doc
                    scan_library(str(lib), tmp, db)

            book = db.query(Book).filter_by(filename="vanished.pdf").first()
            assert book is not None
            assert book.is_missing is False

            # Delete the file and rescan
            pdf.unlink()
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                    mock_fitz.return_value = MagicMock(__len__=lambda _: 1)
                    scan_library(str(lib), tmp, db)

            db.refresh(book)
            assert book.is_missing is True
        finally:
            db.close()

    def test_missing_flag_cleared_when_file_returns(self):
        """A book pre-seeded with is_missing=True has the flag cleared when its file exists."""
        tmp, lib = self._mk_lib()
        books_dir = lib / "books" / "ReturnSystem"
        books_dir.mkdir(parents=True)
        pdf = books_dir / "returning.pdf"
        pdf.write_bytes(b"%PDF-1.4")

        db = SessionLocal()
        try:
            # Pre-seed with is_missing=True
            book = Book(
                title="Returning",
                filename="returning.pdf",
                filepath=str(pdf),
                relative_path=os.path.relpath(str(pdf), str(lib)),
                mime_type="application/pdf",
                has_thumbnail=True,
                page_count=5,
                scan_failed=False,
                is_missing=True,
            )
            db.add(book)
            db.commit()

            # File exists on disk — rescan should clear is_missing
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                    mock_fitz.return_value = MagicMock(__len__=lambda _: 5)
                    scan_library(str(lib), tmp, db)

            db.refresh(book)
            assert book.is_missing is False
        finally:
            db.close()

    def test_missing_map_flagged_after_file_deleted(self):
        """A map whose file is removed between scans gets is_missing=True on rescan."""
        tmp, lib = self._mk_lib()
        maps_dir = lib / "maps" / "LostMaps"
        maps_dir.mkdir(parents=True)
        img = maps_dir / "gone.png"
        img.write_bytes(b"\x89PNG")

        db = SessionLocal()
        try:
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                scan_library(str(lib), tmp, db)

            m = db.query(GenericMap).filter_by(filename="gone.png").first()
            assert m is not None
            assert m.is_missing is False

            img.unlink()
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                scan_library(str(lib), tmp, db)

            db.refresh(m)
            assert m.is_missing is True
        finally:
            db.close()

    def test_missing_token_flagged_after_file_deleted(self):
        """A token whose file is removed between scans gets is_missing=True on rescan."""
        tmp, lib = self._mk_lib()
        tokens_dir = lib / "tokens" / "LostTokens"
        tokens_dir.mkdir(parents=True)
        img = tokens_dir / "ghost.png"
        img.write_bytes(b"\x89PNG")

        db = SessionLocal()
        try:
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                scan_library(str(lib), tmp, db)

            t = db.query(Token).filter_by(filename="ghost.png").first()
            assert t is not None
            assert t.is_missing is False

            img.unlink()
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                scan_library(str(lib), tmp, db)

            db.refresh(t)
            assert t.is_missing is True
        finally:
            db.close()

    def test_scan_stats_include_missing_counts(self):
        """scan_library returns missing_books/maps/tokens counts in its stats dict."""
        tmp, lib = self._mk_lib()
        books_dir = lib / "books" / "StatSystem"
        books_dir.mkdir(parents=True)
        pdf = books_dir / "counted.pdf"
        pdf.write_bytes(b"%PDF-1.4")

        db = SessionLocal()
        try:
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                    mock_fitz.return_value = MagicMock(__len__=lambda _: 1)
                    scan_library(str(lib), tmp, db)

            pdf.unlink()
            with patch("backend.indexer.generate_thumbnail", return_value=False):
                with patch("backend.indexer._fitz_open_with_timeout") as mock_fitz:
                    mock_fitz.return_value = MagicMock(__len__=lambda _: 1)
                    stats = scan_library(str(lib), tmp, db)

            assert "missing_books" in stats
            assert "missing_maps" in stats
            assert "missing_tokens" in stats
            assert stats["missing_books"] >= 1
        finally:
            db.close()
