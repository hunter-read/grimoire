"""Rendering pages in a pool of worker processes (issue #615).

The public API is the module-level functions: ``render_page``, ``render_tile``,
``page_text``, ``page_words``, ``document_info``, ``document_metadata``, ``document_toc``,
``export_page_size``, ``detect_shapes``, ``export`` and ``evict``. With
``RENDER_WORKERS`` at 1 or more they run in worker processes
(``backend.render.worker``); at 0 they run in this process through the
``open_pdf()`` cache, as rendering always did before.

How the pool behaves:

* **One worker per book.** A file path always hashes to the same worker, so its
  documents stay open there and a book is never used by two threads at once.
* **Lazy.** A worker starts on the first request routed to it.
* **Crash isolation.** If a worker dies (a native crash in MuPDF, an OOM kill),
  its in-flight requests raise ``RenderCrashError`` and the next request starts
  a fresh one. The crashed request is not retried: a bad page would crash the
  replacement too.
* **Timeouts.** A request unanswered after ``REQUEST_TIMEOUT`` seconds stops
  the worker, failing what it had, rather than leaving that book's readers
  waiting on it forever.
* **Idle retirement.** A worker with nothing in flight for
  ``PAGE_IDLE_RELEASE`` seconds is stopped. Exiting hands every byte MuPDF
  used back to the OS, which the in-process reclaim can only approximate.

Exports are the exception: ``export`` runs each in a one-shot process of its
own, since an export can run for minutes and would otherwise hold up every book
routed to that worker.

Each app process (``WORKERS``) has its own pool.
"""
import hashlib
import itertools
import multiprocessing
import os
import pickle
import tempfile
import threading
import time
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any, Optional

from .. import config
from . import ops, worker
from .ops import RenderCrashError, RenderError, RenderTimeoutError

logger = config.logger

_MP_CONTEXT = multiprocessing.get_context("spawn")

# Seconds a request may wait for its answer, queueing behind others for the
# same worker included. Generous: a slow page is better than a failed one, and
# this exists for a worker that has stopped answering at all.
REQUEST_TIMEOUT = 120.0
# How long shutdown waits for a worker to exit after its pipe closes.
_STOP_GRACE = 5.0
# Seconds one export may run. An export is capped at 100 images or 200 cut-outs,
# which at the highest resolution takes minutes, not tens of them.
EXPORT_TIMEOUT = 600.0


class _WorkerGone(Exception):
    """The worker stopped between being chosen and being sent the request."""


class _Worker:
    """One worker process, its pipe, and the requests waiting on it."""

    def __init__(self, slot: int) -> None:
        self.slot = slot
        parent_conn, child_conn = _MP_CONTEXT.Pipe()
        self.proc = _MP_CONTEXT.Process(
            target=worker.main,
            args=(child_conn, config.PAGE_RECLAIM_INTERVAL),
            name=f"grimoire-render-{slot}",
            daemon=True,
        )
        self.proc.start()
        # The child holds its own copy; closing ours is what lets recv() in the
        # reader see EOF when the child dies.
        child_conn.close()
        self.conn = parent_conn
        # Guards pending, alive and sending: requests from several threads share
        # the pipe, and a request must be registered before its answer can arrive.
        self.lock = threading.Lock()
        self.pending: dict[int, Future] = {}
        self.alive = True
        # Set when we stop it on purpose, so its exit isn't reported as a crash.
        self.stopping = False
        self.last_used = time.monotonic()
        self._ids = itertools.count()
        # Serialises waiting for the process to exit; see ``_join``.
        self._reap_lock = threading.Lock()
        self.reader = threading.Thread(
            target=self._read, name=f"grimoire-render-{slot}-reader", daemon=True
        )
        self.reader.start()

    def submit(self, op: str, args: tuple) -> Future:
        future: Future = Future()
        with self.lock:
            if not self.alive:
                raise _WorkerGone
            request_id = next(self._ids)
            self.pending[request_id] = future
            self.last_used = time.monotonic()
            try:
                self.conn.send((request_id, op, args))
            except (OSError, ValueError) as e:
                del self.pending[request_id]
                self.alive = False
                raise _WorkerGone from e
        return future

    def idle_since(self) -> Optional[float]:
        """When this worker last had work, or None while a request is in flight."""
        with self.lock:
            return None if self.pending else self.last_used

    def retire_if_idle(self, before: float) -> bool:
        """Stop taking requests if none has been in flight since ``before``."""
        with self.lock:
            if self.pending or self.last_used > before or not self.alive:
                return False
            self.alive = False
            return True

    def _read(self) -> None:
        while True:
            try:
                request_id, ok, payload = self.conn.recv()
            except (EOFError, OSError):
                break
            with self.lock:
                future = self.pending.pop(request_id, None)
                self.last_used = time.monotonic()
            if future is None:
                continue  # its caller timed out and gave up on it
            if ok:
                future.set_result(payload)
            else:
                future.set_exception(payload)
        self._fail_pending()

    def _fail_pending(self) -> None:
        with self.lock:
            self.alive = False
            waiting = list(self.pending.values())
            self.pending.clear()
        if not waiting:
            return  # a retired or shut-down worker: nothing was lost
        if self.stopping:
            error: RenderError = RenderError("the renderer is shutting down")
            for future in waiting:
                if not future.done():
                    future.set_exception(error)
            return
        self._join(_STOP_GRACE)
        code = self.proc.exitcode
        if code is not None and code < 0:
            reason = f"killed by signal {-code}"
        else:
            reason = f"exited with code {code}"
        logger.error(
            "Render worker %d crashed (%s); failing %d request(s)", self.slot, reason, len(waiting)
        )
        error = RenderCrashError(f"render worker {reason}")
        for future in waiting:
            if not future.done():
                future.set_exception(error)

    def _join(self, timeout: float) -> None:
        """Wait up to ``timeout`` for the process to exit, one thread at a time.

        A killed worker is waited on from two threads at once: whoever killed
        it, and the reader, which sees the pipe close and fails what was
        pending. Both end in ``waitpid``, and only one of them gets the exit
        status - multiprocessing swallows the other's ECHILD and records no
        exit code, so until the first thread stores its result ``is_alive()``
        reports a dead process as running. Taking turns means the second
        thread finds the exit code already stored.
        """
        with self._reap_lock:
            self.proc.join(timeout)

    def stop(self) -> None:
        """Close the pipe and wait for the process to exit, killing it if it won't."""
        with self.lock:
            self.alive = False
            self.stopping = True
        try:
            self.conn.close()
        except OSError:
            pass
        self._join(_STOP_GRACE)
        if self.proc.is_alive():
            self.kill()

    def kill(self) -> None:
        """Stop the process now. Its pending requests fail as crashed."""
        with self.lock:
            self.alive = False
        self.proc.kill()
        self._join(_STOP_GRACE)


class _Pool:
    def __init__(self, size: int) -> None:
        self.size = size
        self.slots: list[Optional[_Worker]] = [None] * size
        self.lock = threading.Lock()
        self.sweeper: Optional[threading.Thread] = None
        self.closed = False

    def slot_for(self, filepath: str) -> int:
        # A real hash, not crc32: CRC is linear, so paths differing in one
        # character (Vol 1, Vol 2, ... in one folder) share their low bits and
        # would all land on one worker. Not hash(), which changes every run.
        digest = hashlib.blake2b(filepath.encode("utf-8", "surrogateescape"), digest_size=8)
        return int.from_bytes(digest.digest(), "big") % self.size

    def worker_for(self, filepath: str) -> _Worker:
        slot = self.slot_for(filepath)
        with self.lock:
            if self.closed:
                raise RenderError("The renderer is shutting down")
            current = self.slots[slot]
            if current is None or not current.alive:
                current = _Worker(slot)
                self.slots[slot] = current
                self._ensure_sweeper()
            return current

    def existing_worker(self, filepath: str) -> Optional[_Worker]:
        with self.lock:
            current = self.slots[self.slot_for(filepath)]
            return current if current is not None and current.alive else None

    def call(self, op: str, filepath: str, *args: Any) -> Any:
        try:
            current = self.worker_for(filepath)
            future = current.submit(op, (filepath, *args))
        except _WorkerGone:
            # Retired or died between being chosen and being sent the request;
            # nothing reached it, so a fresh worker can take it.
            current = self.worker_for(filepath)
            try:
                future = current.submit(op, (filepath, *args))
            except _WorkerGone:
                raise RenderCrashError("render worker exited before taking the request") from None
        try:
            return future.result(timeout=REQUEST_TIMEOUT)
        except FutureTimeout:
            logger.error(
                "Render worker %d did not answer within %ss; stopping it",
                current.slot,
                REQUEST_TIMEOUT,
            )
            current.kill()
            raise RenderTimeoutError(f"no answer within {REQUEST_TIMEOUT}s") from None

    def _ensure_sweeper(self) -> None:
        """Start the idle sweeper if it isn't running. Caller holds the lock."""
        if config.PAGE_IDLE_RELEASE <= 0 or self.sweeper is not None:
            return
        self.sweeper = threading.Thread(
            target=self._sweep, name="grimoire-render-idle", daemon=True
        )
        self.sweeper.start()

    def retire_idle(self, now: Optional[float] = None) -> int:
        """Stop every worker idle for PAGE_IDLE_RELEASE. Returns how many stopped."""
        now = time.monotonic() if now is None else now
        before = now - config.PAGE_IDLE_RELEASE
        retiring = []
        with self.lock:
            for slot, current in enumerate(self.slots):
                if current is None:
                    continue
                if not current.alive:
                    self.slots[slot] = None  # crashed or killed; already gone
                elif current.retire_if_idle(before):
                    self.slots[slot] = None
                    retiring.append(current)
        for current in retiring:
            current.stop()
        return len(retiring)

    def _sweep(self) -> None:
        # Wake at a fraction of the window so retirement lands within ~25% of it.
        interval = max(1.0, config.PAGE_IDLE_RELEASE / 4)
        while True:
            time.sleep(interval)
            if retired := self.retire_idle():
                logger.debug("Stopped %d idle render worker(s)", retired)
            # Exit when no worker is left, deciding under the lock worker_for()
            # takes: a worker started after this sees no sweeper and starts one.
            with self.lock:
                if self.closed or not any(self.slots):
                    self.sweeper = None
                    return

    def shutdown(self) -> None:
        with self.lock:
            self.closed = True
            workers = [w for w in self.slots if w is not None]
            self.slots = [None] * self.size
        for current in workers:
            current.stop()


_pool: Optional[_Pool] = None
_pool_lock = threading.Lock()


def _get_pool() -> Optional[_Pool]:
    """The pool, created on first use; None when rendering in-process."""
    global _pool
    if config.RENDER_WORKERS <= 0:
        return None
    with _pool_lock:
        if _pool is None or _pool.closed:
            _pool = _Pool(config.RENDER_WORKERS)
        return _pool


def shutdown() -> None:
    """Stop every worker. Rendering after this starts a new pool."""
    global _pool
    with _pool_lock:
        pool, _pool = _pool, None
    if pool is not None:
        pool.shutdown()


def retire_idle_workers(now: Optional[float] = None) -> int:
    """Stop workers idle for PAGE_IDLE_RELEASE (normally done by the pool's sweeper)."""
    with _pool_lock:
        pool = _pool
    return pool.retire_idle(now) if pool is not None else 0


# --- public API ----------------------------------------------------------------


def render_page(
    filepath: str,
    page_num: int,
    width: int,
    *,
    quality: int = 85,
    method: int = 0,
    count: bool = True,
) -> bytes:
    """Page ``page_num`` (1-based) of ``filepath`` as WebP, ``width`` pixels wide.

    ``count`` adds the render to the PAGE_RECLAIM_INTERVAL tally. Raises
    PageOutOfRange for a page the document doesn't have, and RenderError when
    the render fails or its worker crashes or hangs.
    """
    pool = _get_pool()
    if pool is not None:
        return pool.call("page", filepath, page_num, width, quality, method, count)
    from ..routers.books._helpers import note_page_render, open_pdf

    with open_pdf(filepath) as doc:
        img = ops.rasterize_page(doc, page_num, width)
    # Encoded outside open_pdf() so the book's lock isn't held through it.
    data = ops.encode_webp(img, quality, method)
    del img
    if count:
        note_page_render()
    return data


def render_tile(filepath: str, page_num: int, width: int, col: int, row: int) -> bytes:
    """Zoom tile ``col``/``row`` of the page rendered ``width`` pixels wide, as WebP.

    Raises PageOutOfRange, TileOutOfRange, or RenderError as ``render_page``.
    """
    pool = _get_pool()
    if pool is not None:
        return pool.call("tile", filepath, page_num, width, col, row)
    from ..routers.books._helpers import open_pdf

    with open_pdf(filepath) as doc:
        img = ops.rasterize_tile(doc, page_num, width, col, row)
    # Encoded outside open_pdf(): a zoomed view asks for several tiles of one
    # book at once, and their encodes can run in parallel. Not counted toward
    # the reclaim, which would drop the decoded images the next tile needs.
    return ops.encode_webp(img)


def page_text(filepath: str, page_num: int) -> str:
    """The text layer of one page."""
    pool = _get_pool()
    if pool is not None:
        return pool.call("text", filepath, page_num)
    from ..routers.books._helpers import open_pdf

    with open_pdf(filepath) as doc:
        return ops.page_text(doc, page_num)


def page_words(filepath: str, page_num: int) -> dict[str, Any]:
    """One page's size and word boxes (``ops.page_words``)."""
    pool = _get_pool()
    if pool is not None:
        return pool.call("words", filepath, page_num)
    from ..routers.books._helpers import open_pdf

    with open_pdf(filepath) as doc:
        return ops.page_words(doc, page_num)


def document_info(filepath: str) -> dict[str, Any]:
    """Page count and first-page size (``ops.document_info``)."""
    pool = _get_pool()
    if pool is not None:
        return pool.call("info", filepath)
    from ..routers.books._helpers import open_pdf

    with open_pdf(filepath) as doc:
        return ops.document_info(doc)


def document_metadata(filepath: str) -> dict[str, str]:
    """The file's embedded info dictionary (``ops.document_metadata``)."""
    pool = _get_pool()
    if pool is not None:
        return pool.call("metadata", filepath)
    from ..routers.books._helpers import open_pdf

    with open_pdf(filepath) as doc:
        return ops.document_metadata(doc)


def document_toc(filepath: str) -> list[list[Any]]:
    """The table of contents, as ``outline.read_toc`` gives it."""
    pool = _get_pool()
    if pool is not None:
        return pool.call("toc", filepath)
    from .documents import open_document
    from .outline import read_toc

    doc = open_document(filepath)
    try:
        return read_toc(doc)
    finally:
        doc.close()


def export_page_size(filepath: str, page_num: int) -> dict[str, float]:
    """One page's size in points, for the export dialog."""
    pool = _get_pool()
    if pool is not None:
        return pool.call("page_size", filepath, page_num)
    from ..routers.books._helpers import open_pdf
    from ..services.page_export import run as export_run

    with open_pdf(filepath) as doc:
        return export_run.page_size(doc, page_num)


def detect_shapes(filepath: str, page_num: int) -> list[dict[str, Any]]:
    """Suggested cut-outs for one page, as fractions of the page."""
    pool = _get_pool()
    if pool is not None:
        return pool.call("detect", filepath, page_num)
    from ..routers.books._helpers import open_pdf
    from ..services.page_export import run as export_run

    with open_pdf(filepath) as doc:
        return export_run.detect_page_shapes(doc, page_num)


def export(filepath: str, title: str, spec: dict[str, Any]) -> tuple[list[Any], str]:
    """Run an export (``page_export.run.produce``) in a process of its own.

    Returns the exported files and the name a zip of them would take. Raises
    ExportError for a request the document can't satisfy, RenderCrashError if
    the process dies, and RenderTimeoutError after EXPORT_TIMEOUT.
    """
    if config.RENDER_WORKERS <= 0:
        from ..services.page_export import run as export_run
        from .documents import open_document

        doc = open_document(filepath)
        try:
            return export_run.produce(doc, title, spec)
        finally:
            doc.close()

    fd, result_path = tempfile.mkstemp(prefix="grimoire_export_", suffix=".pkl")
    os.close(fd)
    proc = _MP_CONTEXT.Process(
        target=worker.export_main,
        args=(filepath, title, spec, result_path),
        name="grimoire-export",
        daemon=True,
    )
    try:
        proc.start()
        proc.join(EXPORT_TIMEOUT)
        if proc.is_alive():
            logger.error("Export of %s ran past %ss; stopping it", filepath, EXPORT_TIMEOUT)
            raise RenderTimeoutError(f"export ran past {EXPORT_TIMEOUT}s")
        if os.path.getsize(result_path) == 0:
            code = proc.exitcode
            reason = f"killed by signal {-code}" if code and code < 0 else f"exited with code {code}"
            logger.error("Export process crashed (%s) exporting %s", reason, filepath)
            raise RenderCrashError(f"export process {reason}")
        with open(result_path, "rb") as fh:
            ok, payload = pickle.load(fh)
        if not ok:
            raise payload
        return payload
    finally:
        if proc.is_alive():
            proc.kill()
            proc.join(_STOP_GRACE)
        try:
            os.unlink(result_path)
        except OSError:
            pass


def evict(filepath: str) -> None:
    """Drop the open document for ``filepath`` (its file was replaced in place).

    Reaches the worker holding it, if one is running; never starts one just to
    evict. The worker handles requests in order, so a render queued after this
    reopens the new file.
    """
    pool = _get_pool()
    if pool is None:
        from ..routers.books._helpers import evict_pdf

        evict_pdf(filepath)
        return
    current = pool.existing_worker(filepath)
    if current is None:
        return
    try:
        current.submit("evict", (filepath,)).result(timeout=REQUEST_TIMEOUT)
    except (_WorkerGone, RenderError, FutureTimeout):
        pass  # the worker is gone, so the stale handle went with it
