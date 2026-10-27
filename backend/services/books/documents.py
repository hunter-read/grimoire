"""The open-document cache behind every PDF page render, and the book lookup cache.

Page, tile and export routes and the render pool's workers all lease documents
here, so a book is opened once and a replaced file is never served stale.
"""
import functools
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from typing import Iterator, Optional

import fitz  # type: ignore[import-untyped]

from ...config import PAGE_IDLE_RELEASE, PAGE_RECLAIM_INTERVAL, SessionLocal, logger
from ...indexer.formats import open_document
from ...models import Book
from ...render.memory import reclaim_render_memory as _reclaim_render_memory


class _CachedDoc:
    """An open fitz Document plus how many requests are using it right now.

    A document leaves the cache (LRU eviction, file replaced, idle release) the
    moment it is retired, but it is only *closed* once its last user is done:
    closing it under a render in another thread would pull the document out
    from under that render.

    ``lock`` serialises *use*: PyMuPDF does not support two threads in one
    document at once ("may cause incorrect behaviour or even crash Python"),
    and page handlers run on the threadpool, so two people reading the same
    book would otherwise be exactly that. It costs no throughput, since PyMuPDF
    holds the GIL while it renders anyway. Re-entrant so a nested open_pdf() of
    the same file on one thread can't deadlock itself.
    """

    __slots__ = ("doc", "users", "retired", "lock")

    def __init__(self, doc: fitz.Document) -> None:
        self.doc = doc
        self.users = 0
        self.retired = False
        self.lock = threading.RLock()


# LRU cache of open fitz Documents (avoids re-opening large PDFs on every render).
# Use them only through open_pdf(), which leases the document for the duration.
_PDF_CACHE_MAX = 10
_pdf_cache: "OrderedDict[str, _CachedDoc]" = OrderedDict()
_pdf_cache_lock = threading.Lock()
# monotonic time a document was last leased or handed back; read by the idle sweeper.
_last_pdf_use = 0.0
# Bumped by evict_pdf(). Documents are opened outside _pdf_cache_lock, so a file
# replaced mid-open would otherwise have its old handle cached after the evict.
_evictions = 0
_sweeper: threading.Thread | None = None


# Renders since the last reclaim. PDF page handlers are sync defs run across the
# threadpool, so this counter is shared and guarded by its own lock.
_render_count = 0
_render_count_lock = threading.Lock()


def note_page_render() -> bool:
    """Count one rasterization, reclaiming memory every PAGE_RECLAIM_INTERVAL.

    Returns whether a reclaim ran (for tests). Callers should invoke this after
    a render completes and its pixmap has been released, never on a cache hit.
    """
    global _render_count
    if PAGE_RECLAIM_INTERVAL <= 0:
        return False
    with _render_count_lock:
        _render_count += 1
        if _render_count < PAGE_RECLAIM_INTERVAL:
            return False
        _render_count = 0
    # Reclaim outside the lock: it's slow-ish and other threads only need the
    # counter, not to be serialised behind the trim.
    _reclaim_render_memory()
    return True


def _close_doc(doc: fitz.Document, why: str) -> None:
    try:
        doc.close()
    except (RuntimeError, ValueError) as e:
        # Best-effort: the document may already be closed or broken. Log at
        # debug so a leaked handle is diagnosable.
        logger.debug("Failed to close %s PDF document: %s", why, e)


def _retire(entry: _CachedDoc) -> Optional[fitz.Document]:
    """Mark a document as leaving the cache. Caller holds _pdf_cache_lock.

    Returns the document if nobody is using it, for the caller to close once the
    lock is released; otherwise its last user closes it in _release_pdf().
    """
    entry.retired = True
    return entry.doc if entry.users == 0 else None


def _acquire_pdf(filepath: str) -> _CachedDoc:
    global _last_pdf_use
    with _pdf_cache_lock:
        _last_pdf_use = time.monotonic()
        _ensure_idle_sweeper()
        entry = _pdf_cache.get(filepath)
        if entry is not None:
            _pdf_cache.move_to_end(filepath)
            entry.users += 1
            return entry
        evictions = _evictions

    # Opened outside the lock: a large PDF or an EPUB reflow can take seconds,
    # and holding the lock would stall every other render, cache hits for
    # unrelated books included. open_document applies the shared reflow layout,
    # so an EPUB served by the reader paginates exactly as the indexer counted
    # and indexed it (issue #373). A no-op for fixed-layout formats like PDF.
    opened = _CachedDoc(open_document(filepath))

    to_close = []
    with _pdf_cache_lock:
        entry = _pdf_cache.get(filepath)
        if entry is not None:
            # Another thread opened it meanwhile: use theirs, drop ours.
            _pdf_cache.move_to_end(filepath)
            to_close.append((opened.doc, "duplicate"))
        elif evictions != _evictions:
            # The file may have been replaced while we opened it. Serve this
            # request from what we opened, but don't cache it: the next one reopens.
            entry = opened
            entry.retired = True
        else:
            entry = opened
            _pdf_cache[filepath] = entry
            while len(_pdf_cache) > _PDF_CACHE_MAX:
                _, evicted = _pdf_cache.popitem(last=False)
                doc = _retire(evicted)
                if doc is not None:
                    to_close.append((doc, "evicted"))
        entry.users += 1
    for doc, why in to_close:
        _close_doc(doc, why)
    return entry


def _release_pdf(entry: _CachedDoc) -> None:
    global _last_pdf_use
    with _pdf_cache_lock:
        entry.users -= 1
        # A long render counts as reading right up to the moment it finishes.
        _last_pdf_use = time.monotonic()
        close = entry.retired and entry.users == 0
    if close:
        _close_doc(entry.doc, "retired")


@contextmanager
def open_pdf(filepath: str) -> Iterator[fitz.Document]:
    """The cached fitz Document for ``filepath``, leased for the ``with`` block.

    Use the document (and any page taken from it) only inside the block. While
    it is leased it is never closed, even if it is evicted, its file is
    replaced, or the idle release runs; the last lease closes it then.

    The block also holds the document's lock, so other threads using the same
    book wait for it. Keep it to MuPDF work: copy the pixels out and encode
    them after the block, since Pillow's encoder releases the GIL and runs in
    parallel with other renders.
    """
    entry = _acquire_pdf(filepath)
    try:
        with entry.lock:
            yield entry.doc
    finally:
        _release_pdf(entry)


@functools.lru_cache(maxsize=2000)
def cached_book_info(book_id: str) -> Optional[tuple]:
    """Returns (filepath, mime_type, title, content_hash) or None.

    ``content_hash`` is what makes the render caches content-addressed; it is None
    for rows the scanner has not hashed yet, and callers fall back to a path digest
    in that case.
    """
    db = SessionLocal()
    try:
        book = db.query(Book).filter_by(id=book_id).first()
        if not book:
            return None
        return (book.filepath, book.mime_type, book.title, book.content_hash)
    finally:
        db.close()


def _ensure_idle_sweeper() -> None:
    """Start the idle sweeper if it isn't running. Caller holds _pdf_cache_lock.

    The thread exists only while documents are open: it exits after releasing
    them, so an idle server runs no extra thread at all.
    """
    global _sweeper
    if PAGE_IDLE_RELEASE <= 0 or _sweeper is not None:
        return
    _sweeper = threading.Thread(target=_idle_sweep, name="pdf-idle-release", daemon=True)
    _sweeper.start()


def release_idle_documents(now: float | None = None) -> bool:
    """Close every cached document and reclaim render memory if reading has gone idle.

    Returns whether a release happened: only once no document has been leased
    or handed back for the whole PAGE_IDLE_RELEASE window. A document still
    leased by a render leaves the cache too, but is closed by that render when it
    finishes rather than here.
    """
    now = time.monotonic() if now is None else now
    with _pdf_cache_lock:
        if now - _last_pdf_use < PAGE_IDLE_RELEASE:
            return False
        docs = [doc for entry in _pdf_cache.values() if (doc := _retire(entry)) is not None]
        _pdf_cache.clear()
    for doc in docs:
        _close_doc(doc, "idle")
    _reclaim_render_memory()
    return True


def _idle_sweep() -> None:
    global _sweeper
    # Wake at a fraction of the window so release lands within ~25% of it.
    interval = max(1.0, PAGE_IDLE_RELEASE / 4)
    while True:
        time.sleep(interval)
        if release_idle_documents():
            logger.debug("Released idle PDF documents and render memory")
        # Exit only when nothing is open, deciding under the same lock
        # _acquire_pdf takes: a book opened after this point sees _sweeper is
        # None and starts a fresh sweeper, so no open document is ever orphaned.
        with _pdf_cache_lock:
            if not _pdf_cache:
                _sweeper = None
                return


def evict_pdf(filepath: str) -> bool:
    """Close and drop the cached fitz handle for ``filepath``. Returns whether one was held.

    Required when a file is replaced in place: the cached handle refers to the
    *old* document, and on POSIX the unlinked inode stays alive as long as we
    hold it open, so every subsequent render would keep serving the previous
    file's pages until the entry aged out of the LRU. A render already in
    progress finishes on the old handle and closes it; the next one reopens.
    """
    global _evictions
    with _pdf_cache_lock:
        _evictions += 1
        entry = _pdf_cache.pop(filepath, None)
        if entry is None:
            return False
        doc = _retire(entry)
    if doc is not None:
        _close_doc(doc, "replaced")
    return True


def invalidate_book_cache() -> None:
    """Call after any rescan to flush stale entries."""
    cached_book_info.cache_clear()
