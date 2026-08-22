"""Backup service — timestamped .zip snapshots of the database and user assets.

Public API is re-exported here so callers use ``from backend.services.backup
import create_backup`` without reaching into submodules.
"""
from ._archive import create_backup, snapshot_database
from ._config import (
    BackupConfig,
    backup_dir,
    backup_settings,
    resolve_backup_dir,
)
from ._store import (
    BackupRecord,
    delete_backup,
    find_backup,
    list_backups,
    prune_backups,
)

__all__ = [
    "BackupConfig",
    "BackupRecord",
    "backup_dir",
    "backup_settings",
    "create_backup",
    "delete_backup",
    "find_backup",
    "list_backups",
    "prune_backups",
    "resolve_backup_dir",
    "snapshot_database",
]
