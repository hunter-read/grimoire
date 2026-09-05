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
    hide_audio: Optional[bool] = None
    hide_campaigns: Optional[bool] = None
    # {category_slug: "gm"|"admin"} restricting whole categories app-wide
    # (issue #258). Validated in the handler against the unrestrictable list.
    restricted_categories: Optional[dict] = None
    show_stat_systems: Optional[bool] = None
    show_stat_books: Optional[bool] = None
    show_stat_pages: Optional[bool] = None
    show_stat_maps: Optional[bool] = None
    show_stat_tokens: Optional[bool] = None
    show_stat_audio: Optional[bool] = None
    show_stat_size: Optional[bool] = None
    show_stat_library_size: Optional[bool] = None
    campaign_uploads_disabled: Optional[bool] = None
    campaign_upload_max_file_mb: Optional[int] = None
    campaign_upload_max_total_mb: Optional[int] = None
    password_auth_enabled: Optional[bool] = None
    guest_access_enabled: Optional[bool] = None
    disable_folder_category_inference: Optional[bool] = None
    custom_login_message_enabled: Optional[bool] = None
    custom_login_message: Optional[str] = None  # HTML (sanitized on save)
    # OIDC config
    oidc_enabled: Optional[bool] = None
    oidc_issuer_url: Optional[str] = None
    oidc_token_issuer: Optional[str] = None
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


class SettingsResponse(BaseModel):
    """The full admin settings payload, as built by `_helpers._to_typed`.

    Every field is derived from the string-valued `app_settings` table through
    `_DEFAULTS`, so each one is always present and already coerced to its final
    type — none can come back null. The `*_env_locked` booleans say whether the
    matching field is pinned by an environment variable and so read-only in the
    admin UI.
    """

    rescan_schedule_enabled: bool
    rescan_schedule_interval: str
    rescan_schedule_hour: int
    rescan_schedule_minute: int
    rescan_schedule_weekday: int
    cleanup_on_rescan: bool
    stats_api_key: str
    hide_maps: bool
    hide_tokens: bool
    hide_audio: bool
    hide_campaigns: bool
    restricted_categories: dict
    show_stat_systems: bool
    show_stat_books: bool
    show_stat_pages: bool
    show_stat_maps: bool
    show_stat_tokens: bool
    show_stat_audio: bool
    show_stat_size: bool
    show_stat_library_size: bool
    password_auth_enabled: bool
    password_auth_env_locked: bool
    guest_access_enabled: bool
    guest_access_env_locked: bool
    disable_folder_category_inference: bool
    disable_folder_category_inference_env_locked: bool
    custom_login_message_enabled: bool
    custom_login_message: str
    # OIDC config (`_helpers._oidc_to_typed`) — the client secret is never
    # returned, only whether one is set and how long it is.
    oidc_enabled: bool
    oidc_issuer_url: str
    oidc_token_issuer: str
    oidc_authorization_endpoint: str
    oidc_token_endpoint: str
    oidc_userinfo_endpoint: str
    oidc_jwks_uri: str
    oidc_end_session_endpoint: str
    oidc_client_id: str
    oidc_signing_alg: str
    oidc_button_text: str
    oidc_groups_claim: str
    oidc_permissions_claim: str
    oidc_match_by: str
    oidc_auto_launch: bool
    oidc_auto_register: bool
    oidc_redirect_uri: str
    oidc_client_secret_set: bool
    oidc_client_secret_length: int
    oidc_issuer_url_env_locked: bool
    oidc_token_issuer_env_locked: bool
    oidc_authorization_endpoint_env_locked: bool
    oidc_token_endpoint_env_locked: bool
    oidc_userinfo_endpoint_env_locked: bool
    oidc_jwks_uri_env_locked: bool
    oidc_end_session_endpoint_env_locked: bool
    oidc_client_id_env_locked: bool
    oidc_signing_alg_env_locked: bool
    oidc_button_text_env_locked: bool
    oidc_groups_claim_env_locked: bool
    oidc_permissions_claim_env_locked: bool
    oidc_match_by_env_locked: bool
    oidc_enabled_env_locked: bool
    oidc_auto_launch_env_locked: bool
    oidc_auto_register_env_locked: bool
    oidc_client_secret_env_locked: bool


class ApiKeyResponse(BaseModel):
    """The stats API key after generation, or `""` after revocation."""

    stats_api_key: str


class UISettingsResponse(BaseModel):
    """The visibility subset any authenticated user may read."""

    hide_maps: bool
    hide_tokens: bool
    hide_audio: bool
    hide_campaigns: bool
    show_stat_systems: bool
    show_stat_books: bool
    show_stat_pages: bool
    show_stat_maps: bool
    show_stat_tokens: bool
    show_stat_audio: bool
    show_stat_size: bool
    show_stat_library_size: bool
    campaign_uploads_disabled: bool
    campaign_upload_max_file_mb: int
    campaign_upload_max_total_mb: int
    guest_access_enabled: bool
    library_writable: bool
