"""Favorites package — registers all favorites routes on a single router."""
from fastapi import APIRouter

from .core import list_favorites, add_favorite, remove_favorite
from ._schemas import FavoriteRef, FavoritesResponse

router = APIRouter(prefix="/favorites", tags=["favorites"])

router.add_api_route(
    "",
    list_favorites,
    methods=["GET"],
    summary="List current user's favorites",
    response_model=FavoritesResponse,
)
router.add_api_route(
    "",
    add_favorite,
    methods=["POST"],
    summary="Add a favorite",
    status_code=201,
    response_model=FavoriteRef,
)
router.add_api_route(
    "/{item_type}/{item_id}",
    remove_favorite,
    methods=["DELETE"],
    summary="Remove a favorite",
    status_code=204,
)
