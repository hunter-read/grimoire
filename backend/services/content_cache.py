"""Invalidation and eviction for the caches derived from a library file's bytes.

Rendering a PDF page is expensive, so the result is cached in up to four places:
Valkey, an on-disk WebP, an open ``fitz`` document handle, and the FTS5 rows that
back search. Thumbnails are a fifth. Every one of them was keyed by ``book.id`` or
by a hash of the file's *path*, none of which change when the file at that path is
replaced — so a swapped-in PDF kept serving the old file's pages indefinitely.

Two mechanisms fix that, and this module owns both:

* ``invalidate_book_content`` drops everything derived from a book's old bytes. It
  lives here rather than in the scanner because three callers need it — the
  library scan, the per-book rescan endpoint, and move detection — and an
  invalidation that misses one layer is indistinguishable from no invalidation at
  all.
* ``sweep_page_cache`` bounds the on-disk cache, which previously had no TTL, no
  size cap, and no deletion path whatsoever.
"""
import hashlib
import os
import time
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import PAGE_CACHE_DIR, PAGE_CACHE_MAX_MB, logger, purge_valkey_keys


def page_cache_prefix(filepath: str) -> str:
    """The on-disk page-cache filename prefix for ``filepath``.

    Derived from the DB-sourced path (never user input) so no tainted data
    reaches the filesystem. Must stay in sync with the render path in
    ``routers/books/pages.py``.
    """
    return hashlib.sha1(filepath.encode()).hexdigest()[:16]


def content_token(content_hash: Optional[str], filepath: str) -> str:
    """Short cache-busting token identifying a file's *contents*.

    Falls back to a digest of the path for rows that predate content hashing, which
    reproduces the old (path-keyed) behaviour rather than colliding with it — those
    rows get a real hash on the next scan.
    """
    if content_hash:
        return content_hash[:8]
    return hashlib.sha1(filepath.encode()).hexdigest()[:8]


def purge_disk_pages(filepath: str) -> int:
    """Delete every cached page render for ``filepath``. Returns files removed.

    Covers all render widths and both the pre- and post-content-hash filename
    layouts, since the prefix is unchanged by design.
    """
    prefix = page_cache_prefix(filepath)
    removed = 0
    try:
        with os.scandir(PAGE_CACHE_DIR) as entries:
            targets = [e.path for e in entries if e.name.startswith(f"{prefix}_")]
    except OSError as e:
        logger.warning(f"Page cache scan failed: {e}")
        return 0
    for path in targets:
        try:
            os.remove(path)
            removed += 1
        except OSError as e:
            logger.debug("Could not remove cached page %s: %s", path, e)
    return removed


def invalidate_book_content(
    book_id: str,
    filepath: str,
    db: Optional[Session] = None,
    thumb_path: Optional[str] = None,
) -> None:
    """Drop everything derived from a book's previous contents.

    Call whenever a book's bytes change under a path we have already rendered:
    an in-place replacement found by the scan, a manual per-book rescan, or a
    detected move (where the *old* path's artifacts must go).

    Each layer is best-effort and independent — a Valkey outage must not prevent
    the disk cache from being cleared, so failures are logged, not raised.
    """
    # Valkey: every width and page for this book, both the content-addressed key
    # layout and the legacy id-only one written before this change.
    try:
        purged = purge_valkey_keys(f"page:{book_id}:*")
    except Exception as e:
        logger.warning(f"Could not purge Valkey pages for {book_id}: {e}")
        purged = 0

    # Disk: the renders that would otherwise re-poison Valkey on the next request.
    try:
        removed = purge_disk_pages(filepath)
    except OSError as e:
        logger.warning(f"Could not purge disk pages for {filepath}: {e}")
        removed = 0

    # The open fitz handle still points at the replaced file's inode.
    from ..routers.books._helpers import _invalidate_book_cache, evict_pdf

    try:
        evict_pdf(filepath)
    except Exception as e:
        logger.warning(f"Could not evict cached PDF handle for {filepath}: {e}")

    # FTS rows: search would otherwise return the old book's text. The scan
    # re-indexes because the caller also resets ``indexed``.
    if db is not None:
        try:
            db.execute(text("DELETE FROM book_search WHERE book_id = :bid"), {"bid": book_id})
        except Exception as e:
            logger.warning(f"Could not clear search index for {book_id}: {e}")

    if thumb_path:
        try:
            os.remove(thumb_path)
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.debug("Could not remove stale thumbnail %s: %s", thumb_path, e)

    _invalidate_book_cache()
    logger.debug(
        "Invalidated caches for book %s: %d Valkey key(s), %d cached page(s)",
        book_id,
        purged,
        removed,
    )


def sweep_page_cache(max_mb: Optional[int] = None) -> int:
    """Trim the on-disk page cache to ``PAGE_CACHE_MAX_MB``, oldest first.

    Returns the number of files removed. A no-op when the cap is 0 (disabled) or
    the cache is already under it. Runs at startup and after a scan — never per
    request, since it stats the whole directory.

    Eviction is by last-access time where the filesystem records it, falling back
    to mtime (``relatime`` and ``noatime`` mounts make atime unreliable, but the
    ordering only needs to be approximately LRU — every entry is regenerable).
    """
    cap_mb = PAGE_CACHE_MAX_MB if max_mb is None else max_mb
    if cap_mb <= 0:
        return 0
    cap_bytes = cap_mb * 1024 * 1024

    entries: list[tuple[float, int, str]] = []
    total = 0
    try:
        with os.scandir(PAGE_CACHE_DIR) as it:
            for entry in it:
                try:
                    if not entry.is_file():
                        continue
                    st = entry.stat()
                except OSError:
                    continue
                total += st.st_size
                entries.append((max(st.st_atime, st.st_mtime), st.st_size, entry.path))
    except OSError as e:
        logger.warning(f"Page cache sweep failed to read {PAGE_CACHE_DIR}: {e}")
        return 0

    if total <= cap_bytes:
        return 0

    entries.sort(key=lambda e: e[0])
    removed = 0
    started = time.monotonic()
    for _, size, path in entries:
        if total <= cap_bytes:
            break
        try:
            os.remove(path)
        except OSError:
            continue
        total -= size
        removed += 1
    logger.info(
        "Page cache sweep removed %d file(s) in %.1fs, now ~%d MiB (cap %d MiB)",
        removed,
        time.monotonic() - started,
        total // (1024 * 1024),
        cap_mb,
    )
    return removed
