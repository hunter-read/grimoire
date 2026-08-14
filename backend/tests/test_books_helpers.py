"""Direct unit tests for the shared book endpoint helpers.

Covers the in-process PDF document cache (including LRU eviction and the
best-effort close of an evicted document), the book-info memo cache, and the
explicit-content permission lookup.
"""
import os
import threading
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


class TestEvictPdf:
    """A replaced file must not keep serving from the handle on its old inode."""

    def setup_method(self):
        _helpers._pdf_cache.clear()

    def test_drops_and_closes_the_cached_handle(self, tmp_path):
        path = _write_pdf(str(tmp_path))
        doc = _helpers._get_pdf_doc(path)
        assert path in _helpers._pdf_cache

        assert _helpers.evict_pdf(path) is True
        assert path not in _helpers._pdf_cache
        assert doc.is_closed

        # A later request opens the file afresh rather than reusing the old handle.
        assert _helpers._get_pdf_doc(path) is not doc

    def test_returns_false_when_nothing_is_cached(self, tmp_path):
        assert _helpers.evict_pdf(str(tmp_path / "never-opened.pdf")) is False

    def test_close_failure_is_logged_not_raised(self, caplog):
        broken = MagicMock()
        broken.close.side_effect = RuntimeError("already closed")
        _helpers._pdf_cache["/library/broken.pdf"] = broken

        with caplog.at_level("DEBUG", logger="grimoire"):
            assert _helpers.evict_pdf("/library/broken.pdf") is True
        assert "/library/broken.pdf" not in _helpers._pdf_cache


class TestCachedBookInfo:
    def test_returns_none_for_missing_book(self):
        _helpers._invalidate_book_cache()
        assert _helpers._cached_book_info("does-not-exist") is None

    def test_returns_tuple_and_is_memoized(self):
        _helpers._invalidate_book_cache()
        system = make_game_system()
        book = make_book(system.id, title="Cached", mime_type="application/pdf")

        info = _helpers._cached_book_info(book.id)
        assert info == (book.filepath, "application/pdf", "Cached", book.content_hash)

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


class TestPageRenderReclaim:
    """The render-memory reclaim counter (issue: reader memory growth).

    MuPDF is a C library, so the memory a render leaves behind is invisible to
    Python's GC and isn't freed by closing the document. These tests cover the
    interval bookkeeping and the guards around the two native calls; the actual
    RSS reduction is a property of MuPDF/glibc and isn't asserted here.
    """

    def setup_method(self):
        _helpers._render_count = 0

    def test_reclaims_on_the_configured_interval(self, monkeypatch):
        monkeypatch.setattr(_helpers, "PAGE_RECLAIM_INTERVAL", 3)
        calls = []
        monkeypatch.setattr(_helpers, "_reclaim_render_memory", lambda: calls.append(1))
        results = [_helpers.note_page_render() for _ in range(3)]
        assert results == [False, False, True]
        assert len(calls) == 1

    def test_counter_resets_after_each_reclaim(self, monkeypatch):
        monkeypatch.setattr(_helpers, "PAGE_RECLAIM_INTERVAL", 2)
        calls = []
        monkeypatch.setattr(_helpers, "_reclaim_render_memory", lambda: calls.append(1))
        for _ in range(6):
            _helpers.note_page_render()
        assert len(calls) == 3

    def test_zero_interval_disables_reclaim(self, monkeypatch):
        monkeypatch.setattr(_helpers, "PAGE_RECLAIM_INTERVAL", 0)
        calls = []
        monkeypatch.setattr(_helpers, "_reclaim_render_memory", lambda: calls.append(1))
        assert _helpers.note_page_render() is False
        assert calls == []

    def test_counter_is_threadsafe(self, monkeypatch):
        # Page handlers are sync defs run across the threadpool, so the counter
        # is shared. Every render must be accounted for exactly once.
        monkeypatch.setattr(_helpers, "PAGE_RECLAIM_INTERVAL", 10)
        calls = []
        lock = threading.Lock()

        def _record():
            with lock:
                calls.append(1)

        monkeypatch.setattr(_helpers, "_reclaim_render_memory", _record)
        threads = [
            threading.Thread(target=lambda: [_helpers.note_page_render() for _ in range(20)])
            for _ in range(5)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        # 5 threads x 20 renders = 100 renders / interval 10 = exactly 10 reclaims.
        assert len(calls) == 10

    def test_reclaim_survives_missing_store_shrink(self, monkeypatch):
        # store_shrink availability varies by PyMuPDF build; a failure must not
        # propagate into the request that triggered it.
        def _boom(_):
            raise RuntimeError("no store_shrink in this build")

        monkeypatch.setattr(fitz.TOOLS, "store_shrink", _boom)
        monkeypatch.setattr(_helpers, "_malloc_trim", None)
        _helpers._reclaim_render_memory()  # must not raise

    def test_reclaim_survives_malloc_trim_failure(self, monkeypatch):
        def _boom(_):
            raise OSError("trim failed")

        monkeypatch.setattr(_helpers, "_malloc_trim", _boom)
        _helpers._reclaim_render_memory()  # must not raise

    def test_calls_both_native_reclaims_when_available(self, monkeypatch):
        seen = []
        monkeypatch.setattr(fitz.TOOLS, "store_shrink", lambda pct: seen.append(("shrink", pct)))
        monkeypatch.setattr(_helpers, "_malloc_trim", lambda n: seen.append(("trim", n)))
        _helpers._reclaim_render_memory()
        # Order matters: free MuPDF's store first, then return the arenas.
        assert seen == [("shrink", 100), ("trim", 0)]

    def test_malloc_trim_absent_off_linux(self, monkeypatch):
        monkeypatch.setattr(_helpers.platform, "system", lambda: "Darwin")
        assert _helpers._resolve_malloc_trim() is None

    def test_malloc_trim_absent_without_glibc(self, monkeypatch):
        # musl (Alpine) has no libc.so.6 to load.
        monkeypatch.setattr(_helpers.platform, "system", lambda: "Linux")

        def _no_libc(_name):
            raise OSError("not found")

        monkeypatch.setattr(_helpers.ctypes, "CDLL", _no_libc)
        assert _helpers._resolve_malloc_trim() is None
