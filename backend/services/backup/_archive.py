"""Building a backup archive: a consistent DB snapshot plus user-authored files."""
import json
import os
import sqlite3
import tempfile
import threading
import zipfile
from datetime import datetime, timezone
from typing import Any, Optional

from ...config import (
    AUDIO_COVER_DIR,
    CAMPAIGN_UPLOAD_DIR,
    DB_PATH,
    SYSTEM_COVER_DIR,
    VERSION,
    logger,
)
from ._config import backup_settings
from ._store import BackupRecord, prune_backups, record_for

MANIFEST_NAME = "details.json"
DB_ARCHIVE_NAME = "grimoire.db"

# Directories copied into the archive, as (absolute source, name inside the zip).
# Only user-authored files that no rescan could rebuild are included. Thumbnails
# and page_cache are deliberately absent: both regenerate on demand, and the
# page cache alone can run to many GB.
ASSET_DIRS: tuple[tuple[str, str], ...] = (
    (CAMPAIGN_UPLOAD_DIR, "campaign_uploads"),
    (SYSTEM_COVER_DIR, "system_covers"),
    (AUDIO_COVER_DIR, "audio_covers"),
)

# One backup at a time per process. Creating a backup holds a read lock on the
# database for the length of the snapshot, and two concurrent runs would race on
# retention pruning as well.
_lock = threading.Lock()


def snapshot_database(destination: str) -> None:
    """Write a consistent copy of the SQLite database to `destination`.

    The database runs in WAL mode, where a plain file copy can capture a torn
    state: committed pages may still live in the -wal file, and the copy has no
    way to know which. SQLite's online backup API walks the database under a
    read lock and produces a single self-consistent file with the WAL already
    folded in, which is why `cp` is not a valid substitute here.
    """
    source = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        target = sqlite3.connect(destination)
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()


def _add_directory(zf: zipfile.ZipFile, source: str, arc_root: str) -> int:
    """Add a directory tree to the archive. Returns the number of files added."""
    if not os.path.isdir(source):
        return 0
    added = 0
    for dirpath, _dirnames, filenames in os.walk(source):
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            # Skip anything that vanished mid-walk (a concurrent delete) or is
            # not a regular file — a dangling symlink would otherwise raise and
            # abort the whole backup.
            if not os.path.isfile(full):
                continue
            arcname = os.path.join(arc_root, os.path.relpath(full, source))
            try:
                zf.write(full, arcname)
            except OSError as exc:
                logger.warning(f"Backup: skipping unreadable file {full}: {exc}")
                continue
            added += 1
    return added


def create_backup(db: Any, trigger: str = "manual") -> BackupRecord:
    """Create a backup archive and prune old ones. Returns the new backup.

    `trigger` is recorded in the manifest so a restore can tell a scheduled
    archive from one an operator took by hand.
    """
    if not _lock.acquire(blocking=False):
        raise RuntimeError("A backup is already running.")
    try:
        return _create_backup(db, trigger)
    finally:
        _lock.release()


def _create_backup(db: Any, trigger: str) -> BackupRecord:
    config = backup_settings(db)
    os.makedirs(config.directory, exist_ok=True)

    created = datetime.now(timezone.utc)
    # Colons are illegal in filenames on Windows and awkward everywhere, so the
    # timestamp is compact: grimoire-backup-20260821T140355Z.zip
    stamp = created.strftime("%Y%m%dT%H%M%SZ")
    filename = f"grimoire-backup-{stamp}.zip"
    final_path = os.path.join(config.directory, filename)

    # Assemble into a temp file in the same directory, then rename into place.
    # A partially written .zip must never appear in the listing, and rename is
    # atomic within a filesystem.
    fd, temp_path = tempfile.mkstemp(
        prefix=".grimoire-backup-", suffix=".zip.part", dir=config.directory
    )
    os.close(fd)

    try:
        counts: dict[str, int] = {}
        with zipfile.ZipFile(
            temp_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6
        ) as zf:
            # The database goes through a temp file rather than straight into
            # the zip: the backup API needs a real path to write to.
            with tempfile.TemporaryDirectory(prefix="grimoire-db-snap-") as snap_dir:
                snapshot = os.path.join(snap_dir, DB_ARCHIVE_NAME)
                snapshot_database(snapshot)
                zf.write(snapshot, DB_ARCHIVE_NAME)

            for source, arc_root in ASSET_DIRS:
                counts[arc_root] = _add_directory(zf, source, arc_root)

            manifest = {
                "app": "grimoire",
                "version": VERSION,
                "created_at": created.isoformat().replace("+00:00", "Z"),
                "trigger": trigger,
                "contents": {
                    "database": DB_ARCHIVE_NAME,
                    "directories": counts,
                },
                # Stated in the archive itself so anyone opening it later knows
                # what it does not carry, without needing the docs to hand.
                "excludes": [
                    "library (mounted read-only; back it up separately)",
                    "thumbnails (regenerated on demand)",
                    "page_cache (regenerated on demand)",
                ],
            }
            zf.writestr(MANIFEST_NAME, json.dumps(manifest, indent=2))

        os.replace(temp_path, final_path)
    except BaseException:
        # Includes KeyboardInterrupt/SystemExit: a half-written archive must
        # never survive, whatever ended the run.
        if os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                pass
        raise

    size = os.path.getsize(final_path)
    logger.info(f"Backup created: {filename} ({size / 1024 / 1024:.1f} MB, {trigger})")

    pruned = prune_backups(config)
    if pruned:
        logger.info(f"Backup retention removed {len(pruned)} old backup(s).")

    record = record_for(final_path)
    if record is None:  # pragma: no cover - the file was just written
        raise RuntimeError("Backup was written but could not be read back.")
    return record


def read_manifest(path: str) -> Optional[dict]:
    """Return the parsed manifest from a backup archive, or None if unreadable."""
    try:
        with zipfile.ZipFile(path) as zf:
            with zf.open(MANIFEST_NAME) as fh:
                data = json.load(fh)
        return data if isinstance(data, dict) else None
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        return None
