"""Refuse JSON request bodies holding text that is not valid Unicode.

JSON can spell half of a UTF-16 surrogate pair on its own (``"\\ud800"``), and
Python decodes it into a ``str`` that cannot be encoded as UTF-8. Anything that
then hashes, folds or stores the text - a password, a username, a title - fails
with a ``UnicodeEncodeError``, turning a client mistake into a 500. Form fields,
paths and query strings are percent-decoded with replacement, so they never
carry one; JSON bodies are the only way in, and this answers them with a 422,
shaped like any other validation error, before any handler sees them.

Pure ASGI, like the other middleware here, so streamed responses are left
alone. A body is buffered only when it is JSON, which FastAPI reads whole
anyway, and only parsed when it holds a surrogate escape at all.
"""
import json
import re
from typing import Any

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

#: A ``\uD800``-``\uDFFF`` escape: half of a surrogate pair, or one alone.
_SURROGATE_ESCAPE = re.compile(rb"\\u[dD][89a-fA-F][0-9a-fA-F]{2}")

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
    stack: list[Any] = [data]
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
        elif isinstance(item, list):
            stack.extend(item)
    return False


class LoneSurrogateMiddleware:
    """Answer a JSON body holding a lone surrogate with a 422."""

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

        if complete and has_lone_surrogate(b"".join(m.get("body", b"") for m in messages)):
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

        async def replay() -> Message:
            if messages:
                return messages.pop(0)
            return await receive()

        await self.app(scope, replay, send)
