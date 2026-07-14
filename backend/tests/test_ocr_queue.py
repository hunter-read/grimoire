"""Tests for the deferred-OCR queue: page-checkpointed OCR of scanned PDFs.

Scanned (image-only) PDFs are no longer OCR'd inline during the scan; they are
queued (``ocr_pending``) and drained by a background worker that OCRs one page
at a time and checkpoints ``ocr_pages_done`` so a long book resumes rather than
restarts. These tests exercise the indexer's ``ocr_book`` / ``ocr_page_isolated``
and the helper's ``run_ocr_queue`` drain loop, stubbing the actual per-page OCR
subprocess so no tesseract binary is required.
"""
import uuid
from unittest.mock import patch

from sqlalchemy import text

from backend import indexer
from backend.config import SessionLocal
from backend.models import Book
from backend.routers.library import _helpers


def _clear_pending() -> None:
    """Reset any lingering ocr_pending books so a drain test sees only its own.

    The test DB is a shared session-scoped file with no per-test teardown, so
    ocr_pending rows from other tests would otherwise be swept into run_ocr_queue.
    """
    db = SessionLocal()
    try:
        db.query(Book).filter_by(ocr_pending=True).update({"ocr_pending": False})
        db.commit()
    finally:
        db.close()


def _queued_book(pages_done: int = 0, page_count: int = 3) -> str:
    """Create an ocr_pending book and return its id. page_count is faked below."""
    uid = str(uuid.uuid4())[:8]
    db = SessionLocal()
    book = Book(
        title=f"Scan-{uid}",
        filename=f"scan-{uid}.pdf",
        filepath=f"/tmp/scan-{uid}.pdf",
        relative_path=f"scan-{uid}.pdf",
        mime_type="application/pdf",
        indexed=False,
        index_failed=False,
        ocr_pending=True,
        ocr_pages_done=pages_done,
    )
    db.add(book)
    db.commit()
    bid = book.id
    db.close()
    return bid


def _search_pages(book_id: str) -> list[int]:
    db = SessionLocal()
    try:
        rows = db.execute(
            text("SELECT page_number FROM book_search WHERE book_id = :b ORDER BY page_number"),
            {"b": book_id},
        ).fetchall()
        return [r[0] for r in rows]
    finally:
        db.close()


class TestOcrBook:
    def test_ocrs_all_pages_and_marks_indexed(self):
        bid = _queued_book(page_count=3)
        db = SessionLocal()
        try:
            book = db.get(Book, bid)
            with patch.object(indexer, "_book_page_count", return_value=3), \
                 patch.object(
                     indexer, "ocr_book_page_isolated_wrapper",
                     side_effect=lambda fp, i, should_stop=None, dpi=None: f"text-{i + 1}",
                 ):
                result = indexer.ocr_book(book, db)
            assert result == "done"
            db.refresh(book)
            assert book.indexed is True
            assert book.ocr_pending is False
            assert book.index_error == "ocr"
            assert book.ocr_pages_done == 3
        finally:
            db.close()
        assert _search_pages(bid) == [1, 2, 3]

    def test_resumes_from_checkpoint(self):
        """A book with ocr_pages_done=2 only OCRs the remaining pages."""
        bid = _queued_book(pages_done=2, page_count=3)
        seen = []
        db = SessionLocal()
        try:
            book = db.get(Book, bid)

            def _ocr(fp, i, should_stop=None, dpi=None):
                seen.append(i)
                return f"text-{i + 1}"

            with patch.object(indexer, "_book_page_count", return_value=3), \
                 patch.object(indexer, "ocr_book_page_isolated_wrapper", side_effect=_ocr):
                result = indexer.ocr_book(book, db)
            assert result == "done"
        finally:
            db.close()
        # Only page index 2 (page 3) was OCR'd; pages 1-2 were already done.
        assert seen == [2]
        assert _search_pages(bid) == [3]

    def test_empty_page_still_advances_checkpoint(self):
        """A page that OCRs to nothing is skipped in the index but still checkpointed."""
        bid = _queued_book(page_count=2)
        db = SessionLocal()
        try:
            book = db.get(Book, bid)
            with patch.object(indexer, "_book_page_count", return_value=2), \
                 patch.object(
                     indexer, "ocr_book_page_isolated_wrapper",
                     side_effect=lambda fp, i, should_stop=None, dpi=None: "" if i == 0 else "text",
                 ):
                indexer.ocr_book(book, db)
            db.refresh(book)
            assert book.ocr_pages_done == 2
        finally:
            db.close()
        assert _search_pages(bid) == [2]  # only the non-empty page indexed

    def test_stop_is_resumable(self):
        """A stop mid-book leaves ocr_pending set and the checkpoint advanced."""
        bid = _queued_book(page_count=5)
        db = SessionLocal()
        try:
            book = db.get(Book, bid)

            # Stop once page index 2 (the 3rd page) is reached, so pages 1-2 are
            # committed and the book resumes at page 3 later. Keyed on the book's
            # checkpoint rather than a call counter so it's robust to how many
            # times ocr_book polls should_stop per iteration.
            def _stop():
                return book.ocr_pages_done >= 2

            with patch.object(indexer, "_book_page_count", return_value=5), \
                 patch.object(
                     indexer, "ocr_book_page_isolated_wrapper",
                     side_effect=lambda fp, i, should_stop=None, dpi=None: f"t{i}",
                 ):
                result = indexer.ocr_book(book, db, should_stop=_stop)
            assert result == "stopped"
            db.refresh(book)
            assert book.ocr_pending is True
            assert book.indexed is False
            assert book.ocr_pages_done == 2  # two pages committed before stop
        finally:
            db.close()

    def test_cancelled_page_not_skipped_on_resume(self):
        """A page cancelled mid-flight (empty return + stop) isn't marked done."""
        bid = _queued_book(page_count=3)
        db = SessionLocal()
        try:
            book = db.get(Book, bid)

            # should_stop is False at the top of the loop (so page 1 is attempted)
            # but flips True during the OCR call, so it's True on the after-page
            # check. The empty return is a cancellation, not a blank page: the
            # checkpoint must NOT advance.
            state = {"stopping": False}

            def _ocr(fp, i, should_stop=None, dpi=None):
                state["stopping"] = True  # cancel arrives while OCRing page 1
                return ""

            with patch.object(indexer, "_book_page_count", return_value=3), \
                 patch.object(indexer, "ocr_book_page_isolated_wrapper", side_effect=_ocr):
                result = indexer.ocr_book(book, db, should_stop=lambda: state["stopping"])
            assert result == "stopped"
            db.refresh(book)
            assert book.ocr_pages_done == 0  # page 1 not burned
            assert book.ocr_pending is True
        finally:
            db.close()

    def test_unreadable_book_marked_failed(self):
        bid = _queued_book()
        db = SessionLocal()
        try:
            book = db.get(Book, bid)
            with patch.object(indexer, "_book_page_count", side_effect=RuntimeError("bad")):
                result = indexer.ocr_book(book, db)
            assert result == "error"
            db.refresh(book)
            assert book.ocr_pending is False
            assert book.index_failed is True
            assert "ocr open failed" in book.index_error
        finally:
            db.close()

    def test_per_book_dpi_is_threaded_to_worker(self):
        """ocr_book passes book.ocr_dpi through to each per-page OCR call."""
        bid = _queued_book(page_count=2)
        db = SessionLocal()
        try:
            book = db.get(Book, bid)
            book.ocr_dpi = 400
            db.commit()
            seen_dpi = []

            def _ocr(fp, i, should_stop=None, dpi=None):
                seen_dpi.append(dpi)
                return "t"

            with patch.object(indexer, "_book_page_count", return_value=2), \
                 patch.object(indexer, "ocr_book_page_isolated_wrapper", side_effect=_ocr):
                indexer.ocr_book(book, db)
            assert seen_dpi == [400, 400]
        finally:
            db.close()

    def test_default_dpi_is_none(self):
        """A book with no override passes dpi=None (global default used downstream)."""
        bid = _queued_book(page_count=1)
        db = SessionLocal()
        try:
            book = db.get(Book, bid)
            seen = []
            with patch.object(indexer, "_book_page_count", return_value=1), \
                 patch.object(
                     indexer, "ocr_book_page_isolated_wrapper",
                     side_effect=lambda fp, i, should_stop=None, dpi=None: seen.append(dpi) or "t",
                 ):
                indexer.ocr_book(book, db)
            assert seen == [None]
        finally:
            db.close()


class TestOcrPageIsolated:
    def test_returns_worker_text(self):
        with patch.object(indexer._MP_CONTEXT, "Process") as MockProc, \
             patch("backend.indexer.pickle.load", return_value="hello"), \
             patch("backend.indexer.os.path.getsize", return_value=10), \
             patch("builtins.open"):
            proc = MockProc.return_value
            proc.is_alive.return_value = False
            proc.exitcode = 0
            out = indexer.ocr_page_isolated("/tmp/x.pdf", 0)
        assert out == "hello"

    def test_crash_returns_empty(self):
        with patch.object(indexer._MP_CONTEXT, "Process") as MockProc, \
             patch("backend.indexer.os.path.getsize", return_value=0):
            proc = MockProc.return_value
            proc.is_alive.return_value = False
            proc.exitcode = 1
            out = indexer.ocr_page_isolated("/tmp/x.pdf", 0)
        assert out == ""

    def test_stop_terminates_and_returns_empty(self):
        with patch.object(indexer._MP_CONTEXT, "Process") as MockProc:
            proc = MockProc.return_value
            proc.is_alive.return_value = True  # never exits on its own
            out = indexer.ocr_page_isolated("/tmp/x.pdf", 0, should_stop=lambda: True)
        assert out == ""
        proc.terminate.assert_called()

    def test_dpi_passed_to_worker_process(self):
        """The dpi arg is forwarded as the last Process arg to ocr_page_main."""
        with patch.object(indexer._MP_CONTEXT, "Process") as MockProc, \
             patch("backend.indexer.pickle.load", return_value="x"), \
             patch("backend.indexer.os.path.getsize", return_value=10), \
             patch("builtins.open"):
            proc = MockProc.return_value
            proc.is_alive.return_value = False
            proc.exitcode = 0
            indexer.ocr_page_isolated("/tmp/x.pdf", 2, dpi=350)
        # args = (filepath, page_index, languages, result_path, dpi)
        args = MockProc.call_args.kwargs["args"]
        assert args[1] == 2  # page_index
        assert args[-1] == 350  # dpi


class TestRunOcrQueue:
    def test_drains_pending_books(self):
        _helpers.clear_stop()
        _helpers._set_status({**_helpers._DEFAULT_STATUS})
        _clear_pending()
        bid = _queued_book(page_count=2)

        with patch.object(indexer, "_book_page_count", return_value=2), \
             patch.object(
                 indexer, "ocr_book_page_isolated_wrapper",
                 side_effect=lambda fp, i, should_stop=None, dpi=None: "t",
             ):
            completed = _helpers.run_ocr_queue()

        assert completed == 1
        db = SessionLocal()
        try:
            book = db.get(Book, bid)
            assert book.indexed is True
            assert book.ocr_pending is False
        finally:
            db.close()

    def test_empty_queue_is_noop(self):
        _helpers.clear_stop()
        _clear_pending()
        assert _helpers.run_ocr_queue() == 0

    def test_stop_halts_before_processing(self):
        _helpers._set_status({**_helpers._DEFAULT_STATUS})
        _clear_pending()
        _queued_book(page_count=2)
        _helpers.request_stop()
        try:
            with patch.object(indexer, "ocr_book_page_isolated_wrapper") as m:
                completed = _helpers.run_ocr_queue()
            assert completed == 0
            m.assert_not_called()
        finally:
            _helpers.clear_stop()
