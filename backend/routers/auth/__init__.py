"""Auth package — registers public (unauthenticated) and authenticated routes."""
from fastapi import APIRouter

from .core import auth_config, auth_login, auth_me, auth_setup, auth_status, guest_login

public_router = APIRouter(prefix="/api/auth", tags=["auth"])
public_router.add_api_route(
    "/status",
    auth_status,
    methods=["GET"],
    summary="Check initialization status",
    description=(
        "Returns whether the server has any users. Used by the frontend to "
        "decide whether to show the first-run setup screen."
    ),
)
public_router.add_api_route(
    "/setup",
    auth_setup,
    methods=["POST"],
    summary="First-run admin setup",
    description=(
        "Creates the initial admin account. Returns a JWT. Fails if any users "
        "already exist."
    ),
)
public_router.add_api_route(
    "/login",
    auth_login,
    methods=["POST"],
    summary="Log in",
    description="Authenticates with username and password. Returns a JWT valid for 30 days.",
)
public_router.add_api_route(
    "/guest-login",
    guest_login,
    methods=["POST"],
    summary="Log in as a guest",
    description=(
        "Exchanges a campaign guest invite code for a JWT scoped to a guest "
        "account. Available only when guest access is enabled."
    ),
)
public_router.add_api_route(
    "/config",
    auth_config,
    methods=["GET"],
    summary="Public auth configuration",
    description=(
        "Returns auth-related settings needed by the unauthenticated login "
        "screen: which auth methods are enabled and the optional custom login "
        "message."
    ),
)


router = APIRouter(tags=["auth"])
router.add_api_route(
    "/auth/me",
    auth_me,
    methods=["GET"],
    summary="Get current user",
    description="Returns the authenticated user's id, username, role, and preferences.",
)
