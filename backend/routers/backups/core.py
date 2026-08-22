"""Backup endpoint handlers — admin-only."""
import os

from fastapi import Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_admin
from ...config import get_db, logger
from ...services import backup as backup_service
from ...services.backup._config import VALID_SCHEDULES
from ._schemas import BackupSettingsPatch


def _to_item(record: backup_service.BackupRecord) -> dict:
    return {
        "id": record.id,
        "filename": record.filename,
        "size_bytes": record.size_bytes,
        "created_at": record.created_at,
        "version": record.version,
    }


def list_backups(
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Every backup on disk, newest first.

    This is what makes a check-before-destructive-operation flow possible: the
    caller can read the newest `created_at` and decide whether it is stale.
    """
    config = backup_service.backup_settings(db)
    records = backup_service.list_backups(config)
    return {
        "backups": [_to_item(r) for r in records],
        "directory": config.directory,
        "total_bytes": sum(r.size_bytes for r in records),
    }


def create_backup(
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Take a backup now.

    The database is snapshotted under a read lock, so writes are held off for
    the duration — brief for a typical library, but not instant.
    """
    try:
        record = backup_service.create_backup(db, trigger="manual")
    except RuntimeError as exc:
        # Another backup is already in flight.
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except OSError as exc:
        logger.error(f"Backup failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Backup failed: {exc}") from exc
    return _to_item(record)


def download_backup(
    backup_id: str,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Download one backup archive."""
    config = backup_service.backup_settings(db)
    record = backup_service.find_backup(config, backup_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Backup not found")
    return FileResponse(
        record.path,
        media_type="application/zip",
        filename=record.filename,
        headers={"Content-Disposition": f'attachment; filename="{record.filename}"'},
    )


def delete_backup(
    backup_id: str,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Delete one backup archive. This cannot be undone."""
    config = backup_service.backup_settings(db)
    try:
        deleted = backup_service.delete_backup(config, backup_id)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not delete backup: {exc}") from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Backup not found")
    return None


def get_backup_settings(
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Effective backup configuration, with env-var locks flagged."""
    return _settings_payload(db)


def update_backup_settings(
    data: BackupSettingsPatch,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Update backup settings and re-arm the scheduler."""
    from ... import backup_scheduler
    from ..settings._helpers import _set

    config = backup_service.backup_settings(db)

    if data.backup_schedule is not None:
        if config.schedule_env_locked:
            raise HTTPException(
                400, "Backup schedule is locked by the BACKUP_SCHEDULE environment variable"
            )
        if data.backup_schedule not in VALID_SCHEDULES:
            raise HTTPException(
                400, f"backup_schedule must be one of: {', '.join(VALID_SCHEDULES)}"
            )
        _set(db, "backup_schedule", data.backup_schedule)

    if data.backup_schedule_hour is not None:
        _set(db, "backup_schedule_hour", str(max(0, min(23, data.backup_schedule_hour))))
    if data.backup_schedule_minute is not None:
        _set(db, "backup_schedule_minute", str(max(0, min(59, data.backup_schedule_minute))))
    if data.backup_schedule_weekday is not None:
        _set(db, "backup_schedule_weekday", str(max(0, min(6, data.backup_schedule_weekday))))

    if data.backup_retention_count is not None:
        if config.retention_count_env_locked:
            raise HTTPException(
                400,
                "Backup retention count is locked by the BACKUP_RETENTION_COUNT "
                "environment variable",
            )
        _set(db, "backup_retention_count", str(max(0, data.backup_retention_count)))

    if data.backup_retention_gb is not None:
        if config.retention_gb_env_locked:
            raise HTTPException(
                400,
                "Backup retention size is locked by the BACKUP_RETENTION_GB environment variable",
            )
        _set(db, "backup_retention_gb", str(max(0, data.backup_retention_gb)))

    if data.backup_dir is not None:
        if config.dir_env_locked:
            raise HTTPException(
                400, "Backup directory is locked by the BACKUP_DIR environment variable"
            )
        _validate_backup_dir(data.backup_dir)
        _set(db, "backup_dir", data.backup_dir.strip())

    db.commit()
    backup_scheduler.apply(db)
    return _settings_payload(db)


def _validate_backup_dir(raw: str) -> None:
    """Reject a backup directory Grimoire could not actually write into.

    Checked at save time rather than at the next scheduled run, so a typo
    surfaces while the admin is still looking at the field instead of failing
    silently at 3am.
    """
    if not raw.strip():
        return  # "" means fall back to the default, which is always writable.

    target = backup_service.resolve_backup_dir(raw)
    if os.path.exists(target):
        if not os.path.isdir(target):
            raise HTTPException(400, "Backup directory path exists but is not a directory")
        if not os.access(target, os.W_OK):
            raise HTTPException(400, "Backup directory is not writable by Grimoire")
        return

    # Not there yet: it gets created on first use, so the parent must be usable.
    parent = os.path.dirname(target.rstrip(os.sep)) or os.sep
    if not os.path.isdir(parent):
        raise HTTPException(400, f"Parent directory does not exist: {parent}")
    if not os.access(parent, os.W_OK):
        raise HTTPException(400, f"Parent directory is not writable: {parent}")


def _settings_payload(db: Session) -> dict:
    config = backup_service.backup_settings(db)
    return {
        "backup_schedule": config.schedule,
        "backup_schedule_hour": config.hour,
        "backup_schedule_minute": config.minute,
        "backup_schedule_weekday": config.weekday,
        "backup_retention_count": config.retention_count,
        "backup_retention_gb": config.retention_gb,
        "backup_dir": config.directory,
        "schedule_env_locked": config.schedule_env_locked,
        "retention_count_env_locked": config.retention_count_env_locked,
        "retention_gb_env_locked": config.retention_gb_env_locked,
        "dir_env_locked": config.dir_env_locked,
    }
