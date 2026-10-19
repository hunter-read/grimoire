"""In-process caches and shared helpers for book endpoints."""
import functools
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from typing import Iterator, Optional

import fitz  # type: ignore[import-untyped]
from fastapi import HTTPException

from ...config import PAGE_IDLE_RELEASE, PAGE_RECLAIM_INTERVAL, SessionLocal, logger
from ...indexer.formats import open_document
from ...render.memory import reclaim_render_memory as _reclaim_render_memory
from ...models import Book, User
from ...models.access import rank
from ...services import access_control
from ._schemas import ACCESS_INHERIT


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


def get_visible_book(db, book_id: str, user) -> Book:
    """The book for a GM/admin edit, or 404 when it is missing or hidden from ``user``.

    Edits reach only the books the editor can see, so a book outside their
    access answers exactly like an id that does not exist.
    """
    book = db.query(Book).filter_by(id=book_id).first()
    if not book or not access_control.can_access_book(
        db, access_control.load_user(db, user), book
    ):
        raise HTTPException(404, "Book not found")
    return book


def keeps_access_level(db, book: Book, payload: dict, user) -> bool:
    """Whether an edit leaves ``book`` at least as restricted as it was.

    A new category can carry a different default level, so recategorising is
    also a way of changing who sees the book. Only admins choose who sees what;
    anyone else may move a book only to a level that is the same or stricter.
    """
    if getattr(user, "role", None) == "admin":
        return True
    category = payload.get("category")
    if category is None or category == book.category:
        return True
    before = access_control.resolve_level(db, book)
    # A detached stand-in, so the current row is not touched before the edit is
    # allowed.
    moved = Book(
        access_level=book.access_level, game_system_id=book.game_system_id, category=category
    )
    return rank(access_control.resolve_level(db, moved)) >= rank(before)


# Shared by the single and bulk book edits so both refuse with the same words.
LEVEL_KEPT_DETAIL = "Only admins can make a book visible to more people"


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


def _can_read_book(db, book: Book, user) -> bool:
    """`_assert_book_access` as a predicate, for filtering lists of books."""
    try:
        _assert_book_access(db, book, user)
    except HTTPException:
        return False
    return True
