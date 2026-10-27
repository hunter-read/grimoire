"""Tests for sampling a thin-text book before OCR, to tell a scan from artwork.

A PDF whose own text covers too little of it is queued for OCR (issue #685),
but a map pack or an art book looks the same to that test. The OCR worker reads
a few image-only pages first and, when they yield next to no words, indexes the
book from its own text instead. The per-page OCR and the text extraction are
stubbed, so no tesseract or real PDF is needed.
"""
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import text

from backend import indexer
from backend.config import SessionLocal
from backend.indexer import ocr_probe, reocr_applies, text_too_thin
from backend.indexer._subprocess import OCR_PAGE_ABANDONED, PdfExtractionCrashError
from backend.models import Book

SCANNED_PAGE = " ".join(["Dungeon masters describe the corridor"] * 20)
MAP_LABELS = "N 10 ft Ab Room 3"


def _thin_book(page_count: int = 10, text_pages: int = 2, pages_done: int = 0) -> str:
    uid = str(uuid.uuid4())[:8]
    db = SessionLocal()
    book = Book(
        title=f"Thin-{uid}",
        filename=f"thin-{uid}.pdf",
        filepath=f"/tmp/thin-{uid}.pdf",
        relative_path=f"thin-{uid}.pdf",
        mime_type="application/pdf",
        page_count=page_count,
        indexed=False,
        index_failed=False,
        ocr_pending=True,
        ocr_pages_done=pages_done,
        text_pages=text_pages,
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


# Two pages carrying a text layer of their own, long enough to count as one.
_COVER = " ".join(["Dungeons and Dragons, an adventure for four characters."] * 4)
_CREDITS = " ".join(["Design by the staff, cartography by the usual hands."] * 4)
_NATIVE = ([{"page": 1, "content": _COVER}, {"page": 10, "content": _CREDITS}], False)
# The same book, but what each page carries is only a running header.
_HEADERS = ([{"page": n, "content": "Chapter Five: The Fortress"} for n in range(1, 11)], False)


def _ocr_returning(content):
    seen: list[int] = []

    def ocr(fp, i, should_stop=None, dpi=None):
        seen.append(i)
        return content

    return ocr, seen


class TestHelpers:
    def test_only_a_fresh_pass_over_a_thin_book_is_sampled(self):
        assert ocr_probe.should_sample(SimpleNamespace(ocr_pages_done=0, text_pages=3))
        assert not ocr_probe.should_sample(SimpleNamespace(ocr_pages_done=0, text_pages=0))
        # A manual Re-OCR clears text_pages: the whole book was asked for.
        assert not ocr_probe.should_sample(SimpleNamespace(ocr_pages_done=0, text_pages=None))
        # Resuming: the sample already said "scan".
        assert not ocr_probe.should_sample(SimpleNamespace(ocr_pages_done=4, text_pages=3))

    def test_sample_pages_spread_through_the_book(self):
        assert ocr_probe.sample_pages([1, 2]) == [1, 2]
        assert ocr_probe.sample_pages(list(range(1, 9))) == [2, 5, 7]
        assert ocr_probe.sample_pages(list(range(100)), count=4) == [12, 37, 62, 87]

    def test_words_need_three_letters(self):
        assert ocr_probe.count_words("N 10 ft Ab Room 3 corridor ___ 1234") == 2
        assert ocr_probe.count_words("Übersicht über Räume") == 3


class TestProbe:
    def _probe(self, bid, ocr, extract=_NATIVE, should_stop=None):
        db = SessionLocal()
        try:
            book = db.get(Book, bid)
            kwargs = {"side_effect": extract} if isinstance(extract, Exception) else {
                "return_value": extract
            }
            with patch.object(indexer, "extract_text_isolated", **kwargs), patch.object(
                indexer, "ocr_book_page_isolated_wrapper", side_effect=ocr
            ):
                verdict = ocr_probe.probe(book, db, 10, should_stop)
            db.refresh(book)
            return verdict, book
        finally:
            db.close()

    def test_artwork_keeps_its_own_text(self):
        bid = _thin_book()
        ocr, seen = _ocr_returning(MAP_LABELS)
        verdict, book = self._probe(bid, ocr)
        assert verdict == "artwork"
        # Only image-only pages are sampled (indexes; pages 1 and 10 have text).
        assert seen and all(i not in (0, 9) for i in seen) and len(seen) == 3
        assert book.ocr_pending is False
        assert book.indexed is True
        assert book.index_error == ""
        assert book.text_pages == 2
        assert _search_pages(bid) == [1, 10]

    def test_header_only_pages_are_sampled(self):
        """A page carrying just a running header is one OCR would read, so the
        sample has to be taken from those pages - otherwise a scan stamped with
        its chapter title offers nothing to sample and can never be judged."""
        bid = _thin_book()
        ocr, seen = _ocr_returning(SCANNED_PAGE)
        verdict, book = self._probe(bid, ocr, extract=_HEADERS)
        assert verdict == "scan"
        assert len(seen) == 3
        assert book.ocr_pending is True

    def test_header_only_artwork_still_offers_reocr(self):
        """Judged artwork, the book keeps every page's text but counts none of
        it, so Re-OCR is still offered for it from the menu."""
        bid = _thin_book()
        ocr, _ = _ocr_returning(MAP_LABELS)
        verdict, book = self._probe(bid, ocr, extract=_HEADERS)
        assert verdict == "artwork"
        assert book.text_pages == 0
        assert _search_pages(bid) == list(range(1, 11))  # no page's text is lost

    def test_a_scan_goes_on_to_ocr(self):
        bid = _thin_book()
        ocr, _ = _ocr_returning(SCANNED_PAGE)
        verdict, book = self._probe(bid, ocr)
        assert verdict == "scan"
        assert book.ocr_pending is True
        assert _search_pages(bid) == []

    def test_abandoned_pages_say_nothing(self):
        bid = _thin_book()
        ocr, _ = _ocr_returning(OCR_PAGE_ABANDONED)
        assert self._probe(bid, ocr)[0] == "scan"

    def test_an_extraction_crash_errs_towards_ocr(self):
        bid = _thin_book()
        ocr, seen = _ocr_returning(MAP_LABELS)
        verdict, _ = self._probe(bid, ocr, extract=PdfExtractionCrashError("segfault"))
        assert verdict == "scan"
        assert seen == []

    def test_a_stop_during_extraction(self):
        bid = _thin_book()
        ocr, _ = _ocr_returning(MAP_LABELS)
        assert self._probe(bid, ocr, extract=TimeoutError())[0] == "stopped"

    def test_a_stop_before_a_page(self):
        bid = _thin_book()
        ocr, seen = _ocr_returning(MAP_LABELS)
        verdict, book = self._probe(bid, ocr, should_stop=lambda: True)
        assert verdict == "stopped"
        assert seen == []
        assert book.ocr_pending is True

    def test_a_stop_during_a_page(self):
        bid = _thin_book()
        calls = []

        def ocr(fp, i, should_stop=None, dpi=None):
            calls.append(i)
            return MAP_LABELS

        verdict, _ = self._probe(bid, ocr, should_stop=lambda: bool(calls))
        assert verdict == "stopped"
        assert len(calls) == 1


class TestOcrBookSamples:
    def test_artwork_is_not_read_in_full(self):
        bid = _thin_book()
        ocr, seen = _ocr_returning(MAP_LABELS)
        db = SessionLocal()
        try:
            book = db.get(Book, bid)
            with patch.object(indexer, "_book_page_count", return_value=10), patch.object(
                indexer, "extract_text_isolated", return_value=_NATIVE
            ), patch.object(indexer, "ocr_book_page_isolated_wrapper", side_effect=ocr):
                assert indexer.ocr_book(book, db) == "done"
        finally:
            db.close()
        assert len(seen) == 3
        assert _search_pages(bid) == [1, 10]

    def test_a_scan_is_read_in_full_after_the_sample(self):
        bid = _thin_book()
        ocr, seen = _ocr_returning(SCANNED_PAGE)
        db = SessionLocal()
        try:
            book = db.get(Book, bid)
            with patch.object(indexer, "_book_page_count", return_value=10), patch.object(
                indexer, "extract_text_isolated", return_value=_NATIVE
            ), patch.object(indexer, "ocr_book_page_isolated_wrapper", side_effect=ocr):
                assert indexer.ocr_book(book, db) == "done"
            db.refresh(book)
            assert book.index_error == "ocr"
        finally:
            db.close()
        assert len(seen) == 3 + 10
        assert _search_pages(bid) == list(range(1, 11))

    def test_a_stop_in_the_sample_leaves_the_book_queued(self):
        bid = _thin_book()
        db = SessionLocal()
        try:
            book = db.get(Book, bid)
            with patch.object(indexer, "_book_page_count", return_value=10), patch.object(
                indexer, "extract_text_isolated", side_effect=TimeoutError()
            ):
                assert indexer.ocr_book(book, db, should_stop=lambda: False) == "stopped"
            db.refresh(book)
            assert book.ocr_pending is True
        finally:
            db.close()

    def test_a_manual_re_ocr_is_not_sampled(self):
        bid = _thin_book(text_pages=None)
        ocr, seen = _ocr_returning(MAP_LABELS)
        db = SessionLocal()
        try:
            book = db.get(Book, bid)
            with patch.object(indexer, "_book_page_count", return_value=10), patch.object(
                indexer, "extract_text_isolated", side_effect=AssertionError("sampled")
            ), patch.object(indexer, "ocr_book_page_isolated_wrapper", side_effect=ocr):
                assert indexer.ocr_book(book, db) == "done"
        finally:
            db.close()
        assert seen == list(range(10))


def _book(**kw):
    defaults = dict(
        mime_type="application/pdf", index_failed=False, index_error="", indexed=True,
        text_pages=None, page_count=10,
    )
    return SimpleNamespace(**{**defaults, **kw})


class TestReocrApplies:
    """The one rule the Re-OCR endpoint and the book menus share."""

    def test_ocr_and_image_only_books(self):
        assert reocr_applies(_book(index_error="ocr"))
        assert reocr_applies(_book(index_error="image-only"))

    def test_a_thin_text_layer(self):
        assert reocr_applies(_book(text_pages=2))
        assert reocr_applies(_book(text_pages=0))
        assert not reocr_applies(_book(text_pages=9))

    def test_not_known_is_not_offered(self):
        # Never indexed since text_pages was added and not backfilled.
        assert not reocr_applies(_book(text_pages=None))
        assert not reocr_applies(_book(text_pages=2, indexed=False))

    def test_never_for_failures_or_other_formats(self):
        assert not reocr_applies(_book(index_error="ocr", index_failed=True))
        assert not reocr_applies(_book(index_error="ocr", mime_type="application/epub+zip"))
        assert not reocr_applies(_book(index_error="extraction crashed: x", text_pages=1))

    def test_thin_follows_the_setting(self):
        assert text_too_thin(4, 10)
        assert not text_too_thin(0, 10)
        assert not text_too_thin(4, 0)
        with patch("backend.config.OCR_MIN_TEXT_COVERAGE", 0.0):
            assert not text_too_thin(1, 10)
