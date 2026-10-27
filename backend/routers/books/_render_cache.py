"""Serve a rendered WebP through the Valkey and on-disk render caches.

Shared by whole-page renders (pages.py) and zoom tiles (tiles.py), which are
cached the same way: Valkey first when it is configured, then the file under
PAGE_CACHE_DIR, and only then a fresh render. Keys and filenames are the
caller's, and both carry the file's content token, so a replaced file renders
under new entries rather than serving the old ones.

A miss renders once per key: a second request for an entry that is already
rendering waits for that render and is served from the cache it fills, rather
than rendering the same page again. The client prefetches the pages a note
links to and the search hit under the cursor (issue #640), so a click that
lands mid-prefetch asks for exactly the page being rendered.

Misses are also capped (issue #701): every one holds a request thread until its
render is done, waiting for the same key included, and those threads serve the
whole API. Past ``RENDER_QUEUE_LIMIT`` a miss is answered 503 with Retry-After
straight away, and the reader asks again. Cache hits are never refused.
"""
import io
import os
import threading
from contextlib import contextmanager
from typing import Callable, Iterator, Optional

from fastapi import HTTPException
from fastapi.responses import Response, StreamingResponse

from .._user_files import serve_user_file
from ... import config
from ...config import valkey_client, logger, valkey_cache_set

# Seconds a refused render is told to wait before asking again: about one render.
RETRY_AFTER = 1


# One lock per key currently rendering, with the number of requests holding or
# waiting on it, so the entry is dropped once the last of them is done.
_inflight: dict[str, tuple[threading.Lock, int]] = {}
_inflight_guard = threading.Lock()
# Misses rendering or waiting on a render, across every key; under _inflight_guard.
_admitted = 0


@contextmanager
def _admission() -> Iterator[None]:
    """Count a miss against RENDER_QUEUE_LIMIT, or refuse it with a 503 when full."""
    global _admitted
    with _inflight_guard:
        if _admitted >= config.RENDER_QUEUE_LIMIT:
            raise HTTPException(
                503,
                "The server is busy rendering pages; try again shortly",
                headers={"Retry-After": str(RETRY_AFTER), "Cache-Control": "no-store"},
            )
        _admitted += 1
    try:
        yield
    finally:
        with _inflight_guard:
            _admitted -= 1


@contextmanager
def _single_flight(key: str) -> Iterator[None]:
    """Hold the render lock for ``key``, shared by every request for it."""
    with _inflight_guard:
        lock, users = _inflight.get(key, (threading.Lock(), 0))
        _inflight[key] = (lock, users + 1)
    try:
        with lock:
            yield
    finally:
        with _inflight_guard:
            lock, users = _inflight[key]
            if users > 1:
                _inflight[key] = (lock, users - 1)
            else:
                del _inflight[key]


def _cached(valkey_key: str, cache_path: str, headers: dict[str, str]) -> Optional[Response]:
    """The cached render for the key, from Valkey or disk, or None on a miss."""
    if (client := valkey_client()) is not None:
        try:
            cached = client.get(valkey_key)
            if cached:
                return StreamingResponse(io.BytesIO(cached), media_type="image/webp", headers=headers)
        except Exception as e:
            logger.warning(f"Valkey get error: {e}")

    if os.path.exists(cache_path):
        if (client := valkey_client()) is not None:
            try:
                with open(cache_path, "rb") as f:
                    valkey_cache_set(valkey_key, f.read())
            except OSError as e:
                logger.warning(f"Page cache read error: {e}")
        return serve_user_file(cache_path, "image/webp", headers=headers)
    return None


def _write_disk_cache(cache_path: str, data: bytes) -> None:
    """Write a render to the disk cache all at once.

    Written aside and renamed into place, so a request that finds the file
    never serves one still being written.
    """
    tmp_path = f"{cache_path}.{threading.get_ident()}.tmp"
    try:
        with open(tmp_path, "wb") as f:
            f.write(data)
        os.replace(tmp_path, cache_path)
    except BaseException:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise


def serve_cached_render(
    valkey_key: str,
    cache_path: str,
    headers: dict[str, str],
    render: Callable[[], bytes],
) -> Response:
    """The cached WebP for ``valkey_key``/``cache_path``, rendering it on a miss."""
    if (hit := _cached(valkey_key, cache_path, headers)) is not None:
        return hit
    with _admission(), _single_flight(valkey_key):
        # Another request may have rendered it while this one waited.
        if (hit := _cached(valkey_key, cache_path, headers)) is not None:
            return hit
        img_bytes = render()
        # Fall back to the disk cache when Valkey is absent or the write failed, so
        # a Valkey outage degrades to the on-disk path instead of losing the render.
        if not valkey_cache_set(valkey_key, img_bytes):
            _write_disk_cache(cache_path, img_bytes)
    return StreamingResponse(io.BytesIO(img_bytes), media_type="image/webp", headers=headers)
