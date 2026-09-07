"""Pydantic schemas for the 3D models API."""
from typing import Optional

from pydantic import BaseModel, field_validator

from ...services import tag_service
from .._bulk_schemas import bulk_update_model
from .._variant_schemas import VariantCountMixin, VariantFamilyMixin


class Model3DUpdate(BaseModel):
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    is_explicit: Optional[bool] = None
    # Editable because the scan can only infer it from the filename and folder.
    # A library that does not follow the naming convention leaves every model at
    # None, and a file that moved between a Presupported/ and an Unsupported/
    # folder keeps the flag it was first scanned with — so the user needs a way
    # to say what a file actually is.
    is_supported: Optional[bool] = None

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        return tag_service.dedupe_tags(v) if v is not None else v


# Batch form: {"items": [{"id": ..., ...Model3DUpdate fields}]}.
Model3DBulkUpdate = bulk_update_model(Model3DUpdate, "Model3D")


class FolderTagsUpdate(BaseModel):
    path: str
    tags: list[str]

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        # Keep the entered casing (dedupe by key); the folder-update handler
        # registers catalog rows with this casing and stores internal keys.
        return tag_service.dedupe_tags(v)


class Model3DOut(VariantCountMixin):
    """One model, as returned by the list endpoint.

    ``is_presupported``/``is_unsupported`` are derived from the tri-state
    ``is_supported`` column rather than exposing it directly: the gallery's badge
    system shows a badge for any truthy value, so a single tri-state field would
    render "presupported" and then nothing at all for both the unsupported and
    the unknown case — losing the distinction that matters most here. Two plain
    booleans, both false when unknown, say it unambiguously.
    """

    id: str
    filename: str
    relative_path: str
    description: Optional[str] = None
    tags: list[str]
    file_size: Optional[int] = None
    triangle_count: Optional[int] = None
    has_thumbnail: Optional[bool] = None
    is_explicit: bool
    is_missing: bool
    is_archive: bool
    is_presupported: bool
    is_unsupported: bool


class Model3DListResponse(BaseModel):
    total: int
    models: list[Model3DOut]


class Model3DDetailResponse(Model3DOut, VariantFamilyMixin):
    """``GET /models/{id}`` — metadata, folder context, and viewer capability.

    ``viewer_loader`` names the frontend loader for this format ("stl", "gltf",
    …) and is empty for a format with no viewer. It comes from the backend's
    format table so the extension→loader mapping has one home rather than being
    mirrored by hand in the client.

    ``viewer_available`` is the question the detail view actually asks: it is
    false for a format with no loader *and* for a mesh too large to hand a
    browser, so the client can offer a download instead of hanging a tab.

    ``viewer_oversized`` splits that second case back out. When it is true the
    file is a supported format held back only by its size, so the client offers
    to load it anyway behind a warning; when it is false alongside a false
    ``viewer_available`` the format simply has no loader and a download is the
    only option.
    """

    folder_path: str
    folder_tags: list[str]
    is_supported: Optional[bool] = None
    viewer_loader: str = ""
    viewer_available: bool = False
    viewer_oversized: bool = False


class FolderTagsOut(BaseModel):
    """One folder path and its tags.

    Note the list/update endpoints differ: ``GET /model-folders`` returns display
    tags, while the PATCH/bulk writes echo back the stored internal keys.
    """

    path: str
    tags: list[str]


class Model3DFoldersResponse(BaseModel):
    folders: list[FolderTagsOut]


class StatusResponse(BaseModel):
    status: str
