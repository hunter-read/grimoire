"""Shared request/response schemas for the ``POST /api/<collection>/bulk``
endpoints (issue #270).

Each collection has its own ``<X>Update`` model with its own editable fields, so
the per-item shape is built per router via :func:`bulk_update_model`. The
tag-only envelope (:class:`BulkAddTags`) is identical everywhere and is shared
directly.
"""
from pydantic import BaseModel, Field, field_validator

from ..services import tag_service
from ..services.bulk_service import MAX_BULK_ITEMS


class BulkAddTags(BaseModel):
    """Additively apply ``tags`` to every id in ``ids``.

    Backs the bulk action bar's tag input. Additive by design: it never removes
    tags an item already carries.
    """

    ids: list[str] = Field(..., min_length=1, max_length=MAX_BULK_ITEMS)
    tags: list[str] = Field(..., min_length=1)

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        # Display casing is preserved; the service lowercases only the match key.
        return tag_service.dedupe_tags(v)


class BulkFolderTags(BaseModel):
    """Set tags on many folder paths at once (maps/tokens/audio folder tagging)."""

    folders: list["FolderTagsEntry"] = Field(..., min_length=1, max_length=MAX_BULK_ITEMS)


class FolderTagsEntry(BaseModel):
    path: str
    tags: list[str]

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        return tag_service.dedupe_tags(v)


BulkFolderTags.model_rebuild()


def bulk_update_model(update_model: type[BaseModel], name: str) -> type[BaseModel]:
    """Build the ``{items: [{id, ...fields}]}`` request model for a collection.

    ``update_model`` is the collection's existing single-item PATCH schema, so
    the bulk endpoint accepts exactly the fields (and reuses exactly the
    validators) its PATCH counterpart does — the two can't drift.
    """
    item = type(
        f"{name}BulkItem",
        (update_model,),
        {"__annotations__": {"id": str}, "__doc__": f"One {name} entry in a bulk update."},
    )
    envelope = type(
        f"{name}BulkUpdate",
        (BaseModel,),
        {
            "__annotations__": {"items": list[item]},  # type: ignore[valid-type]
            "items": Field(..., min_length=1, max_length=MAX_BULK_ITEMS),
            "__doc__": f"A batch of {name} updates applied in one transaction.",
        },
    )
    return envelope


# Response shape shared by every bulk endpoint, documented once here:
#   {"updated": [id, ...], "errors": [{"id": ..., "detail": ...}, ...]}
# ``run_bulk_add_tags`` additionally returns ``tags`` keyed by id.
class BulkItemError(BaseModel):
    id: str
    detail: str


class BulkResult(BaseModel):
    """``run_bulk_update``'s response: no ``tags`` key.

    Kept separate from :class:`BulkTagResult` rather than carrying an optional
    ``tags`` field, because an ``Optional`` field is *materialised* as an
    explicit ``tags: null`` by the response serializer — adding a key these
    endpoints never returned. Use :class:`BulkTagResult` for the add-tags
    routes, which really do return it.
    """

    updated: list[str]
    errors: list[BulkItemError]


class BulkTagResult(BulkResult):
    """``run_bulk_add_tags``'s response: the base shape plus per-id display tags."""

    tags: dict[str, list[str]]
