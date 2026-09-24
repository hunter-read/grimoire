"""API keys package — personal API key management (issue #489)."""
from fastapi import APIRouter, Depends

from ._helpers import require_keys_enabled

from ._schemas import ApiKeyOut, ApiKeyPermissionOut, ApiKeyWithSecret
from .core import (
    create_api_key,
    delete_api_key,
    list_api_keys,
    list_permissions,
    regenerate_api_key,
    update_api_key,
)

# The "api-keys" tag is in api_keys.EXCLUDED_TAGS: no key can reach these.
# With API_KEYS_ENABLED off, every endpoint here refuses (403).
router = APIRouter(
    prefix="/api-keys", tags=["api-keys"], dependencies=[Depends(require_keys_enabled)]
)

__all__ = ["router"]

router.add_api_route(
    "",
    list_api_keys,
    methods=["GET"],
    summary="List your API keys (never their secrets)",
    response_model=list[ApiKeyOut],
)
router.add_api_route(
    "/permissions",
    list_permissions,
    methods=["GET"],
    summary="List the permissions your keys can be granted",
    response_model=list[ApiKeyPermissionOut],
)
router.add_api_route(
    "",
    create_api_key,
    methods=["POST"],
    summary="Create an API key that acts as you",
    description="Returns the full key once, in `key`. Only its hash is stored.",
    status_code=201,
    response_model=ApiKeyWithSecret,
)
router.add_api_route(
    "/{key_id}",
    update_api_key,
    methods=["PATCH"],
    summary="Rename a key or change its permissions or expiry",
    response_model=ApiKeyOut,
)
router.add_api_route(
    "/{key_id}/regenerate",
    regenerate_api_key,
    methods=["POST"],
    summary="Issue a new secret for a key",
    description="Keeps the name and permissions. The old secret stops working at once.",
    response_model=ApiKeyWithSecret,
)
router.add_api_route(
    "/{key_id}",
    delete_api_key,
    methods=["DELETE"],
    summary="Revoke (delete) an API key",
    status_code=204,
)
