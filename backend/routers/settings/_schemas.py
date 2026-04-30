"""Pydantic schemas for the settings API."""
from typing import Optional
from pydantic import BaseModel


class SettingsPatch(BaseModel):
    rescan_schedule_enabled: Optional[bool] = None
    rescan_schedule_interval: Optional[str] = None
    rescan_schedule_hour: Optional[int] = None
    rescan_schedule_minute: Optional[int] = None
    rescan_schedule_weekday: Optional[int] = None
    cleanup_on_rescan: Optional[bool] = None
    stats_api_key: Optional[str] = None  # set to "" to clear
    hide_maps: Optional[bool] = None
    hide_tokens: Optional[bool] = None
    hide_campaigns: Optional[bool] = None
    show_stat_systems: Optional[bool] = None
    show_stat_books: Optional[bool] = None
    show_stat_pages: Optional[bool] = None
    show_stat_maps: Optional[bool] = None
    show_stat_tokens: Optional[bool] = None
    show_stat_size: Optional[bool] = None
    password_auth_enabled: Optional[bool] = None
    custom_login_message_enabled: Optional[bool] = None
    custom_login_message: Optional[str] = None  # HTML (sanitized on save)
    # OIDC config
    oidc_enabled: Optional[bool] = None
    oidc_issuer_url: Optional[str] = None
    oidc_authorization_endpoint: Optional[str] = None
    oidc_token_endpoint: Optional[str] = None
    oidc_userinfo_endpoint: Optional[str] = None
    oidc_jwks_uri: Optional[str] = None
    oidc_end_session_endpoint: Optional[str] = None
    oidc_client_id: Optional[str] = None
    # Empty string is a no-op (form re-submits don't clobber); None is a no-op too.
    # Use a sentinel object {"clear": true} or send the literal string "__CLEAR__"
    # to wipe the secret. We accept "__CLEAR__" since it round-trips through JSON
    # without needing a separate field.
    oidc_client_secret: Optional[str] = None
    oidc_signing_alg: Optional[str] = None
    oidc_button_text: Optional[str] = None
    oidc_groups_claim: Optional[str] = None
    oidc_permissions_claim: Optional[str] = None
    oidc_match_by: Optional[str] = None
    oidc_auto_launch: Optional[bool] = None
    oidc_auto_register: Optional[bool] = None
