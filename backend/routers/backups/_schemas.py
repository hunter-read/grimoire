"""Pydantic schemas for the backups API."""
from datetime import datetime

from pydantic import BaseModel


class BackupItem(BaseModel):
    """One backup archive on disk."""

    id: str
    filename: str
    size_bytes: int
    created_at: datetime
    # App version that wrote the archive, from its manifest. "unknown" for an
    # archive whose manifest is missing or unreadable, which is what makes a
    # cross-version restore detectable rather than surprising.
    version: str


class BackupListResponse(BaseModel):
    """The backup listing, newest first, plus where they are stored."""

    backups: list[BackupItem]
    directory: str
    # Total bytes across every listed backup, so the UI can show usage against
    # the retention budget without re-summing per render.
    total_bytes: int


class BackupSettingsPatch(BaseModel):
    """Partial update of backup settings. Omitted fields are left alone."""

    backup_schedule: str | None = None
    backup_schedule_hour: int | None = None
    backup_schedule_minute: int | None = None
    backup_schedule_weekday: int | None = None
    backup_retention_count: int | None = None
    backup_retention_gb: int | None = None
    backup_dir: str | None = None  # "" resets to DATA_PATH/backups


class BackupSettingsResponse(BaseModel):
    """Effective backup settings. `*_env_locked` marks fields pinned by env vars
    and therefore read-only in the admin UI."""

    backup_schedule: str
    backup_schedule_hour: int
    backup_schedule_minute: int
    backup_schedule_weekday: int
    backup_retention_count: int
    backup_retention_gb: int
    backup_dir: str
    schedule_env_locked: bool
    retention_count_env_locked: bool
    retention_gb_env_locked: bool
    dir_env_locked: bool
