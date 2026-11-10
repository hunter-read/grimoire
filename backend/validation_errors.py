"""The 422 answer to a request that fails validation.

FastAPI's own handler echoes each bad value back in the error, and renders the
body as UTF-8. Some values cannot be written back that way, and the failure
while the error is rendered turned a client mistake into a 500:

- a lone surrogate sent as ``"\\ud800"`` in JSON, which is not UTF-8;
- ``NaN`` or ``Infinity``, which strict JSON has no way to write;
- a value nested thousands deep, which overflows the encoder's recursion.

This answers the same body, leaving out the echoed value of an error that
cannot be written, and escaping text that is not UTF-8.
"""
import json
from typing import Any

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

#: The parts of an error that carry the request's own value.
_ECHOED = ("input", "ctx")


def _writable(error: Any) -> Any:
    """One error as JSON can carry it, without its echoed value if that cannot be."""
    try:
        encoded = jsonable_encoder(error)
        json.dumps(encoded, allow_nan=False)
        return encoded
    except (ValueError, TypeError, RecursionError):
        return jsonable_encoder({k: v for k, v in error.items() if k not in _ECHOED})


async def request_validation_handler(_request: Request, exc: Exception) -> Response:
    assert isinstance(exc, RequestValidationError)
    content = {"detail": [_writable(error) for error in exc.errors()]}
    try:
        return JSONResponse(status_code=422, content=content)
    except UnicodeEncodeError:
        # json.dumps escapes non-ASCII by default, surrogates included, which
        # still reads back as the same JSON.
        return Response(json.dumps(content), status_code=422, media_type="application/json")
