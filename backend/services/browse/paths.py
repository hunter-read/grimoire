"""Folder membership as SQL, for paged browsing and tag counting (issue #221).

An item's folder is the directory part of its ``relative_path`` -
``maps/Swamps/Bog/fen.jpg`` lives in ``maps/Swamps/Bog/`` - stored and indexed
as ``folder_path`` (see ``models/browse.py``). Folder records (the
``*_folders`` tag tables, ``BookFolder``) store their path *without* the leading
part: a map folder is ``Swamps/Bog``, collection-relative, and a book folder is
``{system_id}/{category}/{subfolder…}``.

So matching a folder record to its items means putting the leading part back.
That part is the collection's top-level directory for media (``maps/``, or
``Maps/`` on a case-sensitive filesystem), and everything down to the category
directory for books (``books/{System}/{Core Rulebooks}/``). Neither is stored,
so :func:`folder_prefixes` reads the distinct values off the folder index - a
handful of index seeks, however large the collection.

With the prefixes known, "this folder and everything under it" is a range on
the indexed folder column (``>= 'maps/Swamps/'`` and ``< 'maps/Swamps0'``,
``0`` being the character after ``/``), and "directly in this folder" is an
equality. Both read the index, which is what replaces walking every row's path
in Python.
"""
from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy import and_, false, func, or_
from sqlalchemy.orm import Session

# The character after "/" in code-point order. Every path under a folder
# ``X/`` sorts at or after ``X/`` and before ``X0``.
_AFTER_SLASH = chr(ord("/") + 1)


def folder_column(model: Any) -> Any:
    """The indexed folder column for ``model``'s rows."""
    return model.folder_path


def _leading(folder: str, segments: int) -> str:
    """The first ``segments`` path segments of ``folder``, with a trailing slash.

    ``""`` when the folder is shallower than that - an item sitting above where
    the prefix ends (a book directly in its system folder, say) has no prefix.
    """
    parts = folder.split("/")[:-1]  # folder always ends in "/" (or is "")
    if len(parts) < segments:
        return ""
    return "/".join(parts[:segments]) + "/"


def folder_prefixes(db: Session, model: Any, criteria: Iterable[Any], segments: int = 1) -> list[str]:
    """The distinct leading ``segments`` directories among matching rows.

    A loose index scan: take the smallest folder, record its prefix, then seek
    to the first folder past everything under that prefix, and repeat. Each step
    is one index lookup, so the cost is the number of distinct prefixes - nearly
    always one - not the number of rows.

    ``criteria`` must be equality filters on the columns ahead of the folder in
    the index (``variant_parent_id`` for media; system, variant and category for
    books), or the seeks cannot use it.
    """
    column = folder_column(model)
    base = list(criteria)
    prefixes: list[str] = []
    bound = None
    # Bounded: a prefix is consumed every iteration, so this ends on its own;
    # the cap only stops a pathological table from turning into a long loop.
    for _ in range(1000):
        q = db.query(func.min(column)).filter(*base)
        if bound is not None:
            q = q.filter(column >= bound)
        smallest = q.scalar()
        if smallest is None:
            break
        prefix = _leading(smallest, segments)
        if not prefix:
            # Shallower than the prefix depth: skip past this exact folder.
            bound = smallest + "\x00"
            continue
        prefixes.append(prefix)
        bound = prefix[:-1] + _AFTER_SLASH
    return prefixes


def subtree_clause(model: Any, prefixes: Iterable[str], sub: str) -> Any:
    """Rows in folder ``sub`` (relative to a prefix) or anywhere beneath it.

    ``sub`` is a folder record's path relative to the prefix, without slashes at
    either end; ``""`` means the whole prefix.
    """
    column = folder_column(model)
    ranges = []
    for prefix in prefixes:
        start = prefix + sub.strip("/") + "/" if sub.strip("/") else prefix
        ranges.append(and_(column >= start, column < start[:-1] + _AFTER_SLASH))
    return or_(*ranges) if ranges else false()


def exact_clause(model: Any, prefixes: Iterable[str], sub: str) -> Any:
    """Rows directly in folder ``sub`` (relative to a prefix), not beneath it."""
    column = folder_column(model)
    sub = sub.strip("/")
    wanted = [prefix + sub + "/" if sub else prefix for prefix in prefixes]
    if not sub:
        # A bare filename (no directory at all) has an empty folder; it sits at
        # the root as far as every reader of the path is concerned.
        wanted.append("")
    return column.in_(wanted)


def relative_folder(folder: str, segments: int) -> str:
    """``folder`` with its first ``segments`` directories and trailing slash removed.

    The inverse of the prefixing above: ``maps/Swamps/Bog/`` at one segment is
    ``Swamps/Bog``, the form folder records and the frontend use.
    """
    parts = folder.split("/")[:-1]
    return "/".join(parts[segments:])
