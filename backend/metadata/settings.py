"""Persisted configuration for sidecar export.

Off by default, and deliberately so: Grimoire is documented as a read-only
viewer of the library, and writing into it is a change in posture the operator
has to choose. Everything here answers "may we write, and in which formats" —
never "what do we write", which is :mod:`.fields`.
"""
import json
import logging
from typing import Any

from sqlalchemy.orm import Session

from ..models import AppSetting
from .formats import ALL_FORMATS

logger = logging.getLogger("grimoire.metadata")

SETTING_EXPORT_FORMATS = "metadata.export_formats"
SETTING_EXPORT_COVERS = "metadata.export_covers"
SETTING_EXPORT_OVERWRITE = "metadata.export_overwrite_foreign"


def _get(db: Session, key: str, default: str = "") -> str:
    row = db.query(AppSetting).filter_by(key=key).first()
    return row.value if row and row.value is not None else default


def _set(db: Session, key: str, value: str) -> None:
    row = db.query(AppSetting).filter_by(key=key).first()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))


def enabled_formats(db: Session) -> list[str]:
    """Which sidecar formats are turned on, in a stable order.

    An empty list means export is off — the default, and the state the whole
    feature stays in until an admin opts in. Unknown names are dropped rather
    than raising: the stored value may predate a format being renamed, and a
    stale entry must not break every export.
    """
    raw = _get(db, SETTING_EXPORT_FORMATS, "")
    if not raw.strip():
        return []
    try:
        parsed: Any = json.loads(raw)
    except ValueError:
        logger.warning("Ignoring malformed %s setting: %r", SETTING_EXPORT_FORMATS, raw)
        return []
    if not isinstance(parsed, list):
        return []
    chosen = {str(v).strip().lower() for v in parsed}
    return [f for f in ALL_FORMATS if f in chosen]


def set_enabled_formats(db: Session, formats: list[str]) -> list[str]:
    """Turn on exactly ``formats``.  Returns the normalised list that was stored."""
    chosen = {str(f).strip().lower() for f in formats or []}
    unknown = sorted(chosen - set(ALL_FORMATS))
    if unknown:
        raise ValueError(f"unknown sidecar format(s): {', '.join(unknown)}")
    stored = [f for f in ALL_FORMATS if f in chosen]
    _set(db, SETTING_EXPORT_FORMATS, json.dumps(stored))
    return stored


def export_enabled(db: Session) -> bool:
    """Whether any format is on at all — the cheap check before doing work."""
    return bool(enabled_formats(db))


def covers_enabled(db: Session) -> bool:
    """Whether to write a cover image next to the metadata file."""
    return _get(db, SETTING_EXPORT_COVERS, "false").lower() == "true"


def set_covers_enabled(db: Session, enabled: bool) -> None:
    _set(db, SETTING_EXPORT_COVERS, "true" if enabled else "false")


def overwrite_foreign(db: Session) -> bool:
    """Whether a backfill may replace sidecars Grimoire did not write.

    Off by default. A ``.opf`` a user maintains in Calibre is theirs, and the
    issue's "never destructive" requirement means taking it over has to be an
    explicit choice rather than a side effect of enabling export.
    """
    return _get(db, SETTING_EXPORT_OVERWRITE, "false").lower() == "true"


def set_overwrite_foreign(db: Session, enabled: bool) -> None:
    _set(db, SETTING_EXPORT_OVERWRITE, "true" if enabled else "false")
