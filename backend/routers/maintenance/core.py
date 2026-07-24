"""Maintenance endpoint handlers — admin-only housekeeping."""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_admin
from ...config import get_db, logger
from ._helpers import _do_cleanup


def cleanup_missing(
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from ..library import _helpers as _lib

    logger.debug("Cleanup: manual trigger received")
    if _lib._get_status()["running"]:
        logger.debug("Cleanup: blocked — library scan is currently running")
        raise HTTPException(
            status_code=409,
            detail="A library scan is already running; retry after it completes.",
        )

    logger.debug("Cleanup: no scan running, proceeding")
    try:
        removed = _do_cleanup(db)
        logger.info(f"Cleanup complete: {removed}")
        return {"removed": removed}
    except Exception:
        db.rollback()
        raise
