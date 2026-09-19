"""Shared thumbnail-serving helpers for the media routers."""

from typing import Any

from sqlalchemy.orm import Session

from ..config import logger


def clear_stale_thumbnail_flag(db: Session, record: Any) -> None:
    """Mark a record as having no thumbnail when none could be served.

    ``has_thumbnail`` is what the scanner consults to decide whether to render
    one, so a row claiming a thumbnail whose file has gone is never revisited:
    the image stays broken through every future rescan. Clearing the flag on the
    failed read is what lets the next scan treat it as un-thumbnailed and
    regenerate it.

    Only ever clears a flag that is set, so an already-false row costs nothing
    and the common 404 (a format that simply has no thumbnail) writes nothing.

    Deliberately best-effort: this runs inside a request that is already failing,
    and a write error here must not turn a 404 into a 500.
    """
    if not getattr(record, "has_thumbnail", False):
        return
    try:
        record.has_thumbnail = False
        db.commit()
        logger.info(
            "Thumbnail missing for %s; flag cleared so the next scan regenerates it",
            getattr(record, "filepath", record.id),
        )
    except Exception as e:  # pragma: no cover - defensive
        db.rollback()
        logger.warning("Could not clear stale thumbnail flag: %s", e)
