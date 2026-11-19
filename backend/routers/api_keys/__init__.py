"""API keys package — personal API key management (issue #489)."""
from fastapi import APIRouter, Depends

from ._helpers import require_keys_enabled

from ._schemas import (
    ApiKeyOut,
    ApiKeyPermissionOut,
    ApiKeyWithSecret,
    OAuthRedirectOut,
    OAuthRequestOut,
)
from .oauth import approve_request, deny_request, get_request, require_oauth_active
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

__all__ = ["router", "oauth_router"]

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

# The consent page's API for MCP OAuth sign-in (issue #906). Approving an app
# mints a grant - an API key row - so it lives with key management. The "oauth"
# tag is in api_keys.EXCLUDED_TAGS: no key can approve a sign-in. Every
# endpoint answers 404 unless MCP_OAUTH_ENABLED is on and serving.
oauth_router = APIRouter(
    prefix="/oauth", tags=["oauth"], dependencies=[Depends(require_oauth_active)]
)
oauth_router.add_api_route(
    "/requests/{request_id}",
    get_request,
    methods=["GET"],
    summary="Describe a pending MCP sign-in request",
    response_model=OAuthRequestOut,
)
oauth_router.add_api_route(
    "/requests/{request_id}/approve",
    approve_request,
    methods=["POST"],
    summary="Approve a pending MCP sign-in request",
    description="Returns the client's redirect address with a code, for the page to open.",
    response_model=OAuthRedirectOut,
)
oauth_router.add_api_route(
    "/requests/{request_id}/deny",
    deny_request,
    methods=["POST"],
    summary="Deny a pending MCP sign-in request",
    response_model=OAuthRedirectOut,
)
