"""The ``page_num`` path parameter of every route that serves one page.

Pages are numbered from 1. The upper bound is far past any real document and
far below the 64-bit integer SQLite binds, so a huge value is a 422 rather than
an overflow inside a query or a renderer.
"""
from typing import Annotated

from fastapi import Path

MAX_PAGE_NUM = 1_000_000

PageNum = Annotated[int, Path(ge=1, le=MAX_PAGE_NUM, description="Page number, from 1.")]
