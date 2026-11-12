"""Clean up the text in JSON request bodies before any handler sees it.

Two things JSON can spell that the rest of the app cannot hold:

* Half of a UTF-16 surrogate pair on its own (``"\\ud800"``). Python decodes it
  into a ``str`` that cannot be encoded as UTF-8, so anything that then hashes,
  folds or stores the text - a password, a username, a title - fails with a
  ``UnicodeEncodeError``, turning a client mistake into a 500. Answered with a
  422, shaped like any other validation error.
* A NUL (``"\\u0000"``). PostgreSQL text cannot hold one, so its connection drops
  them from every string on the way in (``models.db.postgres_engine``) - after
  the request was validated with them still there. A name of one NUL passed the
  blank check and was stored empty; two tags differing by a NUL passed the
  duplicate check and then collided. They are dropped here instead, on both
  databases, so validation sees the text that will be stored.

Form fields, paths and query strings are percent-decoded with replacement, so
they never carry a lone surrogate; JSON bodies are the only way in through the
request itself. JSON or YAML that a handler parses for itself - a document sent
as a string field, or an uploaded file - can spell one too, so those parsers
check what they read with :func:`holds_lone_surrogate`.

Pure ASGI, like the other middleware here, so streamed responses are left
alone. A body is buffered only when it is JSON, which FastAPI reads whole
anyway, and only parsed when it holds one of those escapes at all.
"""
import json
import re
from typing import Any

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

#: A ``\uD800``-``\uDFFF`` escape: half of a surrogate pair, or one alone.
_SURROGATE_ESCAPE = re.compile(rb"\\u[dD][89a-fA-F][0-9a-fA-F]{2}")

#: How JSON has to spell a NUL: a raw one is not valid inside a string.
_NUL_ESCAPE = b"\\u0000"

#: Bodies past this are passed on unchecked; FastAPI's own limits apply.
MAX_CHECKED_BYTES = 32 * 1024 * 1024

_BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _is_json(scope: Scope) -> bool:
    """Whether FastAPI would read this request's body as JSON."""
    for name, value in scope.get("headers") or []:
        if name == b"content-type":
            media = value.split(b";", 1)[0].strip().lower()
            return media == b"application/json" or media.endswith(b"+json")
    # FastAPI reads a body sent with no content type as JSON.
    return True


def has_lone_surrogate(body: bytes) -> bool:
    """Whether ``body``, read as JSON, holds a string that is not valid Unicode."""
    if not _SURROGATE_ESCAPE.search(body):
        return False
    try:
        data = json.loads(body)
    except (ValueError, RecursionError):
        return False  # not JSON: FastAPI answers that itself
    return holds_lone_surrogate(data)


def holds_lone_surrogate(value: Any) -> bool:
    """Whether ``value`` - parsed JSON or YAML - holds a string that is not valid Unicode.

    Walks lists, tuples and mapping keys and values without recursing, so a
    deeply nested document can't exhaust the stack.
    """
    stack: list[Any] = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            try:
                item.encode("utf-8")
            except UnicodeEncodeError:
                return True
        elif isinstance(item, dict):
            stack.extend(item.keys())
            stack.extend(item.values())
        elif isinstance(item, (list, tuple)):
            stack.extend(item)
    return False


def _without_nul(item: Any) -> Any:
    if isinstance(item, str):
        return item.replace("\x00", "")
    if isinstance(item, dict):
        return {_without_nul(k): _without_nul(v) for k, v in item.items()}
    if isinstance(item, list):
        return [_without_nul(v) for v in item]
    return item


def strip_nul(body: bytes) -> bytes:
    """``body``, read as JSON, with every NUL removed from its strings and keys."""
    if _NUL_ESCAPE not in body:
        return body
    try:
        return json.dumps(_without_nul(json.loads(body))).encode()
    except (ValueError, RecursionError):
        return body  # not JSON: FastAPI answers that itself


class JsonTextMiddleware:
    """Answer a JSON body holding a lone surrogate with a 422; drop its NULs."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in _BODY_METHODS or not _is_json(scope):
            await self.app(scope, receive, send)
            return

        messages: list[Message] = []
        size = 0
        complete = False
        while True:
            message = await receive()
            messages.append(message)
            if message["type"] != "http.request":
                break  # the client went away; let the app see it
            size += len(message.get("body", b""))
            if not message.get("more_body", False):
                complete = True
                break
            if size > MAX_CHECKED_BYTES:
                break

        body = b"".join(m.get("body", b"") for m in messages) if complete else b""
        if has_lone_surrogate(body):
            response = JSONResponse(
                {
                    "detail": [
                        {
                            "type": "unicode_error",
                            "loc": ["body"],
                            "msg": "Text must be valid Unicode",
                        }
                    ]
                },
                status_code=422,
            )
            await response(scope, receive, send)
            return

        cleaned = strip_nul(body)
        if cleaned is not body:
            messages = [{"type": "http.request", "body": cleaned, "more_body": False}]

        async def replay() -> Message:
            if messages:
                return messages.pop(0)
            return await receive()

        await self.app(scope, replay, send)
