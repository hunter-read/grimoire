"""Entry point of the library scan's document helper process.

``backend.indexer.isolation`` starts one of these and sends it the scan's
PyMuPDF work: first-page thumbnails and page counts for PDF, EPUB and DjVu.
PyMuPDF holds the GIL for the whole of an open or a render, so on the scan's own
thread one heavy document froze the server process around it, and uvicorn's
supervisor killed a worker that stopped answering its health check for five
seconds. Here, a slow document only keeps this process busy.

Unlike a render worker it keeps no document cache: the scan reads each file
once. The one exception is the document a thumbnail was just made from, which
stays open for the page count the scan asks for next, so a new book is parsed
once rather than twice - see ``_hold``.

Protocol: the parent sends ``(op, args)`` and waits for ``(True, result)`` or
``(False, exception)`` before sending the next. The helper exits when the pipe
closes.
"""
import os
import signal
from multiprocessing.connection import Connection
from typing import Any, Optional

import pymupdf
from PIL import Image

from .documents import open_document
from .worker import portable

# The first page is rendered at twice the size it will be shown at, so small
# type stays legible once it is shrunk to fit the box - but never above twice
# its own size, which is all a small page needs.
_THUMBNAIL_SCALE = 2.0

# The document the last thumbnail was made from: (path, (mtime_ns, size), doc).
_held: Optional[tuple[str, tuple[int, int], Any]] = None


def _signature(filepath: str) -> tuple[int, int]:
    st = os.stat(filepath)
    return st.st_mtime_ns, st.st_size


def _hold(filepath: str, doc: Any) -> None:
    """Keep ``doc`` open for the next request, if it asks about the same file.

    One document at most, and only until the next request: whatever that asks
    for, the held one is used or closed (see ``_take``).
    """
    global _held
    try:
        _held = (filepath, _signature(filepath), doc)
    except OSError:
        doc.close()


def _take(filepath: str) -> Any:
    """The held document if it is ``filepath`` and unchanged on disk, else None.

    Any other held document is closed.
    """
    global _held
    held, _held = _held, None
    if held is None:
        return None
    path, signature, doc = held
    if path == filepath:
        try:
            if _signature(filepath) == signature:
                return doc
        except OSError:
            pass
    doc.close()
    return None


def _open(filepath: str) -> Any:
    doc = _take(filepath)
    return open_document(filepath) if doc is None else doc


def render_scale(width: float, height: float, size: tuple[int, int]) -> float:
    """The zoom that renders a ``width`` x ``height`` point page at twice ``size``.

    A fixed zoom of 2 drew a 24 x 36 inch poster page as a 54 MB bitmap to make
    a 300-pixel cover; this draws every page at twice the box it is fitted to,
    and a page already smaller than the box at twice its own size, as before.
    """
    if width <= 0 or height <= 0:
        return _THUMBNAIL_SCALE
    fit = min(size[0] / width, size[1] / height)
    return min(_THUMBNAIL_SCALE, 2 * fit)


def thumbnail(filepath: str, output_path: str, size: tuple[int, int]) -> bool:
    """Write the first page of ``filepath`` as a WebP thumbnail at ``output_path``.

    Returns False for a document with no pages.
    """
    doc = _open(filepath)
    try:
        if len(doc) == 0:
            doc.close()
            return False
        page = doc[0]
        scale = render_scale(page.rect.width, page.rect.height, size)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        del pix
    except BaseException:
        doc.close()
        raise
    # A new book's page count is asked for next; keep the parse for it.
    _hold(filepath, doc)
    img.thumbnail(size, Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    img.save(output_path, "WEBP", quality=80)
    return True


def page_count(filepath: str) -> int:
    """How many pages ``filepath`` has, laid out the way the reader lays it out."""
    doc = _open(filepath)
    try:
        return len(doc)
    finally:
        doc.close()


def handle(op: str, args: tuple) -> Any:
    if op == "thumbnail":
        return thumbnail(*args)
    if op == "page_count":
        return page_count(*args)
    raise ValueError(f"unknown scan helper op: {op}")


def serve(conn: Connection) -> None:
    """Answer requests, one at a time, until the pipe closes."""
    while True:
        try:
            op, args = conn.recv()
        except (EOFError, OSError):
            return
        try:
            reply: tuple[bool, Any] = (True, handle(op, args))
        except Exception as e:
            reply = (False, portable(e))
        try:
            conn.send(reply)
        except (OSError, ValueError):
            return  # the parent is gone


def main(conn: Connection) -> None:
    """Process entry point."""
    # Ctrl-C reaches the whole process group; the parent stops the helper by
    # closing the pipe, so it must not die first with a KeyboardInterrupt.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    serve(conn)
