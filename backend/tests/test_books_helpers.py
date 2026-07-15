"""Direct unit tests for the shared book endpoint helpers.

Covers the in-process PDF document cache (including LRU eviction and the
best-effort close of an evicted document), the book-info memo cache, and the
explicit-content permission lookup.
"""
import os
import uuid
from unittest.mock import MagicMock

import fitz  # type: ignore[import-untyped]

from backend.config import SessionLocal
from backend.models import User
from backend.routers.books import _helpers
from backend.tests.conftest import make_book, make_game_system


def _write_pdf(tmp_path, name="doc.pdf") -> str:
    """Create a minimal one-page PDF on disk and return its path."""
    path = os.path.join(tmp_path, name)
    doc = fitz.open()
    doc.new_page()
    doc.save(path)
    doc.close()
    return path


class TestGetPdfDoc:
    def setup_method(self):
        _helpers._pdf_cache.clear()

    def test_caches_and_returns_same_document(self, tmp_path):
        path = _write_pdf(str(tmp_path))
        doc1 = _helpers._get_pdf_doc(path)
        doc2 = _helpers._get_pdf_doc(path)
        assert doc1 is doc2
        assert path in _helpers._pdf_cache

    def test_evicts_least_recently_used_when_full(self, tmp_path):
        # Fill the cache past its max so the oldest entry is evicted + closed.
        paths = [
            _write_pdf(str(tmp_path), f"d{i}.pdf")
            for i in range(_helpers._PDF_CACHE_MAX + 1)
        ]
        for p in paths:
            _helpers._get_pdf_doc(p)
        assert len(_helpers._pdf_cache) == _helpers._PDF_CACHE_MAX
        # The first-inserted document was evicted.
        assert paths[0] not in _helpers._pdf_cache

    def test_evicted_close_error_is_logged_not_raised(self, tmp_path, caplog):
        # A broken evicted document whose close() raises must not blow up the
        # cache insert; the failure is logged at debug instead of swallowed.
        broken = MagicMock()
        broken.close.side_effect = RuntimeError("already closed")
        _helpers._pdf_cache.clear()
        for i in range(_helpers._PDF_CACHE_MAX):
            _helpers._pdf_cache[f"stale-{i}"] = MagicMock()
        # Make the oldest entry the broken one.
        _helpers._pdf_cache["stale-0"] = broken
        _helpers._pdf_cache.move_to_end("stale-0", last=False)

        path = _write_pdf(str(tmp_path))
        with caplog.at_level("DEBUG", logger="grimoire"):
            _helpers._get_pdf_doc(path)  # triggers eviction of `broken`
        broken.close.assert_called_once()
        assert any("evicted pdf" in r.message.lower() for r in caplog.records)


class TestCachedBookInfo:
    def test_returns_none_for_missing_book(self):
        _helpers._invalidate_book_cache()
        assert _helpers._cached_book_info("does-not-exist") is None

    def test_returns_tuple_and_is_memoized(self):
        _helpers._invalidate_book_cache()
        system = make_game_system()
        book = make_book(system.id, title="Cached", mime_type="application/pdf")

        info = _helpers._cached_book_info(book.id)
        assert info == (book.filepath, "application/pdf", "Cached")

        # A second call is served from the lru_cache and returns the same tuple.
        assert _helpers._cached_book_info(book.id) == info
        _helpers._invalidate_book_cache()


class TestAllowExplicit:
    def _make_user(self, allow_explicit):
        db = SessionLocal()
        u = User(
            id=str(uuid.uuid4()),
            username=f"u-{uuid.uuid4().hex[:8]}",
            role="player",
            allow_explicit=allow_explicit,
        )
        db.add(u)
        db.commit()
        uid = u.id
        db.close()
        return uid

    def test_defaults_true_for_unknown_user(self):
        db = SessionLocal()
        try:
            assert _helpers._allow_explicit(db, "missing") is True
        finally:
            db.close()

    def test_reflects_user_flag(self):
        allowed = self._make_user(True)
        blocked = self._make_user(False)
        db = SessionLocal()
        try:
            assert _helpers._allow_explicit(db, allowed) is True
            assert _helpers._allow_explicit(db, blocked) is False
        finally:
            db.close()
