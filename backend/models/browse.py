"""Stored sort keys and folders that let the library be browsed in pages.

Issue #221: the browse views used to download a whole collection and sort, group
and filter it in the browser, which does not survive a library of a few hundred
thousand files. Paging moves that work into SQL, which needs two columns the
schema did not have. Both are derived from columns the row already has, and are
kept in step by ORM events (:func:`register_sort_key_events`) so no write path
has to remember them.

**A natural sort key.** The galleries sorted with ``Intl.Collator(numeric:
true)``, which compares digit runs as numbers and ignores case and accents.
SQLite has no such collation, and registering a Python one would leave the
index unreadable to any connection that lacks it - the ``sqlite3`` CLI
included. So the key is computed here and stored in an ordinary indexed column
(``sort_name`` on media, ``sort_title`` on books), where a plain binary
comparison of two keys gives the natural order.

**The item's folder.** The directory part of ``relative_path``
(``maps/Swamps/Bog/fen.jpg`` lives in ``maps/Swamps/Bog/``), stored as
``folder_path``. Grouping by folder, opening one folder, and "everything under
this tagged folder" are then plain comparisons on an indexed column. Computing
it in SQL instead was tried first: an expression index serves the queries that
can use it, but every filter that cannot re-evaluates the expression per row,
and a "no tags" filter over 187k tokens took half a minute.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Optional

from sqlalchemy import event

_DIGITS = re.compile(r"\d+")


def _number(match: re.Match) -> str:
    """A digit run as ``<3-digit length><digits>``, leading zeros dropped.

    Prefixing the length makes a longer number compare greater whatever its
    digits ("10" after "9"); numbers of equal length then compare digit by
    digit, which is numeric order. Three digits of length covers any run a
    filename will plausibly hold.
    """
    digits = match.group(0).lstrip("0") or "0"
    return f"{len(digits):03d}{digits}"


def natural_key(text: Optional[str]) -> str:
    """The sort key for ``text``: case-, accent- and digit-length-insensitive.

    Accents are folded by decomposing (NFKD) and dropping the combining marks,
    so "Élan" files beside "elan" rather than after "z", as the browser
    collator placed it.
    """
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text)
    folded = "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()
    return _DIGITS.sub(_number, folded)


def folder_path_of(relative_path: Optional[str]) -> str:
    """The directory part of a path, slash-normalised, with a trailing slash.

    ``maps/Swamps/Bog/fen.jpg`` is ``maps/Swamps/Bog/``; a bare filename is
    ``""``. Backslashes become slashes first: a path indexed on Windows is stored
    with them, and every other reader of the path normalises them too (see
    ``getFolderPath`` in the frontend).
    """
    path = (relative_path or "").replace("\\", "/")
    cut = path.rfind("/")
    return path[: cut + 1] if cut >= 0 else ""


def _set_media_keys(_mapper: Any, _connection: Any, target: Any) -> None:
    target.sort_name = natural_key(target.filename)
    target.folder_path = folder_path_of(target.relative_path)


def _set_book_keys(_mapper: Any, _connection: Any, target: Any) -> None:
    target.sort_title = natural_key(target.title)
    target.folder_path = folder_path_of(target.relative_path)


def register_sort_key_events(media_models: list, book_model: Any) -> None:
    """Keep the stored sort keys and folders in step with every ORM write.

    Insert and update both, so a rename, a move, or a title edit in the book
    editor re-keys the row without each of those paths having to remember to.
    A bulk ``Query.update()`` bypasses mapper events; nothing writes a path,
    filename or title that way, and the migration that added the columns
    backfills.
    """
    for model in media_models:
        event.listen(model, "before_insert", _set_media_keys)
        event.listen(model, "before_update", _set_media_keys)
    event.listen(book_model, "before_insert", _set_book_keys)
    event.listen(book_model, "before_update", _set_book_keys)
