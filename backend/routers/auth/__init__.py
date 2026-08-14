"""Auth package — registers public (unauthenticated) and authenticated routes."""
from fastapi import APIRouter

from .core import (
    auth_config,
    auth_login,
    auth_logout,
    auth_me,
    auth_refresh,
    auth_setup,
    auth_status,
    guest_login,
    list_sessions,
    revoke_one_session,
    revoke_other_sessions,
)

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
    description=(
        "Authenticates with username and password. Returns a short-lived "
        "access token and sets the session and refresh cookies."
    ),
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
    "/logout",
    auth_logout,
    methods=["POST"],
    summary="Log out",
    description=(
        "Revokes the current session and clears the session and refresh "
        "cookies. The refresh token stops working immediately; the current "
        "access token stays valid until it expires (at most "
        "ACCESS_TOKEN_EXPIRE_MINUTES). Requires no auth so a client with an "
        "expired access token can still log out."
    ),
)
public_router.add_api_route(
    "/refresh",
    auth_refresh,
    methods=["POST"],
    summary="Refresh the access token",
    description=(
        "Exchanges the `grimoire_refresh` cookie for a new access token and "
        "rotates the refresh token. Returns `{token, user}` and re-sets both "
        "cookies. Returns 401 when the refresh token is missing, expired, or "
        "revoked. Reusing an already-rotated refresh token revokes the whole "
        "session."
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
router.add_api_route(
    "/auth/sessions",
    list_sessions,
    methods=["GET"],
    summary="List your active sessions",
    description=(
        "The caller's own live login sessions, newest first, each with its "
        "origin (password/guest/oidc), user agent, IP, and timestamps. The "
        "session backing the current request is flagged with `current: true`."
    ),
)
router.add_api_route(
    "/auth/sessions/others",
    revoke_other_sessions,
    methods=["DELETE"],
    summary="Log out everywhere else",
    description=(
        "Revokes all of the caller's sessions except the current one. Returns "
        "`{ok, revoked, kept_current}`."
    ),
)
router.add_api_route(
    "/auth/sessions/{session_id}",
    revoke_one_session,
    methods=["DELETE"],
    summary="Revoke one of your sessions",
    description=(
        "Revokes a single session belonging to the caller. Returns 404 for an "
        "unknown session or one owned by another user."
    ),
)
