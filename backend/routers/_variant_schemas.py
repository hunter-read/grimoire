"""Response-schema pieces shared by every collection that supports variants.

Books, maps, tokens, and audio all expose the same two shapes — a count on list
rows and the full family on a detail response — so they are defined once here
rather than four times. See `services/variants.py` for the rules behind them.
"""
from typing import Optional

from pydantic import BaseModel


class VariantEntry(BaseModel):
    """One row of a version picker: another copy of the same thing.

    Mirrors `services.variants.serialize_variant`. The collection-specific
    fields are optional rather than branching this model per resource type —
    a map has no page count, a token has no title.
    """

    id: str
    kind: str
    label: str
    filename: str
    relative_path: str
    file_size: int
    is_missing: bool
    title: Optional[str] = None
    page_count: Optional[int] = None
    mime_type: Optional[str] = None


class VariantCountMixin(BaseModel):
    """List-row field: how many other versions collapse into this entry.

    0 for most items. Drives the "has other versions" badge, and is filled from
    one grouped query per page rather than a lookup per row.
    """

    variant_count: int = 0


class VariantFamilyMixin(BaseModel):
    """Detail-response fields: where this item sits in its variant family.

    `variant_main_id` is the item that represents the family in listings — the
    item itself unless it is a variant. `variants` is the full sibling list, so
    a viewer can render its picker without a second request; it is empty for an
    item that has no other versions.
    """

    variant_parent_id: Optional[str] = None
    variant_kind: str = ""
    variant_label: str = ""
    variant_main_id: Optional[str] = None
    variants: list[VariantEntry] = []
