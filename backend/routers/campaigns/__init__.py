"""Campaign manager — registers all campaign routes on a single router."""

from fastapi import APIRouter

from .core import (
    list_campaigns,
    create_campaign,
    get_campaign,
    update_campaign,
    delete_campaign,
    convert_campaign_to_group,
    set_campaign_archived,
    list_invites,
    admin_list_user_campaigns,
)
from .members import (
    invite_member,
    update_member_status,
    remove_member,
    eligible_members,
)
from .resource_search import (
    search_resources_global,
    suggested_resources,
)
from .resources import (
    list_resources,
    add_resource,
    bulk_add_resources,
    update_resource,
    reorder_resources,
    remove_resource,
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
from .uploads import (
    upload_banner,
    get_banner,
    delete_banner,
    upload_member_art,
    get_member_art,
    delete_member_art,
    upload_member_sheet,
    get_member_sheet,
    delete_member_sheet,
    upload_campaign_file,
    upload_campaign_image,
    get_campaign_file,
)
from .sheets import (
    duplicate_member_sheet,
    list_sheet_sources,
)
from .wiki import (
    list_pages,
    get_page,
    create_page,
    update_page,
    delete_page,
    hide_page,
    unhide_page,
    search_pages,
    page_titles,
    reorder_pages,
)
from .guests import (
    create_guest,
    list_guests,
    regenerate_guest_code,
    remove_guest,
    guest_share_template,
)
from .wiki_io import export_wiki, import_wiki
from .wiki_templates import (
    browse_wiki_templates,
    create_wiki_template,
    delete_wiki_template,
    download_wiki_template,
    export_wiki_template,
    get_wiki_template,
    list_wiki_templates,
    update_template_source,
    update_wiki_template,
    upload_wiki_template,
    use_wiki_template,
)
from .categories import (
    list_categories,
    create_category,
    update_category,
    reorder_categories,
    set_resource_group_order,
    delete_category,
)

router = APIRouter(prefix="/campaigns", tags=["campaigns"])

# --- Admin-only campaign management ---
router.add_api_route(
    "/admin/by-user/{user_id}",
    admin_list_user_campaigns,
    methods=["GET"],
    summary="Admin: list campaigns owned by a user (read-only, minimal fields)",
)

# --- Campaign CRUD ---
router.add_api_route(
    "", list_campaigns, methods=["GET"], summary="List campaigns for the current user"
)
router.add_api_route(
    "", create_campaign, methods=["POST"], summary="Create a campaign", status_code=201
)

# --- Pending invites (must be before /{campaign_id} to avoid routing conflict) ---
router.add_api_route(
    "/invites",
    list_invites,
    methods=["GET"],
    summary="List the current user's pending campaign invitations",
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
router.add_api_route(
    "/{campaign_id}/convert-to-group",
    convert_campaign_to_group,
    methods=["POST"],
    summary="Convert a personal campaign into a GM-run group campaign",
)
router.add_api_route(
    "/{campaign_id}/archive",
    set_campaign_archived,
    methods=["PUT"],
    summary="Archive or unarchive a campaign",
)

# --- Resource search (must be before /{campaign_id} to avoid routing conflict) ---
router.add_api_route(
    "/resources/search",
    search_resources_global,
    methods=["GET"],
    summary="Search books, maps, and tokens by name",
)
router.add_api_route(
    "/resources/suggested/{system_id}",
    suggested_resources,
    methods=["GET"],
    summary="Suggested resources (system books) for the create wizard",
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

# --- Guests (code-based, GM-managed) ---
router.add_api_route(
    "/{campaign_id}/guests",
    create_guest,
    methods=["POST"],
    summary="Create a guest invite code for a GM campaign",
    status_code=201,
)
router.add_api_route(
    "/{campaign_id}/guests",
    list_guests,
    methods=["GET"],
    summary="List a campaign's guests and their invite codes",
)
router.add_api_route(
    "/{campaign_id}/guests/{member_id}/regenerate",
    regenerate_guest_code,
    methods=["POST"],
    summary="Regenerate a guest's invite code",
)
router.add_api_route(
    "/{campaign_id}/guests/{member_id}/share-template",
    guest_share_template,
    methods=["GET"],
    summary="Get share text and links for a guest invite code",
)
router.add_api_route(
    "/{campaign_id}/guests/{member_id}",
    remove_guest,
    methods=["DELETE"],
    summary="Remove a guest (deletes the guest account)",
    status_code=204,
)

# --- Banner ---
router.add_api_route(
    "/{campaign_id}/banner", upload_banner, methods=["POST"], summary="Upload campaign banner"
)
router.add_api_route(
    "/{campaign_id}/banner", get_banner, methods=["GET"], summary="Get campaign banner image"
)
router.add_api_route(
    "/{campaign_id}/banner",
    delete_banner,
    methods=["DELETE"],
    summary="Remove campaign banner",
    status_code=204,
)

# --- Character art & sheets (keyed by CampaignMember id) ---
router.add_api_route(
    "/{campaign_id}/members/{member_id}/art",
    upload_member_art,
    methods=["POST"],
    summary="Upload a member's character art",
)
router.add_api_route(
    "/{campaign_id}/members/{member_id}/art",
    get_member_art,
    methods=["GET"],
    summary="Get a member's character art",
)
router.add_api_route(
    "/{campaign_id}/members/{member_id}/art",
    delete_member_art,
    methods=["DELETE"],
    summary="Remove a member's character art",
    status_code=204,
)
router.add_api_route(
    "/{campaign_id}/members/{member_id}/sheet",
    upload_member_sheet,
    methods=["POST"],
    summary="Upload a member's character sheet",
)
router.add_api_route(
    "/{campaign_id}/members/{member_id}/sheet",
    get_member_sheet,
    methods=["GET"],
    summary="Download a member's character sheet",
)
router.add_api_route(
    "/{campaign_id}/members/{member_id}/sheet",
    delete_member_sheet,
    methods=["DELETE"],
    summary="Remove a member's character sheet",
    status_code=204,
)
router.add_api_route(
    "/{campaign_id}/members/{member_id}/sheet/duplicate",
    duplicate_member_sheet,
    methods=["POST"],
    summary="Duplicate a blank sheet into a member's slot",
)
router.add_api_route(
    "/{campaign_id}/sheet-sources",
    list_sheet_sources,
    methods=["GET"],
    summary="List blank sheets a member can duplicate",
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
    "/{campaign_id}/resources/bulk",
    bulk_add_resources,
    methods=["POST"],
    summary="Link many resources at once",
    status_code=201,
)
router.add_api_route(
    "/{campaign_id}/resources/reorder",
    reorder_resources,
    methods=["PUT"],
    summary="Reorder resources (drag-and-drop)",
)
router.add_api_route(
    "/{campaign_id}/resources/{resource_id}",
    update_resource,
    methods=["PATCH"],
    summary="Update resource visibility/category",
)
router.add_api_route(
    "/{campaign_id}/resources/{resource_id}",
    remove_resource,
    methods=["DELETE"],
    summary="Unlink a resource",
    status_code=204,
)

# --- Campaign file uploads (linked as resource_type='file') ---
router.add_api_route(
    "/{campaign_id}/files",
    upload_campaign_file,
    methods=["POST"],
    summary="Upload a campaign file (GM); links it as a resource",
    status_code=201,
)
router.add_api_route(
    "/{campaign_id}/images",
    upload_campaign_image,
    methods=["POST"],
    summary="Upload an image (GM); links it as an image resource for note embedding",
    status_code=201,
)
router.add_api_route(
    "/{campaign_id}/files/{file_id}",
    get_campaign_file,
    methods=["GET"],
    summary="Download a campaign file (honours resource visibility)",
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

# --- Wiki pages (search/titles before /{page_id} to avoid routing conflict) ---
router.add_api_route(
    "/{campaign_id}/wiki", list_pages, methods=["GET"], summary="List visible wiki pages"
)
router.add_api_route(
    "/{campaign_id}/wiki",
    create_page,
    methods=["POST"],
    summary="Create a wiki page",
    status_code=201,
)
router.add_api_route(
    "/{campaign_id}/wiki/search",
    search_pages,
    methods=["GET"],
    summary="Search wiki pages",
)
router.add_api_route(
    "/{campaign_id}/wiki/titles",
    page_titles,
    methods=["GET"],
    summary="Wiki page titles for [[link]] autocomplete",
)
router.add_api_route(
    "/{campaign_id}/wiki/reorder",
    reorder_pages,
    methods=["PUT"],
    summary="Reorder wiki pages (drag-and-drop)",
)
router.add_api_route(
    "/{campaign_id}/wiki/export",
    export_wiki,
    methods=["GET"],
    summary="Export campaign wiki (md zip or json bundle)",
)
router.add_api_route(
    "/{campaign_id}/wiki/import",
    import_wiki,
    methods=["POST"],
    summary="Import wiki pages (markdown / json / LegendKeeper)",
    status_code=201,
)
router.add_api_route(
    "/{campaign_id}/wiki/templates",
    list_wiki_templates,
    methods=["GET"],
    summary="List the campaign's note templates",
)
router.add_api_route(
    "/{campaign_id}/wiki/templates",
    create_wiki_template,
    methods=["POST"],
    summary="Write a new note template",
    status_code=201,
)
# Literal segments before /{template_id}, so they aren't swallowed by it.
router.add_api_route(
    "/{campaign_id}/wiki/templates/browse",
    browse_wiki_templates,
    methods=["GET"],
    summary="Browse the community note-template catalogue",
)
router.add_api_route(
    "/{campaign_id}/wiki/templates/upload",
    upload_wiki_template,
    methods=["POST"],
    summary="Add a note template from an uploaded .md file",
    status_code=201,
)
router.add_api_route(
    "/{campaign_id}/wiki/templates/source",
    update_template_source,
    methods=["PUT"],
    summary="Set the note-template catalogue URL",
)
router.add_api_route(
    "/{campaign_id}/wiki/templates/download/{template_id}",
    download_wiki_template,
    methods=["POST"],
    summary="Download a community note template into the campaign",
    status_code=201,
)
router.add_api_route(
    "/{campaign_id}/wiki/templates/{template_id}",
    get_wiki_template,
    methods=["GET"],
    summary="Get a note template incl. its body",
)
router.add_api_route(
    "/{campaign_id}/wiki/templates/{template_id}",
    update_wiki_template,
    methods=["PATCH"],
    summary="Edit a note template",
)
router.add_api_route(
    "/{campaign_id}/wiki/templates/{template_id}",
    delete_wiki_template,
    methods=["DELETE"],
    summary="Delete a note template",
    status_code=204,
)
router.add_api_route(
    "/{campaign_id}/wiki/templates/{template_id}/export",
    export_wiki_template,
    methods=["GET"],
    summary="Export a note template as a .zip folder",
)
router.add_api_route(
    "/{campaign_id}/wiki/templates/{template_id}/use",
    use_wiki_template,
    methods=["POST"],
    summary="Create a wiki page from a note template",
    status_code=201,
)
router.add_api_route(
    "/{campaign_id}/wiki/{page_id}", get_page, methods=["GET"], summary="Get a wiki page"
)
router.add_api_route(
    "/{campaign_id}/wiki/{page_id}", update_page, methods=["PATCH"], summary="Update a wiki page"
)
router.add_api_route(
    "/{campaign_id}/wiki/{page_id}",
    delete_page,
    methods=["DELETE"],
    summary="Delete a wiki page",
    status_code=204,
)
router.add_api_route(
    "/{campaign_id}/wiki/{page_id}/hide",
    hide_page,
    methods=["POST"],
    summary="Hide a wiki page from your own view",
)
router.add_api_route(
    "/{campaign_id}/wiki/{page_id}/hide",
    unhide_page,
    methods=["DELETE"],
    summary="Un-hide a wiki page you had hidden",
)

# --- Categories (reorder before /{category_id} to avoid routing conflict) ---
router.add_api_route(
    "/{campaign_id}/categories",
    list_categories,
    methods=["GET"],
    summary="List categories (optionally filtered by kind)",
)
router.add_api_route(
    "/{campaign_id}/categories",
    create_category,
    methods=["POST"],
    summary="Create a category",
    status_code=201,
)
router.add_api_route(
    "/{campaign_id}/categories/reorder",
    reorder_categories,
    methods=["PUT"],
    summary="Reorder categories",
)
router.add_api_route(
    "/{campaign_id}/resource-group-order",
    set_resource_group_order,
    methods=["PUT"],
    summary="Set the resource panel's group display order (categories + type groups)",
)
router.add_api_route(
    "/{campaign_id}/categories/{category_id}",
    update_category,
    methods=["PATCH"],
    summary="Rename a category",
)
router.add_api_route(
    "/{campaign_id}/categories/{category_id}",
    delete_category,
    methods=["DELETE"],
    summary="Delete a category (mode: uncategorize | delete_items)",
    status_code=204,
)
