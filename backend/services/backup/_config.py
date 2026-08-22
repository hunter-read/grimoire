"""Effective backup configuration — env vars override DB settings per field."""
import os
from dataclasses import dataclass
from typing import Any

from ...config import (
    BACKUP_DIR,
    BACKUP_DIR_ENV,
    BACKUP_RETENTION_COUNT_ENV,
    BACKUP_RETENTION_GB_ENV,
    BACKUP_SCHEDULE_ENV,
    DATA_PATH,
)

VALID_SCHEDULES = ("off", "hourly", "daily", "weekly")

DEFAULTS = {
    "backup_schedule": "off",
    "backup_schedule_hour": "3",
    "backup_schedule_minute": "0",
    "backup_schedule_weekday": "0",  # 0=Mon … 6=Sun
    "backup_retention_count": "0",  # 0 = unlimited
    "backup_retention_gb": "0",  # 0 = unlimited
    "backup_dir": "",  # "" = DATA_PATH/backups
}


@dataclass
class BackupConfig:
    """The effective backup settings, after env overrides are applied."""

    schedule: str
    hour: int
    minute: int
    weekday: int
    retention_count: int
    retention_gb: int
    directory: str
    # Which fields an env var has pinned, so the UI can render them read-only.
    schedule_env_locked: bool
    retention_count_env_locked: bool
    retention_gb_env_locked: bool
    dir_env_locked: bool


def _int(raw: dict, key: str) -> int:
    try:
        return max(0, int(raw.get(key) or DEFAULTS[key]))
    except (TypeError, ValueError):
        return int(DEFAULTS[key])


def resolve_backup_dir(configured: str = "") -> str:
    """The directory backups live in.

    BACKUP_DIR pins it; otherwise a UI-configured path wins; otherwise the
    default DATA_PATH/backups. The result is always absolute so the traversal
    guard in `_store` has a stable prefix to compare against.
    """
    if BACKUP_DIR_ENV:
        return os.path.abspath(BACKUP_DIR_ENV)
    if configured.strip():
        return os.path.abspath(os.path.expanduser(configured.strip()))
    return os.path.abspath(BACKUP_DIR)


def backup_settings(db: Any) -> BackupConfig:
    """Read backup settings from the DB, letting env vars override per field."""
    from ...models import AppSetting

    rows = {r.key: r.value for r in db.query(AppSetting).all()}
    raw = {**DEFAULTS, **rows}

    schedule = BACKUP_SCHEDULE_ENV or raw.get("backup_schedule", "off")
    if schedule not in VALID_SCHEDULES:
        schedule = "off"

    count = (
        BACKUP_RETENTION_COUNT_ENV
        if BACKUP_RETENTION_COUNT_ENV is not None
        else _int(raw, "backup_retention_count")
    )
    gb = (
        BACKUP_RETENTION_GB_ENV
        if BACKUP_RETENTION_GB_ENV is not None
        else _int(raw, "backup_retention_gb")
    )

    return BackupConfig(
        schedule=schedule,
        hour=max(0, min(23, _int(raw, "backup_schedule_hour"))),
        minute=max(0, min(59, _int(raw, "backup_schedule_minute"))),
        weekday=max(0, min(6, _int(raw, "backup_schedule_weekday"))),
        retention_count=count,
        retention_gb=gb,
        directory=resolve_backup_dir(raw.get("backup_dir", "")),
        schedule_env_locked=BACKUP_SCHEDULE_ENV is not None,
        retention_count_env_locked=BACKUP_RETENTION_COUNT_ENV is not None,
        retention_gb_env_locked=BACKUP_RETENTION_GB_ENV is not None,
        dir_env_locked=BACKUP_DIR_ENV is not None,
    )


def backup_dir(db: Any) -> str:
    """Convenience accessor for just the effective backup directory."""
    return backup_settings(db).directory


def is_inside_data_path(path: str) -> bool:
    """True when `path` sits under DATA_PATH.

    Used to decide whether the backup directory must be excluded while walking
    DATA_PATH, so a backup never swallows previous backups.
    """
    data = os.path.abspath(DATA_PATH)
    target = os.path.abspath(path)
    return target == data or target.startswith(data + os.sep)
