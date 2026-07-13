"""Standalone PDF text-extraction worker for the isolated extraction subprocess.

This module is the entry point run inside the spawned child process created by
``indexer.extract_text_isolated``.  It deliberately imports **nothing** from the
rest of the ``backend`` package: importing ``backend.config`` at module load
runs Alembic migrations, opens the SQLite engine, and pings Valkey — none of
which a throwaway extraction process should do.  Everything here depends only on
``fitz`` (always needed) and, when OCR is configured, ``PIL``/``pytesseract``.

Keep the extraction logic in ``run`` behaviourally identical to
``indexer.extract_text_from_pdf`` (the in-process reference used by tests and the
OCR fallback).  ``tests/test_pdf_worker.py`` guards against drift by asserting
the two produce the same output.
"""

import os
import pickle

import fitz  # PyMuPDF


def _ocr_settings() -> tuple[bool, str]:
    """Read OCR config from the environment (mirrors backend.config defaults).

    Returns ``(enabled, languages)``.  ``enabled`` also requires the tesseract
    binary to be importable and runnable, probed lazily so the slim image (no
    tesseract) simply skips OCR.
    """
    enabled = os.environ.get("OCR_ENABLED", "true").lower() == "true"
    languages = os.environ.get("OCR_LANGUAGES", "eng").strip() or "eng"
    if not enabled:
        return False, languages
    try:
        import pytesseract

        pytesseract.get_tesseract_version()
        return True, languages
    except Exception:
        return False, languages


def run(filepath: str) -> tuple[list[dict], bool]:
    """Extract text from every page of ``filepath``.

    Returns ``(pages, used_ocr)`` matching ``indexer.extract_text_from_pdf``:
    pages with an embedded text layer are read directly; text-less pages are
    OCR'd when OCR is available, otherwise skipped.
    """
    pages: list[dict] = []
    used_ocr = False
    ocr_on, languages = _ocr_settings()
    doc = fitz.open(filepath)
    try:
        for i, page in enumerate(doc):
            page_text = page.get_text().strip()
            if page_text:
                pages.append({"page": i + 1, "content": page_text})
            elif ocr_on:
                ocr_text = _ocr_page(page, languages)
                if ocr_text:
                    pages.append({"page": i + 1, "content": ocr_text})
                    used_ocr = True
    finally:
        doc.close()
    return pages, used_ocr


def _ocr_page(page, languages: str) -> str:
    """Render a page to an image and OCR it, returning stripped text ("" on failure)."""
    try:
        from PIL import Image
        import pytesseract

        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        return pytesseract.image_to_string(image, lang=languages).strip()
    except Exception:
        return ""


def main(filepath: str, result_path: str) -> None:
    """Subprocess entry point: extract and pickle ``(pages, used_ocr)`` to disk.

    Writing to a file rather than a pipe/queue avoids the deadlock where a child
    blocks writing a large payload the parent hasn't drained.  Any exception
    propagates and the process exits nonzero, which the parent treats as a
    crash — the result file is left empty so the parent can tell.
    """
    result = run(filepath)
    with open(result_path, "wb") as fh:
        pickle.dump(result, fh)
