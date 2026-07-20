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

    The tesseract probe is cached after the first call; ``OCR_ENABLED`` and
    ``OCR_CONCURRENCY`` are read live so tests can toggle them without clearing
    the cache. ``OCR_CONCURRENCY == 0`` is a runtime off switch, equivalent to
    ``OCR_ENABLED=false``.
    """
    global _available
    if not config.OCR_ENABLED or config.OCR_CONCURRENCY == 0:
        return False
    if _available is None:
        _available = _probe_tesseract()
        if _available:
            logger.info(f"Text recognition for scanned books is on (languages: {config.OCR_LANGUAGES}).")
        else:
            logger.info("Text recognition for scanned books is off — Tesseract isn't installed.")
    return _available


def reset_availability_cache() -> None:
    """Clear the cached tesseract probe (used by tests)."""
    global _available
    _available = None


def effective_languages() -> str:
    """The Tesseract language string to OCR with (mirrors ``config.OCR_LANGUAGES``)."""
    return config.OCR_LANGUAGES


def requeue_image_only_books(session) -> int:
    """Queue books previously marked ``image-only`` for deferred OCR.

    Called on startup: when OCR has become available (e.g. after upgrading from
    the slim image or enabling OCR), previously-skipped image-only PDFs are moved
    into the deferred-OCR queue (``ocr_pending=1``) with their page checkpoint
    reset, rather than OCR'd inline during the next scan. No-op — returning 0 —
    when OCR is unavailable, so slim installs never churn. Returns the number
    queued.
    """
    if not ocr_available():
        return 0

    from sqlalchemy import text as _sql_text

    result = session.execute(
        _sql_text(
            "UPDATE books SET ocr_pending = 1, ocr_pages_done = 0, indexed = 0, "
            "index_failed = 0, index_error = '' "
            "WHERE index_error = 'image-only'"
        )
    )
    count = result.rowcount or 0
    if count:
        session.commit()
        logger.info(f"Queued {count} scanned book(s) to read text from on the next scan.")
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
            logger.debug("OCR aborted by stop request")
            return ""
    if t.is_alive():
        logger.warning(f"Gave up reading a page after {_OCR_TIMEOUT}s — skipping it.")
        return ""
    if exc[0] is not None:
        logger.warning(f"Couldn't read text from a page: {exc[0]}")
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
