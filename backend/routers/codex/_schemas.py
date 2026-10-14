"""Request/response models for the Grimoire Codex DB endpoints (issue #35)."""
from typing import Optional

from pydantic import BaseModel, Field


class CodexStatus(BaseModel):
    # GRIMOIRE_CODEX_DB_API_TOKEN is set. Without it nothing about Grimoire Codex DB is shown.
    enabled: bool
    url: str


class CodexSettingsResponse(BaseModel):
    url: str
    send_hashes: bool
    # Settings pinned by an environment variable (url, send_hashes).
    locked: list[str]


class CodexSettingsUpdate(BaseModel):
    url: Optional[str] = None
    send_hashes: Optional[bool] = None


class CodexAccount(BaseModel):
    name: str
    role: str


class CodexTestResponse(BaseModel):
    ok: bool
    url: str
    # The Grimoire Codex DB account the token belongs to, or None if it does not say.
    account: Optional[CodexAccount] = None


class CodexSubmit(BaseModel):
    # Fields to send, in Grimoire's names. Omitted sends every supported field;
    # for a linked record that means a full correction, so the UI sends a choice.
    fields: Optional[list[str]] = Field(default=None, max_length=40)
    note: str = Field(default="", max_length=2000)


class CodexSubmitResponse(BaseModel):
    # "applied" when Grimoire Codex DB took it straight away, "pending" when it waits for review.
    status: str
    codex_id: Optional[str] = None
    # The record is only linked here once it exists in Grimoire Codex DB.
    linked: bool
    edit_url: str


class StatusResponse(BaseModel):
    status: str
