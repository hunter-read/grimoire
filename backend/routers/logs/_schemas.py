"""Pydantic schemas for the logs API."""
from pydantic import BaseModel


class LogEntry(BaseModel):
    """One ring-buffer entry, as built by `config._LogEntry.to_dict`."""

    seq: int
    timestamp: str
    level: str
    logger: str
    message: str


class LogsResponse(BaseModel):
    entries: list[LogEntry]
    total: int
    # Highest seq in the buffer — pass back as `after_seq` to poll for new entries.
    max_seq: int
    level: str
    limit: int
    offset: int
