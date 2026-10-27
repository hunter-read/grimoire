"""Request/response models for the Grimoire Codex DB endpoints (issue #35)."""
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from .._codex_schemas import codex_id_validator


def _http_url(value: str) -> str:
    value = value.strip()
    if not value.startswith(("http://", "https://")) or len(value) > 1000 or any(c.isspace() for c in value):
        raise ValueError("Links must be http(s) addresses")
    return value


class CodexStatus(BaseModel):
    # GRIMOIRE_CODEX_DB_API_TOKEN is set. Without it nothing about Grimoire Codex DB is shown.
    enabled: bool
    url: str


class CodexSettingsResponse(BaseModel):
    url: str
    send_hashes: bool
    # Keep the token owner's Grimoire Codex DB collection in step with what is linked here.
    sync_collection: bool
    # Settings pinned by an environment variable (url, send_hashes, sync_collection).
    locked: list[str]


class CodexSettingsUpdate(BaseModel):
    url: Optional[str] = None
    send_hashes: Optional[bool] = None
    sync_collection: Optional[bool] = None


class CodexCollectionCounts(BaseModel):
    books: int
    systems: int


class CodexCollectionUnknown(BaseModel):
    books: list[str]
    systems: list[str]


class CodexCollectionSyncResponse(BaseModel):
    # How many linked records were sent.
    sent: CodexCollectionCounts
    # How many Grimoire Codex DB marked.
    books: int
    systems: int
    # Linked ids Grimoire Codex DB no longer knows (deleted there, or never existed).
    unknown: CodexCollectionUnknown


class CodexAccount(BaseModel):
    name: str
    role: str


class CodexTestResponse(BaseModel):
    ok: bool
    url: str
    # The Grimoire Codex DB account the token belongs to, or None if it does not say.
    account: Optional[CodexAccount] = None


class CodexAttribution(BaseModel):
    """Credit for fields taken from another catalogue: they stay that source's, not CC0."""

    source: str = Field(min_length=1, max_length=120)
    url: str
    fields: list[Literal["description", "tags"]] = Field(min_length=1, max_length=2)

    _url = field_validator("url")(_http_url)


class CodexSystemChoice(BaseModel):
    """For a new book whose game system is not linked: which Grimoire Codex DB system it belongs to."""

    # An existing Grimoire Codex DB system; the local system is linked to it once the book is sent.
    codex_id: Optional[str] = None
    # Or send the local system as a new record first.
    create: bool = False

    _codex_id = field_validator("codex_id")(codex_id_validator)


class CodexSubmit(BaseModel):
    # Fields to send, in Grimoire's names. Omitted sends every supported field;
    # for a linked record that means a full correction, so the UI sends a choice.
    fields: Optional[list[str]] = Field(default=None, max_length=40)
    note: str = Field(default="", max_length=2000)
    # Upload this record's cover with it.
    cover: bool = False
    # Links that support the record, such as the page it was scraped from.
    sources: list[str] = Field(default_factory=list, max_length=10)
    attribution: Optional[CodexAttribution] = None
    system: Optional[CodexSystemChoice] = None
    # The Grimoire Codex DB revision the choice was made against, from /compare.
    base_revision: Optional[int] = Field(default=None, ge=1)

    @field_validator("sources")
    @classmethod
    def _sources(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(_http_url(v) for v in value if v.strip()))


class CodexSubmitResult(BaseModel):
    # "applied" when Grimoire Codex DB took it straight away, "pending" when it waits for review,
    # "waiting_for_system" when the book was not sent because its new system waits for review.
    status: str
    codex_id: Optional[str] = None
    # The record is only linked here once it exists in Grimoire Codex DB.
    linked: bool
    edit_url: str


class CodexSubmitResponse(CodexSubmitResult):
    # A new book's game system, when it was sent first.
    system: Optional[CodexSubmitResult] = None


class CodexCompareField(BaseModel):
    field: str
    # Loosely typed: a field may be a string, number, bool, list, or list of links.
    local: Optional[Any] = None
    remote: Optional[Any] = None
    # only_local | differs | same | only_remote (see backend/codex/compare.py)
    status: str


class CodexCompareCover(BaseModel):
    local: bool
    remote_url: Optional[str] = None
    # As for fields, plus "none" when neither side has a cover.
    status: str


class CodexAttributionSource(BaseModel):
    # An enabled scraper add-on, and the record's link on its site ("" when it has none).
    id: str
    name: str
    url: str


class CodexSystemCandidate(BaseModel):
    codex_id: str
    name: str
    label: str
    url: str


class CodexCompareSystem(BaseModel):
    """A new book's game system, and the Grimoire Codex DB systems it might be."""

    id: str
    name: str
    codex_id: Optional[str] = None
    candidates: list[CodexSystemCandidate] = []


class CodexCompareResponse(BaseModel):
    linked: bool
    codex_id: Optional[str] = None
    codex_url: Optional[str] = None
    revision: Optional[int] = None
    fields: list[CodexCompareField]
    cover: CodexCompareCover
    # The credits Grimoire Codex DB already has on the record.
    attributions: list[dict[str, Any]] = []
    attribution_sources: list[CodexAttributionSource]
    # Books that are not linked yet only.
    system: Optional[CodexCompareSystem] = None


class StatusResponse(BaseModel):
    status: str
