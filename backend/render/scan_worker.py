"""Entry point of the library scan's document helper process.

``backend.indexer.isolation`` starts one of these and sends it the scan's
PyMuPDF work: first-page thumbnails and page counts for PDF, EPUB and DjVu.
PyMuPDF holds the GIL for the whole of an open or a render, so on the scan's own
thread one heavy document froze the server process around it, and uvicorn's
supervisor killed a worker that stopped answering its health check for five
seconds. Here, a slow document only keeps this process busy.

Unlike a render worker it keeps nothing open between requests: the scan reads
each file once, so a document cache would only hold memory.

Protocol: the parent sends ``(op, args)`` and waits for ``(True, result)`` or
``(False, exception)`` before sending the next. The helper exits when the pipe
closes.
"""
import os
import signal
from multiprocessing.connection import Connection
from typing import Any

import fitz  # PyMuPDF
from PIL import Image

from .documents import open_document
from .worker import portable

# The first page is rendered at twice its size before it is shrunk to fit the
# thumbnail box, so small type stays legible on the cover.
_THUMBNAIL_SCALE = 2


def thumbnail(filepath: str, output_path: str, size: tuple[int, int]) -> bool:
    """Write the first page of ``filepath`` as a WebP thumbnail at ``output_path``.

    Returns False for a document with no pages.
    """
    doc = open_document(filepath)
    try:
        if len(doc) == 0:
            return False
        pix = doc[0].get_pixmap(
            matrix=fitz.Matrix(_THUMBNAIL_SCALE, _THUMBNAIL_SCALE), alpha=False
        )
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        del pix
    finally:
        doc.close()
    img.thumbnail(size, Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    img.save(output_path, "WEBP", quality=80)
    return True


def page_count(filepath: str) -> int:
    """How many pages ``filepath`` has, laid out the way the reader lays it out."""
    doc = open_document(filepath)
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
