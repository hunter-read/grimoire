"""The 422 answer to a request that fails validation.

FastAPI's own handler echoes each bad value back in the error, and renders the
body as UTF-8. A value that cannot be written as UTF-8 - a lone surrogate sent
as ``"\\ud800"`` in JSON - then fails while the error is rendered, turning a
client mistake into a 500. This answers the same body, with such text escaped.
"""
import json

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response


async def request_validation_handler(_request: Request, exc: Exception) -> Response:
    assert isinstance(exc, RequestValidationError)
    content = {"detail": jsonable_encoder(exc.errors())}
    try:
        return JSONResponse(status_code=422, content=content)
    except UnicodeEncodeError:
        # json.dumps escapes non-ASCII by default, surrogates included, which
        # still reads back as the same JSON.
        return Response(json.dumps(content), status_code=422, media_type="application/json")
