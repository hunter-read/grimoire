"""Settings package — registers all settings routes on a single router."""
from fastapi import APIRouter

from .core import (
    get_settings,
    update_settings,
    generate_api_key,
    revoke_api_key,
    get_ui_settings,
)
from ._helpers import get_stats_api_key  # re-exported for library.py

router = APIRouter(prefix="/settings", tags=["settings"])

__all__ = ["router", "get_stats_api_key"]

router.add_api_route("", get_settings, methods=["GET"], summary="Get app settings")
router.add_api_route("", update_settings, methods=["PATCH"], summary="Update app settings")
router.add_api_route(
    "/api-key/generate", generate_api_key, methods=["POST"], summary="Generate a new stats API key"
)
router.add_api_route(
    "/api-key", revoke_api_key, methods=["DELETE"], summary="Revoke the stats API key"
)
router.add_api_route(
    "/ui", get_ui_settings, methods=["GET"], summary="UI settings (any authenticated user)"
)
