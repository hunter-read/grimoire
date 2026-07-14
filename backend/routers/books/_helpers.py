"""In-process caches and shared helpers for book endpoints."""
import functools
import threading
from collections import OrderedDict
from typing import Optional

import fitz  # type: ignore[import-untyped]

from ...config import SessionLocal, logger
from ...models import Book, User


# LRU cache of open fitz Documents (avoids re-opening large PDFs on every render).
# fitz documents are thread-safe for concurrent read operations.
_PDF_CACHE_MAX = 10
_pdf_cache: OrderedDict = OrderedDict()
_pdf_cache_lock = threading.Lock()


def _get_pdf_doc(filepath: str) -> fitz.Document:
    with _pdf_cache_lock:
        if filepath in _pdf_cache:
            _pdf_cache.move_to_end(filepath)
            return _pdf_cache[filepath]
        doc = fitz.open(filepath)
        _pdf_cache[filepath] = doc
        if len(_pdf_cache) > _PDF_CACHE_MAX:
            _, evicted = _pdf_cache.popitem(last=False)
            try:
                evicted.close()
            except (RuntimeError, ValueError) as e:
                # Best-effort: the evicted document may already be closed or
                # broken. Log at debug so a leaked handle is diagnosable.
                logger.debug("Failed to close evicted PDF document: %s", e)
        return doc


@functools.lru_cache(maxsize=2000)
def _cached_book_info(book_id: str) -> Optional[tuple]:
    """Returns (filepath, mime_type, title) or None."""
    db = SessionLocal()
    try:
        book = db.query(Book).filter_by(id=book_id).first()
        if not book:
            return None
        return (book.filepath, book.mime_type, book.title)
    finally:
        db.close()


def _invalidate_book_cache():
    """Call after any rescan to flush stale entries."""
    _cached_book_info.cache_clear()


def _allow_explicit(db, user_id: str) -> bool:
    u = db.query(User).filter_by(id=user_id).first()
    return bool(u.allow_explicit) if u and u.allow_explicit is not None else True
