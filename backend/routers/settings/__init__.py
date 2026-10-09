"""Settings package — registers all settings routes on a single router."""
from fastapi import APIRouter

from .core import (
    get_settings,
    update_settings,
    get_ui_settings,
)
from .oidc_button import delete_oidc_button_icon, upload_oidc_button_icon
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

# OIDC login-button icon (issue #377). Normalized to a PNG on upload; served
# publicly by GET /api/auth/openid/button-icon for the pre-auth login page.
router.add_api_route(
    "/oidc-button-icon",
    upload_oidc_button_icon,
    methods=["POST"],
    summary="Upload the OIDC login-button icon",
    response_model=SettingsResponse,
    description=(
        "Admin-only. Multipart `file`: PNG, JPEG, WebP, GIF or SVG, max 1 MB. The "
        "image is re-encoded server-side (SVGs are rasterized) to a PNG at most "
        "192 px on its longest side, so the uploaded bytes are never served as-is. "
        "400 when `OIDC_BUTTON_ICON` pins the icon. Returns the full settings."
    ),
)
router.add_api_route(
    "/oidc-button-icon",
    delete_oidc_button_icon,
    methods=["DELETE"],
    summary="Remove the OIDC login-button icon",
    response_model=SettingsResponse,
    description=(
        "Admin-only. Deletes the uploaded icon so the button shows text only. 400 "
        "when `OIDC_BUTTON_ICON` pins the icon. Returns the full settings."
    ),
)
