"""Giving memory back once the server has gone quiet.

A scan, a search or a burst of browsing leaves the process larger than it
started: Python and glibc both keep freed memory around for the next request
instead of returning it. On a home server that next request may be tomorrow, and
meanwhile Grimoire sits on memory nothing is using. So after ``IDLE_RELEASE``
seconds without a request the process collects garbage and trims its heap (see
``render.memory.reclaim_render_memory``), and a scan does the same as it ends.

The cost is a few milliseconds on the first request afterwards, while the pages
it touches are mapped again.

Nothing here polls. The thread sleeps until the idle deadline, and after a
release it blocks until the next request arrives, so a quiet server is not woken
up to be told it is quiet.
"""
import gc
import logging
import threading
import time
from typing import Optional

from starlette.types import ASGIApp, Receive, Scope, Send

logger = logging.getLogger("grimoire")

# The container's own HEALTHCHECK calls this every 30 seconds. It is not anyone
# using the server, and counting it would keep the idle deadline from ever
# arriving.
_IGNORED_PATHS = frozenset({"/api/health"})

_last_request = time.monotonic()
# True between a release and the next request: the thread is parked on _wake.
_released = False
_wake = threading.Event()
_stopping = False
_thread: Optional[threading.Thread] = None


def note_request() -> None:
    """Record that someone is using the server. Called for every request."""
    global _last_request, _released
    _last_request = time.monotonic()
    if _released:
        _released = False
        _wake.set()


def release_memory() -> None:
    """Collect garbage and hand freed memory back to the operating system."""
    # Imported here: it loads PyMuPDF, which a process that never releases
    # (a test, a script) has no other reason to pay for.
    from .render.memory import reclaim_render_memory

    gc.collect()
    reclaim_render_memory()


def seconds_until_idle(idle_after: float, now: Optional[float] = None) -> float:
    """How long until the server counts as idle; zero or less once it does."""
    now = time.monotonic() if now is None else now
    return _last_request + idle_after - now


def _run(idle_after: float) -> None:
    global _released
    while not _stopping:
        remaining = seconds_until_idle(idle_after)
        if remaining > 0:
            _wake.wait(remaining)
            _wake.clear()
            continue
        try:
            release_memory()
            logger.debug("Idle for %ds - released unused memory.", int(idle_after))
        except Exception as e:  # noqa: BLE001 - a failed release must not end the thread
            logger.debug("Releasing idle memory failed: %s", e)
        _released = True
        # A request that arrived during the release has already been counted
        # but saw _released False, so nothing would wake the wait below.
        if seconds_until_idle(idle_after) > 0:
            _released = False
            continue
        _wake.wait()
        _wake.clear()


def start(idle_after: float) -> None:
    """Start releasing memory after ``idle_after`` seconds without a request. 0 turns it off."""
    global _thread, _stopping, _released, _last_request
    if idle_after <= 0 or _thread is not None:
        return
    _stopping = False
    _released = False
    _last_request = time.monotonic()
    _wake.clear()
    _thread = threading.Thread(
        target=_run, args=(idle_after,), daemon=True, name="grimoire-idle-release"
    )
    _thread.start()


def stop() -> None:
    global _thread, _stopping
    _stopping = True
    _wake.set()
    if _thread is not None:
        _thread.join(timeout=5)
    _thread = None


class IdleTrackingMiddleware:
    """Pure-ASGI middleware that tells the idle release a request has arrived."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("path") not in _IGNORED_PATHS:
            note_request()
        await self.app(scope, receive, send)
