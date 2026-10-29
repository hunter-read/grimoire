"""SQL tests for "this stored path is inside that folder".

The obvious spelling, ``column.startswith(prefix)``, compiles to
``column LIKE :prefix || '%'``, and SQLite's ``LIKE`` is wrong for paths twice
over: it ignores ASCII case, so ``books/Game/core/`` matches every row under
``books/Game/Core/``, and unless escaped, ``_`` and ``%`` in a folder name are
wildcards, so ``Book_1/`` matches ``BookX1/`` as well. A delete, unindex, move
or rename of one folder then acts on a sibling's rows too (issue #754).

These compare with ``=`` instead, which uses the column's BINARY collation:
case-sensitive, with no wildcards. ``substr`` counts characters and Python's
``len`` counts code points, so the two agree for any non-ASCII name.
"""
from typing import Any

from sqlalchemy import func, or_


def path_under(column: Any, prefix: str) -> Any:
    """``column`` starts with exactly ``prefix``: same case, no wildcards.

    Pass the folder with its trailing separator (``"books/Game/core/"``), or a
    file named like the folder (``core.pdf``) matches too.
    """
    return func.substr(column, 1, len(prefix)) == prefix


def path_at_or_under(column: Any, path: str, sep: str = "/") -> Any:
    """``column`` is ``path`` itself or anything beneath it."""
    return or_(column == path, path_under(column, path + sep))
