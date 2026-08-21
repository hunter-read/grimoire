"""Audio package — registers all audio routes on a single router."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from .._bulk_schemas import BulkResult, BulkTagResult
from .core import (
    list_audio,
    list_audio_folders,
    update_audio_folder,
    bulk_update_audio_folders,
    get_audio,
    serve_audio_file,
    serve_audio_artwork,
    update_audio,
    bulk_update_audio,
    bulk_add_audio_tags,
)
from .covers import (
    delete_audio_cover,
    serve_audio_cover,
    set_audio_cover_from_source,
    upload_audio_cover,
)
from ._schemas import (
    AudioCoverResponse,
    AudioDetailResponse,
    AudioFoldersResponse,
    AudioListResponse,
    FolderTagsOut,
    StatusResponse,
)

router = APIRouter(tags=["audio"])

# Browsing the whole audio library is blocked for guests. Serving an individual
# track/artwork by id is allowed, but the get/file/artwork handlers enforce access
# themselves (via assert_media_access): guests are limited to tracks shared into
# their campaign.
router.add_api_route(
    "/audio",
    list_audio,
    methods=["GET"],
    summary="List audio",
    description="Returns a paginated list of audio tracks.",
    dependencies=[Depends(require_not_guest)],
    response_model=AudioListResponse,
)
router.add_api_route(
    "/audio-folders",
    list_audio_folders,
    methods=["GET"],
    summary="List audio folders",
    description="Returns all known audio folder paths and their associated tags.",
    dependencies=[Depends(require_not_guest)],
    response_model=AudioFoldersResponse,
)
router.add_api_route(
    "/audio-folders",
    update_audio_folder,
    methods=["PATCH"],
    summary="Set tags on an audio folder",
    description="Creates or replaces the tag list for a folder path. GM or admin role required.",
    response_model=FolderTagsOut,
)
router.add_api_route(
    "/audio/{audio_id}",
    get_audio,
    methods=["GET"],
    summary="Get an audio track",
    description="Returns full track metadata including duration, embedded tags, and folder tags.",
    response_model=AudioDetailResponse,
)
router.add_api_route(
    "/audio/{audio_id}/file",
    serve_audio_file,
    methods=["GET"],
    summary="Stream/download audio file",
    description="Streams the original audio file (supports HTTP range requests). Accepts `?token=`.",
)
router.add_api_route(
    "/audio/{audio_id}/artwork",
    serve_audio_artwork,
    methods=["GET"],
    summary="Audio artwork",
    description=(
        "Returns a track's artwork, resolving a cover set through the UI first, "
        "then folder cover art, then embedded album art. 404 if none."
    ),
)
# Cover art set through the UI (issue #286). Distinct from `/artwork` above:
# these read and write only the chosen cover, so the editor can tell one apart
# from folder or embedded art it must not offer to delete.
router.add_api_route(
    "/audio/{audio_id}/cover",
    serve_audio_cover,
    methods=["GET"],
    summary="Audio cover image",
    description=(
        "Serves only a cover set through the UI, for the editor preview. 404 "
        "when the track has none (even if it has folder or embedded art). "
        "GM or admin role required."
    ),
)
router.add_api_route(
    "/audio/{audio_id}/cover",
    upload_audio_cover,
    methods=["POST"],
    summary="Upload an audio cover",
    description=(
        "Stores a cover image for the track. PNG/JPEG/WebP/GIF, max 10 MB. It "
        "takes precedence over folder and embedded art. GM or admin role required."
    ),
    response_model=AudioCoverResponse,
)
router.add_api_route(
    "/audio/{audio_id}/cover/from-source",
    set_audio_cover_from_source,
    methods=["POST"],
    summary="Set an audio cover from an existing image",
    description=(
        "Copies an image Grimoire already holds — a library map or token, book "
        "cover, or another track's artwork — into this track's cover. Body: "
        "{source_type, source_id}. GM or admin role required."
    ),
    response_model=AudioCoverResponse,
)
router.add_api_route(
    "/audio/{audio_id}/cover",
    delete_audio_cover,
    methods=["DELETE"],
    summary="Remove an audio cover",
    description=(
        "Deletes the set cover; folder and embedded art are untouched and take "
        "over again. GM or admin role required."
    ),
    response_model=StatusResponse,
)
router.add_api_route(
    "/audio/{audio_id}",
    update_audio,
    methods=["PATCH"],
    summary="Update audio metadata",
    description="Updates editable fields on a track (description, tags). GM or admin role required.",
    response_model=StatusResponse,
)
# Bulk routes (issue #270). Applying a selection one PATCH per item raced on tag
# creation and 500'd; these take the whole batch in one transaction.
router.add_api_route(
    "/audio/bulk",
    bulk_update_audio,
    methods=["POST"],
    summary="Bulk update audio tracks",
    description=(
        "Applies per-track edits for many tracks in one transaction. "
        "Body: {items: [{id, description?, tags?}]}. Unknown ids are reported in "
        "`errors` and skipped. GM or admin role required."
    ),
    response_model=BulkResult,
)
router.add_api_route(
    "/audio/bulk/tags",
    bulk_add_audio_tags,
    methods=["POST"],
    summary="Bulk add tags to audio tracks",
    description=(
        "Additively applies tags to many tracks in one transaction. "
        "Body: {ids: [...], tags: [...]}. GM or admin role required."
    ),
    response_model=BulkTagResult,
)
router.add_api_route(
    "/audio-folders/bulk",
    bulk_update_audio_folders,
    methods=["POST"],
    summary="Bulk set audio folder tags",
    description=(
        "Sets tags on many audio folders in one transaction. "
        "Body: {folders: [{path, tags}]}. GM or admin role required."
    ),
    response_model=AudioFoldersResponse,
)
