"""Links people add to metadata and campaigns are rendered as ``href``s, so only
http(s) URLs are kept.

Requests are validated strictly: a ``javascript:``, ``data:`` or app-scheme URL
is refused with a 422. Responses are filtered instead of validated, so a link
stored before this check existed (or written by an add-on scraper, which does
not go through the request models) comes back blank rather than failing the
whole response.
"""
from typing import Optional

from pydantic import BaseModel, field_validator

_SCHEMES = ("http://", "https://")
INVALID_URL = "links must be http:// or https:// URLs"


def is_http_url(value: Optional[str]) -> bool:
    """Whether ``value`` is an http(s) URL (blank counts as no link, not a bad one)."""
    text = (value or "").strip()
    return not text or text.lower().startswith(_SCHEMES)


def require_http_url(value: Optional[str]) -> Optional[str]:
    """Request-side validator body: strip, and refuse any other scheme."""
    if value is None:
        return None
    text = value.strip()
    if not is_http_url(text):
        raise ValueError(INVALID_URL)
    return text


def http_url_or_blank(value: Optional[str]) -> str:
    """Response-side filter: the URL when it is http(s), else ``""``."""
    return (value or "").strip() if is_http_url(value) else ""


def http_url_or_none(value: Optional[str]) -> Optional[str]:
    """Response-side filter for a nullable URL column."""
    return value if value is None or is_http_url(value) else None


class LinkEntry(BaseModel):
    """A labeled link sent by a client (publisher page, character builder…)."""

    label: str = ""
    url: str = ""

    @field_validator("url")
    @classmethod
    def _http_only(cls, v: str) -> str:
        return require_http_url(v) or ""


class LinkRef(BaseModel):
    """A labeled link as returned, with any non-http(s) URL blanked."""

    label: str = ""
    url: str = ""

    @field_validator("url", mode="before")
    @classmethod
    def _http_only(cls, v: Optional[str]) -> str:
        return http_url_or_blank(v)
