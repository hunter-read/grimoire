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

router = APIRouter(prefix="/maintenance", tags=["maintenance"])
router.add_api_route(
    "/cleanup-missing",
    cleanup_missing,
    methods=["POST"],
    summary="Remove DB entries for missing files",
    response_model=CleanupResponse,
)
router.add_api_route(
    "/sidecars/settings",
    get_sidecar_settings,
    methods=["GET"],
    summary="Read metadata sidecar export settings",
    response_model=SidecarSettings,
)
router.add_api_route(
    "/sidecars/settings",
    update_sidecar_settings,
    methods=["PUT"],
    summary="Configure metadata sidecar export",
    response_model=SidecarSettings,
)
router.add_api_route(
    "/sidecars/export",
    export_sidecars,
    methods=["POST"],
    summary="Write metadata sidecars for the whole library",
    response_model=SidecarExportResponse,
)


__all__ = ["router", "run_cleanup_sync"]
