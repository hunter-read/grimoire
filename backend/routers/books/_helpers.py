"""In-process caches and shared helpers for book endpoints."""
import ctypes
import functools
import platform
import threading
from collections import OrderedDict
from typing import Optional

import fitz  # type: ignore[import-untyped]
from fastapi import HTTPException

from ...config import PAGE_RECLAIM_INTERVAL, SessionLocal, logger
from ...indexer.formats import open_document
from ...models import Book, User
from ...services import access_control
from ._schemas import ACCESS_INHERIT


# LRU cache of open fitz Documents (avoids re-opening large PDFs on every render).
# fitz documents are thread-safe for concurrent read operations.
_PDF_CACHE_MAX = 10
_pdf_cache: OrderedDict = OrderedDict()
_pdf_cache_lock = threading.Lock()


# glibc's malloc_trim() is what actually returns freed arenas to the OS. It does
# not exist on musl (Alpine), so resolve it once and treat absence as "no trim"
# rather than assuming the symbol is there.
def _resolve_malloc_trim():
    if platform.system() != "Linux":
        return None
    try:
        libc = ctypes.CDLL("libc.so.6")
    except OSError:
        return None  # musl / non-glibc: nothing to call
    return getattr(libc, "malloc_trim", None)


_malloc_trim = _resolve_malloc_trim()

# Renders since the last reclaim. PDF page handlers are sync defs run across the
# threadpool, so this counter is shared and guarded by its own lock.
_render_count = 0
_render_count_lock = threading.Lock()


def _reclaim_render_memory() -> None:
    """Release MuPDF's C-side store and hand the freed arenas back to the OS.

    Both halves are required and neither is Python-level. MuPDF decodes every
    embedded image on a page to raw RGB to rasterize it, and caches that in a
    process-global store, so ``gc.collect()`` and ``doc.close()`` reclaim
    nothing — the allocations were never on Python's heap and aren't owned by
    the document. ``store_shrink`` frees them inside MuPDF; ``malloc_trim`` then
    releases the now-empty glibc arenas, which is the step that actually moves
    RSS back down.
    """
    try:
        fitz.TOOLS.store_shrink(100)
    except Exception as e:  # pragma: no cover - defensive; API varies by build
        logger.debug("MuPDF store_shrink failed: %s", e)
    if _malloc_trim is not None:
        try:
            _malloc_trim(0)
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("malloc_trim failed: %s", e)


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


def _get_pdf_doc(filepath: str) -> fitz.Document:
    with _pdf_cache_lock:
        if filepath in _pdf_cache:
            _pdf_cache.move_to_end(filepath)
            return _pdf_cache[filepath]
        # open_document applies the shared reflow layout, so an EPUB served by
        # the reader paginates exactly as the indexer counted and indexed it
        # (issue #373). A no-op for fixed-layout formats like PDF.
        doc = open_document(filepath)
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


def evict_pdf(filepath: str) -> bool:
    """Close and drop the cached fitz handle for ``filepath``. Returns whether one was held.

    Required when a file is replaced in place: the cached handle refers to the
    *old* document, and on POSIX the unlinked inode stays alive as long as we
    hold it open, so every subsequent render would keep serving the previous
    file's pages until the entry aged out of the LRU.
    """
    with _pdf_cache_lock:
        doc = _pdf_cache.pop(filepath, None)
    if doc is None:
        return False
    try:
        doc.close()
    except (RuntimeError, ValueError) as e:
        # Best-effort, same rationale as the LRU eviction above.
        logger.debug("Failed to close replaced PDF document: %s", e)
    return True


def _invalidate_book_cache():
    """Call after any rescan to flush stale entries."""
    _cached_book_info.cache_clear()


def _enforce_campaign_visibility(db, book) -> int:
    """Force every campaign share of a restricted book down to GM-only visibility.

    A book shared into a campaign as "public" is visible to that campaign's
    players, which would defeat the restriction the admin just applied — the
    campaign is exactly where the spoilers are. Rather than refusing the change
    and making the admin hunt down each campaign first, the shares are demoted
    to ``gm`` so the GM keeps their reference and the players lose it.

    Returns how many share rows were changed, for the caller's response. Does not
    commit — it runs inside the caller's transaction so the level change and the
    demotion land together or not at all.
    """
    from ...models import CampaignResource
    from ...models.access import LEVEL_OPEN, normalize

    if normalize(access_control.resolve_level(db, book)) == LEVEL_OPEN:
        return 0
    rows = (
        db.query(CampaignResource)
        .filter(
            CampaignResource.resource_type == "book",
            CampaignResource.resource_id == book.id,
            CampaignResource.visibility != "gm",
        )
        .all()
    )
    for row in rows:
        row.visibility = "gm"
    return len(rows)


def pop_access_level(payload: dict, user, *, allow_inherit: bool = True):
    """Take ``access_level`` out of an update payload, authorising the change.

    Returns ``(present, value)`` where ``value`` is what to write to the column
    (``None`` meaning inherit). Removing the key from ``payload`` is the point:
    ``bulk_service.apply_updates`` does a blind ``setattr`` over whatever is left,
    so a field that needs authorisation or translation must never reach it.

    Two things happen here that the Pydantic schema cannot do:

      * **Admin-only.** The book/system PATCH routes are open to GMs, but access
        levels are an admin control (issue #258) — a GM who could restrict books
        could also un-restrict the ones being kept from them.
      * **The inherit sentinel.** ``"inherit"`` on the wire becomes a NULL write,
        which an ``exclude_none`` payload could not otherwise express.

    Raises HTTPException(403) when a non-admin tries to change the level.
    """
    if "access_level" not in payload:
        return False, None
    value = payload.pop("access_level")
    if getattr(user, "role", None) != "admin":
        raise HTTPException(403, "Only admins can change access levels")
    if value == ACCESS_INHERIT:
        if not allow_inherit:
            raise HTTPException(400, "access_level 'inherit' is not valid here")
        return True, None
    try:
        return True, access_control.validate_level(value, allow_inherit=allow_inherit)
    except access_control.AccessError as e:
        raise HTTPException(400, str(e))


def _allow_explicit(db, user_id: str) -> bool:
    u = db.query(User).filter_by(id=user_id).first()
    return bool(u.allow_explicit) if u and u.allow_explicit is not None else True


def _assert_book_access(db, book: Book, user) -> None:
    """Authorise a user to read a specific book's content (file, page, TOC, text).

    The by-id content routes are reachable by guests, so they can't rely on the
    library-browse guard the list route has. This enforces the same model those
    metadata reads (`get_book`) enforce, plus campaign scoping for guests:

      * The book's access level (issue #258) is checked first, for *everyone*.
        It is the one gate a campaign share cannot open: a restricted book is
        restricted no matter how it was reached, which is what makes the level
        meaningful rather than advisory. Guests are held to the player ceiling
        here — they see open books only — and then further narrowed to their
        campaign below.
      * Guests may only read a book shared into a campaign they belong to
        (via `user_can_access_resource`). NSFW isn't filtered for guests — a book
        deliberately shared into their campaign is allowed regardless, since a
        guest has no explicit-content preference of their own.
      * Non-guests keep library-wide read access, but a book flagged explicit is
        denied when the user has disabled explicit content (allow_explicit=false).

    Raises HTTPException(403) when access is not permitted.
    """
    if not access_control.can_access_book(db, access_control.load_user(db, user), book):
        # Deliberately the same wording as the campaign-share refusal below, so
        # the response cannot be used to distinguish "restricted" from "not
        # shared with you" — the title alone is the spoiler this feature exists
        # to withhold.
        raise HTTPException(403, "This book is not shared with you")

    if getattr(user, "role", None) == "guest":
        from ..campaigns._helpers import user_can_access_resource

        if not user_can_access_resource(db, user.id, "book", book.id):
            raise HTTPException(403, "This book is not shared with you")
        return

    if book.is_explicit and not _allow_explicit(db, user.id):
        raise HTTPException(403, "Explicit content is disabled for your account")
