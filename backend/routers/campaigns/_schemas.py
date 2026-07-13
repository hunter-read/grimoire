"""Pydantic request schemas for the campaigns package."""

from typing import Optional, List
from pydantic import BaseModel


class CampaignResourceInput(BaseModel):
    resource_type: str  # book | map | token | audio | file
    resource_id: str
    visibility: str = "gm"  # public | private | gm
    shared_user_ids: Optional[List[str]] = None  # for private visibility


class CampaignCreate(BaseModel):
    name: str
    description: str = ""
    is_gm_campaign: bool = False
    gm_title: str = "Game Master"
    parent_campaign_id: Optional[str] = None
    system_id: Optional[str] = None
    system_name: Optional[str] = None  # free text for a system not in the library
    # Explicit resources chosen in the create wizard. When omitted (None), no
    # resources are linked. An empty list also links nothing.
    resources: Optional[List[CampaignResourceInput]] = None


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    gm_title: Optional[str] = None
    system_id: Optional[str] = None
    system_name: Optional[str] = None  # "" clears it
    parent_campaign_id: Optional[str] = None


class InvitePayload(BaseModel):
    user_id: str


class GuestCreate(BaseModel):
    nickname: str = ""


class MemberStatusUpdate(BaseModel):
    status: Optional[str] = None  # accepted | declined
    character_name: Optional[str] = None
    character_sheet_url: Optional[str] = None  # "" clears it


class ResourceAdd(BaseModel):
    resource_type: str  # book | map | token | audio | file
    resource_id: str
    visibility: str = "gm"  # public | private | gm
    shared_user_ids: Optional[List[str]] = None  # for private visibility
    category_id: Optional[str] = None


class ResourceUpdate(BaseModel):
    visibility: Optional[str] = None  # public | private | gm
    shared_user_ids: Optional[List[str]] = None
    # Use the sentinel "" to clear the category (move back to the built-in type group).
    category_id: Optional[str] = None


class ResourceBulkAdd(BaseModel):
    resources: List[ResourceAdd]


class ResourceReorder(BaseModel):
    ordered_ids: List[str]


class CategoryCreate(BaseModel):
    name: str
    kind: str  # note | resource
    icon: Optional[str] = None  # Lucide icon name


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None  # "" clears it


class CategoryReorder(BaseModel):
    # Ordered list of category ids defining the new sort order.
    ordered_ids: List[str]


class ResourceGroupOrder(BaseModel):
    # Ordered list of group keys ("type:book"/"type:map"/"type:token"/"type:audio"/"type:file"
    # and "cat:<category_id>") defining the resource panel's group display order.
    ordered_keys: List[str]


class SessionNoteCreate(BaseModel):
    session_date: str  # YYYY-MM-DD
    title: str = ""


class SessionNoteUpdate(BaseModel):
    title: Optional[str] = None


class PlayerNoteUpdate(BaseModel):
    content: str


class GMNoteUpdate(BaseModel):
    internal_content: Optional[str] = None
    external_content: Optional[str] = None


class ScheduleUpsert(BaseModel):
    days: List[int] = []  # weekday indices (0=Mon … 6=Sun); empty for custom
    frequency: str = "weekly"  # weekly | biweekly | monthly | custom
    time_utc: Optional[str] = None  # "HH:MM" UTC
    biweekly_reference: Optional[str] = None  # YYYY-MM-DD anchor for biweekly
    monthly_week: Optional[int] = None  # 1-4 or -1 (last) for monthly
    custom_dates: Optional[List[str]] = None  # ["YYYY-MM-DD", ...] for custom
    enabled: bool = True  # when False the definition is kept but inactive


class AvailabilityUpdate(BaseModel):
    status: str  # available | tentative | unavailable
    is_cancelled: Optional[bool] = None  # GM only
    user_id: Optional[int] = None  # GM/admin only — set another member's availability


class WikiPageCreate(BaseModel):
    title: str = ""
    body: str = ""
    visibility: str = "gm"  # gm | group | members
    page_type: str = "note"  # note | session
    session_date: Optional[str] = None  # YYYY-MM-DD for session pages
    shared_user_ids: Optional[List[str]] = None  # for members visibility
    parent_id: Optional[str] = None  # nest under another page; null/"" = top level
    icon: Optional[str] = None  # Lucide icon name


class WikiPageUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    visibility: Optional[str] = None
    page_type: Optional[str] = None
    session_date: Optional[str] = None
    shared_user_ids: Optional[List[str]] = None
    # Use the sentinel "" to move the page back to the top level (no parent).
    parent_id: Optional[str] = None
    icon: Optional[str] = None  # "" clears it


class WikiReorder(BaseModel):
    ordered_ids: List[str]
