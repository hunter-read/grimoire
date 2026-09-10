"""Frame discovery, id encoding, and path validation for the token editor.

Frames are overlay images the token editor composites on top of a user's art.
They come from two places: the defaults bundled with the frontend (served by
Vite from ``frontend/static/frames/``, never by this endpoint), and any image in
a folder the operator has marked as holding frames.

A folder declares itself by containing a ``.frames-container`` marker file —
the same convention the books collection uses for ``.parent-system-container``
and friends, and for the same reason: the declaration lives *in* the folder, so
the folder keeps whatever name reads best on disk. ``tokens/Fantasy Frames/``
and ``tokens/Scifi Frames/`` are both frame folders if each holds the marker.

Frames are ordinary library files: the scanner indexes them as tokens like any
other image, and they appear in the token gallery. The marker adds a use for
them rather than hiding them — a frame image *is* a token image, just one you
would normally composite rather than place on a map.
"""

import base64
import binascii
import os
import threading
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from ...indexer import resolve_collection_dir
from ...services.library_fs.constants import LibraryFSError
from ...services.library_fs.paths import library_root, safe_join, to_relative

# Formats the editor can draw onto a canvas. SVG is admitted because an
# ``<img>``-loaded SVG renders in the browser's secure static mode — no script
# execution, inert event attributes, no external fetches — and the serve handler
# additionally pins a restrictive per-response CSP. See ``serve_token_frame``.
FRAME_EXTS = {".png", ".webp", ".svg"}

FRAME_MEDIA_TYPES = {
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}

# The marker file a folder holds to declare that its images are frames.
# Mirrors the books collection's container markers exactly: an empty file whose
# presence reclassifies the folder containing it.
FRAMES_MARKER = ".frames-container"

# Ceilings. MAX_FRAMES bounds the listing (and so the walk); MAX_FRAME_BYTES
# bounds what a single frame can cost the rendering client, which is the real
# residual risk for SVG — a small file can still expand into a pathological
# render. Anyone able to write into LIBRARY_PATH is already the operator, so
# these are guardrails against accident rather than a security boundary.
MAX_FRAMES = 300
MAX_FRAME_BYTES = 4 * 1024 * 1024

# The listing is a filesystem walk over the whole token library, and the editor
# asks for it every time it opens. A short TTL keeps a big library from paying
# for that repeatedly while staying short enough that a user who just dropped a
# PNG into a frames container and reloaded sees it.
LISTING_TTL_SECONDS = 60.0

_cache_lock = threading.Lock()
_cache: Optional[tuple[float, list[dict[str, str]]]] = None


def encode_frame_id(relative: str) -> str:
    """Encode a library-relative path as an opaque, URL-safe frame id.

    base64url rather than the raw path: a path segment containing ``%2F`` is
    normalised back to ``/`` by many proxies *before* FastAPI matches the route,
    which would silently change which route ran. The base64url alphabet is
    ``[A-Za-z0-9_-]``, so no metacharacter ever reaches the router.

    The id is not signed because it carries no authority — ``resolve_frame_path``
    revalidates it from scratch on every use.
    """
    return base64.urlsafe_b64encode(relative.encode("utf-8")).decode("ascii").rstrip("=")


def decode_frame_id(frame_id: str) -> str:
    """Decode a frame id back to a library-relative path, or 404."""
    padding = "=" * (-len(frame_id) % 4)
    try:
        return base64.urlsafe_b64decode(frame_id + padding).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        raise HTTPException(404, "Frame not found") from None


def tokens_root() -> Path:
    """The token collection directory, resolved case-insensitively."""
    return resolve_collection_dir(library_root(), "tokens")


def is_frame_location(path: Path) -> bool:
    """True when ``path`` sits in a folder that has declared itself a frame folder.

    The declaration is a ``.frames-container`` marker file in the same folder,
    which is what makes an ordinary directory name like ``Fantasy Frames`` work.
    The folder must also sit under ``tokens/`` and be reached through non-hidden
    directories, so a marker dropped somewhere unexpected cannot open up a path
    the caller had no business reading.

    This is the gate that makes a frame id safe to accept: ``safe_join`` alone
    only proves a path is *inside the library*, which every book and map also is.
    """
    try:
        root = tokens_root().resolve()
        parent = path.parent.resolve()
        relative = parent.relative_to(root)
    except (ValueError, OSError):
        return False
    if any(part.startswith(".") for part in relative.parts):
        return False
    try:
        return (parent / FRAMES_MARKER).is_file()
    except OSError:
        return False


def resolve_frame_path(frame_id: str) -> Path:
    """Turn a caller-supplied frame id into a real file path, or raise 404.

    Four gates, all mandatory. Every failure returns the same 404 — a distinct
    403 for "exists but forbidden" would confirm the existence of paths the
    caller cannot read.
    """
    relative = decode_frame_id(frame_id)
    try:
        path = safe_join(relative, must_exist=True)
    except LibraryFSError:
        raise HTTPException(404, "Frame not found") from None
    if not is_frame_location(path):
        raise HTTPException(404, "Frame not found")
    if path.suffix.lower() not in FRAME_EXTS or not path.is_file():
        raise HTTPException(404, "Frame not found")
    return path


def _frame_name(stem: str) -> str:
    """Humanise a filename stem for display, mirroring the indexer's title rule."""
    return stem.replace("_", " ").replace("-", " ").strip() or stem


def _frame_row(path: Path, root: Path) -> dict[str, str]:
    """Build the listing entry for one frame file.

    ``group`` is the frame folder's own path relative to ``tokens/`` — so images
    in ``tokens/Fantasy Frames`` group under "Fantasy Frames". It gives the
    picker section headers without needing a second endpoint.
    """
    try:
        group = str(path.parent.relative_to(root)).replace("\\", "/")
    except ValueError:
        group = ""
    return {
        "id": encode_frame_id(to_relative(path)),
        "name": _frame_name(path.stem),
        "group": "" if group == "." else group,
        "format": path.suffix.lower().lstrip("."),
    }


def scan_user_frames() -> list[dict[str, str]]:
    """Walk ``library/tokens/**`` for folders holding a ``.frames-container`` marker.

    Frame folders are ordinary visible directories, so this is an ordinary walk
    that skips hidden folders — no special descent needed. An unreadable folder
    yields no frames rather than a 500, the same way ``_find_folder_artwork``
    treats one.
    """
    root = tokens_root()
    if not root.is_dir():
        return []

    found: list[dict[str, str]] = []
    # followlinks stays False (the default, but the reason matters): a symlink
    # loop inside the library would otherwise hang the request forever.
    for dirpath, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        if FRAMES_MARKER not in files:
            continue

        for name in sorted(files):
            if name.startswith(".") or Path(name).suffix.lower() not in FRAME_EXTS:
                continue
            path = Path(dirpath) / name
            try:
                if not path.is_file() or path.stat().st_size > MAX_FRAME_BYTES:
                    continue
            except OSError:
                continue
            found.append(_frame_row(path, root))
            if len(found) >= MAX_FRAMES:
                return found
    return found


def cached_user_frames() -> list[dict[str, str]]:
    """``scan_user_frames`` behind a short process-local TTL cache."""
    global _cache
    now = time.monotonic()
    with _cache_lock:
        if _cache is not None and _cache[0] > now:
            return _cache[1]
    frames = scan_user_frames()
    with _cache_lock:
        _cache = (now + LISTING_TTL_SECONDS, frames)
    return frames


def reset_frame_cache() -> None:
    """Drop the cached listing. For tests, and any future explicit invalidation."""
    global _cache
    with _cache_lock:
        _cache = None


def frame_response_headers(path: Path) -> dict[str, Any]:
    """Per-response headers for a served frame file.

    The CSP override is defence in depth for SVG. A frame is only ever loaded
    into an ``<img>``, where SVG cannot execute script — and the global policy
    already blocks ``<object>``/``<embed>`` and framing. This pins the file
    itself inert even when navigated to directly, so a browser bug in secure
    static mode does not become an XSS. ``SecurityHeadersMiddleware`` leaves
    headers a response already set untouched, the same mechanism
    ``SAME_ORIGIN_FRAME_HEADERS`` relies on.
    """
    return {
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Content-Disposition": f'inline; filename="{path.name}"',
    }
