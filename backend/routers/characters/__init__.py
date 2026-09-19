"""Characters package — per-user character sheets and the schemas describing them."""
from fastapi import APIRouter

from ._schemas import (
    CharacterDeletedResponse,
    SheetCatalogueResponse,
    CharacterDetail,
    CharacterExport,
    CharacterListResponse,
    PortraitResponse,
    SchemaDeletedResponse,
    SchemaDetail,
    SchemaListResponse,
)
from .portraits import delete_portrait, get_portrait, upload_portrait
from .core import (
    browse_sheets,
    create_character,
    install_sheet,
    export_character,
    import_character,
    delete_character,
    delete_schema,
    get_character,
    get_schema,
    import_schema,
    list_characters,
    list_schemas,
    update_character,
)

router = APIRouter(prefix="/characters", tags=["characters"])

__all__ = ["router"]

# Literal segments before /{character_id}, so they are not swallowed by it.
router.add_api_route(
    "/schemas",
    list_schemas,
    methods=["GET"],
    summary="List installed character schemas",
    response_model=SchemaListResponse,
)
router.add_api_route(
    "/schemas",
    import_schema,
    methods=["POST"],
    summary="Install a pasted character schema",
    response_model=SchemaDetail,
)
router.add_api_route(
    "/schemas/browse",
    browse_sheets,
    methods=["GET"],
    summary="Browse the community sheet catalogue",
    response_model=SheetCatalogueResponse,
)
router.add_api_route(
    "/schemas/install/{sheet_id}",
    install_sheet,
    methods=["POST"],
    summary="Install a sheet from the catalogue",
    response_model=SchemaDetail,
)
router.add_api_route(
    "/schemas/{schema_id}",
    get_schema,
    methods=["GET"],
    summary="Get a schema and its document",
    response_model=SchemaDetail,
)
router.add_api_route(
    "/schemas/{schema_id}",
    delete_schema,
    methods=["DELETE"],
    summary="Uninstall a schema",
    response_model=SchemaDeletedResponse,
)
router.add_api_route(
    "/import",
    import_character,
    methods=["POST"],
    summary="Import a character from an exported file",
    response_model=CharacterDetail,
)
router.add_api_route(
    "",
    list_characters,
    methods=["GET"],
    summary="List the user's characters",
    response_model=CharacterListResponse,
)
router.add_api_route(
    "",
    create_character,
    methods=["POST"],
    summary="Create a character",
    response_model=CharacterDetail,
)
router.add_api_route(
    "/{character_id}",
    get_character,
    methods=["GET"],
    summary="Get a character with computed values",
    response_model=CharacterDetail,
)
router.add_api_route(
    "/{character_id}",
    update_character,
    methods=["PUT"],
    summary="Update a character",
    response_model=CharacterDetail,
)
router.add_api_route(
    "/{character_id}/export",
    export_character,
    methods=["GET"],
    summary="Export a character as a self-contained file",
    response_model=CharacterExport,
    response_model_by_alias=True,
)
router.add_api_route(
    "/{character_id}/portrait",
    upload_portrait,
    methods=["POST"],
    summary="Set a character's portrait",
    response_model=PortraitResponse,
)
router.add_api_route(
    "/{character_id}/portrait",
    get_portrait,
    methods=["GET"],
    summary="A character's portrait image",
)
router.add_api_route(
    "/{character_id}/portrait",
    delete_portrait,
    methods=["DELETE"],
    summary="Remove a character's portrait",
    response_model=CharacterDeletedResponse,
)
router.add_api_route(
    "/{character_id}",
    delete_character,
    methods=["DELETE"],
    summary="Delete a character",
    response_model=CharacterDeletedResponse,
)
