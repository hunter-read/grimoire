"""Applying a settings PATCH: one writer per setting, looked up by its key.

Each writer validates the value it is given, raising ``HTTPException(400)`` for
a bad one or for a setting an environment variable pins, and stores it. Nothing
is committed here, so a refusal part-way through a patch discards all of it.
"""
import json
from typing import Any, Callable, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ... import config
from ...services import access_control
from ...services import share_links as share_policy
from ...services.oidc_button import MAX_RADIUS_PX, normalize_color, normalize_radius
from . import _helpers as helpers
from ._helpers import (
    _OIDC_BOOL_FIELDS,
    _OIDC_BUTTON_COLOR_FIELDS,
    _OIDC_STRING_FIELDS,
    _VALID_INTERVALS,
    _VALID_MATCH_BY,
    _VALID_SIGNING_ALGS,
    _set,
    sanitize_login_message,
    seal_client_secret,
)

# (db, setting key, patched value) -> None.
Writer = Callable[[Session, str, Any], None]
# The patched value -> the string stored, or None to store nothing.
Transform = Callable[[Any], Optional[str]]


def _flag(value: bool) -> str:
    return "true" if value else "false"


def _store(transform: Transform = _flag) -> Writer:
    def write(db: Session, key: str, value: Any) -> None:
        stored = transform(value)
        if stored is not None:
            _set(db, key, stored)

    return write


def _clamped(low: int, high: Optional[int] = None) -> Writer:
    return _store(lambda value: str(max(low, value if high is None else min(high, value))))


def _one_of(label: str, choices: tuple[str, ...], then: Transform = str) -> Transform:
    def check(value: str) -> Optional[str]:
        if value not in choices:
            raise HTTPException(400, f"{label} must be one of: {', '.join(choices)}")
        return then(value)

    return check


def _pinned(pin: Callable[[], Any], message: str, writer: Writer) -> Writer:
    """``writer``, refused while ``pin()`` is set.

    ``pin`` reads the env var at call time, from ``_helpers`` where the rest of
    the settings code (and the tests that patch it) looks for it.
    """

    def write(db: Session, key: str, value: Any) -> None:
        if pin() is not None:
            raise HTTPException(400, message)
        writer(db, key, value)

    return write


def _restricted_categories(value: dict) -> str:
    # Validated rather than stored as sent: an admin who mistypes a level or
    # tries to restrict a category that may not be restricted (core, character
    # sheets) should be told, not silently ignored.
    try:
        cleaned = access_control.validate_category_defaults(value)
    except access_control.AccessError as exc:
        raise HTTPException(400, str(exc)) from exc
    return json.dumps(cleaned)


def _share_link_role(db: Session, key: str, allowed: bool) -> None:
    share_policy.set_role_default(db, key.removeprefix("share_links_role_"), allowed)


def _oidc_pinned(key: str, writer: Writer) -> Writer:
    return _pinned(
        lambda: helpers.OIDC_ENV.get(key), f"{key} is locked by an environment variable", writer
    )


def _strip(value: str) -> str:
    return value.strip()


def _button_color(key: str) -> Transform:
    # Button appearance is rendered into the public login page's styles, so it
    # is held to strict hex colors / a bounded integer and stored canonicalized.
    def check(value: str) -> str:
        canonical = normalize_color(value)
        if canonical is None:
            raise HTTPException(400, f"{key} must be a hex color like #1a2b3c, or empty")
        return canonical.strip()

    return check


def _button_radius(value: str) -> str:
    radius = normalize_radius(value)
    if radius is None:
        raise HTTPException(
            400, f"oidc_button_radius must be an integer from 0 to {MAX_RADIUS_PX}, or empty"
        )
    return radius.strip()


def _client_secret(value: str) -> str:
    # "__CLEAR__" wipes the stored secret; anything else is stored sealed (see
    # oidc_effective_client_secret).
    return "" if value == "__CLEAR__" else seal_client_secret(value)


def _oidc_writers() -> dict[str, Writer]:
    transforms: dict[str, Transform] = {key: _strip for key in _OIDC_STRING_FIELDS}
    transforms.update({key: _button_color(key) for key in _OIDC_BUTTON_COLOR_FIELDS})
    transforms["oidc_button_radius"] = _button_radius
    transforms["oidc_match_by"] = _one_of("oidc_match_by", _VALID_MATCH_BY, _strip)
    transforms["oidc_signing_alg"] = _one_of("oidc_signing_alg", _VALID_SIGNING_ALGS, _strip)
    transforms.update({key: _flag for key in _OIDC_BOOL_FIELDS})
    writers = {key: _oidc_pinned(key, _store(t)) for key, t in transforms.items()}
    pinned_secret = _oidc_pinned("oidc_client_secret", _store(_client_secret))

    def client_secret(db: Session, key: str, value: str) -> None:
        # "" is no change, so a form re-submit doesn't clobber the stored secret
        # (and is not refused when the secret is pinned).
        if value != "":
            pinned_secret(db, key, value)

    writers["oidc_client_secret"] = client_secret
    return writers


_FLAGS = (
    "rescan_schedule_enabled",
    "cleanup_on_rescan",
    "hide_maps",
    "hide_tokens",
    "hide_audio",
    "hide_models",
    "hide_campaigns",
    "show_stat_systems",
    "show_stat_books",
    "show_stat_pages",
    "show_stat_maps",
    "show_stat_tokens",
    "show_stat_audio",
    "show_stat_models",
    "show_stat_size",
    "show_stat_library_size",
    "campaign_uploads_disabled",
    "custom_login_message_enabled",
)

WRITERS: dict[str, Writer] = {
    **{key: _store() for key in _FLAGS},
    "rescan_schedule_interval": _store(_one_of("interval", _VALID_INTERVALS)),
    "rescan_schedule_hour": _clamped(0, 23),
    "rescan_schedule_minute": _clamped(0, 59),
    "rescan_schedule_weekday": _clamped(0, 6),
    "library_watch_enabled": _pinned(
        lambda: config.LIBRARY_WATCH_ENV,
        "Watching the library is locked by the LIBRARY_WATCH environment variable",
        _store(),
    ),
    "library_watch_mode": _pinned(
        lambda: config.LIBRARY_WATCH_MODE_ENV,
        "The watch mode is locked by the LIBRARY_WATCH_MODE environment variable",
        _store(_one_of("watch mode", config.LIBRARY_WATCH_MODES)),
    ),
    "restricted_categories": _store(_restricted_categories),
    "campaign_upload_max_file_mb": _clamped(0),
    "campaign_upload_max_total_mb": _clamped(0),
    "password_auth_enabled": _pinned(
        lambda: helpers.ALLOW_PASSWORD_AUTHENTICATION_ENV,
        "Password authentication is locked by the ALLOW_PASSWORD_AUTHENTICATION environment variable",
        _store(),
    ),
    "guest_access_enabled": _pinned(
        lambda: helpers.GUEST_ACCESS_ENABLED_ENV,
        "Guest access is locked by the GUEST_ACCESS_ENABLED environment variable",
        _store(),
    ),
    "share_links_role_gm": _share_link_role,
    "share_links_role_player": _share_link_role,
    "disable_folder_category_inference": _pinned(
        lambda: helpers.DISABLE_FOLDER_CATEGORY_INFERENCE_ENV,
        "Folder category inference is locked by the "
        "DISABLE_FOLDER_CATEGORY_INFERENCE environment variable",
        _store(),
    ),
    "custom_login_message": _store(sanitize_login_message),
    **_oidc_writers(),
}


def apply_patch(db: Session, values: dict[str, Any]) -> None:
    """Validate and store each setting in ``values`` (the patch's non-null fields)."""
    for key, value in values.items():
        WRITERS[key](db, key, value)
