"""Campaign manager — registers all campaign routes on a single router."""

from fastapi import APIRouter

from .core import (
    list_campaigns,
    create_campaign,
    get_campaign,
    update_campaign,
    delete_campaign,
    search_resources_global,
    invite_member,
    update_member_status,
    remove_member,
    list_resources,
    add_resource,
    update_resource,
    remove_resource,
    eligible_members,
    admin_list_all_campaigns,
    admin_list_deleted_campaigns,
    admin_list_user_campaigns,
    admin_soft_delete_campaign,
    admin_restore_campaign,
)
from .sessions import (
    list_sessions,
    create_session,
    get_session,
    update_session,
    delete_session,
    upsert_player_note,
    upsert_gm_note,
    search_session_notes,
)
from .schedule import (
    get_schedule,
    upsert_schedule,
    delete_schedule,
    get_availability,
    set_availability,
    cancel_session_date,
)

router = APIRouter(prefix="/campaigns", tags=["campaigns"])

# --- Admin-only campaign management ---
router.add_api_route(
    "/admin/all",
    admin_list_all_campaigns,
    methods=["GET"],
    summary="Admin: list all campaigns",
)
router.add_api_route(
    "/admin/deleted",
    admin_list_deleted_campaigns,
    methods=["GET"],
    summary="Admin: list soft-deleted campaigns",
)
router.add_api_route(
    "/admin/by-user/{user_id}",
    admin_list_user_campaigns,
    methods=["GET"],
    summary="Admin: list campaigns owned by a user",
)
router.add_api_route(
    "/admin/{campaign_id}/delete",
    admin_soft_delete_campaign,
    methods=["POST"],
    summary="Admin: soft-delete a campaign",
    status_code=204,
)
router.add_api_route(
    "/admin/{campaign_id}/restore",
    admin_restore_campaign,
    methods=["POST"],
    summary="Admin: restore a soft-deleted campaign",
)

# --- Campaign CRUD ---
router.add_api_route(
    "", list_campaigns, methods=["GET"], summary="List campaigns for the current user"
)
router.add_api_route(
    "", create_campaign, methods=["POST"], summary="Create a campaign", status_code=201
)
router.add_api_route("/{campaign_id}", get_campaign, methods=["GET"], summary="Get a campaign")
router.add_api_route(
    "/{campaign_id}", update_campaign, methods=["PATCH"], summary="Update a campaign"
)
router.add_api_route(
    "/{campaign_id}",
    delete_campaign,
    methods=["DELETE"],
    summary="Delete a campaign",
    status_code=204,
)

# --- Resource search (must be before /{campaign_id} to avoid routing conflict) ---
router.add_api_route(
    "/resources/search",
    search_resources_global,
    methods=["GET"],
    summary="Search books, maps, and tokens by name",
)

# --- Members ---
router.add_api_route(
    "/{campaign_id}/invite",
    invite_member,
    methods=["POST"],
    summary="Invite a player to a GM campaign",
    status_code=201,
)
router.add_api_route(
    "/{campaign_id}/members/{user_id}",
    update_member_status,
    methods=["PATCH"],
    summary="Accept or decline an invitation",
)
router.add_api_route(
    "/{campaign_id}/members/{user_id}",
    remove_member,
    methods=["DELETE"],
    summary="Remove a member",
    status_code=204,
)

# --- Resources ---
router.add_api_route(
    "/{campaign_id}/resources", list_resources, methods=["GET"], summary="List linked resources"
)
router.add_api_route(
    "/{campaign_id}/resources",
    add_resource,
    methods=["POST"],
    summary="Link a resource to a campaign",
    status_code=201,
)
router.add_api_route(
    "/{campaign_id}/resources/{resource_id}",
    update_resource,
    methods=["PATCH"],
    summary="Update resource sharing",
)
router.add_api_route(
    "/{campaign_id}/resources/{resource_id}",
    remove_resource,
    methods=["DELETE"],
    summary="Unlink a resource",
    status_code=204,
)

# --- Eligible members ---
router.add_api_route(
    "/{campaign_id}/eligible-members",
    eligible_members,
    methods=["GET"],
    summary="List users that can be invited",
)

# --- Sessions ---
router.add_api_route(
    "/{campaign_id}/sessions", list_sessions, methods=["GET"], summary="List session notes"
)
router.add_api_route(
    "/{campaign_id}/sessions",
    create_session,
    methods=["POST"],
    summary="Create a session note",
    status_code=201,
)
router.add_api_route(
    "/{campaign_id}/sessions/search",
    search_session_notes,
    methods=["GET"],
    summary="Search session notes",
)
router.add_api_route(
    "/{campaign_id}/sessions/{session_id}",
    get_session,
    methods=["GET"],
    summary="Get a session note with all notes",
)
router.add_api_route(
    "/{campaign_id}/sessions/{session_id}",
    update_session,
    methods=["PATCH"],
    summary="Update session title",
)
router.add_api_route(
    "/{campaign_id}/sessions/{session_id}",
    delete_session,
    methods=["DELETE"],
    summary="Delete a session note",
    status_code=204,
)
router.add_api_route(
    "/{campaign_id}/sessions/{session_id}/notes/player",
    upsert_player_note,
    methods=["PUT"],
    summary="Save own player note",
)
router.add_api_route(
    "/{campaign_id}/sessions/{session_id}/notes/gm",
    upsert_gm_note,
    methods=["PUT"],
    summary="Save GM notes (owner only)",
)

# --- Schedule ---
router.add_api_route(
    "/{campaign_id}/schedule",
    get_schedule,
    methods=["GET"],
    summary="Get campaign schedule and next sessions",
)
router.add_api_route(
    "/{campaign_id}/schedule",
    upsert_schedule,
    methods=["PUT"],
    summary="Create or update campaign schedule",
)
router.add_api_route(
    "/{campaign_id}/schedule",
    delete_schedule,
    methods=["DELETE"],
    summary="Remove campaign schedule",
    status_code=204,
)

# --- Availability ---
router.add_api_route(
    "/{campaign_id}/availability",
    get_availability,
    methods=["GET"],
    summary="Get availability chart for upcoming sessions",
)
router.add_api_route(
    "/{campaign_id}/availability/{session_date}",
    set_availability,
    methods=["PUT"],
    summary="Set availability for a session date",
)
router.add_api_route(
    "/{campaign_id}/availability/{session_date}/cancel",
    cancel_session_date,
    methods=["PUT"],
    summary="GM: cancel or uncancel a session date",
)
