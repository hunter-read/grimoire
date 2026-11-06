"""Pins package - folders and game systems a user keeps one click away."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from ._schemas import PinOut, PinsResponse
from .core import add_pin, list_pins, remove_pin

router = APIRouter(prefix="/pins", tags=["pins"], dependencies=[Depends(require_not_guest)])

__all__ = ["router"]

router.add_api_route(
    "",
    list_pins,
    methods=["GET"],
    summary="List the user's pins",
    description="Oldest first. Pass `collection` for one view's pins.",
    response_model=PinsResponse,
)
router.add_api_route(
    "",
    add_pin,
    methods=["POST"],
    summary="Pin a folder or game system",
    description=(
        "`collection` is the view (`systems`, `maps`, `tokens`, `audio`, `models`); "
        "`target` is a game system's id, or a collection-relative folder path. "
        "Pinning something already pinned returns the existing pin."
    ),
    response_model=PinOut,
)
router.add_api_route(
    "/{pin_id}",
    remove_pin,
    methods=["DELETE"],
    summary="Unpin",
    status_code=204,
)
