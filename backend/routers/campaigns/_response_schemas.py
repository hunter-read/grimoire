"""Pydantic response schemas for the campaigns API.

Kept separate from ``_schemas.py`` (the request models) because the campaigns
package serves the largest route surface in the app and one combined file would
be unwieldy — see the "prefer smaller, focused files" rule in ``CLAUDE.md``.

``response_model`` makes FastAPI *filter and validate* what a handler returns, so
every field below is typed against what the handler actually builds:

* A column declared only ``default=...`` (rather than ``nullable=False``) can
  still hold NULL — the default applies at insert, and rows predating a column
  migration keep NULL. Those are ``Optional`` here.
* A key a handler only adds inside an ``if`` is ``Optional`` too, or it would
  either vanish from the schema or fail validation depending on the branch.

Where that reasoning isn't obvious from the field name, there's a comment.
"""

from typing import Any, Optional

from pydantic import BaseModel


# --------------------------------------------------------------------------- #
# Campaign CRUD (core.py)
# --------------------------------------------------------------------------- #


class CampaignMemberOut(BaseModel):
    """One row of ``_helpers.build_members`` / ``core._members``.

    Three shapes share this model: the GM owner row, a player row, and the
    lighter row ``list_campaigns`` builds. Only the keys common to all of them
    are required; everything a single shape omits is Optional.
    """

    user_id: str
    # Empty string when the User row has gone missing; `display_name` is a
    # nullable column.
    username: str
    display_name: Optional[str] = None
    # `status` is `default="invited"` on CampaignMember, so legacy rows may be NULL.
    status: Optional[str] = None
    character_name: Optional[str] = None
    # The rest only exist on `build_members` rows, not on `list_campaigns`'.
    is_owner: Optional[bool] = None
    campaign_access: Optional[bool] = None
    # Player rows only (the owner row carries no CampaignMember id).
    id: Optional[str] = None
    is_guest: Optional[bool] = None
    guest_code: Optional[str] = None
    has_art: Optional[bool] = None
    has_sheet: Optional[bool] = None
    character_sheet_filename: Optional[str] = None
    character_sheet_url: Optional[str] = None


class CampaignResourceRef(BaseModel):
    """The trimmed resource rows embedded in ``get_campaign``'s payload."""

    id: str
    resource_type: str
    resource_id: str
    # `visibility` is `default="gm"`, so a legacy row may be NULL.
    visibility: Optional[str] = None
    category_id: Optional[str] = None


class CampaignOut(BaseModel):
    """A campaign as built by ``_helpers.serialize_campaign``.

    ``invitation_status`` and ``resources`` are added by individual handlers
    (``list_campaigns`` and ``get_campaign`` respectively) rather than by the
    serializer, so both are Optional.
    """

    id: str
    name: str
    # `description` is `default=""`, not NOT NULL.
    description: Optional[str] = None
    owner_id: str
    # Coalesced by the serializer to "" when the owner row is missing.
    owner_display_name: str
    # `is_gm_campaign`/`gm_title` are `default=...` columns.
    is_gm_campaign: Optional[bool] = None
    gm_title: Optional[str] = None
    parent_campaign_id: Optional[str] = None
    system_id: Optional[str] = None
    system_name: Optional[str] = None
    system_display_name: str
    has_schedule: bool
    # Null unless an enabled schedule yields an upcoming date.
    next_session: Optional[str] = None
    has_banner: bool
    banner_focus_y: int = 50
    resource_group_order: list[str]
    is_archived: bool
    archived_at: Optional[str] = None
    locked: bool
    owner_has_campaign_access: bool
    members: list[CampaignMemberOut]
    created_at: str
    updated_at: str
    last_accessed_at: Optional[str] = None
    # Only `list_campaigns` sets this (None for owned campaigns, the membership
    # status for ones the user was invited to / joined).
    invitation_status: Optional[str] = None
    # Only `get_campaign` sets this.
    resources: Optional[list[CampaignResourceRef]] = None


class CampaignInviteOut(BaseModel):
    """One pending invitation from ``list_invites``."""

    campaign_id: str
    name: str
    description: Optional[str] = None
    # Coalesced to "" when the owner row is missing.
    owner_display_name: str


class AdminCampaignOut(BaseModel):
    """The minimal read-only campaign view for the admin user page."""

    id: str
    name: str
    description: Optional[str] = None
    is_gm_campaign: Optional[bool] = None
    system_id: Optional[str] = None
    # Looked up from GameSystem; null when the campaign has no linked system.
    system_name: Optional[str] = None


# --------------------------------------------------------------------------- #
# Members (members.py)
# --------------------------------------------------------------------------- #


class MemberInviteOut(BaseModel):
    """``invite_member`` — literal ``{"user_id", "status"}``."""

    user_id: str
    status: str


class MemberStatusOut(BaseModel):
    """``update_member_status`` — the member's post-update state."""

    user_id: str
    status: Optional[str] = None
    character_name: Optional[str] = None
    character_sheet_url: Optional[str] = None


class EligibleMemberOut(BaseModel):
    """One invitable user from ``eligible_members``."""

    id: str
    username: str
    display_name: Optional[str] = None
    # `role` is `default="player"` on User, so legacy rows may be NULL.
    role: Optional[str] = None
    already_invited: bool
    campaign_access: bool


# --------------------------------------------------------------------------- #
# Guests (guests.py)
# --------------------------------------------------------------------------- #


class GuestOut(BaseModel):
    """One guest, as built by ``guests._serialize_guest``."""

    id: str
    user_id: str
    # The guest User's display_name; null when the row is missing.
    nickname: Optional[str] = None
    guest_code: Optional[str] = None
    status: Optional[str] = None
    character_name: Optional[str] = None
    has_art: bool
    has_sheet: bool


class GuestShareTemplateOut(BaseModel):
    """Copy-paste share text and links for a guest invite code."""

    code: Optional[str] = None
    link: str
    message: str
    mailto_url: str
    discord_message: str


# --------------------------------------------------------------------------- #
# Library resource picker (resource_search.py)
# --------------------------------------------------------------------------- #


class ResourceSearchHit(BaseModel):
    """One book/map/token/audio hit from ``search_resources_global``."""

    resource_type: str
    resource_id: str
    # Book title / media filename — NOT NULL columns in every branch.
    name: str
    # Folder path; always a string (possibly empty).
    subtitle: str
    # `has_thumbnail` is a `default=False` column for books/maps/tokens; the
    # audio branch coalesces it with `bool(...)`.
    has_thumbnail: Optional[bool] = None


class SuggestedResourceOut(BaseModel):
    """One suggested (system) book for the create wizard."""

    resource_type: str
    resource_id: str
    name: str
    # `Book.category` is `default="core"`, so it may be NULL on legacy rows.
    subtitle: Optional[str] = None
    has_thumbnail: Optional[bool] = None
    suggested: bool


# --------------------------------------------------------------------------- #
# Linked resources (resources.py, uploads.py)
# --------------------------------------------------------------------------- #


class LinkedResourceOut(BaseModel):
    """One linked resource, as built by ``resources._serialize``.

    ``shared_user_ids`` is only added when ``include_shares`` is set (the owner's
    view), so it is Optional. The same shape is returned by the file/image upload
    handlers, which build the dict by hand and omit both ``has_thumbnail`` and
    ``shared_user_ids``.
    """

    id: str
    resource_type: str
    resource_id: str
    # Falls back to the raw resource id when the target row is gone.
    name: str
    # Omitted by the upload handlers, which return an image/file row directly.
    has_thumbnail: Optional[bool] = None
    is_image: bool
    visibility: Optional[str] = None
    category_id: Optional[str] = None
    # `sort_order` is `default=0` rather than NOT NULL.
    sort_order: Optional[int] = None
    # Owner-only; absent for a member's view of the list.
    shared_user_ids: Optional[list[str]] = None


class OkResponse(BaseModel):
    """``{"ok": True}`` — the reorder endpoints' acknowledgement."""

    ok: bool


# --------------------------------------------------------------------------- #
# Uploads and sheets (uploads.py, sheets.py)
# --------------------------------------------------------------------------- #


class BannerUploadOut(BaseModel):
    banner_path: str


class BannerFocusOut(BaseModel):
    banner_focus_y: int


class MemberArtUploadOut(BaseModel):
    character_art_path: str


class MemberSheetOut(BaseModel):
    """Returned by both the sheet upload and the blank-sheet duplicate."""

    character_sheet_path: str
    character_sheet_filename: Optional[str] = None


class SheetSourceOut(BaseModel):
    """One blank sheet a member can duplicate."""

    id: str
    name: str


class SheetSourcesOut(BaseModel):
    books: list[SheetSourceOut]
    files: list[SheetSourceOut]


# --------------------------------------------------------------------------- #
# Sessions (sessions.py)
# --------------------------------------------------------------------------- #


class SessionSummaryOut(BaseModel):
    """A session note's identity — list/create/update all return this shape."""

    id: str
    session_date: str
    # `SessionNote.title` is `default=""` rather than NOT NULL.
    title: Optional[str] = None


class PlayerSessionNoteOut(BaseModel):
    user_id: str
    username: str
    display_name: Optional[str] = None
    # `content` is a `default=""` column.
    content: Optional[str] = None
    updated_at: Optional[str] = None


class GMSessionNoteOut(BaseModel):
    """The GM note block on ``get_session``.

    Every key is Optional: the handler returns ``{}`` when the session has no GM
    note at all, and omits ``internal_content`` entirely for non-owners.
    """

    external_content: Optional[str] = None
    internal_content: Optional[str] = None
    updated_at: Optional[str] = None


class SessionDetailOut(BaseModel):
    id: str
    campaign_id: str
    session_date: str
    title: Optional[str] = None
    player_notes: list[PlayerSessionNoteOut]
    gm_note: GMSessionNoteOut


class SessionNoteSearchHit(BaseModel):
    session_id: str
    session_date: str
    session_title: Optional[str] = None
    note_type: str
    # Null for a GM note whose campaign owner row is gone.
    author_id: Optional[str] = None
    author_username: str
    author_display_name: Optional[str] = None
    snippet: str


class SessionNoteSearchOut(BaseModel):
    results: list[SessionNoteSearchHit]
    query: str


class PlayerNoteOut(BaseModel):
    """``upsert_player_note`` echoes the saved content back."""

    content: str


class GMNoteOut(BaseModel):
    """``upsert_gm_note`` echoes both halves of the stored GM note back."""

    internal_content: Optional[str] = None
    external_content: Optional[str] = None


# --------------------------------------------------------------------------- #
# Schedule and availability (schedule.py)
# --------------------------------------------------------------------------- #


class ScheduleOut(BaseModel):
    """The campaign schedule. ``definition`` is a free-form JSON column, and is
    null when no schedule row exists."""

    definition: Optional[dict[str, Any]] = None
    # `enabled` is NOT NULL on the model but the no-schedule branch returns False.
    enabled: bool
    next_sessions: list[str]


class AvailabilityCell(BaseModel):
    """One member's answer for one date. Both keys are null/False when they have
    not responded (the handler substitutes ``{"status": None, ...}``)."""

    status: Optional[str] = None
    is_cancelled: Optional[bool] = None


class AvailabilityRow(BaseModel):
    user_id: str
    username: str
    display_name: Optional[str] = None
    is_owner: bool
    dates: dict[str, AvailabilityCell]


class AvailabilityOut(BaseModel):
    next_sessions: list[str]
    cancelled_dates: list[str]
    rows: list[AvailabilityRow]


class AvailabilitySetOut(BaseModel):
    session_date: str
    # `status`/`is_cancelled` are `default=...` columns on SessionAvailability.
    status: Optional[str] = None
    is_cancelled: Optional[bool] = None


class SessionDateCancelOut(BaseModel):
    session_date: str
    is_cancelled: Optional[bool] = None


# --------------------------------------------------------------------------- #
# Calendar subscription (calendar.py)
# --------------------------------------------------------------------------- #


class CalendarSubscriptionOut(BaseModel):
    """The caller's ICS subscription state.

    Every URL is null unless the user has minted a token *and* BASE_URL names a
    real public origin — a feed URL built from the localhost default would be
    unreachable from the calendar app that has to poll it.
    """

    has_token: bool
    base_url_configured: bool
    feed_url: Optional[str] = None
    # Same URL under the webcal:// scheme, so a click subscribes rather than
    # downloading a one-off copy.
    webcal_url: Optional[str] = None
    # Only present when the request named a campaign.
    campaign_feed_url: Optional[str] = None


# --------------------------------------------------------------------------- #
# Wiki pages (wiki.py)
# --------------------------------------------------------------------------- #


class WikiPageSummaryOut(BaseModel):
    """A page's metadata, as built by ``wiki._page_summary``.

    ``create_page`` / ``update_page`` return exactly this; the list and search
    endpoints extend it (see the subclasses below).
    """

    id: str
    # `title` is NOT NULL but `default=""`; `slug` is NOT NULL with no default.
    title: str
    slug: str
    # `visibility`/`page_type`/`sort_order` are `default=...` columns.
    visibility: Optional[str] = None
    page_type: Optional[str] = None
    session_date: Optional[str] = None
    parent_id: Optional[str] = None
    icon: Optional[str] = None
    icon_color: Optional[str] = None
    sort_order: Optional[int] = None
    updated_at: Optional[str] = None


class WikiPageListItem(WikiPageSummaryOut):
    """A page in ``list_pages``: the summary plus this viewer's permissions."""

    can_edit: bool
    can_delete: bool
    is_hidden: bool
    is_mine: bool


class WikiPageSearchHit(WikiPageSummaryOut):
    """A search hit: the summary plus a body excerpt (may be empty)."""

    snippet: str


class WikiSearchOut(BaseModel):
    results: list[WikiPageSearchHit]
    query: str


class WikiPageDetailOut(BaseModel):
    """One page in full, from ``get_page``."""

    id: str
    campaign_id: str
    title: str
    slug: str
    # `body` is `default=""`, and non-GMs receive a secrets-stripped copy.
    body: Optional[str] = None
    visibility: Optional[str] = None
    page_type: Optional[str] = None
    session_date: Optional[str] = None
    parent_id: Optional[str] = None
    icon: Optional[str] = None
    icon_color: Optional[str] = None
    # Nullable FK: a page outlives the user who wrote it (attribution is cleared,
    # not cascaded — see `_helpers.purge_user_data`).
    created_by_id: Optional[str] = None
    created_by_name: Optional[str] = None
    can_edit: bool
    can_delete: bool
    is_mine: bool
    is_hidden: bool
    # Empty unless the viewer is the author of a `members`-visibility page.
    shared_user_ids: list[str]
    shared_write_user_ids: list[str]
    backlinks: list[WikiPageSummaryOut]
    updated_at: Optional[str] = None


class WikiPageHiddenOut(BaseModel):
    """``hide_page`` / ``unhide_page`` — ``{"ok", "hidden"}``."""

    ok: bool
    hidden: bool


class WikiHeadingOut(BaseModel):
    """One ATX heading from ``wikilinks.extract_headings``."""

    text: str
    level: int


class WikiPageTitleOut(BaseModel):
    """One autocomplete entry backing the `[[link]]` picker."""

    id: str
    title: str
    slug: str
    ambiguous: bool
    # Null when the page is top-level, or its parent isn't visible to this user.
    parent_title: Optional[str] = None
    headings: list[WikiHeadingOut]


# --------------------------------------------------------------------------- #
# Wiki import (wiki_io.py). Export returns raw Response objects (zip / markdown /
# JSON attachments) and so deliberately carries no response_model.
# --------------------------------------------------------------------------- #


class WikiImportOut(BaseModel):
    imported: int
    format: str
    pages: list[WikiPageSummaryOut]


# --------------------------------------------------------------------------- #
# Note templates (wiki_templates.py)
# --------------------------------------------------------------------------- #


class WikiTemplateSummaryOut(BaseModel):
    """One template's metadata, from ``wiki_templates._summary``.

    ``system``/``category``/``description`` are coalesced by the serializer
    (``t.system or ""``), so they are required despite being nullable columns.
    """

    id: str
    # `name` is NOT NULL but `default=""`.
    name: str
    system: str
    category: str
    description: str
    # Provenance: null for a hand-written or uploaded template.
    source_id: Optional[str] = None
    source_url: Optional[str] = None
    source_version: Optional[str] = None
    created_at: Optional[str] = None


class WikiTemplateDefaultsOut(BaseModel):
    """The page defaults a template seeds a new page with.

    Read out of the body's frontmatter with ``.get(key, "")`` defaults, so every
    field is a plain string even when the block is absent.
    """

    title: str
    icon: str
    icon_color: str
    visibility: str
    page_type: str


class WikiTemplateDetailOut(WikiTemplateSummaryOut):
    """A template including its body, from ``wiki_templates._detail``."""

    # The markdown with its frontmatter block split off into `defaults`.
    body: str
    defaults: WikiTemplateDefaultsOut


class WikiTemplateListOut(BaseModel):
    templates: list[WikiTemplateSummaryOut]
    campaign_system: str
    downloads_enabled: bool
    categories: list[str]
    authored_system: str


class WikiTemplateUseOut(BaseModel):
    """``use_wiki_template`` — deliberately the importer's shape, so the client
    treats "used a template" and "imported a file" alike."""

    imported: int
    template_id: str
    pages: list[WikiPageSummaryOut]


class CatalogueTemplateOut(BaseModel):
    """One community template entry, from ``catalogue.build_tree``.

    Every field is bounded/coalesced to a string by ``_clean_str`` there.
    """

    id: str
    name: str
    version: str
    system: str
    category: str
    description: str


class CatalogueFolderOut(BaseModel):
    path: str
    name: str
    templates: list[CatalogueTemplateOut]


class WikiTemplateBrowseOut(BaseModel):
    folders: list[CatalogueFolderOut]
    downloaded_ids: list[str]
    campaign_system: str
    index_url: str
    is_custom_url: bool
    generated: str


class WikiTemplateSourceOut(BaseModel):
    index_url: str
    is_custom_url: bool


# --------------------------------------------------------------------------- #
# Categories (categories.py)
# --------------------------------------------------------------------------- #


class CampaignCategoryOut(BaseModel):
    """One GM-defined category, from ``categories._serialize``."""

    id: str
    name: str
    kind: str
    icon: Optional[str] = None
    icon_color: Optional[str] = None
    # `sort_order` is `default=0` rather than NOT NULL.
    sort_order: Optional[int] = None


class ResourceGroupOrderOut(BaseModel):
    """``set_resource_group_order`` — the ack plus the cleaned key list."""

    ok: bool
    resource_group_order: list[str]


__all__ = [
    "AdminCampaignOut",
    "AvailabilityCell",
    "AvailabilityOut",
    "AvailabilityRow",
    "AvailabilitySetOut",
    "BannerUploadOut",
    "CalendarSubscriptionOut",
    "CampaignCategoryOut",
    "CampaignInviteOut",
    "CampaignMemberOut",
    "CampaignOut",
    "CampaignResourceRef",
    "CatalogueFolderOut",
    "CatalogueTemplateOut",
    "EligibleMemberOut",
    "GMNoteOut",
    "GMSessionNoteOut",
    "GuestOut",
    "GuestShareTemplateOut",
    "LinkedResourceOut",
    "MemberArtUploadOut",
    "MemberInviteOut",
    "MemberSheetOut",
    "MemberStatusOut",
    "OkResponse",
    "PlayerNoteOut",
    "PlayerSessionNoteOut",
    "ResourceGroupOrderOut",
    "ResourceSearchHit",
    "ScheduleOut",
    "SessionDateCancelOut",
    "SessionDetailOut",
    "SessionNoteSearchHit",
    "SessionNoteSearchOut",
    "SessionSummaryOut",
    "SheetSourceOut",
    "SheetSourcesOut",
    "SuggestedResourceOut",
    "WikiHeadingOut",
    "WikiImportOut",
    "WikiPageDetailOut",
    "WikiPageHiddenOut",
    "WikiPageListItem",
    "WikiPageSearchHit",
    "WikiPageSummaryOut",
    "WikiPageTitleOut",
    "WikiSearchOut",
    "WikiTemplateBrowseOut",
    "WikiTemplateDefaultsOut",
    "WikiTemplateDetailOut",
    "WikiTemplateListOut",
    "WikiTemplateSourceOut",
    "WikiTemplateSummaryOut",
    "WikiTemplateUseOut",
]
