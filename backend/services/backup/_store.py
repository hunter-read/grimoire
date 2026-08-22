"""Listing, locating, deleting, and pruning backup archives on disk.

Backups are files, not database rows. The directory is the source of truth, so
an operator can drop an archive in or sync the directory elsewhere and the app
agrees with what is actually there.
"""
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from ...config import logger
from ._config import BackupConfig

BACKUP_PREFIX = "grimoire-backup-"
BACKUP_SUFFIX = ".zip"

# grimoire-backup-20260821T140355Z.zip — the id is the timestamp portion, which
# is unique per second and sorts lexicographically in chronological order.
_NAME_RE = re.compile(r"^grimoire-backup-(\d{8}T\d{6}Z)\.zip$")

_GB = 1024**3


@dataclass
class BackupRecord:
    """One backup archive on disk."""

    id: str
    filename: str
    path: str
    size_bytes: int
    created_at: datetime
    version: str


def _created_from_id(backup_id: str) -> Optional[datetime]:
    try:
        return datetime.strptime(backup_id, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def record_for(path: str) -> Optional[BackupRecord]:
    """Build a record for one archive path, or None if it is not a backup."""
    filename = os.path.basename(path)
    match = _NAME_RE.match(filename)
    if not match or not os.path.isfile(path):
        return None

    backup_id = match.group(1)
    created = _created_from_id(backup_id)
    if created is None:
        return None

    try:
        size = os.path.getsize(path)
    except OSError:
        return None

    # The manifest is authoritative for the version, but an archive written by
    # an older build (or a truncated one) may not have a readable one. Listing
    # must not fail because of that, so the version degrades to "unknown".
    from ._archive import read_manifest

    manifest = read_manifest(path)
    version = str(manifest.get("version") or "") if manifest else ""

    return BackupRecord(
        id=backup_id,
        filename=filename,
        path=path,
        size_bytes=size,
        created_at=created,
        version=version or "unknown",
    )


def list_backups(config: BackupConfig) -> list[BackupRecord]:
    """All backups in the configured directory, newest first."""
    directory = config.directory
    if not os.path.isdir(directory):
        return []

    records: list[BackupRecord] = []
    try:
        entries = os.listdir(directory)
    except OSError as exc:
        logger.warning(f"Backup: cannot read backup directory {directory}: {exc}")
        return []

    for name in entries:
        record = record_for(os.path.join(directory, name))
        if record is not None:
            records.append(record)

    records.sort(key=lambda r: r.created_at, reverse=True)
    return records


def find_backup(config: BackupConfig, backup_id: str) -> Optional[BackupRecord]:
    """Locate one backup by id.

    The id is matched against a strict timestamp pattern before it ever reaches
    the filesystem, so a caller-supplied value cannot walk out of the backup
    directory (`../../etc/passwd` fails the pattern, not a path check).
    """
    if not _NAME_RE.match(f"{BACKUP_PREFIX}{backup_id}{BACKUP_SUFFIX}"):
        return None
    return record_for(os.path.join(config.directory, f"{BACKUP_PREFIX}{backup_id}{BACKUP_SUFFIX}"))


def delete_backup(config: BackupConfig, backup_id: str) -> bool:
    """Delete one backup. Returns False if it does not exist."""
    record = find_backup(config, backup_id)
    if record is None:
        return False
    try:
        os.unlink(record.path)
    except OSError as exc:
        logger.error(f"Backup: failed to delete {record.filename}: {exc}")
        raise
    logger.info(f"Backup deleted: {record.filename}")
    return True


def prune_backups(config: BackupConfig) -> list[BackupRecord]:
    """Delete backups that exceed the retention limits. Returns what was removed.

    Both limits apply independently — a backup goes if it breaches either the
    count or the total-size budget. Pruning is oldest-first and always stops
    with one backup left standing: a single archive larger than the whole size
    budget is kept rather than leaving the operator with no recovery point at
    all. This runs after a new archive is written, so the ceiling is expected to
    be briefly exceeded during a run.
    """
    count_limit = config.retention_count
    gb_limit = config.retention_gb
    if count_limit <= 0 and gb_limit <= 0:
        return []

    # Oldest first, so the survivors are always the newest.
    records = sorted(list_backups(config), key=lambda r: r.created_at)
    removed: list[BackupRecord] = []

    if count_limit > 0:
        while len(records) > max(1, count_limit):
            removed.append(records.pop(0))

    if gb_limit > 0:
        budget = gb_limit * _GB
        while len(records) > 1 and sum(r.size_bytes for r in records) > budget:
            removed.append(records.pop(0))

    for record in removed:
        try:
            os.unlink(record.path)
            logger.debug(f"Backup retention removed {record.filename}")
        except OSError as exc:
            logger.warning(f"Backup: retention could not delete {record.filename}: {exc}")

    return removed
