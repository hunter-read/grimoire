"""Pydantic schemas for the add-ons API."""
from typing import Optional

from pydantic import BaseModel, field_validator


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
