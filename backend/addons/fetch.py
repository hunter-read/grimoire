"""HTTP fetching for add-ons, with an on-disk response cache.

Every outbound add-on request goes through here so the limits (timeout, size
cap, redirect cap) apply uniformly no matter what a definition asks for. Sources
publish whole catalogues, so responses are cached on disk for the manifest's
``cache_ttl`` — one fetch a day typically serves every lookup.
"""
import hashlib
import json
import logging
import os
import time
from typing import TYPE_CHECKING, Any, Callable, Optional

import httpx

from .. import config
from .constants import (
    ADDON_CACHE_DIR,
    DEFAULT_CACHE_TTL,
    HTTP_MAX_BYTES,
    HTTP_MAX_REDIRECTS,
    HTTP_TIMEOUT,
)

if TYPE_CHECKING:
    from .credentials import SourceCredentials

logger = logging.getLogger("grimoire.addons")


class AddonFetchError(Exception):
    """An add-on's source could not be fetched or parsed.

    Carries a message safe to show the user — the UI surfaces these directly so
    a dead source reads as "couldn't reach it", not a 500.
    """


class DownloadError(AddonFetchError):
    """A ``download`` that failed, and how, so each caller can word it its own way.

    ``reason`` is "status" (``status`` holds the code), "timeout", "network"
    (``detail`` holds httpx's message) or "too_large".
    """

    def __init__(self, reason: str, status: Optional[int] = None, detail: str = "") -> None:
        self.reason = reason
        self.status = status
        self.detail = detail
        super().__init__(self.describe("file"))

    def describe(self, what: str) -> str:
        """The failure as a sentence about downloading ``what``."""
        if self.reason == "status":
            return f"The {what} download returned HTTP {self.status}"
        if self.reason == "timeout":
            return f"The {what} download timed out"
        if self.reason == "too_large":
            return f"That {what} file is too large"
        return f"Could not download the {what}: {self.detail}"


def _cache_path(url: str) -> str:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
    return os.path.join(ADDON_CACHE_DIR, f"{digest}.json")


def read_cache(url: str, ttl: int) -> Optional[Any]:
    """Return the cached document for ``url`` when still fresh, else None."""
    if ttl <= 0:
        return None
    path = _cache_path(url)
    try:
        age = time.time() - os.path.getmtime(path)
        if age > ttl:
            return None
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        # Missing, unreadable, or corrupt cache is simply a miss.
        return None


def write_cache(url: str, document: Any) -> None:
    """Persist a fetched document.  Cache failures are never fatal."""
    path = _cache_path(url)
    try:
        os.makedirs(ADDON_CACHE_DIR, exist_ok=True)
        # Write-then-rename so a crash mid-write cannot leave a truncated file
        # that later reads as corrupt.
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(document, fh)
        os.replace(tmp, path)
    except (OSError, TypeError, ValueError) as exc:
        logger.warning("Add-on cache write failed for %s: %s", url, exc)


def clear_cache(url: Optional[str] = None) -> None:
    """Drop one cached response, or the whole cache."""
    try:
        if url is not None:
            os.unlink(_cache_path(url))
            return
        for name in os.listdir(ADDON_CACHE_DIR):
            if name.endswith(".json"):
                os.unlink(os.path.join(ADDON_CACHE_DIR, name))
    except OSError:
        pass


def _user_agent(template: str) -> str:
    if not template:
        return f"Grimoire/{config.VERSION}"
    return template.replace("{version}", config.VERSION)


def open_client(
    *,
    timeout: float = HTTP_TIMEOUT,
    headers: Optional[dict[str, str]] = None,
    credentials: Optional["SourceCredentials"] = None,
) -> httpx.Client:
    """An httpx client with the shared redirect limits, for catalogue downloads.

    ``credentials`` attaches a private source's token to each request that falls
    inside that source - re-checked on every redirect hop, so a redirect out of
    the source never carries it (see ``credentials.SourceCredentials.apply``).
    """
    hooks = {"request": [credentials.apply]} if credentials else {}
    return httpx.Client(
        timeout=timeout,
        follow_redirects=True,
        max_redirects=HTTP_MAX_REDIRECTS,
        headers=headers or {"User-Agent": f"Grimoire/{config.VERSION}"},
        event_hooks=hooks,
    )


def download(
    url: str,
    *,
    max_bytes: Optional[int] = None,
    timeout: float = HTTP_TIMEOUT,
    headers: Optional[dict[str, str]] = None,
    credentials: Optional["SourceCredentials"] = None,
) -> bytes:
    """GET ``url`` and return its body, reading no more than ``max_bytes`` of it.

    The body is streamed and counted as it arrives, so a response with no
    Content-Length (or a wrong one) stops one chunk past the limit rather than
    being read whole first. ``max_bytes`` is capped at ``HTTP_MAX_BYTES``.
    Raises ``DownloadError``.
    """
    limit = HTTP_MAX_BYTES if max_bytes is None else min(max_bytes, HTTP_MAX_BYTES)
    try:
        with open_client(timeout=timeout, headers=headers, credentials=credentials) as client:
            with client.stream("GET", url) as response:
                if response.status_code != 200:
                    raise DownloadError("status", status=response.status_code)

                # Trust the declared length when present, but still count bytes:
                # a lying or absent Content-Length must not let us read forever.
                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > limit:
                    raise DownloadError("too_large")

                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > limit:
                        raise DownloadError("too_large")
                    chunks.append(chunk)
    except httpx.TimeoutException as exc:
        raise DownloadError("timeout") from exc
    except httpx.HTTPError as exc:
        raise DownloadError("network", detail=str(exc)) from exc
    return b"".join(chunks)


def download_file(
    url: str,
    *,
    what: str,
    error: Callable[[str], Exception],
    max_bytes: Optional[int] = None,
    timeout: float = HTTP_TIMEOUT,
    credentials: Optional["SourceCredentials"] = None,
) -> bytes:
    """``download``, with a failure raised as ``error`` and worded about ``what``.

    For the catalogue installers (sheets, packs, themes, wiki templates, add-on
    files), which each have their own error type but say the same things.
    """
    try:
        return download(url, max_bytes=max_bytes, timeout=timeout, credentials=credentials)
    except DownloadError as exc:
        raise error(exc.describe(what)) from exc


def fetch_json(
    url: str,
    user_agent: str = "",
    timeout: int = HTTP_TIMEOUT,
    credentials: Optional["SourceCredentials"] = None,
) -> Any:
    """GET ``url`` and parse JSON, enforcing the shared network limits.

    Raises ``AddonFetchError`` with a user-facing message on any failure.
    """
    headers = {"User-Agent": _user_agent(user_agent), "Accept": "application/json"}
    try:
        body = download(url, timeout=timeout, headers=headers, credentials=credentials)
    except DownloadError as exc:
        raise AddonFetchError(_source_message(exc)) from exc

    try:
        return json.loads(body)
    except (ValueError, RecursionError):
        # If strict JSON decoding fails, attempt parsing as YAML for index sources
        # (e.g. index.yaml) before raising a fetch error.
        try:
            from ..services import untrusted_yaml

            parsed = untrusted_yaml.safe_load(body)
            if isinstance(parsed, (dict, list)):
                return parsed
        except Exception:
            pass
        raise AddonFetchError("source did not return valid JSON or YAML")


def _source_message(exc: DownloadError) -> str:
    """``fetch_json``'s wording: the thing fetched is an add-on's source."""
    if exc.reason == "status":
        return f"source returned HTTP {exc.status}"
    if exc.reason == "timeout":
        return "source timed out"
    if exc.reason == "too_large":
        return "source response is too large"
    return f"could not reach source: {exc.detail}"


def fetch_document(
    url: str,
    user_agent: str = "",
    cache_ttl: int = DEFAULT_CACHE_TTL,
    force: bool = False,
    timeout: int = HTTP_TIMEOUT,
    credentials: Optional["SourceCredentials"] = None,
) -> Any:
    """Fetch ``url``, serving from the disk cache while it is fresh.

    ``timeout`` lets a caller fetching a small file fail faster than the
    catalogue-sized default. ``credentials`` is for catalogue sources only -
    a scraper's requests to its target site never pass it.
    """
    if not force:
        cached = read_cache(url, cache_ttl)
        # Early return on cache hit to avoid redundant network round trips
        if cached is not None:
            logger.debug("Add-on cache hit for %s", url)
            return cached

    logger.debug("Add-on fetching %s", url)
    document = fetch_json(url, user_agent=user_agent, timeout=timeout, credentials=credentials)
    if cache_ttl > 0:
        write_cache(url, document)
    return document
