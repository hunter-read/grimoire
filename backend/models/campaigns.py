"""Campaign, session note, schedule, and availability models."""
import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .. import token_vault
from .base import Base, _utcnow, _uuid


class Campaign(Base):
    """A campaign — either a GM-run campaign or a player's personal campaign."""

    __tablename__ = "campaigns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, default="")
    owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)

    is_gm_campaign: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    gm_title: Mapped[Optional[str]] = mapped_column(String(100), default="Game Master")
    parent_campaign_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("campaigns.id"), nullable=True)
    system_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("game_systems.id"), nullable=True)
    # Free-text system name for a system not in the library (used when system_id is null).
    system_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Relative filename of the campaign banner, stored under DATA_PATH/campaign_uploads/banners/
    banner_path: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # Vertical focal point of the banner inside the 2:1 hero, 0-100 (50 = centred).
    # A banner picked from a library asset is rarely 2:1, so this is what keeps
    # the interesting part of a tall image in frame (issue #286).
    banner_focus_y: Mapped[Optional[int]] = mapped_column(Integer, default=50)

    # Archived campaigns are hidden from every member's campaign list unless the
    # list is explicitly asked to include them, and are read-only for everyone
    # (the same freeze the owner-level `locked` state applies). Archiving is
    # reversible: unarchiving restores writes and normal listing.
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    archived_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)

    # Manual display order for the resource panel's groups, interleaving the
    # built-in type groups (keys "type:book", "type:map", "type:token",
    # "type:file") with GM-defined categories (key "cat:<category_id>"). A list of
    # those keys; groups absent from the list fall to the end in their default
    # order. Empty/null means "use the default order" (categories then types).
    resource_group_order: Mapped[Optional[list[Any]]] = mapped_column(JSON, default=list)

    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)
    # Last time any user opened the campaign — drives "recently accessed" sorting.
    last_accessed_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)

    members: Mapped[list["CampaignMember"]] = relationship(
        "CampaignMember", back_populates="campaign", cascade="all, delete-orphan"
    )
    resources: Mapped[list["CampaignResource"]] = relationship(
        "CampaignResource", back_populates="campaign", cascade="all, delete-orphan"
    )
    session_notes: Mapped[list["SessionNote"]] = relationship(
        "SessionNote",
        back_populates="campaign",
        cascade="all, delete-orphan",
        order_by="SessionNote.session_date",
    )
    schedule: Mapped[Optional["CampaignSchedule"]] = relationship(
        "CampaignSchedule", back_populates="campaign", uselist=False, cascade="all, delete-orphan"
    )
    availability: Mapped[list["SessionAvailability"]] = relationship(
        "SessionAvailability", back_populates="campaign", cascade="all, delete-orphan"
    )
    wiki_pages: Mapped[list["WikiPage"]] = relationship(
        "WikiPage", back_populates="campaign", cascade="all, delete-orphan"
    )
    # Link rows have no owning-side relationship of their own, so without this the
    # campaign's wiki_pages cascade would delete pages that link rows still
    # reference, and SQLite (foreign_keys=ON) would reject the delete.
    wiki_links: Mapped[list["WikiPageLink"]] = relationship(
        "WikiPageLink",
        cascade="all, delete-orphan",
        primaryjoin="Campaign.id==WikiPageLink.campaign_id",
    )
    wiki_templates: Mapped[list["WikiTemplate"]] = relationship(
        "WikiTemplate", back_populates="campaign", cascade="all, delete-orphan"
    )
    categories: Mapped[list["CampaignCategory"]] = relationship(
        "CampaignCategory", back_populates="campaign", cascade="all, delete-orphan"
    )
    files: Mapped[list["CampaignFile"]] = relationship(
        "CampaignFile", back_populates="campaign", cascade="all, delete-orphan"
    )


class CampaignMember(Base):
    """A player invited to (or who has joined) a GM-run campaign."""

    __tablename__ = "campaign_members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    status: Mapped[Optional[str]] = mapped_column(String(20), default="invited")
    character_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Guest membership: a member backed by a guest User, which signs in with a
    # unique 10-char alphanumeric code. The code is stored like the OPDS token:
    # `_hash` is what sign-ins are matched on and `_sealed` the code encrypted
    # so the GM can share it again. Read and set it through `guest_code`.
    is_guest: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    guest_code_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    guest_code_sealed: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relative filenames under DATA_PATH/campaign_uploads/{art,tokens,sheets}/
    character_art_path: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # The character's VTT token — deliberately separate from the art above. The
    # art is a portrait for the campaign page; the token is the cropped, framed
    # disc a player drops on a battlemap, and a character routinely has one
    # without the other.
    character_token_path: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    character_sheet_path: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    character_sheet_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # original upload name
    # Alternatively, a link to an external sheet (e.g. D&D Beyond or a hosted PDF).
    character_sheet_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    @property
    def guest_code(self) -> Optional[str]:
        """The guest's sign-in code, or None (also when SECRET_KEY has changed)."""
        return token_vault.unseal(self.guest_code_sealed)

    @guest_code.setter
    def guest_code(self, code: Optional[str]) -> None:
        self.guest_code_hash = token_vault.lookup_hash(code) if code else None
        self.guest_code_sealed = token_vault.seal(code) if code else None

    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)

    campaign: Mapped["Campaign"] = relationship("Campaign", back_populates="members")

    __table_args__ = (UniqueConstraint("campaign_id", "user_id"),)


class CampaignResource(Base):
    """A book, map, token, file, or system linked to a campaign."""

    __tablename__ = "campaign_resources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)  # book | map | token | file
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False)
    # Visibility:
    #   public  — every accepted member sees it
    #   private — only the users in `shares` (plus the GM) see it
    #   gm      — only the GM (owner) sees it
    visibility: Mapped[Optional[str]] = mapped_column(String(20), default="gm")
    # Legacy flags, retained only so existing rows can be migrated to `visibility`.
    shared: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    gm_only: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    # Optional GM-defined category. When null, the resource groups under its
    # built-in type group (Books / Maps / Tokens / Files).
    category_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("campaign_categories.id"), nullable=True)
    # Manual ordering within a category/type group (drag-and-drop).
    sort_order: Mapped[Optional[int]] = mapped_column(Integer, default=0)

    campaign: Mapped["Campaign"] = relationship("Campaign", back_populates="resources")
    shares: Mapped[list["CampaignResourceShare"]] = relationship(
        "CampaignResourceShare", back_populates="resource", cascade="all, delete-orphan"
    )

    __table_args__ = (UniqueConstraint("campaign_id", "resource_type", "resource_id"),)


class SessionNote(Base):
    """Notes for a single session of a campaign."""

    __tablename__ = "session_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    session_date: Mapped[str] = mapped_column(String(10), nullable=False)
    title: Mapped[Optional[str]] = mapped_column(String(255), default="")

    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)

    campaign: Mapped["Campaign"] = relationship("Campaign", back_populates="session_notes")
    player_notes: Mapped[list["PlayerSessionNote"]] = relationship(
        "PlayerSessionNote", back_populates="session", cascade="all, delete-orphan"
    )
    gm_note: Mapped[Optional["GMSessionNote"]] = relationship(
        "GMSessionNote", back_populates="session", uselist=False, cascade="all, delete-orphan"
    )


class PlayerSessionNote(Base):
    """Per-player scratch pad for a session — readable by all, writable only by owner."""

    __tablename__ = "player_session_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("session_notes.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    content: Mapped[Optional[str]] = mapped_column(Text, default="")

    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)

    session: Mapped["SessionNote"] = relationship("SessionNote", back_populates="player_notes")

    __table_args__ = (UniqueConstraint("session_id", "user_id"),)


class GMSessionNote(Base):
    """GM-only internal notes + shared external notes for a session."""

    __tablename__ = "gm_session_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("session_notes.id"), nullable=False, unique=True)
    internal_content: Mapped[Optional[str]] = mapped_column(Text, default="")
    external_content: Mapped[Optional[str]] = mapped_column(Text, default="")

    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)

    session: Mapped["SessionNote"] = relationship("SessionNote", back_populates="gm_note")


class CampaignSchedule(Base):
    """Recurrence definition for a GM campaign's sessions."""

    __tablename__ = "campaign_schedules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaigns.id"), nullable=False, unique=True)
    definition: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)
    # When disabled the definition is preserved but the schedule is treated as
    # inactive (no next session, no availability chart).
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)

    campaign: Mapped["Campaign"] = relationship("Campaign", back_populates="schedule")


class SessionAvailability(Base):
    """A player's (or GM's) availability for a specific session date."""

    __tablename__ = "session_availability"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    session_date: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[Optional[str]] = mapped_column(String(20), default="available")
    is_cancelled: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)

    campaign: Mapped["Campaign"] = relationship("Campaign", back_populates="availability")

    __table_args__ = (UniqueConstraint("campaign_id", "user_id", "session_date"),)


class WikiPage(Base):
    """A markdown wiki page in a campaign — the campaign-building notebook.

    visibility:
      - gm:      only the campaign owner can see it
      - group:   all accepted members can see it
      - members: only the owner and the users in `shares` can see it
    """

    __tablename__ = "wiki_pages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Normalized title used to resolve [[wiki links]]; unique within a campaign.
    slug: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    body: Mapped[Optional[str]] = mapped_column(Text, default="")
    visibility: Mapped[Optional[str]] = mapped_column(String(20), default="gm")  # gm | group | members
    page_type: Mapped[Optional[str]] = mapped_column(String(20), default="note")  # note | session
    session_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD for session pages
    created_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    # Parent page for nesting. When null, the page sits at the wiki's top level.
    # Replaces the old flat note-category grouping: a "category" is now just a page
    # whose children nest under it, to arbitrary depth.
    parent_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("wiki_pages.id"), nullable=True)
    # Deprecated: legacy flat note-category grouping. Retained only so the one-time
    # note-category -> parent-page migration can read it; new code uses parent_id.
    category_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("campaign_categories.id"), nullable=True)
    # Optional icon shown in the page list: either a curated Lucide key (e.g.
    # "user", "swords") or a literal emoji. Emoji are stored as-is and rendered
    # as text; anything else is resolved against the curated Lucide set.
    icon: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    # Optional icon tint: a preset palette token (e.g. "red") or a "#rrggbb"
    # literal. Null means "inherit the row's text colour".
    icon_color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    # Manual ordering within the page list (drag-and-drop).
    sort_order: Mapped[Optional[int]] = mapped_column(Integer, default=0)

    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)

    campaign: Mapped["Campaign"] = relationship("Campaign", back_populates="wiki_pages")
    shares: Mapped[list["WikiPageShare"]] = relationship(
        "WikiPageShare", back_populates="page", cascade="all, delete-orphan"
    )
    # Per-user "hidden from my view" rows. Cascaded so deleting a page doesn't
    # strand rows pointing at it.
    hidden_by: Mapped[list["WikiPageHidden"]] = relationship("WikiPageHidden", cascade="all, delete-orphan")
    # Nesting: gives the unit of work an ordering constraint so a parent is never
    # deleted before its children. Deleting a single page re-parents its children
    # first (see routers/campaigns/wiki.py), so this cascade only bites when the
    # whole subtree is going away with the campaign.
    parent: Mapped[Optional["WikiPage"]] = relationship(
        "WikiPage", remote_side="WikiPage.id", back_populates="children"
    )
    children: Mapped[list["WikiPage"]] = relationship(
        "WikiPage", back_populates="parent", cascade="all, delete-orphan"
    )
    # Both link sides, so a page's link rows go before the page itself. `overlaps`
    # is required: these and Campaign.wiki_links manage the same rows.
    outgoing_links: Mapped[list["WikiPageLink"]] = relationship(
        "WikiPageLink",
        cascade="all, delete-orphan",
        primaryjoin="WikiPage.id==WikiPageLink.source_page_id",
        overlaps="wiki_links",
    )
    incoming_links: Mapped[list["WikiPageLink"]] = relationship(
        "WikiPageLink",
        cascade="all, delete-orphan",
        primaryjoin="WikiPage.id==WikiPageLink.target_page_id",
        overlaps="wiki_links,outgoing_links",
    )

    __table_args__ = (UniqueConstraint("campaign_id", "slug"),)


class WikiTemplate(Base):
    """A reusable starting point for a wiki page, owned by one campaign.

    Templates are per-campaign rather than global: they are small markdown
    files, so a copy per campaign costs almost nothing, and it means a GM can
    edit a downloaded template freely without touching anyone else's copy.

    A template arrives one of three ways — downloaded from a community
    repository, uploaded as a `.md` file, or written in the app — and
    `source_id` / `source_url` record the first of those so a downloaded
    template can be traced back (and re-downloaded) later. Both are null for a
    template the GM authored.
    """

    __tablename__ = "wiki_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Free text, mirroring the community manifest's fields. Both may be empty:
    # a system-agnostic template has no system, and an uncategorised one falls
    # under "General" in the browser.
    system: Mapped[Optional[str]] = mapped_column(String(255), default="")
    category: Mapped[Optional[str]] = mapped_column(String(255), default="")
    description: Mapped[Optional[str]] = mapped_column(Text, default="")
    # The markdown page body, including its YAML frontmatter.
    body: Mapped[Optional[str]] = mapped_column(Text, default="")
    # Provenance for a downloaded template: the community id (e.g. "5e-spell")
    # and the URL it came from. Null for authored/uploaded templates.
    source_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_version: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    sort_order: Mapped[Optional[int]] = mapped_column(Integer, default=0)

    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)

    campaign: Mapped["Campaign"] = relationship("Campaign", back_populates="wiki_templates")


class WikiPageShare(Base):
    """A user a `members`-visibility ("Private") wiki page is shared with.

    The row's existence grants *read*; `can_write` upgrades it to read+write.
    Write always implies read, so there is no write-without-read state to
    represent — revoking read means deleting the row outright.

    Rows predating `can_write` default to read-only, which is what they granted
    before per-user write existed.
    """

    __tablename__ = "wiki_page_shares"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    page_id: Mapped[str] = mapped_column(String(36), ForeignKey("wiki_pages.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    can_write: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)

    page: Mapped["WikiPage"] = relationship("WikiPage", back_populates="shares")

    __table_args__ = (UniqueConstraint("page_id", "user_id"),)


class WikiPageHidden(Base):
    """A wiki page one user has hidden from their own view.

    Purely per-user decluttering, not a permission: hiding is available on any
    page the user can see, including one they cannot edit, and it changes
    nothing for anybody else. Hiding a parent hides its whole subtree, which is
    derived at read time from `parent_id` rather than stored per descendant — so
    a page moved out of a hidden subtree reappears on its own.
    """

    __tablename__ = "wiki_page_hidden"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    page_id: Mapped[str] = mapped_column(String(36), ForeignKey("wiki_pages.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)

    __table_args__ = (UniqueConstraint("page_id", "user_id"),)


class WikiPageLink(Base):
    """A resolved [[wiki link]] from one page to another, for backlinks.

    Rebuilt from the source page's body on every save.
    """

    __tablename__ = "wiki_page_links"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    source_page_id: Mapped[str] = mapped_column(String(36), ForeignKey("wiki_pages.id"), nullable=False, index=True)
    target_page_id: Mapped[str] = mapped_column(String(36), ForeignKey("wiki_pages.id"), nullable=False, index=True)

    __table_args__ = (UniqueConstraint("source_page_id", "target_page_id"),)


class CampaignCategory(Base):
    """A GM-defined grouping for either wiki pages or linked resources.

    `kind` keeps the two namespaces separate: a note category never holds a
    resource and vice-versa. `sort_order` is GM-rearrangeable.
    """

    __tablename__ = "campaign_categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # note | resource
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Optional icon shown beside the category — a curated Lucide key or an emoji.
    icon: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    # Optional icon tint: a preset palette token or a "#rrggbb" literal.
    icon_color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    sort_order: Mapped[Optional[int]] = mapped_column(Integer, default=0)

    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)

    campaign: Mapped["Campaign"] = relationship("Campaign", back_populates="categories")


class CampaignResourceShare(Base):
    """A user a `private`-visibility resource is shared with."""

    __tablename__ = "campaign_resource_shares"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    resource_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaign_resources.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)

    resource: Mapped["CampaignResource"] = relationship("CampaignResource", back_populates="shares")

    __table_args__ = (UniqueConstraint("resource_id", "user_id"),)


class CampaignFile(Base):
    """A GM-uploaded file attached to a campaign, stored under DATA_PATH.

    Surfaced as a linked resource via CampaignResource(resource_type='file',
    resource_id=<this id>). Not part of the shared library.
    """

    __tablename__ = "campaign_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    stored_path: Mapped[str] = mapped_column(String(255), nullable=False)  # relative filename on disk
    filename: Mapped[str] = mapped_column(String(255), nullable=False)  # original upload name
    mime_type: Mapped[Optional[str]] = mapped_column(String(100), default="application/octet-stream")
    size_bytes: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    # True for image uploads (PNG/JPEG/WebP/GIF), so the UI can render them inline
    # (e.g. embedded in a wiki note) and show a thumbnail instead of a file card.
    is_image: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    uploaded_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)

    campaign: Mapped["Campaign"] = relationship("Campaign", back_populates="files")
