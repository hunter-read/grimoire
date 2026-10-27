"""Handing the memory MuPDF used for a render back to the operating system.

Shared by the in-process render path (``services/books/documents.py``) and the
render workers (``backend/render/worker.py``), which reclaim their own memory
the same way.
"""
import ctypes
import logging
import platform
from typing import Any, Callable, Optional

import fitz  # PyMuPDF

logger = logging.getLogger("grimoire")


# glibc's malloc_trim() is what actually returns freed arenas to the OS. It does
# not exist on musl (Alpine), so resolve it once and treat absence as "no trim"
# rather than assuming the symbol is there.
def resolve_malloc_trim() -> Optional[Callable[[int], Any]]:
    if platform.system() != "Linux":
        return None
    try:
        libc = ctypes.CDLL("libc.so.6")
    except OSError:
        return None  # musl / non-glibc: nothing to call
    return getattr(libc, "malloc_trim", None)


malloc_trim = resolve_malloc_trim()


def reclaim_render_memory() -> None:
    """Release MuPDF's C-side store and hand the freed arenas back to the OS.

    Both halves are required and neither is Python-level. MuPDF decodes every
    embedded image on a page to raw RGB to rasterize it, and caches that in a
    process-global store, so ``gc.collect()`` and ``doc.close()`` reclaim
    nothing — the allocations were never on Python's heap and aren't owned by
    the document. ``store_shrink`` frees them inside MuPDF; ``malloc_trim`` then
    releases the now-empty glibc arenas, which is the step that actually moves
    RSS back down.
    """
    try:
        fitz.TOOLS.store_shrink(100)
    except Exception as e:  # pragma: no cover - defensive; API varies by build
        logger.debug("MuPDF store_shrink failed: %s", e)
    if malloc_trim is not None:
        try:
            malloc_trim(0)
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("malloc_trim failed: %s", e)
