"""A fake network for tests of code that downloads through ``httpx.Client``.

``serve`` routes every client the code under test builds to a handler, through
httpx's own MockTransport, so the real client - redirects, streaming, hooks -
runs as it would against a server. ``ChunkedBody`` is a response body with no
Content-Length that counts how much of it was read, for checking a size cap
stops the read rather than only judging it afterwards.
"""
from typing import Callable

import httpx


def serve(monkeypatch, handler: Callable[[httpx.Request], httpx.Response]) -> None:
    """Answer every request an ``httpx.Client`` makes with ``handler(request)``.

    ``handler`` may also raise an httpx exception (a timeout, a refused
    connection) to have the request fail that way.
    """
    transport = httpx.MockTransport(handler)
    real_client = httpx.Client

    def client(**kwargs):
        kwargs.pop("transport", None)
        return real_client(transport=transport, **kwargs)

    monkeypatch.setattr(httpx, "Client", client)


class ChunkedBody(httpx.SyncByteStream):
    """``total`` bytes sent ``chunk`` bytes at a time, with no declared length."""

    def __init__(self, total: int, chunk: int = 256) -> None:
        self.total = total
        self.chunk = chunk
        self.sent = 0

    def __iter__(self):
        while self.sent < self.total:
            size = min(self.chunk, self.total - self.sent)
            self.sent += size
            yield b"x" * size


def serve_chunked(monkeypatch, total: int, chunk: int = 256) -> ChunkedBody:
    """Answer every request with a ``ChunkedBody``, returned to check ``sent``."""
    body = ChunkedBody(total, chunk)
    serve(monkeypatch, lambda request: httpx.Response(200, stream=body))
    return body
