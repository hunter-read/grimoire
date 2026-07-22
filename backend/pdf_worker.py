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


def run(filepath: str, text_only: bool = False) -> tuple[list[dict], bool]:
    """Extract text from every page of ``filepath``.

    Returns ``(pages, used_ocr)`` matching ``indexer.extract_text_from_pdf``:
    pages with an embedded text layer are read directly; text-less pages are
    OCR'd when OCR is available, otherwise skipped.

    When ``text_only`` is True, OCR is skipped entirely — only the embedded text
    layer is read.  The deferred-OCR pipeline uses this for the fast scan phase:
    image-only pages come back missing (empty ``pages``), the caller queues the
    book for OCR, and OCR runs later page-by-page via ``ocr_page`` so a slow
    scanned book never blocks or times out the main scan.
    """
    pages: list[dict] = []
    used_ocr = False
    ocr_on = False if text_only else _ocr_settings()[0]
    languages = _ocr_settings()[1] if ocr_on else "eng"
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


def ocr_page(filepath: str, page_index: int, languages: str, dpi: int | None = None) -> str:
    """OCR a single 0-based page of ``filepath``, returning stripped text.

    Used by the deferred-OCR worker's isolated subprocess so a native crash or
    hang while OCRing one page can't take down the server or the whole book —
    the parent checkpoints progress and resumes at the next page.  Returns "" on
    any failure (page already has a text layer, render error, OCR error).

    ``dpi`` overrides the resolution the page is rasterized at; None uses the
    global ``OCR_DPI`` default. Used by the per-book re-OCR flow to re-read a
    specific book at a sharper resolution.
    """
    doc = fitz.open(filepath)
    try:
        page = doc[page_index]
        # A page that already has embedded text was handled in the fast phase;
        # OCRing it again would duplicate content in the index.
        if page.get_text().strip():
            return ""
        return _ocr_page(page, languages, dpi=dpi)
    finally:
        doc.close()


def _ocr_scale(dpi: int | None = None) -> float:
    """Rasterization scale for OCR (72 DPI × scale). Mirrors backend.config default.

    Rendering is the CPU/memory-heavy half of OCR: a page's bitmap is
    ``(scale·width_pt) × (scale·height_pt) × 3`` bytes in memory. The default
    ``OCR_DPI=150`` (scale ≈ 2.08) is a good accuracy/cost balance for Tesseract;
    lower it (e.g. 100) to cut render time and per-process memory on small hosts,
    raise it (e.g. 300) for cleaner OCR on faint scans at higher cost.

    An explicit ``dpi`` (per-book override) wins over the ``OCR_DPI`` env default.
    """
    if dpi is not None:
        try:
            value = float(dpi)
        except (TypeError, ValueError):
            value = 150.0
    else:
        try:
            value = float(os.environ.get("OCR_DPI", "150"))
        except ValueError:
            value = 150.0
    value = max(72.0, min(value, 600.0))  # clamp to a sane range
    return value / 72.0


def _ocr_page(page: "fitz.Page", languages: str, dpi: int | None = None) -> str:
    """Render a page to an image and OCR it, returning stripped text ("" on failure)."""
    try:
        from PIL import Image
        import pytesseract

        scale = _ocr_scale(dpi)
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        return pytesseract.image_to_string(image, lang=languages).strip()
    except Exception:
        return ""


def main(filepath: str, result_path: str, text_only: bool = False) -> None:
    """Subprocess entry point: extract and pickle ``(pages, used_ocr)`` to disk.

    Writing to a file rather than a pipe/queue avoids the deadlock where a child
    blocks writing a large payload the parent hasn't drained.  Any exception
    propagates and the process exits nonzero, which the parent treats as a
    crash — the result file is left empty so the parent can tell.
    """
    result = run(filepath, text_only=text_only)
    with open(result_path, "wb") as fh:
        pickle.dump(result, fh)


def ocr_page_main(
    filepath: str, page_index: int, languages: str, result_path: str, dpi: int | None = None
) -> None:
    """Subprocess entry point for OCRing a single page (deferred-OCR worker).

    Pickles the recognised text to ``result_path``.  A crash leaves the file
    empty, which the parent treats as a failed page and skips. ``dpi`` overrides
    the rasterization resolution (per-book re-OCR); None uses the global default.
    """
    text = ocr_page(filepath, page_index, languages, dpi=dpi)
    with open(result_path, "wb") as fh:
        pickle.dump(text, fh)
