"""Maintenance endpoint handlers — admin-only housekeeping."""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_admin
from ...config import get_db, logger
from ...metadata import export as sidecar_export
from ...metadata import settings as sidecar_settings
from ._helpers import _do_cleanup
from ._schemas import SidecarSettings


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


def get_sidecar_settings(
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Current metadata sidecar export configuration."""
    return {
        "formats": sidecar_settings.enabled_formats(db),
        "covers": sidecar_settings.covers_enabled(db),
        "overwrite_foreign": sidecar_settings.overwrite_foreign(db),
    }


def update_sidecar_settings(
    data: SidecarSettings,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Enable, disable, or reconfigure sidecar export."""
    try:
        stored = sidecar_settings.set_enabled_formats(db, data.formats)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    sidecar_settings.set_covers_enabled(db, data.covers)
    sidecar_settings.set_overwrite_foreign(db, data.overwrite_foreign)
    db.commit()
    logger.info(
        "Sidecar export configured: formats=%s covers=%s overwrite_foreign=%s",
        stored or "(disabled)",
        data.covers,
        data.overwrite_foreign,
    )
    return {
        "formats": stored,
        "covers": data.covers,
        "overwrite_foreign": data.overwrite_foreign,
    }


def export_sidecars(
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Backfill metadata sidecars for the whole library.

    Runs inline rather than in the background: it is admin-triggered, bounded by
    the library size, and the operator wants the per-item outcome — how many
    files were skipped as foreign, and whether the mount is writable — in the
    response rather than in a log they have to go find.
    """
    from ..library import _helpers as _lib

    if _lib._get_status()["running"]:
        # A scan rewrites the very rows being exported, so the sidecars would
        # capture a moving target.
        raise HTTPException(
            status_code=409,
            detail="A library scan is already running; retry after it completes.",
        )

    formats = sidecar_settings.enabled_formats(db)
    if not formats:
        raise HTTPException(
            status_code=400,
            detail="Metadata sidecar export is disabled. Enable at least one format first.",
        )

    logger.info("Sidecar export: starting backfill (formats=%s)", formats)
    result = sidecar_export.export_library(db, formats)
    logger.info(
        "Sidecar export complete: written=%d skipped_foreign=%d failed=%d covers=%d",
        result.written,
        result.skipped_foreign,
        result.failed,
        result.covers,
    )
    return {
        "written": result.written,
        "skipped_foreign": result.skipped_foreign,
        "skipped_missing": result.skipped_missing,
        "failed": result.failed,
        "covers": result.covers,
        "read_only": result.read_only,
        "errors": result.errors,
    }
