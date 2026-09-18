"""Characters package — per-user character sheets and the schemas describing them."""
from fastapi import APIRouter

from ._schemas import (
    CharacterDeletedResponse,
    CharacterDetail,
    CharacterListResponse,
    SchemaDeletedResponse,
    SchemaDetail,
    SchemaListResponse,
)
from .core import (
    create_character,
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
    "/{character_id}",
    delete_character,
    methods=["DELETE"],
    summary="Delete a character",
    response_model=CharacterDeletedResponse,
)
