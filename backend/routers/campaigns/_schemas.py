"""Pydantic request schemas for the campaigns package."""

from typing import Optional, List
from pydantic import BaseModel


class CampaignCreate(BaseModel):
    name: str
    description: str = ""
    is_gm_campaign: bool = False
    gm_title: str = "Game Master"
    parent_campaign_id: Optional[str] = None
    system_id: Optional[str] = None


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    gm_title: Optional[str] = None
    system_id: Optional[str] = None
    parent_campaign_id: Optional[str] = None


class InvitePayload(BaseModel):
    user_id: str


class MemberStatusUpdate(BaseModel):
    status: Optional[str] = None  # accepted | declined
    character_name: Optional[str] = None


class ResourceAdd(BaseModel):
    resource_type: str  # book | map | token
    resource_id: str
    shared: bool = False


class ResourceUpdate(BaseModel):
    shared: bool


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


class AvailabilityUpdate(BaseModel):
    status: str  # available | tentative | unavailable
    is_cancelled: Optional[bool] = None  # GM only
    user_id: Optional[int] = None  # GM/admin only — set another member's availability
