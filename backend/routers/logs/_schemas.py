"""Pydantic schemas for the logs API."""
from typing import Optional

from pydantic import BaseModel


class LogEntry(BaseModel):
    """One ring-buffer entry, as built by `config._LogEntry.to_dict`."""

    seq: int
    timestamp: str
    level: str
    logger: str
    message: str
    # Who made the request that emitted the line; None when no one did.
    user: Optional[str] = None


class LogsResponse(BaseModel):
    entries: list[LogEntry]
    total: int
    # Highest seq in the buffer — pass back as `after_seq` to poll for new entries.
    max_seq: int
    level: str
    limit: int
    offset: int
    # The `user` filter applied, if any.
    user: Optional[str] = None
    # Every username with a line in the buffer, for the viewer's user picker.
    users: list[str] = []
