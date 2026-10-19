"""Shared helpers and defaults for settings endpoints."""
import json
import logging

from ... import config, token_vault
from ...config import (
    ALLOW_PASSWORD_AUTHENTICATION_ENV,
    DISABLE_FOLDER_CATEGORY_INFERENCE_ENV,
    GUEST_ACCESS_ENABLED_ENV,
    OIDC_ENV,
    BASE_URL,
)
from ...models import AppSetting
from ...services.oidc_button import current_icon, normalize_color, normalize_radius
from ._login_message import sanitize_login_message  # noqa: F401  (re-exported)

logger = logging.getLogger("grimoire.oidc")


_VALID_INTERVALS = ("hourly", "daily", "weekly")

_DEFAULTS = {
    "rescan_schedule_enabled": "false",
    "rescan_schedule_interval": "daily",
    "rescan_schedule_hour": "2",
    "rescan_schedule_minute": "0",
    "rescan_schedule_weekday": "0",  # 0=Mon … 6=Sun
    "cleanup_on_rescan": "false",
    "hide_maps": "false",
    "hide_tokens": "false",
    "hide_audio": "false",
    "hide_models": "false",
    "hide_campaigns": "false",
    # Category → access-level map restricting whole categories app-wide (issue
    # #258), as a JSON object. "{}" means nothing is restricted by category.
    "restricted_categories": "{}",
    # Sidebar stats visibility (true = shown)
    "show_stat_systems": "true",
    "show_stat_books": "false",
    "show_stat_pages": "true",
    "show_stat_maps": "false",
    "show_stat_tokens": "false",
    "show_stat_audio": "false",
    "show_stat_models": "false",
    "show_stat_size": "true",
    "show_stat_library_size": "false",
    "password_auth_enabled": "true",
    # Whether GMs/admins may create guest invite codes for their campaigns.
    "guest_access_enabled": "false",
    # Share-link role defaults (issue #541); see services/share_links.py.
    "share_links_role_gm": "true",
    "share_links_role_player": "false",
    # When true, the indexer does not infer a book's category from its folder
    # names (books fall back to the neutral "uncategorized" category).
    "disable_folder_category_inference": "false",
    "custom_login_message_enabled": "false",
    "custom_login_message": "",
    # OIDC — all stored as strings; "" means unset
    "oidc_enabled": "false",
    "oidc_issuer_url": "",
    "oidc_token_issuer": "",
    "oidc_authorization_endpoint": "",
    "oidc_token_endpoint": "",
    "oidc_userinfo_endpoint": "",
    "oidc_jwks_uri": "",
    "oidc_end_session_endpoint": "",
    "oidc_client_id": "",
    "oidc_client_secret": "",
    "oidc_signing_alg": "RS256",
    "oidc_button_text": "Sign in with SSO",
    # Login-button appearance (issue #377). "" = the theme's default look.
    "oidc_button_bg_color": "",
    "oidc_button_text_color": "",
    "oidc_button_border_color": "",
    "oidc_button_radius": "",
    # Content hash of the uploaded icon in BRANDING_DIR; "" = no icon.
    "oidc_button_icon": "",
    "oidc_groups_claim": "",
    "oidc_permissions_claim": "",
    "oidc_match_by": "none",  # none | email | username
    "oidc_auto_launch": "false",
    "oidc_auto_register": "false",
    # Campaign file uploads (admins are exempt from all three). 0 = unlimited.
    "campaign_uploads_disabled": "false",
    "campaign_upload_max_file_mb": "0",
    "campaign_upload_max_total_mb": "0",
}

_VALID_MATCH_BY = ("none", "email", "username")
_VALID_SIGNING_ALGS = ("RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512", "HS256")
_OIDC_STRING_FIELDS = (
    "oidc_issuer_url",
    "oidc_token_issuer",
    "oidc_authorization_endpoint",
    "oidc_token_endpoint",
    "oidc_userinfo_endpoint",
    "oidc_jwks_uri",
    "oidc_end_session_endpoint",
    "oidc_client_id",
    "oidc_signing_alg",
    "oidc_button_text",
    "oidc_button_bg_color",
    "oidc_button_text_color",
    "oidc_button_border_color",
    "oidc_button_radius",
    "oidc_groups_claim",
    "oidc_permissions_claim",
    "oidc_match_by",
)
_OIDC_BOOL_FIELDS = ("oidc_enabled", "oidc_auto_launch", "oidc_auto_register")
# Set through their own endpoints rather than the PATCH body, but env-lockable.
_OIDC_LOCKABLE_FIELDS = _OIDC_STRING_FIELDS + _OIDC_BOOL_FIELDS + (
    "oidc_client_secret",
    "oidc_button_icon",
)
_OIDC_BUTTON_COLOR_FIELDS = (
    "oidc_button_bg_color",
    "oidc_button_text_color",
    "oidc_button_border_color",
)
OIDC_BUTTON_ICON_PATH = "/api/auth/openid/button-icon"


def _warn_invalid_button_env() -> None:
    """Log once at startup for env-pinned button styles that will be ignored."""
    for key in _OIDC_BUTTON_COLOR_FIELDS:
        val = OIDC_ENV.get(key)
        if val is not None and normalize_color(val) is None:
            logger.warning("%s=%r is not a CSS hex color; ignoring it", key.upper(), val)
    radius = OIDC_ENV.get("oidc_button_radius")
    if radius is not None and normalize_radius(radius) is None:
        logger.warning("OIDC_BUTTON_RADIUS=%r is not an integer 0-40; ignoring it", radius)


_warn_invalid_button_env()


def _get_raw(db) -> dict:
    """Return all settings as a string dict, falling back to defaults."""
    rows = {r.key: r.value for r in db.query(AppSetting).all()}
    return {**_DEFAULTS, **rows}


def _set(db, key: str, value: str) -> None:
    row = db.query(AppSetting).filter_by(key=key).first()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))


def _to_typed(raw: dict) -> dict:
    return {
        "rescan_schedule_enabled": raw["rescan_schedule_enabled"] == "true",
        "rescan_schedule_interval": raw["rescan_schedule_interval"],
        "rescan_schedule_hour": int(raw.get("rescan_schedule_hour", "2")),
        "rescan_schedule_minute": int(raw.get("rescan_schedule_minute", "0")),
        "rescan_schedule_weekday": int(raw.get("rescan_schedule_weekday", "0")),
        "cleanup_on_rescan": raw.get("cleanup_on_rescan", "false") == "true",
        "hide_maps": raw["hide_maps"] == "true",
        "hide_tokens": raw["hide_tokens"] == "true",
        "hide_audio": raw["hide_audio"] == "true",
        "hide_models": raw["hide_models"] == "true",
        "hide_campaigns": raw["hide_campaigns"] == "true",
        "restricted_categories": _restricted_categories_to_typed(raw),
        "show_stat_systems": raw["show_stat_systems"] == "true",
        "show_stat_books": raw["show_stat_books"] == "true",
        "show_stat_pages": raw["show_stat_pages"] == "true",
        "show_stat_maps": raw["show_stat_maps"] == "true",
        "show_stat_tokens": raw["show_stat_tokens"] == "true",
        "show_stat_audio": raw["show_stat_audio"] == "true",
        "show_stat_models": raw["show_stat_models"] == "true",
        "show_stat_size": raw["show_stat_size"] == "true",
        "show_stat_library_size": raw["show_stat_library_size"] == "true",
        "password_auth_enabled": password_auth_effective(raw),
        "password_auth_env_locked": ALLOW_PASSWORD_AUTHENTICATION_ENV is not None,
        "guest_access_enabled": guest_access_effective(raw),
        "guest_access_env_locked": GUEST_ACCESS_ENABLED_ENV is not None,
        # Read at call time, so the switch is honoured however config is set.
        "share_links_enabled": config.SHARE_LINKS_ENABLED,
        "share_links_role_gm": raw.get("share_links_role_gm", "true") == "true",
        "share_links_role_player": raw.get("share_links_role_player", "false") == "true",
        "disable_folder_category_inference": disable_folder_category_inference_effective(raw),
        "disable_folder_category_inference_env_locked": (
            DISABLE_FOLDER_CATEGORY_INFERENCE_ENV is not None
        ),
        "custom_login_message_enabled": raw.get("custom_login_message_enabled", "false") == "true",
        "custom_login_message": raw.get("custom_login_message", ""),
        # OIDC
        **_oidc_to_typed(raw),
    }


def _restricted_categories_to_typed(raw) -> dict:
    """Parse the stored category→level JSON for the settings response.

    Mirrors ``access_control.category_defaults``' forgiveness: a corrupt value
    reads as "nothing restricted" rather than failing the whole settings request
    and locking an admin out of the page they would fix it on.
    """
    try:
        parsed = json.loads(raw.get("restricted_categories", "{}") or "{}")
    except (ValueError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _oidc_to_typed(raw: dict) -> dict:
    """Build the OIDC subset of the settings response.

    The client secret is never returned in plain text — only a boolean
    indicating whether one is set, plus the length of the stored value (so
    the UI can render the right number of bullet placeholders).
    """
    eff = oidc_effective(raw)
    secret = oidc_effective_client_secret(raw)
    locks = {f"{k}_env_locked": OIDC_ENV.get(k) is not None for k in _OIDC_LOCKABLE_FIELDS}
    return {
        **eff,
        "oidc_redirect_uri": oidc_redirect_uri(),
        "oidc_button_icon_url": oidc_button_icon_url(raw),
        "oidc_client_secret_set": bool(secret),
        "oidc_client_secret_length": len(secret) if secret else 0,
        **locks,
    }


def password_auth_effective(raw: dict) -> bool:
    """Return the effective password-auth setting, honoring the env override."""
    if ALLOW_PASSWORD_AUTHENTICATION_ENV is not None:
        return ALLOW_PASSWORD_AUTHENTICATION_ENV
    return raw.get("password_auth_enabled", "true") == "true"


def guest_access_effective(raw: dict) -> bool:
    """Return the effective guest-access setting, honoring the env override."""
    if GUEST_ACCESS_ENABLED_ENV is not None:
        return GUEST_ACCESS_ENABLED_ENV
    return raw.get("guest_access_enabled", "false") == "true"


def disable_folder_category_inference_effective(raw: dict) -> bool:
    """Return the effective folder-category-inference setting (True = disabled).

    Honors the DISABLE_FOLDER_CATEGORY_INFERENCE env override, falling back to
    the DB setting when the env var is unset.
    """
    if DISABLE_FOLDER_CATEGORY_INFERENCE_ENV is not None:
        return DISABLE_FOLDER_CATEGORY_INFERENCE_ENV
    return raw.get("disable_folder_category_inference", "false") == "true"


def oidc_effective(raw: dict) -> dict:
    """Return the effective OIDC config (env vars override DB values per field)."""

    def s(key: str) -> str:
        env_val = OIDC_ENV.get(key)
        if env_val is not None:
            return str(env_val)
        return raw.get(key, _DEFAULTS.get(key, ""))

    def b(key: str) -> bool:
        env_val = OIDC_ENV.get(key)
        if env_val is not None:
            return bool(env_val)
        return raw.get(key, _DEFAULTS.get(key, "false")) == "true"

    return {
        "oidc_enabled": b("oidc_enabled"),
        "oidc_issuer_url": s("oidc_issuer_url"),
        "oidc_token_issuer": s("oidc_token_issuer"),
        "oidc_authorization_endpoint": s("oidc_authorization_endpoint"),
        "oidc_token_endpoint": s("oidc_token_endpoint"),
        "oidc_userinfo_endpoint": s("oidc_userinfo_endpoint"),
        "oidc_jwks_uri": s("oidc_jwks_uri"),
        "oidc_end_session_endpoint": s("oidc_end_session_endpoint"),
        "oidc_client_id": s("oidc_client_id"),
        "oidc_signing_alg": s("oidc_signing_alg") or "RS256",
        "oidc_button_text": s("oidc_button_text") or "Sign in with SSO",
        # Re-validated on read so a bad env pin degrades to the default look.
        "oidc_button_bg_color": normalize_color(s("oidc_button_bg_color")) or "",
        "oidc_button_text_color": normalize_color(s("oidc_button_text_color")) or "",
        "oidc_button_border_color": normalize_color(s("oidc_button_border_color")) or "",
        "oidc_button_radius": normalize_radius(s("oidc_button_radius")) or "",
        "oidc_groups_claim": s("oidc_groups_claim"),
        "oidc_permissions_claim": s("oidc_permissions_claim"),
        "oidc_match_by": s("oidc_match_by") or "none",
        "oidc_auto_launch": b("oidc_auto_launch"),
        "oidc_auto_register": b("oidc_auto_register"),
    }


# Sealed values already reported as unreadable, so a changed SECRET_KEY is
# logged once rather than on every login-page load.
_unreadable_secrets: set[str] = set()


def seal_client_secret(value: str) -> str:
    """The value to store for an OIDC client secret (see token_vault)."""
    return token_vault.seal_secret(value) if value else ""


def oidc_effective_client_secret(raw: dict) -> str:
    """Return the effective client secret. Never call from public-facing code.

    A stored secret is sealed under SECRET_KEY, so a database backup alone does
    not carry it. If it no longer unseals (SECRET_KEY changed since it was
    saved) it counts as unset - OIDC reads as not configured until an admin
    enters it again - and that is logged.
    """
    env_val = OIDC_ENV.get("oidc_client_secret")
    if env_val is not None:
        return env_val
    sealed = raw.get("oidc_client_secret", "") or ""
    if not sealed:
        return ""
    secret = token_vault.unseal_secret(sealed)
    if secret is None:
        if sealed not in _unreadable_secrets:
            _unreadable_secrets.add(sealed)
            logger.error(
                "The stored OIDC client secret cannot be decrypted - SECRET_KEY has "
                "changed since it was saved. OIDC sign-in is off until the secret is "
                "entered again in Settings > Authentication, or set OIDC_CLIENT_SECRET."
            )
        return ""
    return secret


def oidc_button_icon_url(raw: dict) -> str:
    """Relative URL of the effective login-button icon, or "" when there is none.

    The ``v`` query parameter is the icon's content hash, so the browser can
    cache it forever and still pick up a replacement immediately.
    """
    icon = current_icon(raw.get("oidc_button_icon", ""), OIDC_ENV.get("oidc_button_icon"))
    return f"{OIDC_BUTTON_ICON_PATH}?v={icon[1]}" if icon else ""


def oidc_redirect_uri() -> str:
    """The fixed callback URL for the OIDC flow.

    BASE_URL is used when set; otherwise the example placeholder is returned
    so the admin UI can show what to register at the IdP. The actual callback
    only works when BASE_URL points at the public origin.
    """
    if BASE_URL and BASE_URL != "http://localhost:9481":
        return f"{BASE_URL}/api/auth/openid/callback"
    return f"{BASE_URL}/api/auth/openid/callback"


def oidc_is_configured(raw: dict) -> bool:
    """True if OIDC has the minimum required fields to actually run a login."""
    eff = oidc_effective(raw)
    if not eff["oidc_enabled"]:
        return False
    if not eff["oidc_issuer_url"]:
        return False
    if not eff["oidc_client_id"]:
        return False
    if not oidc_effective_client_secret(raw):
        return False
    return True
