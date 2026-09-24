"""Maintenance package — admin-only housekeeping tasks."""
from fastapi import APIRouter

from ._helpers import run_cleanup_sync  # re-exported for the scheduler
from ._schemas import CleanupResponse, SidecarExportResponse, SidecarSettings
from .core import (
    cleanup_missing,
    export_sidecars,
    get_sidecar_settings,
    update_sidecar_settings,
)

# Tagged per route rather than on the router: cleanup is tagged "library" so an
# API key's library permission covers it, while the rest stays "maintenance",
# which keys cannot reach (issue #489).
router = APIRouter(prefix="/maintenance")
router.add_api_route(
    "/cleanup-missing",
    cleanup_missing,
    methods=["POST"],
    tags=["library"],
    summary="Remove DB entries for missing files",
    response_model=CleanupResponse,
)
router.add_api_route(
    "/sidecars/settings",
    get_sidecar_settings,
    methods=["GET"],
    tags=["maintenance"],
    summary="Read metadata sidecar export settings",
    response_model=SidecarSettings,
)
router.add_api_route(
    "/sidecars/settings",
    update_sidecar_settings,
    methods=["PUT"],
    tags=["maintenance"],
    summary="Configure metadata sidecar export",
    response_model=SidecarSettings,
)
router.add_api_route(
    "/sidecars/export",
    export_sidecars,
    methods=["POST"],
    tags=["maintenance"],
    summary="Write metadata sidecars for the whole library",
    response_model=SidecarExportResponse,
)


__all__ = ["router", "run_cleanup_sync"]
