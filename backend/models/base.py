"""Shared SQLAlchemy base, UTC clock, and UUID helper for Grimoire models."""
import datetime
import uuid
from typing import Optional

from sqlalchemy.orm import declarative_base

Base = declarative_base()


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def utc_iso(value: Optional[datetime.datetime]) -> Optional[str]:
    """``value`` as ISO-8601 with an explicit UTC offset, or None.

    SQLite hands ``DateTime`` columns back naive - the offset ``_utcnow`` wrote
    is dropped - and a browser parses an offset-less ISO string as *local*
    time, which would shift every date by the viewer's UTC offset. Every stored
    datetime is UTC, so a naive one is tagged as such here.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=datetime.timezone.utc)
    return value.isoformat()


def _uuid() -> str:
    return str(uuid.uuid4())
