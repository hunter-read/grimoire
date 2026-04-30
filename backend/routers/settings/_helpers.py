"""Shared helpers and defaults for settings endpoints."""
import re

from ...config import SessionLocal, ALLOW_PASSWORD_AUTHENTICATION_ENV, OIDC_ENV, BASE_URL
from ...models import AppSetting


_VALID_INTERVALS = ("hourly", "daily", "weekly")

_DEFAULTS = {
    "rescan_schedule_enabled": "false",
    "rescan_schedule_interval": "daily",
    "rescan_schedule_hour": "2",
    "rescan_schedule_minute": "0",
    "rescan_schedule_weekday": "0",  # 0=Mon … 6=Sun
    "cleanup_on_rescan": "false",
    "stats_api_key": "",
    "hide_maps": "false",
    "hide_tokens": "false",
    "hide_campaigns": "false",
    # Sidebar stats visibility (true = shown)
    "show_stat_systems": "true",
    "show_stat_books": "false",
    "show_stat_pages": "true",
    "show_stat_maps": "false",
    "show_stat_tokens": "false",
    "show_stat_size": "true",
    "password_auth_enabled": "true",
    "custom_login_message_enabled": "false",
    "custom_login_message": "",
    # OIDC — all stored as strings; "" means unset
    "oidc_enabled": "false",
    "oidc_issuer_url": "",
    "oidc_authorization_endpoint": "",
    "oidc_token_endpoint": "",
    "oidc_userinfo_endpoint": "",
    "oidc_jwks_uri": "",
    "oidc_end_session_endpoint": "",
    "oidc_client_id": "",
    "oidc_client_secret": "",
    "oidc_signing_alg": "RS256",
    "oidc_button_text": "Sign in with SSO",
    "oidc_groups_claim": "",
    "oidc_permissions_claim": "",
    "oidc_match_by": "none",  # none | email | username
    "oidc_auto_launch": "false",
    "oidc_auto_register": "false",
}

_VALID_MATCH_BY = ("none", "email", "username")
_VALID_SIGNING_ALGS = ("RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512", "HS256")
_OIDC_STRING_FIELDS = (
    "oidc_issuer_url",
    "oidc_authorization_endpoint",
    "oidc_token_endpoint",
    "oidc_userinfo_endpoint",
    "oidc_jwks_uri",
    "oidc_end_session_endpoint",
    "oidc_client_id",
    "oidc_signing_alg",
    "oidc_button_text",
    "oidc_groups_claim",
    "oidc_permissions_claim",
    "oidc_match_by",
)
_OIDC_BOOL_FIELDS = ("oidc_enabled", "oidc_auto_launch", "oidc_auto_register")
_OIDC_LOCKABLE_FIELDS = _OIDC_STRING_FIELDS + _OIDC_BOOL_FIELDS + ("oidc_client_secret",)


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
        "stats_api_key": raw["stats_api_key"],
        "hide_maps": raw["hide_maps"] == "true",
        "hide_tokens": raw["hide_tokens"] == "true",
        "hide_campaigns": raw["hide_campaigns"] == "true",
        "show_stat_systems": raw["show_stat_systems"] == "true",
        "show_stat_books": raw["show_stat_books"] == "true",
        "show_stat_pages": raw["show_stat_pages"] == "true",
        "show_stat_maps": raw["show_stat_maps"] == "true",
        "show_stat_tokens": raw["show_stat_tokens"] == "true",
        "show_stat_size": raw["show_stat_size"] == "true",
        "password_auth_enabled": password_auth_effective(raw),
        "password_auth_env_locked": ALLOW_PASSWORD_AUTHENTICATION_ENV is not None,
        "custom_login_message_enabled": raw.get("custom_login_message_enabled", "false") == "true",
        "custom_login_message": raw.get("custom_login_message", ""),
        # OIDC
        **_oidc_to_typed(raw),
    }


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
        "oidc_client_secret_set": bool(secret),
        "oidc_client_secret_length": len(secret) if secret else 0,
        **locks,
    }


def password_auth_effective(raw: dict) -> bool:
    """Return the effective password-auth setting, honoring the env override."""
    if ALLOW_PASSWORD_AUTHENTICATION_ENV is not None:
        return ALLOW_PASSWORD_AUTHENTICATION_ENV
    return raw.get("password_auth_enabled", "true") == "true"


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
        "oidc_authorization_endpoint": s("oidc_authorization_endpoint"),
        "oidc_token_endpoint": s("oidc_token_endpoint"),
        "oidc_userinfo_endpoint": s("oidc_userinfo_endpoint"),
        "oidc_jwks_uri": s("oidc_jwks_uri"),
        "oidc_end_session_endpoint": s("oidc_end_session_endpoint"),
        "oidc_client_id": s("oidc_client_id"),
        "oidc_signing_alg": s("oidc_signing_alg") or "RS256",
        "oidc_button_text": s("oidc_button_text") or "Sign in with SSO",
        "oidc_groups_claim": s("oidc_groups_claim"),
        "oidc_permissions_claim": s("oidc_permissions_claim"),
        "oidc_match_by": s("oidc_match_by") or "none",
        "oidc_auto_launch": b("oidc_auto_launch"),
        "oidc_auto_register": b("oidc_auto_register"),
    }


def oidc_effective_client_secret(raw: dict) -> str:
    """Return the effective client secret. Never call from public-facing code."""
    env_val = OIDC_ENV.get("oidc_client_secret")
    if env_val is not None:
        return env_val
    return raw.get("oidc_client_secret", "") or ""


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


# ---------------------------------------------------------------------------
# Custom login message HTML sanitization
# ---------------------------------------------------------------------------
# The login message is rendered as HTML on the (pre-auth) login screen, so we
# strictly allowlist tags and attributes. The editor on the client only emits
# this set of tags; anything else is dropped.

_ALLOWED_TAGS = {"b", "strong", "i", "em", "s", "strike", "del", "u",
                 "p", "br", "ul", "ol", "li", "a"}
_ALLOWED_ATTRS = {"a": {"href", "title"}}
_DANGEROUS_BLOCK_RE = re.compile(
    r"<(script|style|iframe|object|embed|svg|math)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
_TAG_RE = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>")
_ATTR_RE = re.compile(r"""([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')""")
_SAFE_URL_RE = re.compile(r"^(https?:|mailto:|/|#)", re.IGNORECASE)


def sanitize_login_message(html: str) -> str:
    """Allowlist-sanitize HTML for the custom login message."""
    if not html:
        return ""

    # First strip dangerous blocks (script/style/etc.) including their contents.
    html = _DANGEROUS_BLOCK_RE.sub("", html)

    def repl(match: re.Match) -> str:
        closing = match.group(1) == "/"
        tag = match.group(2).lower()
        attrs_str = match.group(3) or ""
        if tag not in _ALLOWED_TAGS:
            return ""
        if closing:
            return f"</{tag}>"
        # Build sanitized attribute list
        kept: list[str] = []
        allowed = _ALLOWED_ATTRS.get(tag, set())
        for am in _ATTR_RE.finditer(attrs_str):
            name = am.group(1).lower()
            value = am.group(3) if am.group(3) is not None else am.group(4) or ""
            if name not in allowed:
                continue
            if name == "href" and not _SAFE_URL_RE.match(value):
                continue
            kept.append(f'{name}="{value}"')
        if tag == "a":
            # Force safe link relations
            kept.append('rel="noopener noreferrer nofollow"')
            kept.append('target="_blank"')
        return f"<{tag}{(' ' + ' '.join(kept)) if kept else ''}>"

    return _TAG_RE.sub(repl, html)


def get_stats_api_key(db) -> str:
    """Return the current stats API key (empty string = disabled)."""
    row = db.query(AppSetting).filter_by(key="stats_api_key").first()
    return row.value if row else ""
