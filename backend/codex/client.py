"""HTTP client for the GrimoireCodexDB API (``/api/v1``).

Every call is synchronous, bounded (timeout, response size) and raises
``CodexError`` with a message safe to show the user, so a GrimoireCodexDB outage reads as
"couldn't reach GrimoireCodexDB" in the UI rather than a 500.
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
    """A GrimoireCodexDB request failed. ``status`` is GrimoireCodexDB's HTTP status, when it answered."""

    def __init__(self, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status


class CodexDisabled(CodexError):
    """GrimoireCodexDB is turned off in settings, or a write was attempted without a token."""


def http_error(exc: CodexError) -> HTTPException:
    """The status Grimoire answers with when a GrimoireCodexDB call fails.

    Turned off or missing a token is the caller's to fix (400); a record GrimoireCodexDB
    does not have is 404; GrimoireCodexDB rejecting the request keeps its 4xx (so a 422
    validation message reaches the user); anything else is 502, because the
    fault is upstream rather than in this request.
    """
    if isinstance(exc, CodexDisabled):
        return HTTPException(400, str(exc))
    if exc.status == 404:
        return HTTPException(404, "That record is not in GrimoireCodexDB")
    if exc.status == 401:
        return HTTPException(400, "GrimoireCodexDB rejected the API token. Check it in settings.")
    if exc.status is not None and 400 <= exc.status < 500:
        return HTTPException(exc.status, str(exc))
    return HTTPException(502, str(exc))


def _message(status: int, body: bytes) -> str:
    """GrimoireCodexDB's own error text when it sent one, else a generic line."""
    try:
        data = json.loads(body)
        if isinstance(data, dict) and isinstance(data.get("error"), str):
            return data["error"]
    except ValueError:
        pass
    return f"GrimoireCodexDB returned HTTP {status}"


def request(
    settings: CodexSettings,
    method: str,
    path: str,
    *,
    params: Optional[dict[str, Any]] = None,
    body: Optional[dict[str, Any]] = None,
    auth: bool = False,
) -> Any:
    """Call ``{url}/api/v1{path}`` and return the parsed JSON body.

    ``auth`` sends the API token; it is required for writes and optional for
    reads (with it, GrimoireCodexDB applies the account's own settings, such as explicit
    content).
    """
    if not settings.enabled:
        raise CodexDisabled("GrimoireCodexDB is turned off in settings")
    headers = {
        "User-Agent": f"Grimoire/{config.VERSION}",
        "Accept": "application/json",
    }
    if auth:
        if not settings.token:
            raise CodexDisabled("Add a GrimoireCodexDB API token in settings to send records")
        headers["Authorization"] = f"Bearer {settings.token}"
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
                        raise CodexError("GrimoireCodexDB sent a response that is too large")
                    chunks.append(chunk)
                status = response.status_code
    except httpx.TimeoutException as exc:
        raise CodexError("GrimoireCodexDB did not answer in time") from exc
    except httpx.HTTPError as exc:
        raise CodexError(f"Could not reach GrimoireCodexDB: {exc}") from exc

    raw = b"".join(chunks)
    if status >= 400:
        raise CodexError(_message(status, raw), status)
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise CodexError("GrimoireCodexDB sent a response that is not JSON") from exc


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
    result: dict[str, Any] = request(settings, "POST", f"/grimoire/{path}", body=payload, auth=True)
    return result


def me(settings: CodexSettings) -> dict[str, Any]:
    """The account the token belongs to (``user`` is null without a valid token)."""
    result: dict[str, Any] = request(settings, "GET", "/me", auth=bool(settings.token))
    return result
