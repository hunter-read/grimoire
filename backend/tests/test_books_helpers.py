"""Direct unit tests for the shared book endpoint helpers.

Covers the in-process PDF document cache (LRU eviction, leases that keep a
document open while it is in use, idle release, and the best-effort close of a
retired document), the book-info memo cache, and the explicit-content
permission lookup.
"""
import os
import threading
import uuid
from unittest.mock import MagicMock

import fitz  # type: ignore[import-untyped]
import pytest

from backend.config import SessionLocal
from backend.models import User
from backend.services.books import documents
from backend.services.media.access import allow_explicit
from backend.tests.conftest import make_book, make_game_system


def _write_pdf(tmp_path, name="doc.pdf") -> str:
    """Create a minimal one-page PDF on disk and return its path."""
    path = os.path.join(tmp_path, name)
    doc = fitz.open()
    doc.new_page()
    doc.save(path)
    doc.close()
    return path



def _cache(**docs):
    """Seed the cache with stand-in documents, oldest first."""
    for key, doc in docs.items():
        documents._pdf_cache[key] = documents._CachedDoc(doc)


def _lease(path):
    """Take a lease the way a request does and return the document."""
    with documents.open_pdf(path) as doc:
        return doc


class TestIdleRelease:
    """Open documents and MuPDF's store are released once reading goes idle."""

    def setup_method(self):
        documents._pdf_cache.clear()

    def test_nothing_released_inside_the_idle_window(self, tmp_path, monkeypatch):
        monkeypatch.setattr(documents, "PAGE_IDLE_RELEASE", 300)
        path = _write_pdf(str(tmp_path))
        _lease(path)
        assert documents.release_idle_documents(now=documents._last_pdf_use + 299) is False
        assert path in documents._pdf_cache

    def test_idle_documents_are_closed_and_memory_reclaimed(self, monkeypatch):
        monkeypatch.setattr(documents, "PAGE_IDLE_RELEASE", 300)
        reclaimed = MagicMock()
        monkeypatch.setattr(documents, "_reclaim_render_memory", reclaimed)
        docs = [MagicMock(), MagicMock()]
        _cache(a=docs[0], b=docs[1])
        documents._last_pdf_use = 1000.0
        assert documents.release_idle_documents(now=1300.0) is True
        assert not documents._pdf_cache
        for d in docs:
            d.close.assert_called_once()
        reclaimed.assert_called_once()

    def test_a_document_still_rendering_is_closed_by_its_render(self, monkeypatch):
        """A render longer than the idle window must not lose its document."""
        monkeypatch.setattr(documents, "PAGE_IDLE_RELEASE", 300)
        monkeypatch.setattr(documents, "_reclaim_render_memory", MagicMock())
        busy = MagicMock()
        monkeypatch.setattr(documents, "open_document", lambda _p: busy)
        with documents.open_pdf("/library/slow.pdf") as doc:
            assert documents.release_idle_documents(now=documents._last_pdf_use + 301) is True
            assert "/library/slow.pdf" not in documents._pdf_cache
            doc.close.assert_not_called()
        busy.close.assert_called_once()

    def test_close_errors_do_not_stop_the_release(self, monkeypatch):
        monkeypatch.setattr(documents, "PAGE_IDLE_RELEASE", 300)
        monkeypatch.setattr(documents, "_reclaim_render_memory", MagicMock())
        broken, fine = MagicMock(), MagicMock()
        broken.close.side_effect = RuntimeError("already closed")
        _cache(broken=broken, fine=fine)
        documents._last_pdf_use = 0.0
        assert documents.release_idle_documents(now=1000.0) is True
        fine.close.assert_called_once()

    def test_disabled_never_starts_a_sweeper(self, tmp_path, monkeypatch):
        monkeypatch.setattr(documents, "PAGE_IDLE_RELEASE", 0)
        monkeypatch.setattr(documents, "_sweeper", None)
        _lease(_write_pdf(str(tmp_path)))
        assert documents._sweeper is None

    def test_sweeper_releases_then_exits_and_restarts_on_next_open(self, tmp_path, monkeypatch):
        """End to end with a 1s window: release, thread exit, fresh thread on reopen."""
        monkeypatch.setattr(documents, "PAGE_IDLE_RELEASE", 1)
        monkeypatch.setattr(documents, "_sweeper", None)
        path = _write_pdf(str(tmp_path))
        doc = _lease(path)
        first = documents._sweeper
        assert first is not None and first.is_alive()
        first.join(timeout=10)
        assert not first.is_alive(), "sweeper should exit once nothing is open"
        assert not documents._pdf_cache and documents._sweeper is None
        assert doc.is_closed

        _lease(path)
        second = documents._sweeper
        assert second is not None and second is not first
        second.join(timeout=10)
        assert not documents._pdf_cache


class TestOpenPdf:
    def setup_method(self):
        documents._pdf_cache.clear()

    def test_caches_and_returns_same_document(self, tmp_path):
        path = _write_pdf(str(tmp_path))
        doc1 = _lease(path)
        doc2 = _lease(path)
        assert doc1 is doc2
        assert path in documents._pdf_cache
        assert documents._pdf_cache[path].users == 0

    def test_lease_is_returned_when_the_block_raises(self, tmp_path):
        path = _write_pdf(str(tmp_path))
        with pytest.raises(KeyError):
            with documents.open_pdf(path):
                assert documents._pdf_cache[path].users == 1
                raise KeyError("boom")
        assert documents._pdf_cache[path].users == 0

    def test_evicts_least_recently_used_when_full(self, tmp_path):
        # Fill the cache past its max so the oldest entry is evicted + closed.
        paths = [
            _write_pdf(str(tmp_path), f"d{i}.pdf")
            for i in range(documents._PDF_CACHE_MAX + 1)
        ]
        first = _lease(paths[0])
        for p in paths[1:]:
            _lease(p)
        assert len(documents._pdf_cache) == documents._PDF_CACHE_MAX
        # The first-inserted document was evicted, and closed since nobody held it.
        assert paths[0] not in documents._pdf_cache
        assert first.is_closed

    def test_evicting_a_document_in_use_waits_for_its_reader(self, tmp_path):
        """Eleven books read at once: the evicted one stays open until its page is done."""
        paths = [
            _write_pdf(str(tmp_path), f"d{i}.pdf")
            for i in range(documents._PDF_CACHE_MAX + 1)
        ]
        with documents.open_pdf(paths[0]) as reading:
            for p in paths[1:]:
                _lease(p)
            assert paths[0] not in documents._pdf_cache
            assert not reading.is_closed
            # Still fully usable mid-"render".
            assert reading[0].get_pixmap().width > 0
        assert reading.is_closed

    def test_concurrent_readers_never_see_a_closed_document(self, tmp_path):
        """Many threads across more books than the cache holds: no render fails."""
        paths = [
            _write_pdf(str(tmp_path), f"c{i}.pdf")
            for i in range(documents._PDF_CACHE_MAX * 2)
        ]
        errors = []

        def reader(offset):
            for i in range(40):
                try:
                    with documents.open_pdf(paths[(offset + i) % len(paths)]) as doc:
                        doc[0].get_pixmap(matrix=fitz.Matrix(0.2, 0.2))
                except Exception as e:  # pragma: no cover - the failure being tested
                    errors.append(e)

        threads = [threading.Thread(target=reader, args=(n,)) for n in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert errors == []
        assert all(entry.users == 0 for entry in documents._pdf_cache.values())

    def test_evicted_close_error_is_logged_not_raised(self, tmp_path, caplog):
        # A broken evicted document whose close() raises must not blow up the
        # cache insert; the failure is logged at debug instead of swallowed.
        broken = MagicMock()
        broken.close.side_effect = RuntimeError("already closed")
        documents._pdf_cache.clear()
        _cache(**{f"stale-{i}": MagicMock() for i in range(1, documents._PDF_CACHE_MAX)})
        # Make the oldest entry the broken one.
        _cache(**{"stale-0": broken})
        documents._pdf_cache.move_to_end("stale-0", last=False)

        path = _write_pdf(str(tmp_path))
        with caplog.at_level("DEBUG", logger="grimoire"):
            _lease(path)  # triggers eviction of `broken`
        broken.close.assert_called_once()
        assert any("evicted pdf" in r.message.lower() for r in caplog.records)


class TestDocumentLock:
    """PyMuPDF is not thread-safe: one document is only ever used by one thread at a time."""

    def setup_method(self):
        documents._pdf_cache.clear()

    def test_threads_never_overlap_inside_one_document(self, tmp_path):
        path = _write_pdf(str(tmp_path))
        inside, peak, errors = [0], [0], []
        count_lock = threading.Lock()

        def reader():
            for _ in range(25):
                try:
                    with documents.open_pdf(path) as doc:
                        with count_lock:
                            inside[0] += 1
                            peak[0] = max(peak[0], inside[0])
                        doc[0].get_pixmap(matrix=fitz.Matrix(0.2, 0.2))
                        with count_lock:
                            inside[0] -= 1
                except Exception as e:  # pragma: no cover - the failure being tested
                    errors.append(e)

        threads = [threading.Thread(target=reader) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert errors == []
        assert peak[0] == 1

    def test_other_books_are_not_held_up(self, tmp_path):
        first, second = _write_pdf(str(tmp_path), "a.pdf"), _write_pdf(str(tmp_path), "b.pdf")
        holding, done = threading.Event(), threading.Event()

        def hold_first():
            with documents.open_pdf(first):
                holding.set()
                done.wait(timeout=10)

        t = threading.Thread(target=hold_first)
        t.start()
        assert holding.wait(timeout=10)
        try:
            # Would block until timeout if the lock were global rather than per book.
            assert _lease(second).page_count == 1
        finally:
            done.set()
            t.join()

    def test_nested_open_of_the_same_book_does_not_deadlock(self, tmp_path):
        path = _write_pdf(str(tmp_path))
        with documents.open_pdf(path) as outer:
            with documents.open_pdf(path) as inner:
                assert inner is outer

    def test_opening_does_not_hold_the_cache_lock(self, tmp_path, monkeypatch):
        """A slow open (a big PDF, an EPUB reflow) must not stall other books' renders."""
        cached = _write_pdf(str(tmp_path), "cached.pdf")
        _lease(cached)
        opening, release = threading.Event(), threading.Event()
        lock_held_during_open = []

        def slow_open(_path):
            lock_held_during_open.append(documents._pdf_cache_lock.locked())
            opening.set()
            release.wait(timeout=10)
            return MagicMock()

        monkeypatch.setattr(documents, "open_document", slow_open)
        t = threading.Thread(target=_lease, args=("/library/huge.pdf",))
        t.start()
        assert opening.wait(timeout=10)
        try:
            assert _lease(cached).page_count == 1
        finally:
            release.set()
            t.join()
        assert lock_held_during_open == [False]
        assert "/library/huge.pdf" in documents._pdf_cache

    def test_racing_opens_keep_one_document_and_close_the_other(self, monkeypatch):
        opened = []
        both_opening = threading.Barrier(2, timeout=10)

        def racing_open(_path):
            doc = MagicMock()
            opened.append(doc)
            both_opening.wait()
            return doc

        monkeypatch.setattr(documents, "open_document", racing_open)
        got = []
        threads = [
            threading.Thread(target=lambda: got.append(_lease("/library/same.pdf")))
            for _ in range(2)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        kept = documents._pdf_cache["/library/same.pdf"].doc
        assert got == [kept, kept]
        loser = next(d for d in opened if d is not kept)
        loser.close.assert_called_once()
        kept.close.assert_not_called()

    def test_a_file_replaced_mid_open_is_used_once_not_cached(self, monkeypatch):
        doc = MagicMock()

        def open_then_replaced(path):
            documents.evict_pdf(path)  # the file is replaced while we read it
            return doc

        monkeypatch.setattr(documents, "open_document", open_then_replaced)
        with documents.open_pdf("/library/replaced.pdf") as got:
            assert got is doc
            assert "/library/replaced.pdf" not in documents._pdf_cache
        doc.close.assert_called_once()


class TestEvictPdf:
    """A replaced file must not keep serving from the handle on its old inode."""

    def setup_method(self):
        documents._pdf_cache.clear()

    def test_drops_and_closes_the_cached_handle(self, tmp_path):
        path = _write_pdf(str(tmp_path))
        doc = _lease(path)
        assert path in documents._pdf_cache

        assert documents.evict_pdf(path) is True
        assert path not in documents._pdf_cache
        assert doc.is_closed

        # A later request opens the file afresh rather than reusing the old handle.
        assert _lease(path) is not doc

    def test_a_render_in_progress_keeps_its_handle_until_done(self, tmp_path):
        path = _write_pdf(str(tmp_path))
        with documents.open_pdf(path) as doc:
            assert documents.evict_pdf(path) is True
            assert not doc.is_closed
            # The next request already gets the new file.
            assert _lease(path) is not doc
        assert doc.is_closed

    def test_returns_false_when_nothing_is_cached(self, tmp_path):
        assert documents.evict_pdf(str(tmp_path / "never-opened.pdf")) is False

    def test_close_failure_is_logged_not_raised(self, caplog):
        broken = MagicMock()
        broken.close.side_effect = RuntimeError("already closed")
        _cache(**{"/library/broken.pdf": broken})

        with caplog.at_level("DEBUG", logger="grimoire"):
            assert documents.evict_pdf("/library/broken.pdf") is True
        assert "/library/broken.pdf" not in documents._pdf_cache


class TestCachedBookInfo:
    def test_returns_none_for_missing_book(self):
        documents.invalidate_book_cache()
        assert documents.cached_book_info("does-not-exist") is None

    def test_returns_tuple_and_is_memoized(self):
        documents.invalidate_book_cache()
        system = make_game_system()
        book = make_book(system.id, title="Cached", mime_type="application/pdf")

        info = documents.cached_book_info(book.id)
        assert info == (book.filepath, "application/pdf", "Cached", book.content_hash)

        # A second call is served from the lru_cache and returns the same tuple.
        assert documents.cached_book_info(book.id) == info
        documents.invalidate_book_cache()


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
            assert allow_explicit(db, "missing") is True
        finally:
            db.close()

    def test_reflects_user_flag(self):
        allowed = self._make_user(True)
        blocked = self._make_user(False)
        db = SessionLocal()
        try:
            assert allow_explicit(db, allowed) is True
            assert allow_explicit(db, blocked) is False
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
        documents._render_count = 0

    def test_reclaims_on_the_configured_interval(self, monkeypatch):
        monkeypatch.setattr(documents, "PAGE_RECLAIM_INTERVAL", 3)
        calls = []
        monkeypatch.setattr(documents, "_reclaim_render_memory", lambda: calls.append(1))
        results = [documents.note_page_render() for _ in range(3)]
        assert results == [False, False, True]
        assert len(calls) == 1

    def test_counter_resets_after_each_reclaim(self, monkeypatch):
        monkeypatch.setattr(documents, "PAGE_RECLAIM_INTERVAL", 2)
        calls = []
        monkeypatch.setattr(documents, "_reclaim_render_memory", lambda: calls.append(1))
        for _ in range(6):
            documents.note_page_render()
        assert len(calls) == 3

    def test_zero_interval_disables_reclaim(self, monkeypatch):
        monkeypatch.setattr(documents, "PAGE_RECLAIM_INTERVAL", 0)
        calls = []
        monkeypatch.setattr(documents, "_reclaim_render_memory", lambda: calls.append(1))
        assert documents.note_page_render() is False
        assert calls == []

    def test_counter_is_threadsafe(self, monkeypatch):
        # Page handlers are sync defs run across the threadpool, so the counter
        # is shared. Every render must be accounted for exactly once.
        monkeypatch.setattr(documents, "PAGE_RECLAIM_INTERVAL", 10)
        calls = []
        lock = threading.Lock()

        def _record():
            with lock:
                calls.append(1)

        monkeypatch.setattr(documents, "_reclaim_render_memory", _record)
        threads = [
            threading.Thread(target=lambda: [documents.note_page_render() for _ in range(20)])
            for _ in range(5)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        # 5 threads x 20 renders = 100 renders / interval 10 = exactly 10 reclaims.
        assert len(calls) == 10
