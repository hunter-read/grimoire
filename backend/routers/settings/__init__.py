"""Settings package — registers all settings routes on a single router."""
from fastapi import APIRouter

from .core import (
    get_settings,
    update_settings,
    get_ui_settings,
)
from ._schemas import SettingsResponse, UISettingsResponse

router = APIRouter(prefix="/settings", tags=["settings"])

__all__ = ["router"]

router.add_api_route(
    "", get_settings, methods=["GET"], summary="Get app settings", response_model=SettingsResponse
)
router.add_api_route(
    "",
    update_settings,
    methods=["PATCH"],
    summary="Update app settings",
    response_model=SettingsResponse,
)
router.add_api_route(
    "/ui",
    get_ui_settings,
    methods=["GET"],
    summary="UI settings (any authenticated user)",
    response_model=UISettingsResponse,
)
