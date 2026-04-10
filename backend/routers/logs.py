"""Log retrieval endpoint for admin users."""
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query

from ..config import _memory_handler
from ..auth import require_admin, CurrentUser

router = APIRouter(tags=["logs"])

_LEVEL_MAP: dict[str, int] = {
    "debug":    logging.DEBUG,
    "info":     logging.INFO,
    "warning":  logging.WARNING,
    "error":    logging.ERROR,
    "critical": logging.CRITICAL,
}


@router.get(
    "/logs",
    summary="Application logs",
    description=(
        "Returns recent application log entries from the in-memory ring buffer (up to 20 000 entries). "
        "The `level` filter follows standard log hierarchy: `debug` returns all levels, "
        "`info` returns info/warning/error/critical, etc. "
        "Console output is controlled by the `LOG_LEVEL` environment variable, but this endpoint "
        "always has access to DEBUG-level logs regardless of that setting. "
        "For live polling, pass `after_seq` set to the `max_seq` value from the previous response — "
        "only entries with a higher sequence number are returned, making polling exact regardless of "
        "how fast entries arrive. "
        "**Admin only.**"
    ),
)
def get_logs(
    level: Literal["debug", "info", "warning", "error", "critical"] = Query(
        default="info", description="Minimum log level to return"
    ),
    limit: int = Query(default=200, ge=1, le=20000, description="Maximum number of entries to return"),
    offset: int = Query(default=0, ge=0, description="Entries to skip from the newest end (historical pagination, ignored when after_seq is set)"),
    after_seq: Optional[int] = Query(default=None, ge=0, description="Return only entries with seq > this value (live-poll cursor)"),
    _: CurrentUser = Depends(require_admin),
):
    min_level = _LEVEL_MAP.get(level.lower(), logging.INFO)
    entries, max_seq = _memory_handler.get_entries(
        min_level=min_level,
        limit=limit,
        offset=offset,
        after_seq=after_seq if after_seq is not None else 0,
    )
    total = _memory_handler.get_total(min_level=min_level)
    return {
        "entries":  entries,
        "total":    total,
        "max_seq":  max_seq,
        "level":    level,
        "limit":    limit,
        "offset":   offset,
    }
