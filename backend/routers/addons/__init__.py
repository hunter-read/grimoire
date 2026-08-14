"""Add-ons package — registers all add-on management routes on a single router."""
from fastapi import APIRouter

from ._schemas import (
    AddonListResponse,
    AddonSettingsResponse,
    InstalledAddon,
    RefreshIndexResponse,
    StatusResponse,
    UpdateAllResponse,
)
from .core import (
    install_addon,
    list_addons,
    refresh_index,
    update_all_addons,
    uninstall_addon,
    update_addon,
    update_addon_settings,
)

router = APIRouter(prefix="/addons", tags=["addons"])

__all__ = ["router"]

router.add_api_route(
    "",
    list_addons,
    methods=["GET"],
    summary="List add-ons",
    description=(
        "Returns installed add-ons and everything offered by the cached "
        "community index, plus add-on settings. Admin only."
    ),
    response_model=AddonListResponse,
)
router.add_api_route(
    "/refresh",
    refresh_index,
    methods=["POST"],
    summary="Refresh the add-on index",
    description="Re-fetches the community index from the configured URL. Admin only.",
    response_model=RefreshIndexResponse,
)
router.add_api_route(
    "/update-all",
    update_all_addons,
    methods=["POST"],
    summary="Update all add-ons",
    description=(
        "Refreshes the index, then updates every installed add-on with a newer "
        "version. Returns what was updated and what failed. A script-backed "
        "add-on whose script changed drops back to unapproved. Admin only."
    ),
    response_model=UpdateAllResponse,
)
router.add_api_route(
    "/settings",
    update_addon_settings,
    methods=["PATCH"],
    summary="Update add-on settings",
    description="Sets the index URL and the global 'allow add-on scripts' switch. Admin only.",
    response_model=AddonSettingsResponse,
)
router.add_api_route(
    "/{addon_id}/install",
    install_addon,
    methods=["POST"],
    summary="Install or update an add-on",
    description=(
        "Downloads an add-on from the cached index, verifies its checksum, and "
        "installs it. Script-backed add-ons additionally require "
        "`approve_script`. Admin only."
    ),
    response_model=InstalledAddon,
)
router.add_api_route(
    "/{addon_id}",
    update_addon,
    methods=["PATCH"],
    summary="Enable, disable, or approve an add-on",
    description="Toggles an add-on's enabled state or its script approval. Admin only.",
    response_model=InstalledAddon,
)
router.add_api_route(
    "/{addon_id}",
    uninstall_addon,
    methods=["DELETE"],
    summary="Uninstall an add-on",
    description="Removes an installed add-on and forgets its state. Admin only.",
    response_model=StatusResponse,
)
