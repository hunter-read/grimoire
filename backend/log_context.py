"""Tag each log line with the user whose request produced it (issue #576).

The in-app log viewer filters by user, so every entry the ring buffer records
during a request needs to know who made it. ``LogUserMiddleware`` opens a slot
for each HTTP request; authentication fills it (``set_log_user``) once it knows
who is calling; ``config._MemoryLogHandler`` reads it (``current_log_user``)
as each line is emitted.

The context variable holds a mutable slot rather than the username itself
because of where authentication runs. FastAPI resolves a sync dependency such
as ``get_current_user`` in a worker thread with a *copy* of the request's
context, so a value it ``set()`` there would be gone by the time the handler
runs. A slot set by the middleware is shared by every copy, so filling it in
from any of them is seen by all.
"""
import contextvars
from typing import Optional

from starlette.types import ASGIApp, Receive, Scope, Send


class _Slot:
    __slots__ = ("username",)

    def __init__(self) -> None:
        self.username: Optional[str] = None


_request_slot: contextvars.ContextVar[Optional[_Slot]] = contextvars.ContextVar(
    "grimoire_log_user", default=None
)


def set_log_user(username: Optional[str]) -> None:
    """Attribute the rest of the current request's log lines to ``username``.

    Does nothing outside a request (startup, the scanner, background workers),
    whose lines belong to no one.
    """
    slot = _request_slot.get()
    if slot is not None:
        slot.username = username


def current_log_user() -> Optional[str]:
    """The username the current request authenticated as, if any."""
    slot = _request_slot.get()
    return slot.username if slot is not None else None


class LogUserMiddleware:
    """Pure-ASGI middleware giving each HTTP request its own log-user slot.

    Pure ASGI rather than ``BaseHTTPMiddleware``, which would buffer streamed
    responses (page images, downloads) and run the app in a different context.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        token = _request_slot.set(_Slot())
        try:
            await self.app(scope, receive, send)
        finally:
            _request_slot.reset(token)
