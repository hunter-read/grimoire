"""Audio package — registers all audio routes on a single router."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from .core import (
    list_audio,
    list_audio_folders,
    update_audio_folder,
    get_audio,
    serve_audio_file,
    serve_audio_artwork,
    update_audio,
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
)
router.add_api_route(
    "/audio-folders",
    list_audio_folders,
    methods=["GET"],
    summary="List audio folders",
    description="Returns all known audio folder paths and their associated tags.",
    dependencies=[Depends(require_not_guest)],
)
router.add_api_route(
    "/audio-folders",
    update_audio_folder,
    methods=["PATCH"],
    summary="Set tags on an audio folder",
    description="Creates or replaces the tag list for a folder path. GM or admin role required.",
)
router.add_api_route(
    "/audio/{audio_id}",
    get_audio,
    methods=["GET"],
    summary="Get an audio track",
    description="Returns full track metadata including duration, embedded tags, and folder tags.",
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
    description="Returns folder cover art or embedded album art for a track. 404 if none.",
)
router.add_api_route(
    "/audio/{audio_id}",
    update_audio,
    methods=["PATCH"],
    summary="Update audio metadata",
    description="Updates editable fields on a track (description, tags). GM or admin role required.",
)
