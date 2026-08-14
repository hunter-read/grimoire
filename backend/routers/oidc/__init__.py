"""OIDC package — registers admin discovery and public login/callback routes."""
import httpx  # re-exported so tests can patch ``backend.routers.oidc.httpx.get``

from fastapi import APIRouter

from ._helpers import (
    _OIDCError,
    _permissions_from_claim,
    _resolve_user,
    _role_from_groups,
)
from ._schemas import DiscoverResponse
from .core import discover, oidc_callback, oidc_login

router = APIRouter(prefix="/auth/openid", tags=["auth"])
router.add_api_route(
    "/discover",
    discover,
    methods=["POST"],
    summary="Fetch OIDC discovery document",
    response_model=DiscoverResponse,
    description=(
        "Admin-only. Fetches `.well-known/openid-configuration` from the issuer "
        "URL and returns the relevant endpoint URLs so the admin UI can "
        "autofill the form. The server makes the request so the browser does "
        "not hit a CORS wall."
    ),
)


public_router = APIRouter(prefix="/api/auth/openid", tags=["auth"])
public_router.add_api_route(
    "/login",
    oidc_login,
    methods=["GET"],
    summary="Start an OIDC login",
    description="Redirects the user-agent to the IdP authorization endpoint.",
)
public_router.add_api_route(
    "/callback",
    oidc_callback,
    methods=["GET"],
    summary="OIDC callback",
    description=(
        "Receives the authorization code from the IdP, exchanges it for "
        "tokens, validates the ID token, resolves or creates the local user, "
        "and redirects to the frontend with a one-time grimoire token."
    ),
)


__all__ = [
    "router",
    "public_router",
    # Re-exported so tests can patch ``backend.routers.oidc.httpx.get``
    "httpx",
    # Re-exported for tests
    "_OIDCError",
    "_permissions_from_claim",
    "_resolve_user",
    "_role_from_groups",
]
