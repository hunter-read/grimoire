"""Request bodies for the per-user theme endpoints."""
from typing import Any, Optional

from pydantic import BaseModel, field_validator

from ...services.themes import APP_MODES, THEME_MODES


class ThemeImport(BaseModel):
    """A theme pasted or uploaded by the user.

    Loosely typed on purpose: the real validation is
    ``services.themes.parse_theme``, which drops unknown tokens and unsafe
    colours. Duplicating the allowlist here would give two places to keep in
    step and no extra safety.
    """

    id: Optional[str] = None
    name: Optional[str] = None
    mode: Optional[str] = None
    app_mode: Optional[str] = None
    version: Optional[str] = None
    tokens: dict[str, Any] = {}
    # {colour_mode: {token: colour}} for a theme shipping both a light and a
    # dark palette. Takes precedence over `tokens` when present.
    variants: dict[str, Any] = {}


class ThemeSelection(BaseModel):
    """The user's active appearance: a mode, and optionally an installed theme."""

    mode: Optional[str] = None
    # "" clears the selection and returns to the built-in palette; None leaves
    # it untouched, so a caller can change mode alone.
    theme_id: Optional[str] = None
    # Which app_mode the selection applies to. Omitted means the default.
    app_mode: Optional[str] = None

    @field_validator("app_mode")
    @classmethod
    def known_app_mode(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.lower()
        if value not in APP_MODES:
            raise ValueError(f"app_mode must be one of {', '.join(APP_MODES)}")
        return value

    @field_validator("mode")
    @classmethod
    def known_mode(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.lower()
        if value not in (*THEME_MODES, "system"):
            raise ValueError("mode must be light, dark, or system")
        return value


class ThemeSourceUpdate(BaseModel):
    """An operator pointing the catalogue at a fork or mirror."""

    index_url: Optional[str] = None

    @field_validator("index_url")
    @classmethod
    def http_url(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.strip()
        if value and not value.startswith(("http://", "https://")):
            raise ValueError("index_url must be an http(s) URL")
        return value


class InstalledTheme(BaseModel):
    """One of the user's installed themes, as built by `core._serialize`.

    `mode` and `app_mode` are coalesced by the serializer (`theme.mode or
    "dark"`), and `variants`/`modes`/`is_community` are always computed, so
    those stay required. The three `source_*` columns are null for a theme the
    user authored rather than downloaded, and `tokens` falls back to
    `sanitize_tokens(theme.tokens)`, which returns nothing for a row whose
    tokens are empty or unrecognised.
    """

    id: str
    name: str
    mode: str
    app_mode: str
    variants: dict[str, dict[str, str]]
    modes: list[str]
    tokens: Optional[dict[str, str]] = None
    source_id: Optional[str] = None
    source_url: Optional[str] = None
    source_version: Optional[str] = None
    is_community: bool


class BuiltInTheme(BaseModel):
    """A theme bundled with the app — named here, coloured in the stylesheet."""

    id: str
    name: str
    app_mode: str


class ThemeListResponse(BaseModel):
    installed: list[InstalledTheme]
    app_mode: str
    app_modes: list[str]
    built_in: list[BuiltInTheme]
    # Spread from the user's per-app_mode selection; both are coalesced to a
    # string ("" = the built-in palette).
    mode: str
    theme_id: str
    downloads_enabled: bool
    index_url: str
    default_index_url: str
    is_custom_url: bool


class CatalogueTheme(BaseModel):
    """One catalogue row from `services.themes.list_entries`.

    Every field is coerced to a bounded string or list there, so none can be
    null. `installed` is stamped on by the handler after the fact.
    """

    id: str
    name: str
    description: str
    mode: str
    app_mode: str
    modes: list[str]
    version: str
    author: str
    author_url: str
    path: str
    sha256: str
    grimoire_min_version: str
    installed: bool


class ThemeBrowseResponse(BaseModel):
    themes: list[CatalogueTheme]
    generated: str
    index_url: str
    is_custom_url: bool


class ThemeSelectionResponse(BaseModel):
    """The active app_mode plus the selection within it."""

    app_mode: str
    mode: str
    theme_id: str


class ThemeSourceResponse(BaseModel):
    index_url: str
    is_custom_url: bool


class ThemeDeletedResponse(BaseModel):
    ok: bool
