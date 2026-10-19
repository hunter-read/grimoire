"""Share-link management (issue #541) - registers the routes on one router."""
from fastapi import APIRouter

from ... import api_keys

from ._schemas import ShareLinkOut, ShareLinkPermission, StatusResponse
from .core import (
    create_share_link,
    delete_share_link,
    get_share_permission,
    list_all_share_links,
    list_share_links,
    list_user_share_links,
    revoke_share_link,
    update_share_link,
)

router = APIRouter(prefix="/share-links", tags=["share-links"])

router.add_api_route(
    "",
    list_share_links,
    methods=["GET"],
    summary="List my share links",
    description=(
        "Your share links, newest first, each with its current `state` (active, "
        "disabled, revoked, expired, suspended - you may no longer share - or "
        "unavailable - the item is gone or you can no longer read it). Filter "
        "with `resource_type`, `resource_id` and `variant`."
    ),
    response_model=list[ShareLinkOut],
)
router.add_api_route(
    "",
    create_share_link,
    methods=["POST"],
    summary="Create a share link",
    description=(
        "Creates a public link to one book, map, token, audio track or model you "
        "can read. Optional `label`, `expires_in_days` (null for never) and "
        "`password`. `variant: \"otfbm\"` (maps only, with an optional `cell` "
        "of 20-100) makes the link serve the map resized as an OTFBM "
        "background instead of the original. 403 when share links are off or "
        "you may not create them."
    ),
    response_model=ShareLinkOut,
)
# Declared ahead of "/{link_id}" so these are not read as ids.
router.add_api_route(
    "/permission",
    get_share_permission,
    methods=["GET"],
    summary="Whether I may create share links",
    description="Your effective permission and which layer decided it (instance, role or override).",
    response_model=ShareLinkPermission,
)
router.add_api_route(
    "/all",
    list_all_share_links,
    methods=["GET"],
    summary="List every share link",
    description="Every user's share links, with their owners. Admin only, and not with an API key: the live link URLs are credentials.",
    response_model=list[ShareLinkOut],
    openapi_extra=api_keys.EXCLUDED,
)
router.add_api_route(
    "/users/{user_id}",
    list_user_share_links,
    methods=["GET"],
    summary="List a user's share links",
    description="One user's share links, for the user admin page. Admin only, and not with an API key: the live link URLs are credentials.",
    response_model=list[ShareLinkOut],
    openapi_extra=api_keys.EXCLUDED,
)
router.add_api_route(
    "/{link_id}",
    update_share_link,
    methods=["PATCH"],
    summary="Change a share link",
    description=(
        "Change the label, expiry (`expires_in_days`, null for never) or password "
        "(null or empty to remove it). Your own links, or anyone's for an admin."
    ),
    response_model=ShareLinkOut,
)
router.add_api_route(
    "/{link_id}/revoke",
    revoke_share_link,
    methods=["POST"],
    summary="Revoke a share link",
    description="Stops the link working for good. It stays listed as revoked until deleted.",
    response_model=ShareLinkOut,
)
router.add_api_route(
    "/{link_id}",
    delete_share_link,
    methods=["DELETE"],
    summary="Delete a share link",
    description="Removes the link entirely; it stops working if it had not been revoked.",
    response_model=StatusResponse,
)
