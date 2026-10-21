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
"""
import io
import os
import threading
from contextlib import contextmanager
from typing import Callable, Iterator, Optional

from fastapi import HTTPException
from fastapi.responses import Response, StreamingResponse

from .._user_files import serve_user_file
from ...config import valkey_client, logger, valkey_cache_set
from ...render.ops import PageOutOfRange, RenderError, TileOutOfRange


@contextmanager
def render_errors(failed: str = "This page could not be rendered") -> Iterator[None]:
    """Turn the render pool's errors into HTTP responses.

    A page or tile the document doesn't have is the caller's mistake (400). A
    render that failed, or whose worker crashed or hung, is ours (500): the
    worker is replaced and the next request tries again.
    """
    try:
        yield
    except (PageOutOfRange, TileOutOfRange) as e:
        raise HTTPException(400, str(e)) from None
    except RenderError as e:
        logger.warning("%s: %s", failed, e)
        raise HTTPException(500, failed) from None


# One lock per key currently rendering, with the number of requests holding or
# waiting on it, so the entry is dropped once the last of them is done.
_inflight: dict[str, tuple[threading.Lock, int]] = {}
_inflight_guard = threading.Lock()


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
    with _single_flight(valkey_key):
        # Another request may have rendered it while this one waited.
        if (hit := _cached(valkey_key, cache_path, headers)) is not None:
            return hit
        img_bytes = render()
        # Fall back to the disk cache when Valkey is absent or the write failed, so
        # a Valkey outage degrades to the on-disk path instead of losing the render.
        if not valkey_cache_set(valkey_key, img_bytes):
            _write_disk_cache(cache_path, img_bytes)
    return StreamingResponse(io.BytesIO(img_bytes), media_type="image/webp", headers=headers)
