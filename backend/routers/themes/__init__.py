"""Themes package — per-user colour themes, installed from a catalogue or pasted."""
from fastapi import APIRouter

from .core import (
    browse_themes,
    delete_theme,
    import_theme,
    install_theme,
    list_themes,
    select_theme,
    set_theme_source,
)

router = APIRouter(prefix="/themes", tags=["themes"])

__all__ = ["router"]

router.add_api_route("", list_themes, methods=["GET"], summary="List installed themes")
router.add_api_route(
    "", import_theme, methods=["POST"], summary="Install a pasted or uploaded theme"
)
# Literal segments before /{theme_id}, so they are not swallowed by it.
router.add_api_route(
    "/browse", browse_themes, methods=["GET"], summary="Browse the community catalogue"
)
router.add_api_route(
    "/selection", select_theme, methods=["PUT"], summary="Set the active mode and theme"
)
router.add_api_route(
    "/source", set_theme_source, methods=["PUT"], summary="Set the catalogue URL (admin)"
)
router.add_api_route(
    "/install/{theme_id}",
    install_theme,
    methods=["POST"],
    summary="Install a theme from the catalogue",
)
router.add_api_route(
    "/{theme_id}", delete_theme, methods=["DELETE"], summary="Uninstall a theme"
)
