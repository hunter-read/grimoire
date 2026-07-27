"""Lookups package — genre and system-family reference values (issue #202).

Registers CRUD routes for the curated genre tree and system-family list that
feed the editor dropdowns and the settings management screens.
"""
from fastapi import APIRouter

from .core import (
    create_dice_material,
    create_genre,
    create_license,
    create_parent_system,
    create_system_family,
    delete_dice_material,
    delete_genre,
    delete_license,
    delete_parent_system,
    delete_system_family,
    list_dice_materials,
    list_genres,
    list_licenses,
    list_parent_systems,
    list_system_families,
)

router = APIRouter(tags=["lookups"])

__all__ = ["router"]

router.add_api_route(
    "/genres", list_genres, methods=["GET"], summary="List all genres (tiered)"
)
router.add_api_route(
    "/genres", create_genre, methods=["POST"], summary="Create a custom genre (admin)"
)
router.add_api_route(
    "/genres/{genre_id}",
    delete_genre,
    methods=["DELETE"],
    summary="Delete a genre (admin; blocked if in use unless force=true)",
)
router.add_api_route(
    "/system-families",
    list_system_families,
    methods=["GET"],
    summary="List all system families",
)
router.add_api_route(
    "/system-families",
    create_system_family,
    methods=["POST"],
    summary="Create a custom system family (admin)",
)
router.add_api_route(
    "/system-families/{family_id}",
    delete_system_family,
    methods=["DELETE"],
    summary="Delete a system family (admin; blocked if in use unless force=true)",
)
router.add_api_route(
    "/parent-systems",
    list_parent_systems,
    methods=["GET"],
    summary="List all parent systems",
)
router.add_api_route(
    "/parent-systems",
    create_parent_system,
    methods=["POST"],
    summary="Create a custom parent system (admin)",
)
router.add_api_route(
    "/parent-systems/{parent_id}",
    delete_parent_system,
    methods=["DELETE"],
    summary="Delete a parent system (admin; blocked if in use unless force=true)",
)
router.add_api_route(
    "/licenses",
    list_licenses,
    methods=["GET"],
    summary="List all licenses",
)
router.add_api_route(
    "/licenses",
    create_license,
    methods=["POST"],
    summary="Create a custom license (admin)",
)
router.add_api_route(
    "/licenses/{license_id}",
    delete_license,
    methods=["DELETE"],
    summary="Delete a license (admin; blocked if in use unless force=true)",
)
router.add_api_route(
    "/dice-materials",
    list_dice_materials,
    methods=["GET"],
    summary="List all dice/materials",
)
router.add_api_route(
    "/dice-materials",
    create_dice_material,
    methods=["POST"],
    summary="Create a custom dice/material (admin)",
)
router.add_api_route(
    "/dice-materials/{material_id}",
    delete_dice_material,
    methods=["DELETE"],
    summary="Delete a dice/material (admin; blocked if in use unless force=true)",
)
