"""Saved-filters package — per-user named sort/filter presets."""
from fastapi import APIRouter

from .core import (
    create_saved_filter,
    delete_saved_filter,
    list_saved_filters,
    update_saved_filter,
)

router = APIRouter(prefix="/saved-filters", tags=["saved-filters"])

__all__ = ["router"]

router.add_api_route(
    "", list_saved_filters, methods=["GET"], summary="List the user's saved filters"
)
router.add_api_route(
    "", create_saved_filter, methods=["POST"], summary="Create/overwrite a saved filter"
)
router.add_api_route(
    "/{filter_id}",
    update_saved_filter,
    methods=["PATCH"],
    summary="Rename, re-save state, or set default",
)
router.add_api_route(
    "/{filter_id}", delete_saved_filter, methods=["DELETE"], summary="Delete a saved filter"
)
