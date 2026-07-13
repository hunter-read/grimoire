"""Optional OCR support for image-only PDFs.

Image-only PDFs (scanned pages with no embedded text layer) yield no text from
PyMuPDF's ``get_text()`` and are otherwise excluded from full-text search. When
Tesseract is available, the indexer renders each such page to an image and runs
it through OCR here so the recognised text can be added to the FTS index.

Everything is best-effort and degrades gracefully: on the ``-slim`` image the
tesseract binary is absent, ``ocr_available()`` returns False, and callers fall
back to the pre-OCR ``image-only`` behaviour. OCR is CPU-heavy and can hang on
pathological input, so ``ocr_image`` runs Tesseract in a daemon thread with a
timeout, mirroring the rest of the indexer.
"""

import logging
import threading

from PIL import Image

from . import config

logger = logging.getLogger("grimoire.ocr")

# Per-page OCR budget. Scanned pages are slow; anything beyond this is treated
# as a hang and abandoned so a single bad page can't stall the whole scan.
_OCR_TIMEOUT = 120  # seconds

# Cached result of the tesseract-binary probe (None = not yet probed).
_available: bool | None = None


def _probe_tesseract() -> bool:
    """Return True if pytesseract is importable and the tesseract binary runs."""
    try:
        import pytesseract  # local import keeps startup light on slim images

        pytesseract.get_tesseract_version()
        return True
    except Exception as exc:  # ImportError, TesseractNotFoundError, etc.
        logger.debug(f"Tesseract not available: {exc}")
        return False


def ocr_available() -> bool:
    """Whether OCR can run: enabled in config AND tesseract is usable.

    The tesseract probe is cached after the first call; ``OCR_ENABLED`` is read
    live so tests can toggle it without clearing the cache.
    """
    global _available
    if not config.OCR_ENABLED:
        return False
    if _available is None:
        _available = _probe_tesseract()
        if _available:
            logger.info(f"OCR enabled (languages: {config.OCR_LANGUAGES})")
        else:
            logger.info("OCR disabled — tesseract binary not found")
    return _available


def reset_availability_cache() -> None:
    """Clear the cached tesseract probe (used by tests)."""
    global _available
    _available = None


def requeue_image_only_books(session) -> int:
    """Reset books previously marked ``image-only`` so the next scan OCRs them.

    Called on startup: when OCR has become available (e.g. after upgrading from
    the slim image or enabling OCR), previously-skipped image-only PDFs are
    re-queued by clearing ``indexed``. No-op — returning 0 — when OCR is
    unavailable, so slim installs never churn. Returns the number re-queued.
    """
    if not ocr_available():
        return 0

    from sqlalchemy import text as _sql_text

    result = session.execute(
        _sql_text(
            "UPDATE books SET indexed = 0, index_error = '' "
            "WHERE index_error = 'image-only' AND indexed = 1"
        )
    )
    count = result.rowcount or 0
    if count:
        session.commit()
        logger.info(f"OCR: re-queued {count} previously image-only book(s) for indexing")
    return count


def _ocr_task(image: Image.Image, result: list, exc: list) -> None:
    """Worker executed in a daemon thread by ocr_image."""
    try:
        import pytesseract

        result[0] = pytesseract.image_to_string(image, lang=config.OCR_LANGUAGES)
    except Exception as e:
        exc[0] = e


def ocr_image(image: Image.Image, should_stop=None) -> str:
    """Run OCR on a PIL image, returning the recognised text (stripped).

    Runs in a daemon thread with a timeout so a wedged OCR call can't hang the
    scan. Returns "" on timeout, error, or empty result — never raises.
    """
    result = [None]
    exc = [None]
    t = threading.Thread(target=_ocr_task, args=(image, result, exc), daemon=True)
    t.start()
    poll_interval = 0.5
    elapsed = 0.0
    while t.is_alive() and elapsed < _OCR_TIMEOUT:
        t.join(poll_interval)
        elapsed += poll_interval
        if should_stop and should_stop():
            logger.warning("OCR aborted by stop request")
            return ""
    if t.is_alive():
        logger.error(f"OCR timed out after {_OCR_TIMEOUT}s")
        return ""
    if exc[0] is not None:
        logger.error(f"OCR failed: {exc[0]}")
        return ""
    return (result[0] or "").strip()


def ocr_pixmap(pixmap, should_stop=None) -> str:
    """Run OCR on a PyMuPDF pixmap by converting it to a PIL image first."""
    try:
        image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
    except Exception as exc:
        logger.error(f"Could not convert page pixmap for OCR: {exc}")
        return ""
    return ocr_image(image, should_stop=should_stop)
