"""Log retrieval endpoint handlers (admin-only)."""
import logging
from typing import Literal, Optional

from fastapi import Depends, Query

from ...auth import CurrentUser, require_admin
from ...config import _memory_handler

_LEVEL_MAP: dict[str, int] = {
    "debug":    logging.DEBUG,
    "info":     logging.INFO,
    "warning":  logging.WARNING,
    "error":    logging.ERROR,
    "critical": logging.CRITICAL,
}


def get_logs(
    level: Literal["debug", "info", "warning", "error", "critical"] = Query(
        default="info", description="Minimum log level to return"
    ),
    limit: int = Query(
        default=200, ge=1, le=20000, description="Maximum number of entries to return"
    ),
    offset: int = Query(
        default=0,
        ge=0,
        description=(
            "Entries to skip from the newest end (historical pagination, "
            "ignored when after_seq is set)"
        ),
    ),
    after_seq: Optional[int] = Query(
        default=None, ge=0, description="Return only entries with seq > this value (live-poll cursor)"
    ),
    user: Optional[str] = Query(
        default=None,
        max_length=100,
        description="Return only lines from requests made by this username",
    ),
    _: CurrentUser = Depends(require_admin),
):
    min_level = _LEVEL_MAP.get(level.lower(), logging.INFO)
    entries, max_seq = _memory_handler.get_entries(
        min_level=min_level,
        limit=limit,
        offset=offset,
        after_seq=after_seq if after_seq is not None else 0,
        user=user or None,
    )
    total = _memory_handler.get_total(min_level=min_level, user=user or None)
    return {
        "entries":  entries,
        "total":    total,
        "max_seq":  max_seq,
        "level":    level,
        "limit":    limit,
        "offset":   offset,
        "user":     user or None,
        "users":    _memory_handler.get_users(),
    }
