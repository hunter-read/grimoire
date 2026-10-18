"""Entry point of a render worker process (issue #615).

``backend.render.pool`` spawns these and talks to each over a pipe. A worker
handles one request at a time, in the order they arrive, against its own small
LRU of open documents. Requests for a book always go to the same worker, so a
book is only ever open in one process and used by one thread there, which is
what PyMuPDF requires; no locking is needed.

Why a separate process: a native crash in MuPDF while rendering a bad file now
takes down this worker and fails the requests it had, rather than stopping the
server. And PyMuPDF holds the GIL while it rasterises, so separate processes
are the only way renders run in parallel.

Imports nothing beyond ``backend.render`` (PyMuPDF and Pillow): not even
``backend.config``, so settings arrive as arguments. That keeps a worker's
baseline near that of the two libraries.

Protocol: the parent sends ``(request_id, op, args)``; the worker answers
``(request_id, True, result)`` or ``(request_id, False, exception)``. It exits
when the pipe closes.
"""
import pickle
import signal
import sys
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from multiprocessing.connection import Connection
from typing import Any, NamedTuple

import fitz  # PyMuPDF
from PIL import Image

from . import ops
from .documents import open_document
from .memory import reclaim_render_memory
from .outline import read_toc

# Open documents kept per worker. Matches the in-process cache.
DOC_CACHE_MAX = 10
# Threads encoding rendered pages to WebP. Pillow releases the GIL while it
# encodes, so encoding one page overlaps rasterizing the next, as it does
# across the in-process threadpool. Without this a worker spends ~40% of each
# page encoding with MuPDF idle, and one worker is slower than no worker.
ENCODERS = 2


class Encode(NamedTuple):
    """A rasterized page or tile waiting to be encoded and sent."""

    img: Image.Image
    quality: int
    method: int


class Documents:
    """An LRU of open documents, keyed by file path."""

    def __init__(self, limit: int = DOC_CACHE_MAX) -> None:
        self.limit = limit
        self._docs: "OrderedDict[str, fitz.Document]" = OrderedDict()

    def get(self, filepath: str) -> fitz.Document:
        doc = self._docs.get(filepath)
        if doc is not None:
            self._docs.move_to_end(filepath)
            return doc
        doc = open_document(filepath)
        self._docs[filepath] = doc
        while len(self._docs) > self.limit:
            _, oldest = self._docs.popitem(last=False)
            _close(oldest)
        return doc

    def evict(self, filepath: str) -> bool:
        doc = self._docs.pop(filepath, None)
        if doc is None:
            return False
        _close(doc)
        return True

    def close_all(self) -> None:
        while self._docs:
            _close(self._docs.popitem()[1])

    def __len__(self) -> int:
        return len(self._docs)


def _close(doc: fitz.Document) -> None:
    try:
        doc.close()
    except (RuntimeError, ValueError):
        pass  # already closed or broken; nothing left to release


def handle(docs: Documents, op: str, args: tuple) -> tuple[Any, bool]:
    """Run one request. Returns ``(result, counts_as_render)``.

    A page or tile comes back as an ``Encode`` for an encoder thread to finish.
    """
    if op == "page":
        filepath, page_num, width, quality, method, count = args
        img = ops.rasterize_page(docs.get(filepath), page_num, width)
        return Encode(img, quality, method), count
    if op == "tile":
        filepath, page_num, width, col, row = args
        img = ops.rasterize_tile(docs.get(filepath), page_num, width, col, row)
        # Not counted: a zoomed view asks for several tiles of one page, and
        # reclaiming between them would drop the decoded images the next needs.
        return Encode(img, 85, 0), False
    if op == "text":
        filepath, page_num = args
        return ops.page_text(docs.get(filepath), page_num), False
    if op == "words":
        filepath, page_num = args
        return ops.page_words(docs.get(filepath), page_num), False
    if op == "info":
        (filepath,) = args
        return ops.document_info(docs.get(filepath)), False
    if op == "toc":
        (filepath,) = args
        return read_toc(docs.get(filepath)), False
    if op in ("page_size", "detect"):
        # Imported on first use: page export is only needed by the export dialog.
        from ..services.page_export import run as export_run

        filepath, page_num = args
        work = export_run.page_size if op == "page_size" else export_run.detect_page_shapes
        return work(docs.get(filepath), page_num), False
    if op == "evict":
        (filepath,) = args
        return docs.evict(filepath), False
    raise ValueError(f"Unknown render operation {op!r}")


def portable(exc: Exception) -> Exception:
    """``exc`` as something that survives pickling back to the parent.

    The range errors carry what the caller needs for its 400 and pickle as they
    are. Anything else, MuPDF's exception types included, is flattened to a
    RenderError with the original's name and message.
    """
    if isinstance(exc, (ops.PageOutOfRange, ops.TileOutOfRange)):
        return exc
    # An export request the document can't satisfy (a 400). Looked up rather
    # than imported, so a worker that never exports never loads page export.
    spec = sys.modules.get("backend.services.page_export.spec")
    if spec is not None and isinstance(exc, spec.ExportError):
        return exc
    return ops.RenderError(f"{type(exc).__name__}: {exc}")


def serve(conn: Connection, reclaim_interval: int) -> None:
    """Answer requests until the pipe closes.

    Requests are read and rasterized one at a time on this thread, the only one
    that touches MuPDF. Encoding is handed to ``ENCODERS`` threads, and answers
    can therefore go back out of order; the parent matches them by request id.
    """
    docs = Documents()
    renders = 0
    send_lock = threading.Lock()
    # At most ENCODERS rasterized images wait for an encoder: rasterizing ahead
    # of them would only hold more decoded pages in memory.
    encode_slots = threading.BoundedSemaphore(ENCODERS)
    encoders = ThreadPoolExecutor(ENCODERS, thread_name_prefix="grimoire-encode")

    def send(reply: tuple[int, bool, Any]) -> bool:
        with send_lock:
            try:
                conn.send(reply)
                return True
            except (OSError, ValueError):
                return False  # the parent is gone; the read loop will see EOF

    def encode_and_send(request_id: int, job: Encode) -> None:
        reply: tuple[int, bool, Any]
        try:
            reply = (request_id, True, ops.encode_webp(job.img, job.quality, job.method))
        except Exception as e:
            reply = (request_id, False, portable(e))
        finally:
            del job
            encode_slots.release()
        send(reply)

    try:
        while True:
            try:
                request_id, op, args = conn.recv()
            except (EOFError, OSError):
                return
            try:
                result, counted = handle(docs, op, args)
            except Exception as e:
                if not send((request_id, False, portable(e))):
                    return
                continue
            if isinstance(result, Encode):
                encode_slots.acquire()
                encoders.submit(encode_and_send, request_id, result)
            elif not send((request_id, True, result)):
                return
            # Let go of the image before a reclaim, so it is part of what's freed.
            del result
            if counted and reclaim_interval > 0:
                renders += 1
                if renders >= reclaim_interval:
                    renders = 0
                    reclaim_render_memory()
    finally:
        encoders.shutdown(wait=True)
        docs.close_all()


def export_main(filepath: str, title: str, spec: dict[str, Any], result_path: str) -> None:
    """Entry point of a one-shot export process: run one export, then exit.

    Exports don't go to the pooled workers: one can take minutes, which would
    hold up every book routed to that worker. The result is pickled to
    ``result_path`` as ``(ok, files-and-zip-name or exception)``; a crash leaves
    the file empty, which the parent reports as one. A file rather than a pipe,
    since an export can be large.
    """
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    from ..services.page_export import run as export_run

    outcome: tuple[bool, Any]
    try:
        doc = open_document(filepath)
        try:
            outcome = (True, export_run.produce(doc, title, spec))
        finally:
            _close(doc)
    except Exception as e:
        outcome = (False, portable(e))
    with open(result_path, "wb") as fh:
        pickle.dump(outcome, fh)


def main(conn: Connection, reclaim_interval: int) -> None:
    """Process entry point. ``reclaim_interval`` is ``PAGE_RECLAIM_INTERVAL``."""
    # Ctrl-C in a terminal reaches the whole process group. The parent shuts
    # workers down by closing their pipes; a worker must not die on its own
    # first, mid-request, with a KeyboardInterrupt traceback.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    serve(conn, reclaim_interval)
