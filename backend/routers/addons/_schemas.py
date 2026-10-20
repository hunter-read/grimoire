"""Pydantic schemas for the add-ons API."""
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ...addons.urls import index_url_problem


class ChangelogEntry(BaseModel):
    version: str
    changes: list[str]


class AddonInstall(BaseModel):
    """Install/update request.

    ``approve_script`` is the operator's explicit consent to run third-party
    code, collected per add-on at install time. It is meaningless for YAML-only
    add-ons and ignored for them.
    """

    approve_script: bool = False
    index_url: Optional[str] = None


class AddonUpdate(BaseModel):
    enabled: Optional[bool] = None
    script_approved: Optional[bool] = None


class AddonSettingsUpdate(BaseModel):
    index_url: Optional[str] = None
    index_urls: Optional[list[str]] = None
    allow_scripts: Optional[bool] = None

    @field_validator("index_urls", "index_url")
    @classmethod
    def http_urls(cls, v: Any) -> Any:
        if v is None:
            return v
        urls = [v] if isinstance(v, str) else v
        for url in urls:
            if not isinstance(url, str):
                continue
            url = url.strip()
            problem = index_url_problem(url) if url else None
            if problem:
                raise ValueError(problem)
        return v



class SourceCredentialSet(BaseModel):
    """An access token for one configured index source (issue #642).

    ``header`` defaults to ``Authorization``, sent as ``Bearer <token>``; any
    other header name (GitLab's ``PRIVATE-TOKEN``) carries the token as is.
    """

    url: str
    token: str = Field(max_length=4096)
    header: Optional[str] = Field(default=None, max_length=64)


class SourceCredentialInfo(BaseModel):
    """What the UI may know about a source's token - never the token itself."""

    header: str
    # Set by ADDON_INDEX_CREDENTIALS, so it cannot be changed or removed here.
    env_locked: bool
    # Stored, but SECRET_KEY has changed since, so it must be entered again.
    unreadable: bool


class SourceCredentialsResponse(BaseModel):
    source_credentials: dict[str, SourceCredentialInfo] = Field(default_factory=dict)


class InstalledAddon(BaseModel):
    """One installed add-on, as built by `addons.registry.describe`.

    Every field is read off a validated `AddonManifest` (whose optional strings
    default to `""`, never null) or coerced by `describe` itself, so nothing
    here can be absent. `available_version`/`update_available` are seeded to
    `""`/`False` by `describe` and overwritten by the list handler when the
    add-on also appears in the cached index — a hand-placed add-on keeps the
    seeded values rather than dropping the keys.
    """

    id: str
    name: str
    version: str
    kind: str
    target: str
    description: str
    homepage: str
    author: str
    author_url: str
    attribution: str
    requires_script: bool
    script_approved: bool
    enabled: bool
    runnable: bool
    blocked_reason: str
    source: str
    available_version: str
    update_available: bool
    changelog: Optional[list[ChangelogEntry]] = None
    source_url: Optional[str] = ""
    index_url: Optional[str] = ""
    available_in: list[dict] = Field(default_factory=list)


class AvailableAddon(BaseModel):
    """One row of the cached community index, as offered to the admin UI.

    Mirrors `addons.manifest.IndexEntry`, whose optional fields all default to
    `""`/`False`, so none can be null.
    """

    id: str
    name: str
    kind: str
    target: str
    version: str
    description: str
    homepage: str
    author: str
    author_url: str
    requires_script: bool
    script_sha256: str
    installed: bool
    update_available: bool
    changelog: Optional[list[ChangelogEntry]] = None
    source_url: Optional[str] = ""
    index_url: Optional[str] = ""
    available_in: list[dict] = Field(default_factory=list)


class VerifyIndexResponse(BaseModel):
    url: str
    verified: bool
    trusted_index_urls: list[str] = Field(default_factory=list)


class AddonListResponse(BaseModel):
    installed: list[InstalledAddon]
    available: list[AvailableAddon]
    index_url: Optional[str] = None
    index_urls: list[str] = Field(default_factory=list)
    default_index_url: str
    trusted_index_urls: list[str] = Field(default_factory=list)
    source_contents: dict[str, list[str]] = Field(default_factory=dict)
    # Keyed by configured index URL; a source without a token is absent.
    source_credentials: dict[str, SourceCredentialInfo] = Field(default_factory=dict)
    allow_scripts: bool
    # From the cached index blob, which may predate the `generated` key.
    index_generated: Optional[str] = None


class RefreshIndexResponse(BaseModel):
    status: str
    count: int
    errors: list[dict] = Field(default_factory=list)


class AddonUpdated(BaseModel):
    """One add-on that updated cleanly. `from`/`to` are the two versions."""

    id: str
    # `from` is a Python keyword, so it is aliased rather than named directly.
    from_version: str = Field(alias="from")
    to: str

    model_config = ConfigDict(populate_by_name=True)


class AddonUpdateFailure(BaseModel):
    id: str
    error: str


class UpdateAllResponse(BaseModel):
    status: str
    updated: list[AddonUpdated]
    failed: list[AddonUpdateFailure]


class AddonSettingsResponse(BaseModel):
    index_url: Optional[str] = None
    index_urls: list[str] = Field(default_factory=list)
    allow_scripts: bool


class StatusResponse(BaseModel):
    status: str
