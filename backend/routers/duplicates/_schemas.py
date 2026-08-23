"""Request and response models for duplicate resolution."""
from typing import Literal, Optional

from pydantic import BaseModel, Field

from .._variant_schemas import VariantEntry

# The four collections that can hold duplicates of each other. A map can never
# be a variant of a book, so every request names exactly one of these and the
# handler resolves it to a single model.
ResourceType = Literal["book", "map", "token", "audio"]


class LinkChild(BaseModel):
    """One item to file under a parent, with the label the picker will show."""

    id: str
    # Validated against models.variants.VARIANT_KINDS by the service, not here,
    # so the error message can list the accepted values.
    kind: str
    label: str = ""


class LinkRequest(BaseModel):
    resource_type: ResourceType
    parent_id: str
    # Capped for the same reason bulk updates are: one request should not be
    # able to restructure an entire library.
    children: list[LinkChild] = Field(..., min_length=1, max_length=20)


class PromoteRequest(BaseModel):
    """Hand an existing family a different main version.

    ``kind``/``label`` describe the *old* parent once it becomes a variant —
    the copy being demoted is the one that now needs describing.
    """

    resource_type: ResourceType
    new_parent_id: str
    old_parent_id: str
    kind: str = "other"
    label: str = ""


class PromoteResult(BaseModel):
    new_parent_id: str
    moved: int = 0


class LinkResult(BaseModel):
    """Per-item outcome, mirroring the bulk-update contract.

    A bad id in a batch skips that one item rather than failing the request, so
    the user keeps the links that were valid.
    """

    parent_id: str
    linked: list[str]
    errors: list[dict] = []


class UnlinkRequest(BaseModel):
    resource_type: ResourceType
    # Either specific children, or every child of a parent.
    ids: list[str] = []
    parent_id: Optional[str] = None


class UnlinkResult(BaseModel):
    unlinked: list[str]


class MergeMetadataRequest(BaseModel):
    resource_type: ResourceType
    source_id: str
    target_id: str
    # Explicit rather than "everything": copying blindly is how you lose the
    # good record's title to the bad one's.
    fields: list[str] = Field(..., min_length=1)
    # False fills only fields that are empty on the target.
    overwrite: bool = False


class MergeMetadataResult(BaseModel):
    updated: list[str]
    skipped: list[str]


class DeleteItemRequest(BaseModel):
    """``reparent_to`` is required when the item being deleted has variants.

    Empty string means "promote them all to standalone entries"; an id names
    which variant inherits the others. Both are explicit so deleting a parent can
    never silently hide its children.
    """

    delete_file: bool = True
    reparent_to: Optional[str] = None


class DeleteItemResult(BaseModel):
    id: str
    path: str
    file_deleted: bool
    reparented: int = 0


class CompareItem(BaseModel):
    """One side of a side-by-side comparison."""

    id: str
    filename: str
    relative_path: str
    file_size: int
    content_hash: Optional[str] = None
    has_thumbnail: bool = False
    is_missing: bool = False
    created_at: Optional[str] = None
    title: Optional[str] = None
    page_count: Optional[int] = None
    mime_type: Optional[str] = None
    game_system_id: Optional[str] = None
    game_system_name: Optional[str] = None
    description: Optional[str] = None
    tags: list[str] = []
    # What the filesystem cannot tell you and the decision usually turns on:
    # how much user work is attached to this copy.
    reference_counts: dict[str, int] = {}
    variant_parent_id: Optional[str] = None
    variant_kind: str = ""
    variants: list[VariantEntry] = []


class CompareDifference(BaseModel):
    field: str
    values: list[Optional[str]]
    same: bool


class CompareResult(BaseModel):
    resource_type: ResourceType
    items: list[CompareItem]
    differences: list[CompareDifference]
    # How far a synced page-flip can go before one side runs out.
    page_count_min: int = 0
    suggested_parent_id: Optional[str] = None


class ScanRequest(BaseModel):
    """Which collections to scan, and how hard to look.

    Empty ``resource_types`` means all four. ``accuracy`` trades certainty for
    reach: ``exact`` finds only byte-identical files and never a false positive,
    while the looser levels take longer and return matches that need judging.
    """

    resource_types: list[ResourceType] = []
    accuracy: Literal["exact", "high", "medium", "low"] = "medium"


class ScanStatus(BaseModel):
    running: bool = False
    phase: Optional[str] = None
    accuracy: Optional[str] = None
    resource_type: Optional[str] = None
    scanned: int = 0
    total: int = 0
    groups_found: int = 0
    scan_id: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    error: Optional[str] = None


class ScanTriggerResult(BaseModel):
    status: str


class GroupMember(BaseModel):
    """One candidate inside a group, with everything the review row shows."""

    id: str
    filename: str
    relative_path: str
    file_size: int = 0
    title: Optional[str] = None
    page_count: Optional[int] = None
    has_thumbnail: bool = False
    is_missing: bool = False
    game_system_name: Optional[str] = None
    content_hash: Optional[str] = None
    suggested_kind: str = "other"
    suggested_label: str = ""
    reference_counts: dict[str, int] = {}


class CompareResponse(BaseModel):
    """The side-by-side payload: two-to-four items, their diff, and what can be copied."""

    resource_type: str
    items: list[dict] = []
    differences: list[dict] = []
    mergeable_fields: list[str] = []
    page_count_min: int = 0
    suggested_parent_id: Optional[str] = None


class GroupEdge(BaseModel):
    """One pairwise match inside a group — the unit review actually works in."""

    a: str
    b: str
    reason: str = ""
    score: float = 0.0


class DuplicateGroupOut(BaseModel):
    id: str
    resource_type: str
    confidence: float
    reasons: list[str] = []
    reason_text: str = ""
    suggested_parent_id: Optional[str] = None
    members: list[GroupMember] = []
    edges: list[GroupEdge] = []


class GroupListResponse(BaseModel):
    scan_id: Optional[str] = None
    total: int = 0
    groups: list[DuplicateGroupOut] = []


class DismissRequest(BaseModel):
    resource_type: ResourceType
    member_ids: list[str] = Field(..., min_length=2)
    note: str = ""


class DismissalOut(BaseModel):
    id: str
    resource_type: str
    member_ids: list[str] = []
    note: str = ""
    created_at: Optional[str] = None
    member_names: list[str] = []


class DismissalListResponse(BaseModel):
    dismissals: list[DismissalOut] = []
