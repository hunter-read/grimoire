"""Request and response models for the GM screen (``gm_screen.py``)."""
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Requests
# --------------------------------------------------------------------------- #


class GmPanelCreate(BaseModel):
    """A new panel. Without a position it goes into the first gap it fits."""

    kind: str = Field(max_length=30)
    title: Optional[str] = Field(default=None, max_length=500)
    x: Optional[int] = None
    y: Optional[int] = None
    w: Optional[int] = None
    h: Optional[int] = None
    config: Optional[dict[str, Any]] = None
    state: Optional[dict[str, Any]] = None


class GmPanelUpdate(BaseModel):
    """A partial update: only what is given changes. ``state`` replaces the
    panel's state whole, cleaned against its config."""

    title: Optional[str] = Field(default=None, max_length=500)
    x: Optional[int] = None
    y: Optional[int] = None
    w: Optional[int] = None
    h: Optional[int] = None
    config: Optional[dict[str, Any]] = None
    state: Optional[dict[str, Any]] = None


class GmLayoutCell(BaseModel):
    id: str = Field(max_length=36)
    x: int
    y: int
    w: int
    h: int


class GmLayoutUpdate(BaseModel):
    """Every panel a drag moved, in one write: moving one panel can push others."""

    panels: list[GmLayoutCell] = Field(max_length=60)


class GmResetRequest(BaseModel):
    scope: Literal["scene", "session", "rest"]


class GmCopyRequest(BaseModel):
    """Copy another campaign's board. ``replace`` False adds it below this one."""

    source_campaign_id: str = Field(max_length=36)
    replace: bool = True


class GmImportRequest(BaseModel):
    """A board document, as exported from a campaign or written for the catalogue."""

    document: dict[str, Any]
    replace: bool = True


class GmApplyPresetRequest(BaseModel):
    preset_id: str = Field(max_length=100)
    # Which catalogue, when two offer a preset of the same id.
    index_url: Optional[str] = Field(default=None, max_length=1000)
    replace: bool = True


# --------------------------------------------------------------------------- #
# Responses
# --------------------------------------------------------------------------- #


class GmPanelOut(BaseModel):
    id: str
    kind: str
    title: str
    x: int
    y: int
    w: int
    h: int
    config: dict[str, Any]
    state: dict[str, Any]
    updated_at: Optional[str] = None


class GmScreenOut(BaseModel):
    panels: list[GmPanelOut]


class GmSourceCampaign(BaseModel):
    id: str
    name: str
    panel_count: int


class GmSourcesOut(BaseModel):
    """Other campaigns this GM runs that have a board to copy."""

    campaigns: list[GmSourceCampaign]


class GmBoardExport(BaseModel):
    format: str
    name: str
    panels: list[dict[str, Any]]


class GmPreset(BaseModel):
    id: str
    name: str
    version: str
    system: str
    description: str
    author: str
    author_url: str
    license: str
    panel_count: int
    index_url: str


class GmCatalogueError(BaseModel):
    url: str
    error: str


class GmPresetListOut(BaseModel):
    presets: list[GmPreset]
    errors: list[GmCatalogueError]


class GmPartyField(BaseModel):
    """A value the party overview can show: a sheet field or a computed value."""

    name: str
    label: str
    type: str
    # "field" can be edited where the player lets the GM; "computed" reads only.
    source: Literal["field", "computed"]


class GmPartyCharacter(BaseModel):
    id: str
    name: str
    user_id: str
    owner_name: str
    status: str
    # The GM may change this character's values: their own, or one whose
    # player let the campaign's GM edit it.
    editable: bool
    schema_ref: str
    schema_name: str
    portrait_path: Optional[str] = None
    portrait_version: Optional[int] = None
    portrait_crop: Optional[dict[str, Any]] = None
    # The character's scalar fields and computed values, by name.
    values: dict[str, Any]


class GmPartyOut(BaseModel):
    characters: list[GmPartyCharacter]
    fields: list[GmPartyField]
