"""Whether the scan should date the items it inserts (issue #199).

Every library item records ``added_at`` - when it first appeared - and the UI
badges anything from the last week as new. The exception is the **first
import**: on a fresh install the whole library arrives in one scan, and dating
it would badge every item as new for a week, which says nothing. Items from the
first import are left undated (NULL), exactly like rows that predate tracking.

The first import is over once either is true:

* the ``library.first_import_done`` setting is set - written when a full scan
  completes with something in the library, or
* any item row already carries a date - an install upgraded past migration 0040
  (whose rows were backfilled from ``created_at``), or one that has dated
  inserts already. Checked so an upgrade needs no migration step of its own.

An interrupted first import leaves only undated rows and no setting, so the next
scan carries on undated, as it should: it is still the same import.

A full scan that finds an empty library does not end the first import either,
so installing Grimoire before copying the library in still counts the copy as
the first import.
"""
import datetime
from typing import Any, Callable

from sqlalchemy import exists, null
from sqlalchemy.orm import Session

from ..models import AppSetting, Audio, Book, GenericMap, Model3D, Token

FIRST_IMPORT_DONE_KEY = "library.first_import_done"

_ITEM_MODELS: tuple[Any, ...] = (Book, GenericMap, Token, Audio, Model3D)


def _any_item(session: Session, condition: Callable[[Any], Any]) -> bool:
    """Whether any item table holds a row matching ``condition(model)``."""
    return any(session.query(exists().where(condition(m))).scalar() for m in _ITEM_MODELS)


def first_import_done(session: Session) -> bool:
    """True once the scanner should date new items (see the module docstring)."""
    row = session.query(AppSetting).filter_by(key=FIRST_IMPORT_DONE_KEY).first()
    if row is not None and row.value == "1":
        return True
    return _any_item(session, lambda m: m.added_at.isnot(None))


def mark_first_import_done(session: Session) -> None:
    """Record that the first import has finished, if the library holds anything.

    Called after a complete, unscoped scan. A no-op on an empty library, so the
    import that eventually fills it is still the undated first one.
    """
    if not _any_item(session, lambda m: m.id.isnot(None)):
        return
    row = session.query(AppSetting).filter_by(key=FIRST_IMPORT_DONE_KEY).first()
    if row is None:
        session.add(AppSetting(key=FIRST_IMPORT_DONE_KEY, value="1"))
    elif row.value == "1":
        return
    else:
        row.value = "1"
    session.commit()


def added_at_for_insert(date_inserts: bool) -> Any:
    """The ``added_at`` a newly scanned row gets: now, or NULL in the first import.

    The NULL is SQL ``null()`` rather than ``None``: the ORM treats a ``None``
    on a column with a default as "no value" and fires the default, which would
    date the row anyway.
    """
    return datetime.datetime.now(datetime.timezone.utc) if date_inserts else null()
