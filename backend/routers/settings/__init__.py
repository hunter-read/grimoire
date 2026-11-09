"""Settings package — registers all settings routes on a single router."""
from fastapi import APIRouter

from ... import api_keys
from .core import (
    get_settings,
    update_settings,
    get_ui_settings,
)
from .folder_access import (
    delete_folder_access_rule,
    list_folder_access_rules,
    save_folder_access_rule,
)
from .oidc_button import delete_oidc_button_icon, upload_oidc_button_icon
from ._schemas import (
    FolderAccessRuleOut,
    FolderAccessRulesResponse,
    FolderAccessStatusResponse,
    SettingsResponse,
    UISettingsResponse,
)

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

# Folder access rules (issue #772): restrict every book beneath a library folder.
router.add_api_route(
    "/folder-access",
    list_folder_access_rules,
    methods=["GET"],
    summary="List folder access restrictions",
    response_model=FolderAccessRulesResponse,
)
router.add_api_route(
    "/folder-access",
    save_folder_access_rule,
    methods=["PUT"],
    summary="Restrict a folder",
    description=(
        "Admin-only. Restricts every book beneath a folder inside `books/` or the "
        "armory to `gm` (GMs and admins) or `admin`, replacing any level the folder "
        "had. A book resolves to the stricter of the folder's level and what its "
        "system or category gives it; only the book's own level overrides it. "
        "Campaign shares of the books it restricts are demoted to GM-only. 404 when "
        "the folder does not exist."
    ),
    response_model=FolderAccessRuleOut,
)
router.add_api_route(
    "/folder-access",
    delete_folder_access_rule,
    methods=["DELETE"],
    summary="Lift a folder's restriction",
    response_model=FolderAccessStatusResponse,
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
    # Part of the sign-in page: session only, never a key.
    openapi_extra=api_keys.EXCLUDED,
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
    # Part of the sign-in page: session only, never a key.
    openapi_extra=api_keys.EXCLUDED,
)
