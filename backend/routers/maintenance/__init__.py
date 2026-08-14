"""Maintenance package — admin-only housekeeping tasks."""
from fastapi import APIRouter

from ._helpers import run_cleanup_sync  # re-exported for the scheduler
from ._schemas import CleanupResponse
from .core import cleanup_missing

router = APIRouter(prefix="/maintenance", tags=["maintenance"])
router.add_api_route(
    "/cleanup-missing",
    cleanup_missing,
    methods=["POST"],
    summary="Remove DB entries for missing files",
    response_model=CleanupResponse,
)


__all__ = ["router", "run_cleanup_sync"]
