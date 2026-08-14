"""Users package — registers all user routes on a single router."""
from fastapi import APIRouter

from .core import list_users, list_guests, create_user, convert_guest, update_user, delete_user
from .me import (
    update_own_preferences,
    change_own_password,
    delete_own_account,
    get_opds_status,
    generate_opds_token,
    revoke_opds_token,
)
from ._schemas import (
    GuestOut,
    OpdsStatusResponse,
    PasswordChangeResponse,
    PreferencesResponse,
    UserOut,
    UserUpdateResponse,
)

router = APIRouter(prefix="/users", tags=["users"])

# --- Collection ---
router.add_api_route(
    "", list_users, methods=["GET"], summary="List all users", response_model=list[UserOut]
)
router.add_api_route(
    "",
    create_user,
    methods=["POST"],
    summary="Create a user",
    status_code=201,
    response_model=UserOut,
    # `create_user` returns a subset of UserOut (no display_name/created_at).
    # Without this, response_model would materialize those as explicit nulls —
    # keys the endpoint has never sent.
    response_model_exclude_unset=True,
)

# --- Guests (registered before /{user_id} to avoid routing conflict) ---
router.add_api_route(
    "/guests",
    list_guests,
    methods=["GET"],
    summary="List guest accounts",
    description="Lists all per-campaign guest accounts with their campaign and inviter.",
    response_model=list[GuestOut],
)

# --- Self-service (registered before /{user_id} to avoid routing conflict) ---
router.add_api_route(
    "/me/preferences",
    update_own_preferences,
    methods=["PATCH"],
    summary="Update own preferences",
    response_model=PreferencesResponse,
)
router.add_api_route(
    "/me/password",
    change_own_password,
    methods=["PATCH"],
    summary="Change own password",
    response_model=PasswordChangeResponse,
)
router.add_api_route(
    "/me", delete_own_account, methods=["DELETE"], summary="Delete own account", status_code=204
)

# --- OPDS (self-service) ---
router.add_api_route(
    "/me/opds",
    get_opds_status,
    methods=["GET"],
    summary="Get OPDS feed status",
    response_model=OpdsStatusResponse,
    # The disabled/guest branch returns only {opds_enabled, feed_url}; without
    # this, `has_token` would appear as an explicit null it never sent.
    response_model_exclude_unset=True,
)
router.add_api_route(
    "/me/opds/generate",
    generate_opds_token,
    methods=["POST"],
    summary="Generate/regenerate OPDS token",
    response_model=OpdsStatusResponse,
)
router.add_api_route(
    "/me/opds",
    revoke_opds_token,
    methods=["DELETE"],
    summary="Revoke OPDS token",
    status_code=200,
    response_model=OpdsStatusResponse,
)

# --- Admin single-user operations ---
router.add_api_route(
    "/{user_id}",
    update_user,
    methods=["PATCH"],
    summary="Update user role or password",
    description="Change a user's role or reset their password. Cannot demote the last admin.",
    response_model=UserUpdateResponse,
)
router.add_api_route(
    "/{user_id}/convert",
    convert_guest,
    methods=["POST"],
    summary="Convert a guest to a permanent user",
    description=(
        "Promotes a guest account to a permanent user, keeping its campaign "
        "membership and character. A password is required only when password "
        "auth is enabled."
    ),
    response_model=UserOut,
)
router.add_api_route(
    "/{user_id}",
    delete_user,
    methods=["DELETE"],
    summary="Delete a user",
    description="Permanently deletes a user. Cannot delete yourself or the last admin.",
    status_code=204,
)
