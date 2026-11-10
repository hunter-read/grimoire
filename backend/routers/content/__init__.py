"""Content catalog package — server-wide packs, browsed through a user's schema."""
from fastapi import APIRouter, Depends

from ...auth import require_ttrpg_access

from ._schemas import (
    CatalogEntry,
    CatalogResponse,
    ContentTypeListResponse,
    PackListResponse,
    ResolveResponse,
)
from .core import (
    browse_content,
    reload_packs,
    get_entry,
    list_content_types,
    list_packs,
    resolve_entries,
)

router = APIRouter(
    prefix="/content",
    tags=["content"],
    # A guest invited to a league reaches only leagues and armies.
    dependencies=[Depends(require_ttrpg_access)],
)

__all__ = ["router"]

# Literal segments before the /{schema_id} routes, so they are not swallowed.
router.add_api_route(
    "/packs",
    list_packs,
    methods=["GET"],
    summary="List installed content packs",
    response_model=PackListResponse,
)
router.add_api_route(
    "/packs/reload",
    reload_packs,
    methods=["POST"],
    summary="Re-read content packs from disk (admin)",
    response_model=PackListResponse,
)
router.add_api_route(
    "/{schema_id}/types",
    list_content_types,
    methods=["GET"],
    summary="The content types a schema declares",
    response_model=ContentTypeListResponse,
)
router.add_api_route(
    "/{schema_id}/resolve",
    resolve_entries,
    methods=["GET"],
    summary="Resolve many entry references at once",
    response_model=ResolveResponse,
)
router.add_api_route(
    "/{schema_id}/{content_type}",
    browse_content,
    methods=["GET"],
    summary="Browse a content type",
    response_model=CatalogResponse,
)
router.add_api_route(
    "/{schema_id}/{content_type}/{entry_id}",
    get_entry,
    methods=["GET"],
    summary="One catalog entry",
    response_model=CatalogEntry,
)
