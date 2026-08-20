"""Logs package — admin-only access to the in-memory log ring buffer."""
from fastapi import APIRouter

from .core import get_logs
from ._schemas import LogsResponse

router = APIRouter(tags=["logs"])
router.add_api_route(
    "/logs",
    get_logs,
    methods=["GET"],
    summary="Application logs",
    response_model=LogsResponse,
    description=(
        "Returns recent application log entries from the in-memory ring buffer "
        "(up to 20 000 entries). The `level` filter follows standard log "
        "hierarchy: `debug` returns all levels, `info` returns "
        "info/warning/error/critical, etc. Console output is controlled by the "
        "`LOG_LEVEL` environment variable, but this endpoint always has access "
        "to DEBUG-level logs regardless of that setting. For live polling, pass "
        "`after_seq` set to the `max_seq` value from the previous response - "
        "only entries with a higher sequence number are returned, making "
        "polling exact regardless of how fast entries arrive. **Admin only.**"
    ),
)
