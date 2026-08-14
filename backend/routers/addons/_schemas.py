"""Pydantic schemas for the add-ons API."""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AddonInstall(BaseModel):
    """Install/update request.

    ``approve_script`` is the operator's explicit consent to run third-party
    code, collected per add-on at install time. It is meaningless for YAML-only
    add-ons and ignored for them.
    """

    approve_script: bool = False


class AddonUpdate(BaseModel):
    enabled: Optional[bool] = None
    script_approved: Optional[bool] = None


class AddonSettingsUpdate(BaseModel):
    index_url: Optional[str] = None
    allow_scripts: Optional[bool] = None

    @field_validator("index_url")
    @classmethod
    def http_url(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if v and not v.startswith(("http://", "https://")):
            raise ValueError("index URL must be an http(s) URL")
        return v


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
    attribution: str
    requires_script: bool
    script_approved: bool
    enabled: bool
    runnable: bool
    blocked_reason: str
    source: str
    available_version: str
    update_available: bool


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
    requires_script: bool
    script_sha256: str
    installed: bool
    update_available: bool


class AddonListResponse(BaseModel):
    installed: list[InstalledAddon]
    available: list[AvailableAddon]
    index_url: str
    default_index_url: str
    allow_scripts: bool
    # From the cached index blob, which may predate the `generated` key.
    index_generated: Optional[str] = None


class RefreshIndexResponse(BaseModel):
    status: str
    count: int


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
    index_url: str
    allow_scripts: bool


class StatusResponse(BaseModel):
    status: str
