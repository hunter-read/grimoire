"""Saved audio sets — per-user named playlists and soundboards."""
from fastapi import APIRouter

from ._schemas import AudioSetOut, AudioSetsResponse, StatusResponse
from .core import (
    create_audio_set,
    delete_audio_set,
    get_audio_set,
    list_audio_sets,
    update_audio_set,
)

router = APIRouter(prefix="/audio-sets", tags=["audio-sets"])

__all__ = ["router"]

router.add_api_route(
    "",
    list_audio_sets,
    methods=["GET"],
    summary="List the user's saved playlists and soundboards",
    response_model=AudioSetsResponse,
)
router.add_api_route(
    "",
    create_audio_set,
    methods=["POST"],
    summary="Save a playlist or soundboard",
    response_model=AudioSetOut,
)
router.add_api_route(
    "/{set_id}",
    get_audio_set,
    methods=["GET"],
    summary="Load one saved set, resolved against the library",
    response_model=AudioSetOut,
)
router.add_api_route(
    "/{set_id}",
    update_audio_set,
    methods=["PATCH"],
    summary="Rename a saved set or replace its contents",
    response_model=AudioSetOut,
)
router.add_api_route(
    "/{set_id}",
    delete_audio_set,
    methods=["DELETE"],
    summary="Delete a saved set",
    response_model=StatusResponse,
)
