"""Tests for the optional OCR path (backend/ocr.py) and its indexer integration.

pytesseract may not be installed in the test environment, so these tests inject
a fake pytesseract module via sys.modules where a working OCR engine is needed,
and exercise the real degradation path where it is absent.
"""

import sys
import types
import uuid
from unittest.mock import patch

from PIL import Image

from backend import config, ocr
from backend.config import SessionLocal
from backend.models import Book


def _fake_pytesseract(text="recognised text", version="5.0.0"):
    """Build a stand-in pytesseract module returning fixed OCR output."""
    mod = types.SimpleNamespace(
        image_to_string=lambda image, lang=None: text,
        get_tesseract_version=lambda: version,
    )
    return mod


# ---------------------------------------------------------------------------
# ocr_available — availability probe + graceful degradation
# ---------------------------------------------------------------------------


class TestAvailability:
    def teardown_method(self):
        ocr.reset_availability_cache()
        sys.modules.pop("pytesseract", None)

    def test_unavailable_when_pytesseract_missing(self):
        """No pytesseract installed → OCR degrades to unavailable, no raise."""
        ocr.reset_availability_cache()
        with patch.dict(sys.modules, {"pytesseract": None}):
            with patch.object(config, "OCR_ENABLED", True):
                assert ocr.ocr_available() is False

    def test_available_when_pytesseract_present(self):
        ocr.reset_availability_cache()
        with patch.dict(sys.modules, {"pytesseract": _fake_pytesseract()}):
            with patch.object(config, "OCR_ENABLED", True):
                assert ocr.ocr_available() is True

    def test_disabled_by_config_even_when_present(self):
        """OCR_ENABLED=false force-disables OCR regardless of tesseract."""
        ocr.reset_availability_cache()
        with patch.dict(sys.modules, {"pytesseract": _fake_pytesseract()}):
            with patch.object(config, "OCR_ENABLED", False):
                assert ocr.ocr_available() is False


# ---------------------------------------------------------------------------
# ocr_image — OCR execution, error and timeout handling
# ---------------------------------------------------------------------------


class TestOcrImage:
    def teardown_method(self):
        sys.modules.pop("pytesseract", None)

    def test_returns_recognised_text(self):
        img = Image.new("RGB", (10, 10), "white")
        with patch.dict(sys.modules, {"pytesseract": _fake_pytesseract("  hello  ")}):
            assert ocr.ocr_image(img) == "hello"

    def test_returns_empty_on_error(self):
        """A failing OCR call is swallowed and returns ""; never raises."""
        img = Image.new("RGB", (10, 10), "white")

        def _boom(image, lang=None):
            raise RuntimeError("tesseract exploded")

        mod = types.SimpleNamespace(image_to_string=_boom, get_tesseract_version=lambda: "5")
        with patch.dict(sys.modules, {"pytesseract": mod}):
            assert ocr.ocr_image(img) == ""

    def test_stop_request_aborts(self):
        """A stop request abandons an in-flight (blocking) OCR call, returning ""."""
        import time

        img = Image.new("RGB", (10, 10), "white")

        def _slow(image, lang=None):
            time.sleep(5)  # simulate a long-running OCR the stop request interrupts
            return "text"

        mod = types.SimpleNamespace(image_to_string=_slow, get_tesseract_version=lambda: "5")
        with patch.dict(sys.modules, {"pytesseract": mod}):
            assert ocr.ocr_image(img, should_stop=lambda: True) == ""


# ---------------------------------------------------------------------------
# extract_text_from_pdf — OCR fallback for pages with no text layer
# ---------------------------------------------------------------------------


class TestExtractOcrFallback:
    def teardown_method(self):
        ocr.reset_availability_cache()

    def test_ocr_used_when_no_text_layer(self, tmp_path):
        """A page with no embedded text is OCR'd when OCR is available."""
        import fitz

        pdf_path = tmp_path / "image_only.pdf"
        doc = fitz.open()
        doc.new_page()  # blank page — get_text() returns ""
        doc.save(str(pdf_path))
        doc.close()

        from backend import indexer

        with patch.object(ocr, "ocr_available", return_value=True):
            with patch.object(ocr, "ocr_pixmap", return_value="scanned words"):
                pages, used_ocr = indexer.extract_text_from_pdf(str(pdf_path))

        assert used_ocr is True
        assert pages == [{"page": 1, "content": "scanned words"}]

    def test_no_ocr_when_unavailable(self, tmp_path):
        """With OCR unavailable, a text-less page yields no pages (image-only)."""
        import fitz

        pdf_path = tmp_path / "image_only.pdf"
        doc = fitz.open()
        doc.new_page()
        doc.save(str(pdf_path))
        doc.close()

        from backend import indexer

        with patch.object(ocr, "ocr_available", return_value=False):
            pages, used_ocr = indexer.extract_text_from_pdf(str(pdf_path))

        assert used_ocr is False
        assert pages == []


# ---------------------------------------------------------------------------
# index_book_text — OCR marker on indexed books
# ---------------------------------------------------------------------------


class TestIndexMarker:
    def test_ocr_indexed_book_marked(self):
        from backend import indexer

        uid = str(uuid.uuid4())[:8]
        db = SessionLocal()
        try:
            book = Book(
                title=f"OCRBook-{uid}",
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

            pages = [{"page": 1, "content": "ocr text"}]
            with patch(
                "backend.indexer.extract_text_isolated", return_value=(pages, True)
            ):
                result = indexer.index_book_text(book, "/tmp", db)

            db.refresh(book)
            assert result is True
            assert book.indexed is True
            assert book.index_error == "ocr"
        finally:
            db.close()


# ---------------------------------------------------------------------------
# requeue_image_only_books — startup re-queue when OCR becomes available
# ---------------------------------------------------------------------------


class TestRequeue:
    def teardown_method(self):
        ocr.reset_availability_cache()

    def test_requeues_image_only_when_available(self):
        uid = str(uuid.uuid4())[:8]
        db = SessionLocal()
        try:
            book = Book(
                title=f"IO-{uid}",
                filename=f"io-{uid}.pdf",
                filepath=f"/tmp/io-{uid}.pdf",
                relative_path=f"io-{uid}.pdf",
                mime_type="application/pdf",
                indexed=True,
                index_error="image-only",
            )
            db.add(book)
            db.commit()
            book_id = book.id

            with patch.object(ocr, "ocr_available", return_value=True):
                count = ocr.requeue_image_only_books(db)

            assert count >= 1
            db.expire_all()
            refreshed = db.query(Book).filter_by(id=book_id).first()
            assert refreshed.indexed is False
            assert refreshed.index_error == ""
        finally:
            db.close()

    def test_noop_when_unavailable(self):
        uid = str(uuid.uuid4())[:8]
        db = SessionLocal()
        try:
            book = Book(
                title=f"IO-{uid}",
                filename=f"io2-{uid}.pdf",
                filepath=f"/tmp/io2-{uid}.pdf",
                relative_path=f"io2-{uid}.pdf",
                mime_type="application/pdf",
                indexed=True,
                index_error="image-only",
            )
            db.add(book)
            db.commit()
            book_id = book.id

            with patch.object(ocr, "ocr_available", return_value=False):
                count = ocr.requeue_image_only_books(db)

            assert count == 0
            db.expire_all()
            refreshed = db.query(Book).filter_by(id=book_id).first()
            assert refreshed.indexed is True
            assert refreshed.index_error == "image-only"
        finally:
            db.close()
