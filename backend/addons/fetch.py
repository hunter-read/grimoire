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
from typing import Any, Optional

import httpx

from .. import config
from .constants import (
    ADDON_CACHE_DIR,
    DEFAULT_CACHE_TTL,
    HTTP_MAX_BYTES,
    HTTP_MAX_REDIRECTS,
    HTTP_TIMEOUT,
)

logger = logging.getLogger("grimoire.addons")


class AddonFetchError(Exception):
    """An add-on's source could not be fetched or parsed.

    Carries a message safe to show the user — the UI surfaces these directly so
    a dead source reads as "couldn't reach it", not a 500.
    """


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


def fetch_json(url: str, user_agent: str = "", timeout: int = HTTP_TIMEOUT) -> Any:
    """GET ``url`` and parse JSON, enforcing the shared network limits.

    Raises ``AddonFetchError`` with a user-facing message on any failure.
    """
    headers = {"User-Agent": _user_agent(user_agent), "Accept": "application/json"}
    try:
        with httpx.Client(
            timeout=timeout,
            follow_redirects=True,
            max_redirects=HTTP_MAX_REDIRECTS,
            headers=headers,
        ) as client:
            with client.stream("GET", url) as response:
                if response.status_code != 200:
                    raise AddonFetchError(
                        f"source returned HTTP {response.status_code}"
                    )

                # Trust the declared length when present, but still count bytes:
                # a lying or absent Content-Length must not let us read forever.
                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > HTTP_MAX_BYTES:
                    raise AddonFetchError("source response is too large")

                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > HTTP_MAX_BYTES:
                        raise AddonFetchError("source response is too large")
                    chunks.append(chunk)

        body = b"".join(chunks)
    except httpx.TimeoutException as exc:
        raise AddonFetchError("source timed out") from exc
    except httpx.HTTPError as exc:
        raise AddonFetchError(f"could not reach source: {exc}") from exc

    try:
        return json.loads(body)
    except ValueError as exc:
        raise AddonFetchError("source did not return valid JSON") from exc


def fetch_document(
    url: str,
    user_agent: str = "",
    cache_ttl: int = DEFAULT_CACHE_TTL,
    force: bool = False,
) -> Any:
    """Fetch ``url``, serving from the disk cache while it is fresh."""
    if not force:
        cached = read_cache(url, cache_ttl)
        if cached is not None:
            logger.debug("Add-on cache hit for %s", url)
            return cached

    logger.debug("Add-on fetching %s", url)
    document = fetch_json(url, user_agent=user_agent)
    if cache_ttl > 0:
        write_cache(url, document)
    return document
