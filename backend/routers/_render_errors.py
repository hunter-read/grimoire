"""How render-pool failures read over HTTP, shared by the book and map page routes."""
from contextlib import contextmanager
from typing import Iterator

from fastapi import HTTPException

from ..config import logger
from ..render.ops import PageOutOfRange, RenderError, TileOutOfRange, WidthOutOfRange


@contextmanager
def render_errors(failed: str = "This page could not be rendered") -> Iterator[None]:
    """Turn the render pool's errors into HTTP responses.

    A page or tile the document doesn't have is the caller's mistake (400). A
    render that failed, or whose worker crashed or hung, is ours (500): the
    worker is replaced and the next request tries again.
    """
    try:
        yield
    except (PageOutOfRange, TileOutOfRange, WidthOutOfRange) as e:
        raise HTTPException(400, str(e)) from None
    except RenderError as e:
        logger.warning("%s: %s", failed, e)
        raise HTTPException(500, failed) from None
