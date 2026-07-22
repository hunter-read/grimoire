"""Shared helper for serving on-disk files with HTTP cache validators.

Starlette's ``FileResponse`` emits ``ETag``/``Last-Modified`` (derived from the
file's mtime + size) but does *not* honour ``If-None-Match``/``If-Modified-Since``
— it only handles ``Range`` requests. This helper adds conditional-request
handling so a client that already holds a fresh copy gets a cheap ``304 Not
Modified`` instead of the full body, and attaches a shared ``Cache-Control``
policy so every uploaded/served file behaves the same way.

Uploaded files (campaign banners, character art, sheets, file resources) are
mutable — re-uploaded under the same URL — so we cache with revalidation rather
than the ``immutable`` policy used for content-addressed rendered pages. Because
the validator is derived from mtime + size, a re-upload naturally invalidates the
cached copy.
"""

import os
from email.utils import formatdate, parsedate
from typing import Any

from fastapi import Request
from fastapi.responses import FileResponse, Response
from starlette.responses import md5_hexdigest

# Cache for 5 minutes, then revalidate against the validators below. "private"
# keeps these access-controlled responses out of shared/proxy caches.
UPLOAD_CACHE_CONTROL = "private, max-age=300, must-revalidate"


def _validators(stat_result: os.stat_result) -> tuple[str, str]:
    """Return the (etag, last_modified) pair Starlette's FileResponse would emit."""
    etag_base = f"{stat_result.st_mtime}-{stat_result.st_size}"
    etag = f'"{md5_hexdigest(etag_base.encode(), usedforsecurity=False)}"'
    last_modified = formatdate(stat_result.st_mtime, usegmt=True)
    return etag, last_modified


def _not_modified(request: Request, etag: str, last_modified: str) -> bool:
    """True when the client's cached copy is still fresh per RFC 9110 §13.

    ``If-None-Match`` takes precedence over ``If-Modified-Since`` when present.
    """
    if_none_match = request.headers.get("if-none-match")
    if if_none_match is not None:
        if if_none_match.strip() == "*":
            return True
        candidates = {tag.strip().removeprefix("W/") for tag in if_none_match.split(",")}
        return etag in candidates or etag.removeprefix("W/") in candidates

    if_modified_since = request.headers.get("if-modified-since")
    if if_modified_since is not None:
        client = parsedate(if_modified_since)
        current = parsedate(last_modified)
        if client is not None and current is not None:
            return current <= client
    return False


def cached_file_response(request: Request, path: str, **kwargs: Any) -> Response:
    """Serve ``path`` with cache validators, returning 304 when the client is fresh.

    Accepts the same keyword arguments as ``FileResponse`` (``filename``,
    ``media_type``, …). Any caller-supplied ``headers`` are preserved and the
    shared ``Cache-Control`` is added unless the caller already set one.
    """
    etag, last_modified = _validators(os.stat(path))

    headers = dict(kwargs.pop("headers", None) or {})
    headers.setdefault("Cache-Control", UPLOAD_CACHE_CONTROL)

    if _not_modified(request, etag, last_modified):
        return Response(
            status_code=304,
            headers={
                "ETag": etag,
                "Last-Modified": last_modified,
                "Cache-Control": headers["Cache-Control"],
            },
        )
    return FileResponse(path, headers=headers, **kwargs)
