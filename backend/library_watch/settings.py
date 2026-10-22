"""The watcher's settings: env pins over ``app_settings``, and what "auto" resolves to.

Same shape as the other env-lockable settings: an env var, when set, wins and
locks the field in the admin UI; otherwise the admin's choice in the database
applies. Watching is on unless turned off - with it, a change on disk shows up
in the library by itself, and a schedule is only needed by servers that would
rather scan at a quiet hour.
"""
import json
import os
from typing import Any, Optional

from sqlalchemy.orm import Session

from .. import config
from ..models import AppSetting

ENABLED_KEY = "library_watch_enabled"
MODE_KEY = "library_watch_mode"
# What the watcher is doing right now, written by the process that runs it so
# any worker can report it: {"state": ..., "detail": ...}.
STATE_KEY = "library_watch_state"

DEFAULT_ENABLED = "true"
DEFAULT_MODE = "auto"

# Filesystems where a change made by another machine never reaches this one's
# kernel as an event, so watching for events would miss it. FUSE is included
# wholesale: rclone, sshfs and mergerfs mounts all behave this way.
_NETWORK_FS = frozenset(
    {
        "nfs",
        "nfs4",
        "cifs",
        "smb3",
        "smbfs",
        "9p",
        "ceph",
        "glusterfs",
        "afs",
        "davfs",
        "fuse",
        "fuseblk",
        "lustre",
    }
)


def enabled(raw: dict) -> bool:
    if config.LIBRARY_WATCH_ENV is not None:
        return config.LIBRARY_WATCH_ENV
    return raw.get(ENABLED_KEY, DEFAULT_ENABLED) == "true"


def mode(raw: dict) -> str:
    if config.LIBRARY_WATCH_MODE_ENV is not None:
        return config.LIBRARY_WATCH_MODE_ENV
    value = raw.get(MODE_KEY, DEFAULT_MODE)
    return value if value in config.LIBRARY_WATCH_MODES else DEFAULT_MODE


def read(db: Session) -> dict:
    """The raw rows these settings read, keyed like ``app_settings``."""
    rows = db.query(AppSetting).filter(AppSetting.key.in_((ENABLED_KEY, MODE_KEY))).all()
    return {r.key: r.value for r in rows if r.value is not None}


def state(raw: dict) -> dict:
    """What the watcher last reported doing, from the raw settings rows."""
    try:
        parsed = json.loads(raw.get(STATE_KEY) or "null")
    except ValueError:
        parsed = None
    if not isinstance(parsed, dict):
        return {"state": "off", "detail": ""}
    return {"state": str(parsed.get("state", "off")), "detail": str(parsed.get("detail", ""))}


def save_state(db: Session, value: dict) -> None:
    encoded = json.dumps(value)
    row = db.query(AppSetting).filter_by(key=STATE_KEY).first()
    if row is None:
        db.add(AppSetting(key=STATE_KEY, value=encoded))
    else:
        row.value = encoded
    db.commit()


def to_typed(raw: dict) -> dict[str, Any]:
    """The settings-response fields for the watcher."""
    return {
        "library_watch_enabled": enabled(raw),
        "library_watch_env_locked": config.LIBRARY_WATCH_ENV is not None,
        "library_watch_mode": mode(raw),
        "library_watch_mode_env_locked": config.LIBRARY_WATCH_MODE_ENV is not None,
        "library_watch_state": state(raw),
        "library_watch_poll_interval": config.LIBRARY_WATCH_POLL_INTERVAL,
    }


def filesystem_type(path: str, mounts_file: str = "/proc/mounts") -> Optional[str]:
    """The filesystem type ``path`` lives on, from the mount table; None if unknown.

    Linux only, which is where it matters: the Docker image. Elsewhere there is
    no ``/proc/mounts`` and "auto" falls back to events.
    """
    try:
        with open(mounts_file, encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError:
        return None
    target = os.path.realpath(path)
    best, best_type = "", None
    for line in lines:
        fields = line.split()
        if len(fields) < 3:
            continue
        # Mount points escape spaces and tabs as octal.
        point = fields[1].replace("\\040", " ").replace("\\011", "\t")
        inside = target == point or target.startswith(point.rstrip("/") + "/")
        if inside and len(point) >= len(best):
            best, best_type = point, fields[2]
    return best_type


def resolve_polling(chosen: str, fs_type: Optional[str]) -> bool:
    """Whether to poll, given the chosen mode and the library's filesystem type."""
    if chosen == "poll":
        return True
    if chosen == "events":
        return False
    if not fs_type:
        return False
    base = fs_type.split(".", 1)[0]
    return fs_type in _NETWORK_FS or base in _NETWORK_FS
