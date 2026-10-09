"""Request/response models for the GrimoireCodexDB endpoints (issue #35)."""
from typing import Optional

from pydantic import BaseModel, Field


class CodexStatus(BaseModel):
    enabled: bool
    url: str
    can_submit: bool


class CodexSettingsResponse(CodexStatus):
    send_hashes: bool
    has_token: bool
    # Settings pinned by an environment variable (enabled, url, api_token, send_hashes).
    locked: list[str]


class CodexSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    url: Optional[str] = None
    send_hashes: Optional[bool] = None
    # Write-only. "" clears the token; omitted leaves it alone.
    api_token: Optional[str] = Field(default=None, max_length=200)


class CodexAccount(BaseModel):
    name: str
    role: str


class CodexTestResponse(BaseModel):
    ok: bool
    url: str
    # The GrimoireCodexDB account the token belongs to, or None when no token is set.
    account: Optional[CodexAccount] = None


class CodexSubmit(BaseModel):
    # Fields to send, in Grimoire's names. Omitted sends every supported field;
    # for a linked record that means a full correction, so the UI sends a choice.
    fields: Optional[list[str]] = Field(default=None, max_length=40)
    note: str = Field(default="", max_length=2000)


class CodexSubmitResponse(BaseModel):
    # "applied" when GrimoireCodexDB took it straight away, "pending" when it waits for review.
    status: str
    codex_id: Optional[str] = None
    # The record is only linked here once it exists in GrimoireCodexDB.
    linked: bool
    edit_url: str


class StatusResponse(BaseModel):
    status: str
