"""The scan's PyMuPDF work, run in a helper process.

PyMuPDF holds the GIL for the whole of an open or a render. When the scan did
that work on its own thread, one heavy document froze the server process around
it: every request waited behind the render. With ``WORKERS`` above 1 it was
worse. uvicorn's supervisor took the silence for a hang and killed the worker,
whose replacement started the same scan over and stalled on the same file,
every few seconds, for good. A thread-based timeout could not help: the thread
doing the waiting needed the very lock the render held.

So first-page thumbnails and page counts for PDF, EPUB and DjVu go to one helper
process (``backend.render.scan_worker``), and the caller waits on a pipe, which
releases the GIL. The helper is started on first use and kept for the files that
follow. A timeout, a stop request or a crash kills it, and the next file starts
a fresh one, so a document that hangs MuPDF costs its own budget and no more.

There is one helper per server process. Calls are serialised: a caller on
another thread (a single-book re-index during a scan) waits its turn.
"""
import logging
import threading
import time
from typing import Any, Callable, Optional

from ..render import scan_worker
from .constants import _FITZ_TIMEOUT, _MP_CONTEXT

logger = logging.getLogger("grimoire.indexer")

# How often a caller waiting on the helper checks for a stop request.
_POLL_INTERVAL = 0.25
# How long shutdown waits for the helper to exit once its pipe is closed.
_STOP_GRACE = 5.0


class HelperCrashError(RuntimeError):
    """The helper process exited without answering (a native crash, an OOM kill)."""


class _Helper:
    """One helper process and its end of the pipe."""

    def __init__(self) -> None:
        parent_conn, child_conn = _MP_CONTEXT.Pipe()
        self.proc = _MP_CONTEXT.Process(
            target=scan_worker.main,
            args=(child_conn,),
            name="grimoire-scan-helper",
            daemon=True,
        )
        self.proc.start()
        # The child holds its own copy; closing ours is what lets recv() see EOF
        # when the child dies.
        child_conn.close()
        self.conn = parent_conn

    def exit_reason(self) -> str:
        code = self.proc.exitcode
        if code is None:
            return "still running"
        if code < 0:
            return f"killed by signal {-code}"
        return f"exit code {code}"

    def kill(self) -> None:
        self.proc.kill()
        self.proc.join(_STOP_GRACE)
        self.conn.close()

    def stop(self) -> None:
        """Close the pipe so the helper exits, killing it if it does not."""
        self.conn.close()
        self.proc.join(_STOP_GRACE)
        if self.proc.is_alive():
            self.proc.kill()
            self.proc.join(_STOP_GRACE)


_lock = threading.Lock()
_helper: Optional[_Helper] = None


def _discard() -> None:
    """Kill the current helper. Caller holds ``_lock``."""
    global _helper
    helper, _helper = _helper, None
    if helper is not None:
        helper.kill()


def _call(
    op: str,
    args: tuple,
    timeout: float,
    should_stop: Optional[Callable[[], bool]] = None,
) -> Any:
    """Run ``op`` in the helper and return its result.

    Raises TimeoutError when it takes longer than ``timeout`` seconds or
    ``should_stop()`` turns true, HelperCrashError when the helper dies, and
    whatever the operation raised (as a ``RenderError``) when it fails.
    """
    global _helper
    with _lock:
        if _helper is None or not _helper.proc.is_alive():
            _discard()
            _helper = _Helper()
        helper = _helper
        try:
            helper.conn.send((op, args))
        except (OSError, ValueError) as e:
            _discard()
            raise HelperCrashError(f"scan helper stopped before taking the request: {e}") from e
        deadline = time.monotonic() + timeout
        while not helper.conn.poll(_POLL_INTERVAL):
            if not helper.proc.is_alive():
                # An answer sent just before it exited is still in the pipe.
                if helper.conn.poll():
                    break
                reason = helper.exit_reason()
                _discard()
                raise HelperCrashError(f"scan helper exited ({reason})")
            if should_stop is not None and should_stop():
                _discard()
                raise TimeoutError("aborted by stop request")
            if time.monotonic() >= deadline:
                _discard()
                raise TimeoutError(f"no answer within {timeout:g}s")
        try:
            ok, value = helper.conn.recv()
        except (EOFError, OSError):
            helper.proc.join(_STOP_GRACE)
            reason = helper.exit_reason()
            _discard()
            raise HelperCrashError(f"scan helper exited ({reason})") from None
    if ok:
        return value
    raise value


def render_thumbnail(
    filepath: str,
    output_path: str,
    size: tuple[int, int],
    timeout: float,
    should_stop: Optional[Callable[[], bool]] = None,
) -> bool:
    """Write a first-page WebP thumbnail of a PDF, EPUB or DjVu file.

    Returns False for a document with no pages. Raises as ``_call``.
    """
    return bool(_call("thumbnail", (filepath, output_path, tuple(size)), timeout, should_stop))


def document_page_count(
    filepath: str,
    should_stop: Optional[Callable[[], bool]] = None,
    timeout: float = _FITZ_TIMEOUT,
) -> int:
    """Page count of a PDF, EPUB or DjVu file, read in the helper. Raises as ``_call``."""
    return int(_call("page_count", (filepath,), timeout, should_stop))


def shutdown(kill_busy: bool = False) -> None:
    """Stop the helper, if one is running. The next call starts a fresh one.

    Never waits out a call in flight. By default a busy helper is left to the
    thread using it (a single-book re-index can outlast the scan that started
    the helper). With ``kill_busy``, as the server stops, it is killed instead
    and the waiting call fails as a crash.
    """
    global _helper
    if not _lock.acquire(blocking=False):
        helper = _helper
        if kill_busy and helper is not None:
            helper.proc.kill()
        return
    try:
        helper, _helper = _helper, None
    finally:
        _lock.release()
    if helper is not None:
        helper.stop()
