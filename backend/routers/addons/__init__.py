"""Add-ons package — registers all add-on management routes on a single router."""
from fastapi import APIRouter

from ... import api_keys
from ._schemas import (
    AddonListResponse,
    AddonSettingsResponse,
    InstalledAddon,
    RefreshIndexResponse,
    SourceCredentialsResponse,
    StatusResponse,
    UpdateAllResponse,
    VerifyIndexResponse,
)
from .core import (
    clear_source_credential,
    install_addon,
    list_addons,
    refresh_index,
    set_source_credential,
    uninstall_addon,
    update_addon,
    update_addon_settings,
    update_all_addons,
    verify_index,
)

router = APIRouter(prefix="/addons", tags=["addons"])

__all__ = ["router"]

router.add_api_route(
    "/verify-index",
    verify_index,
    methods=["GET"],
    summary="Verify an add-on index URL",
    description="Strictly checks if a given add-on index URL is in the set of trusted index URLs.",
    response_model=VerifyIndexResponse,
)
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
    # Decides where add-ons come from and whether they run code: session only.
    openapi_extra=api_keys.EXCLUDED,
)
router.add_api_route(
    "/sources/credential",
    set_source_credential,
    methods=["PUT"],
    summary="Set a private source's access token",
    description=(
        "Stores an access token for one configured index source, sealed under "
        "SECRET_KEY. It is sent only to URLs inside that source, as "
        "`Authorization: Bearer <token>` or under the given header. The token is "
        "never returned. Admin only."
    ),
    response_model=SourceCredentialsResponse,
    # A credential for wherever add-ons come from: session only.
    openapi_extra=api_keys.EXCLUDED,
)
router.add_api_route(
    "/sources/credential",
    clear_source_credential,
    methods=["DELETE"],
    summary="Remove a private source's access token",
    description="Forgets the stored access token for one configured index source. Admin only.",
    response_model=SourceCredentialsResponse,
    openapi_extra=api_keys.EXCLUDED,
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
    description=(
        "Toggles an add-on's enabled state or its script approval. Approving "
        "records the SHA-256 of the script on disk; a script that no longer "
        "matches it must be approved again before it runs. Admin only."
    ),
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
