"""Serve a rendered WebP through the Valkey and on-disk render caches.

Shared by whole-page renders (pages.py) and zoom tiles (tiles.py), which are
cached the same way: Valkey first when it is configured, then the file under
PAGE_CACHE_DIR, and only then a fresh render. Keys and filenames are the
caller's, and both carry the file's content token, so a replaced file renders
under new entries rather than serving the old ones.
"""
import io
import os
from typing import Callable

from fastapi.responses import FileResponse, Response, StreamingResponse

from ...config import _valkey, logger, valkey_cache_set


def serve_cached_render(
    valkey_key: str,
    cache_path: str,
    headers: dict[str, str],
    render: Callable[[], bytes],
) -> Response:
    """The cached WebP for ``valkey_key``/``cache_path``, rendering it on a miss."""
    if _valkey is not None:
        try:
            cached = _valkey.get(valkey_key)
            if cached:
                return StreamingResponse(io.BytesIO(cached), media_type="image/webp", headers=headers)
        except Exception as e:
            logger.warning(f"Valkey get error: {e}")

    if os.path.exists(cache_path):
        if _valkey is not None:
            try:
                with open(cache_path, "rb") as f:
                    valkey_cache_set(valkey_key, f.read())
            except OSError as e:
                logger.warning(f"Page cache read error: {e}")
        return FileResponse(cache_path, media_type="image/webp", headers=headers)

    img_bytes = render()
    # Fall back to the disk cache when Valkey is absent or the write failed, so
    # a Valkey outage degrades to the on-disk path instead of losing the render.
    if not valkey_cache_set(valkey_key, img_bytes):
        with open(cache_path, "wb") as f:
            f.write(img_bytes)
    return StreamingResponse(io.BytesIO(img_bytes), media_type="image/webp", headers=headers)
