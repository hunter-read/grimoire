"""LIKE patterns from user text, the same on SQLite and PostgreSQL.

User text dropped straight into a LIKE pattern is not text: ``%`` and ``_`` are
wildcards on both databases, and on PostgreSQL a backslash is the escape
character, so a search ending in one was an error there. :func:`contains`
escapes all three, and every caller passes ``escape=LIKE_ESCAPE`` so both
databases read the escapes the same way.
"""

from typing import Any

LIKE_ESCAPE = "\\"


def escape_like(value: str) -> str:
    """``value`` with LIKE's special characters escaped, matched literally."""
    return (
        value.replace(LIKE_ESCAPE, LIKE_ESCAPE * 2)
        .replace("%", LIKE_ESCAPE + "%")
        .replace("_", LIKE_ESCAPE + "_")
    )


def contains(value: str) -> str:
    """A LIKE pattern matching ``value`` anywhere, literally."""
    return f"%{escape_like(value)}%"


def icontains(column: Any, value: str) -> Any:
    """``column`` contains ``value``, case-insensitively and literally."""
    return column.ilike(contains(value), escape=LIKE_ESCAPE)


def iequals(column: Any, value: str) -> Any:
    """``column`` equals ``value`` case-insensitively (no wildcards)."""
    return column.ilike(escape_like(value), escape=LIKE_ESCAPE)


def ilike(column: Any, pattern: str) -> Any:
    """``column`` ILIKE a ``pattern`` built with :func:`contains`."""
    return column.ilike(pattern, escape=LIKE_ESCAPE)
