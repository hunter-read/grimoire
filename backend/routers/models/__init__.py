"""3D models package — registers all model routes on a single router."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from .._bulk_schemas import BulkResult, BulkTagResult
from ._schemas import (
    FolderTagsOut,
    Model3DDetailResponse,
    Model3DFoldersResponse,
    Model3DListResponse,
    StatusResponse,
)
from .core import (
    bulk_add_model_tags,
    bulk_update_model_folders,
    bulk_update_models,
    get_model,
    list_model_folders,
    list_models,
    serve_model_file,
    serve_model_thumbnail,
    update_model,
    update_model_folder,
)

router = APIRouter(tags=["models"])

# Browsing the whole model library is blocked for guests. Serving an individual
# model/thumbnail by id is allowed, but the get/file/thumbnail handlers enforce
# access themselves (via assert_media_access): guests are limited to models
# shared into their campaign, and explicit models are gated on allow_explicit.
router.add_api_route(
    "/models",
    list_models,
    methods=["GET"],
    summary="List 3D models",
    description="Returns a paginated list of 3D models.",
    dependencies=[Depends(require_not_guest)],
    response_model=Model3DListResponse,
)
router.add_api_route(
    "/model-folders",
    list_model_folders,
    methods=["GET"],
    summary="List model folders",
    description="Returns all known model folder paths and their associated tags.",
    dependencies=[Depends(require_not_guest)],
    response_model=Model3DFoldersResponse,
)
router.add_api_route(
    "/model-folders",
    update_model_folder,
    methods=["PATCH"],
    summary="Set tags on a model folder",
    description="Creates or replaces the tag list for a folder path. GM or admin role required.",
    response_model=FolderTagsOut,
)
router.add_api_route(
    "/models/{model_id}",
    get_model,
    methods=["GET"],
    summary="Get a 3D model",
    description=(
        "Returns full model metadata including folder tags, mesh size, the "
        "presupported/unsupported flag, and whether the browser viewer can "
        "render this file."
    ),
    response_model=Model3DDetailResponse,
)
router.add_api_route(
    "/models/{model_id}/file",
    serve_model_file,
    methods=["GET"],
    summary="Download model file",
    description="Streams the original mesh file. Also the source the 3D viewer loads.",
)
router.add_api_route(
    "/models/{model_id}/thumbnail",
    serve_model_thumbnail,
    methods=["GET"],
    summary="Model thumbnail",
    description=(
        "Returns the pregenerated WebP thumbnail for a model. 404 if not yet "
        "generated, or for a format that cannot be rendered server-side."
    ),
)
router.add_api_route(
    "/models/{model_id}",
    update_model,
    methods=["PATCH"],
    summary="Update model metadata",
    description=(
        "Updates editable fields on a model (description, tags, is_explicit, "
        "is_supported). GM or admin role required."
    ),
    response_model=StatusResponse,
)
# Bulk routes (issue #270). Applying a selection one PATCH per item raced on tag
# creation and 500'd; these take the whole batch in one transaction.
router.add_api_route(
    "/models/bulk",
    bulk_update_models,
    methods=["POST"],
    summary="Bulk update models",
    description=(
        "Applies per-model edits for many models in one transaction. "
        "Body: {items: [{id, description?, tags?, is_explicit?, is_supported?}]}. "
        "Unknown ids are reported in `errors` and skipped. GM or admin role required."
    ),
    response_model=BulkResult,
)
router.add_api_route(
    "/models/bulk/tags",
    bulk_add_model_tags,
    methods=["POST"],
    summary="Bulk add tags to models",
    description=(
        "Additively applies tags to many models in one transaction. "
        "Body: {ids: [...], tags: [...]}. GM or admin role required."
    ),
    response_model=BulkTagResult,
)
router.add_api_route(
    "/model-folders/bulk",
    bulk_update_model_folders,
    methods=["POST"],
    summary="Bulk set model folder tags",
    description=(
        "Sets tags on many model folders in one transaction. "
        "Body: {folders: [{path, tags}]}. GM or admin role required."
    ),
    response_model=Model3DFoldersResponse,
)
