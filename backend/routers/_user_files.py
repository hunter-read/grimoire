"""Serving files from the library, uploads and caches - one way, with one set of headers.

Every router used to build its own ``FileResponse`` and remember to add the
inert-document headers for an SVG, which is how one route ends up without
them. Routes serve files through :func:`serve_user_file` instead, which picks
the type from the extension when the caller has none and always applies
``security.inert_svg_headers``; ``test_router_access_guards`` fails on a
router that builds a ``FileResponse`` itself.
"""
import mimetypes
from typing import Mapping, Optional

from fastapi.responses import FileResponse

from ..security import inert_svg_headers

# Types mimetypes doesn't know everywhere (it reads the host's mime.types).
_EXTRA_TYPES = {
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".m4b": "audio/mp4",
    ".opus": "audio/ogg",
    ".stl": "model/stl",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
}


def guess_media_type(path: str) -> str:
    """The media type for ``path`` from its extension, or octet-stream."""
    dot = path.rfind(".")
    ext = path[dot:].lower() if dot != -1 else ""
    return _EXTRA_TYPES.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"


def serve_user_file(
    path: str,
    media_type: Optional[str] = None,
    *,
    filename: Optional[str] = None,
    headers: Optional[Mapping[str, str]] = None,
    same_origin_frame: bool = False,
) -> FileResponse:
    """A ``FileResponse`` for ``path``, with the inert headers an SVG needs.

    ``filename`` makes it a download (``Content-Disposition: attachment``).
    ``same_origin_frame`` is for a file the reader embeds in a same-origin
    frame. The inert headers win over ``headers`` for an SVG, so a caller can't
    loosen them by accident.

    Without a ``Cache-Control`` from the caller the response is ``private``: what
    a route serves depends on who is signed in, so only that user's browser keeps
    a copy.
    """
    media = media_type or guess_media_type(path)
    merged = {
        **(headers or {}),
        **inert_svg_headers(media, path, same_origin_frame=same_origin_frame),
    }
    if not any(key.lower() == "cache-control" for key in merged):
        merged["Cache-Control"] = "private"
    return FileResponse(path, media_type=media, filename=filename, headers=merged)
