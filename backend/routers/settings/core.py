"""App settings endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ... import api_keys, config
from ...config import get_db
from ...auth import require_admin, get_current_user, CurrentUser
from ...services.library_fs import library_writable
from ...services.app_settings import (
    get_raw,
    to_typed,
    guest_access_effective,
    oidc_is_configured,
    password_auth_effective,
)
from ._schemas import SettingsPatch
from ._update import apply_patch

router = APIRouter()

_PASSWORD_OFF_LOCKOUT = (
    "Set up single sign-on (OIDC) before turning off password sign-in - "
    "otherwise no one could sign in."
)
_OIDC_OFF_LOCKOUT = (
    "Turn password sign-in back on before turning off single sign-on - "
    "otherwise no one could sign in."
)


def _sign_in_possible(raw: dict) -> bool:
    """Whether anyone could sign in: by password, or through a working OIDC setup."""
    return password_auth_effective(raw) or oidc_is_configured(raw)


# Sign-in settings - every OIDC field, password and guest sign-in, and the
# login page's message - are set from a signed-in session only, never a key.
_SIGN_IN_FIELDS = (
    "password_auth_enabled",
    "guest_access_enabled",
    "custom_login_message_enabled",
    "custom_login_message",
    *(name for name in SettingsPatch.model_fields if name.startswith("oidc_")),
)


def get_settings(_: CurrentUser = Depends(require_admin), db: Session = Depends(get_db)):
    raw = get_raw(db)
    return to_typed(raw)


def update_settings(
    data: SettingsPatch,
    current_user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from ... import library_watch, scheduler  # local import avoids circular dependency

    touches_sign_in = any(getattr(data, key) is not None for key in _SIGN_IN_FIELDS)
    if touches_sign_in:
        api_keys.assert_session(current_user, "Sign-in settings need a signed-in session")
    # Only a change that takes sign-in away is refused below, never one made while
    # it is already impossible - that would stop an admin repairing it in steps.
    could_sign_in = touches_sign_in and _sign_in_possible(get_raw(db))

    apply_patch(
        db,
        {key: getattr(data, key) for key in SettingsPatch.model_fields if getattr(data, key) is not None},
    )

    # Judged on the settings as this patch leaves them (the query autoflushes the
    # writes above), so a patch that sets up OIDC and turns passwords off in one
    # go is allowed. Nothing is committed yet, so a refusal discards it all.
    if could_sign_in and not _sign_in_possible(get_raw(db)):
        db.rollback()
        raise HTTPException(
            400,
            _PASSWORD_OFF_LOCKOUT if data.password_auth_enabled is False else _OIDC_OFF_LOCKOUT,
        )

    db.commit()

    # Apply immediately so the change takes effect without a restart
    scheduler.apply(db)
    library_watch.poke()

    return to_typed(get_raw(db))


def get_ui_settings(_: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Returns the subset of settings that affect UI visibility for all users."""
    raw = get_raw(db)
    return {
        "hide_maps": raw["hide_maps"] == "true",
        "hide_tokens": raw["hide_tokens"] == "true",
        "hide_audio": raw["hide_audio"] == "true",
        "hide_models": raw["hide_models"] == "true",
        "hide_campaigns": raw["hide_campaigns"] == "true",
        "show_stat_systems": raw["show_stat_systems"] == "true",
        "show_stat_books": raw["show_stat_books"] == "true",
        "show_stat_pages": raw["show_stat_pages"] == "true",
        "show_stat_maps": raw["show_stat_maps"] == "true",
        "show_stat_tokens": raw["show_stat_tokens"] == "true",
        "show_stat_audio": raw["show_stat_audio"] == "true",
        "show_stat_models": raw["show_stat_models"] == "true",
        "show_stat_size": raw["show_stat_size"] == "true",
        "show_stat_library_size": raw["show_stat_library_size"] == "true",
        "demo_mode": config.ENABLE_DEMO_MODE,
        "campaign_uploads_disabled": raw["campaign_uploads_disabled"] == "true",
        "campaign_upload_max_file_mb": int(raw.get("campaign_upload_max_file_mb") or 0),
        "campaign_upload_max_total_mb": int(raw.get("campaign_upload_max_total_mb") or 0),
        "guest_access_enabled": guest_access_effective(raw),
        # Whether API keys exist on this instance at all (API_KEYS_ENABLED);
        # the UI hides every API key menu when they don't.
        "api_keys_enabled": config.API_KEYS_ENABLED,
        # Whether share links exist on this instance (SHARE_LINKS_ENABLED); the
        # UI hides every share menu when they don't.
        "share_links_enabled": config.SHARE_LINKS_ENABLED,
        # Whether /mcp is served (MCP_ENABLED); the new-key dialog then shows how
        # to connect an AI assistant with the key.
        "mcp_enabled": config.MCP_ENABLED,
        # Whether the library can be modified at all. The file-management actions
        # (move / rename / delete) are hidden rather than shown-and-failing when
        # the library is mounted read-only, and every view outside the file
        # manager needs to know that without issuing a browse of its own.
        "library_writable": library_writable(),
    }
