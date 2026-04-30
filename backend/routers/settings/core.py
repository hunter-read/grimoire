"""App settings endpoints."""
import secrets

from fastapi import APIRouter, Depends, HTTPException

from ...config import SessionLocal, ALLOW_PASSWORD_AUTHENTICATION_ENV, OIDC_ENV
from ...auth import require_admin, get_current_user, CurrentUser
from ._helpers import (
    _get_raw,
    _set,
    _to_typed,
    _VALID_INTERVALS,
    _VALID_MATCH_BY,
    _VALID_SIGNING_ALGS,
    _OIDC_STRING_FIELDS,
    _OIDC_BOOL_FIELDS,
    password_auth_effective,
    sanitize_login_message,
)
from ._schemas import SettingsPatch

router = APIRouter()


def get_settings(_: CurrentUser = Depends(require_admin)):
    db = SessionLocal()
    try:
        raw = _get_raw(db)
        return _to_typed(raw)
    finally:
        db.close()


def update_settings(data: SettingsPatch, _: CurrentUser = Depends(require_admin)):
    from ... import scheduler  # local import avoids circular dependency

    if (
        data.rescan_schedule_interval is not None
        and data.rescan_schedule_interval not in _VALID_INTERVALS
    ):
        raise HTTPException(400, f"interval must be one of: {', '.join(_VALID_INTERVALS)}")

    db = SessionLocal()
    try:
        if data.rescan_schedule_enabled is not None:
            _set(db, "rescan_schedule_enabled", "true" if data.rescan_schedule_enabled else "false")
        if data.rescan_schedule_interval is not None:
            _set(db, "rescan_schedule_interval", data.rescan_schedule_interval)
        if data.rescan_schedule_hour is not None:
            _set(db, "rescan_schedule_hour", str(max(0, min(23, data.rescan_schedule_hour))))
        if data.rescan_schedule_minute is not None:
            _set(db, "rescan_schedule_minute", str(max(0, min(59, data.rescan_schedule_minute))))
        if data.rescan_schedule_weekday is not None:
            _set(db, "rescan_schedule_weekday", str(max(0, min(6, data.rescan_schedule_weekday))))
        if data.cleanup_on_rescan is not None:
            _set(db, "cleanup_on_rescan", "true" if data.cleanup_on_rescan else "false")
        if data.stats_api_key is not None:
            _set(db, "stats_api_key", data.stats_api_key)
        if data.hide_maps is not None:
            _set(db, "hide_maps", "true" if data.hide_maps else "false")
        if data.hide_tokens is not None:
            _set(db, "hide_tokens", "true" if data.hide_tokens else "false")
        if data.hide_campaigns is not None:
            _set(db, "hide_campaigns", "true" if data.hide_campaigns else "false")
        for key in (
            "show_stat_systems",
            "show_stat_books",
            "show_stat_pages",
            "show_stat_maps",
            "show_stat_tokens",
            "show_stat_size",
        ):
            val = getattr(data, key)
            if val is not None:
                _set(db, key, "true" if val else "false")
        if data.password_auth_enabled is not None:
            if ALLOW_PASSWORD_AUTHENTICATION_ENV is not None:
                raise HTTPException(
                    400,
                    "Password authentication is locked by the ALLOW_PASSWORD_AUTHENTICATION environment variable",
                )
            _set(db, "password_auth_enabled", "true" if data.password_auth_enabled else "false")
        if data.custom_login_message_enabled is not None:
            _set(
                db,
                "custom_login_message_enabled",
                "true" if data.custom_login_message_enabled else "false",
            )
        if data.custom_login_message is not None:
            _set(db, "custom_login_message", sanitize_login_message(data.custom_login_message))

        # OIDC fields ---------------------------------------------------------
        # Validate match_by + signing_alg up front so we don't half-write.
        if data.oidc_match_by is not None and data.oidc_match_by not in _VALID_MATCH_BY:
            raise HTTPException(
                400, f"oidc_match_by must be one of: {', '.join(_VALID_MATCH_BY)}"
            )
        if data.oidc_signing_alg is not None and data.oidc_signing_alg not in _VALID_SIGNING_ALGS:
            raise HTTPException(
                400, f"oidc_signing_alg must be one of: {', '.join(_VALID_SIGNING_ALGS)}"
            )

        # Bool fields
        for key in _OIDC_BOOL_FIELDS:
            val = getattr(data, key)
            if val is None:
                continue
            if OIDC_ENV.get(key) is not None:
                raise HTTPException(
                    400, f"{key} is locked by an environment variable"
                )
            _set(db, key, "true" if val else "false")

        # Plain-string fields
        for key in _OIDC_STRING_FIELDS:
            val = getattr(data, key)
            if val is None:
                continue
            if OIDC_ENV.get(key) is not None:
                raise HTTPException(
                    400, f"{key} is locked by an environment variable"
                )
            _set(db, key, val.strip())

        # Client secret — special handling:
        #   None or "" → no change (so a form re-submit doesn't clobber)
        #   "__CLEAR__" → wipe the stored secret
        #   anything else → set as-is
        if data.oidc_client_secret is not None and data.oidc_client_secret != "":
            if OIDC_ENV.get("oidc_client_secret") is not None:
                raise HTTPException(
                    400, "oidc_client_secret is locked by an environment variable"
                )
            if data.oidc_client_secret == "__CLEAR__":
                _set(db, "oidc_client_secret", "")
            else:
                _set(db, "oidc_client_secret", data.oidc_client_secret)

        db.commit()

        # Apply immediately so the change takes effect without a restart
        scheduler.apply(db)

        return _to_typed(_get_raw(db))
    finally:
        db.close()


def generate_api_key(_: CurrentUser = Depends(require_admin)):
    key = secrets.token_urlsafe(32)
    db = SessionLocal()
    try:
        _set(db, "stats_api_key", key)
        db.commit()
        return {"stats_api_key": key}
    finally:
        db.close()


def revoke_api_key(_: CurrentUser = Depends(require_admin)):
    db = SessionLocal()
    try:
        _set(db, "stats_api_key", "")
        db.commit()
        return {"stats_api_key": ""}
    finally:
        db.close()


def get_ui_settings(_: CurrentUser = Depends(get_current_user)):
    """Returns the subset of settings that affect UI visibility for all users."""
    db = SessionLocal()
    try:
        raw = _get_raw(db)
        return {
            "hide_maps": raw["hide_maps"] == "true",
            "hide_tokens": raw["hide_tokens"] == "true",
            "hide_campaigns": raw["hide_campaigns"] == "true",
            "show_stat_systems": raw["show_stat_systems"] == "true",
            "show_stat_books": raw["show_stat_books"] == "true",
            "show_stat_pages": raw["show_stat_pages"] == "true",
            "show_stat_maps": raw["show_stat_maps"] == "true",
            "show_stat_tokens": raw["show_stat_tokens"] == "true",
            "show_stat_size": raw["show_stat_size"] == "true",
        }
    finally:
        db.close()
