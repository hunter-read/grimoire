"""HTTP client for the Grimoire Codex DB API (``/api/v1``).

Every call is synchronous, bounded (timeout, response size) and raises
``CodexError`` with a message safe to show the user, so a Grimoire Codex DB outage reads as
"couldn't reach Grimoire Codex DB" in the UI rather than a 500.
"""
import json
from typing import Any, Optional

import httpx
from fastapi import HTTPException

from .. import config
from .settings import CodexSettings

TIMEOUT = 15.0
MAX_BYTES = 2 * 1024 * 1024


class CodexError(Exception):
    """A Grimoire Codex DB request failed. ``status`` is Grimoire Codex DB's HTTP status, when it answered."""

    def __init__(self, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status


class CodexDisabled(CodexError):
    """Grimoire Codex DB is not configured (no ``GRIMOIRE_CODEX_DB_API_TOKEN``)."""


def http_error(exc: CodexError) -> HTTPException:
    """The status Grimoire answers with when a Grimoire Codex DB call fails.

    Not configured is the caller's to fix (400); a record Grimoire Codex DB
    does not have is 404; Grimoire Codex DB rejecting the request keeps its 4xx (so a 422
    validation message reaches the user); anything else is 502, because the
    fault is upstream rather than in this request.
    """
    if isinstance(exc, CodexDisabled):
        return HTTPException(400, str(exc))
    if exc.status == 404:
        return HTTPException(404, "That record is not in Grimoire Codex DB")
    if exc.status == 401:
        return HTTPException(400, "Grimoire Codex DB rejected the API token. Check GRIMOIRE_CODEX_DB_API_TOKEN.")
    if exc.status is not None and 400 <= exc.status < 500:
        return HTTPException(exc.status, str(exc))
    return HTTPException(502, str(exc))


def _message(status: int, body: bytes) -> str:
    """Grimoire Codex DB's own error text when it sent one, else a generic line."""
    try:
        data = json.loads(body)
        if isinstance(data, dict) and isinstance(data.get("error"), str):
            return data["error"]
    except ValueError:
        pass
    return f"Grimoire Codex DB returned HTTP {status}"


def request(
    settings: CodexSettings,
    method: str,
    path: str,
    *,
    params: Optional[dict[str, Any]] = None,
    body: Optional[dict[str, Any]] = None,
) -> Any:
    """Call ``{url}/api/v1{path}`` and return the parsed JSON body.

    Every call sends the API token. Grimoire Codex DB needs it for writes; on
    reads it applies the account's own settings, such as explicit content.
    """
    if not settings.enabled:
        raise CodexDisabled("Grimoire Codex DB is not configured on this server")
    headers = {
        "User-Agent": f"Grimoire/{config.VERSION}",
        "Accept": "application/json",
        "Authorization": f"Bearer {settings.token}",
    }
    try:
        with httpx.Client(timeout=TIMEOUT, follow_redirects=True, max_redirects=3) as client:
            with client.stream(
                method,
                f"{settings.url}/api/v1{path}",
                params={k: v for k, v in (params or {}).items() if v not in (None, "")},
                json=body,
                headers=headers,
            ) as response:
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > MAX_BYTES:
                        raise CodexError("Grimoire Codex DB sent a response that is too large")
                    chunks.append(chunk)
                status = response.status_code
    except httpx.TimeoutException as exc:
        raise CodexError("Grimoire Codex DB did not answer in time") from exc
    except httpx.HTTPError as exc:
        raise CodexError(f"Could not reach Grimoire Codex DB: {exc}") from exc

    raw = b"".join(chunks)
    if status >= 400:
        raise CodexError(_message(status, raw), status)
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise CodexError("Grimoire Codex DB sent a response that is not JSON") from exc


def match_book(settings: CodexSettings, signals: dict[str, Any]) -> dict[str, Any]:
    """``POST /match``: ranked candidates for a file, with a ``best`` id when one is certain."""
    result: dict[str, Any] = request(settings, "POST", "/match", body=signals)
    return result


def search(settings: CodexSettings, query: str, entity_type: str, limit: int = 10) -> list[dict[str, Any]]:
    """``GET /search`` restricted to one record type."""
    data = request(settings, "GET", "/search", params={"q": query, "type": entity_type, "limit": limit})
    items: list[dict[str, Any]] = data.get("items", []) if isinstance(data, dict) else []
    return items


def export(settings: CodexSettings, entity_type: str, codex_id: str) -> dict[str, Any]:
    """A book or system in Grimoire's own field names (``GET /books/{id}/grimoire``)."""
    path = "books" if entity_type == "book" else "systems"
    result: dict[str, Any] = request(settings, "GET", f"/{path}/{codex_id}/grimoire")
    return result


def submit(settings: CodexSettings, entity_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Send a local record (``POST /grimoire/books`` or ``/grimoire/systems``)."""
    path = "books" if entity_type == "book" else "systems"
    result: dict[str, Any] = request(settings, "POST", f"/grimoire/{path}", body=payload)
    return result


def me(settings: CodexSettings) -> dict[str, Any]:
    """The account the token belongs to (``user`` is null if Grimoire Codex DB does not know it)."""
    result: dict[str, Any] = request(settings, "GET", "/me")
    return result
