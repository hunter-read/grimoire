"""URL → character import adapters.

Sheets declare supported sources under ``import_sources``. Each source ``id``
may have a converter registered here. Core stays free of sheet-specific UI;
the converters are small adapters that emit a ``grimoire://character/v1``
payload for :func:`import_character`.
"""
from __future__ import annotations

import fnmatch
import os
from typing import Any, Callable, Optional
from urllib.parse import urlparse

from . import dicecloud_v1

ConvertFn = Callable[..., dict]


class ImportSourceError(Exception):
    """A URL could not be imported."""


_REGISTRY: dict[str, ConvertFn] = {
    "dicecloud-v1": dicecloud_v1.import_from_url,
}


def registered_ids() -> list[str]:
    return sorted(_REGISTRY)


def match_pattern(url: str, pattern: str) -> bool:
    """Match a source ``url_pattern`` (glob or exact prefix) against ``url``."""
    url = url.strip()
    pattern = pattern.strip()
    if not url or not pattern:
        return False
    if "*" in pattern or "?" in pattern:
        return fnmatch.fnmatch(url, pattern) or fnmatch.fnmatch(
            url.split("?", 1)[0].rstrip("/"), pattern.rstrip("/")
        )
    return url.startswith(pattern) or url.rstrip("/") == pattern.rstrip("/")


def sources_from_schema(document: dict) -> list[dict[str, Any]]:
    """Normalise a sheet's ``import_sources`` list for the API."""
    raw = document.get("import_sources") or []
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        source_id = item.get("id")
        name = item.get("name")
        patterns = item.get("url_patterns") or []
        if not isinstance(source_id, str) or not source_id.strip():
            continue
        if not isinstance(name, str) or not name.strip():
            continue
        if not isinstance(patterns, list) or not patterns:
            continue
        cleaned_patterns = [p.strip() for p in patterns if isinstance(p, str) and p.strip()]
        if not cleaned_patterns:
            continue
        entry = {
            "id": source_id.strip(),
            "name": name.strip(),
            "url_patterns": cleaned_patterns,
            "available": source_id.strip() in _REGISTRY,
        }
        example = item.get("example_url")
        if isinstance(example, str) and example.strip():
            entry["example_url"] = example.strip()
        out.append(entry)
    return out


def find_source_for_url(
    url: str, sources: list[dict[str, Any]]
) -> Optional[dict[str, Any]]:
    for source in sources:
        for pattern in source.get("url_patterns") or []:
            if match_pattern(url, pattern):
                return source
    return None


def convert_url(
    url: str,
    *,
    source_id: str,
    schema_id: str,
    api_key: Optional[str] = None,
) -> dict:
    """Run the registered converter for ``source_id``."""
    fn = _REGISTRY.get(source_id)
    if not fn:
        raise ImportSourceError(
            f"No converter is installed for import source {source_id!r}"
        )
    key = (api_key or "").strip() or os.environ.get("DICECLOUD_API_KEY", "").strip()
    try:
        if source_id == "dicecloud-v1":
            return fn(url, api_key=key, schema_id=schema_id)
        return fn(url, schema_id=schema_id)
    except ValueError as exc:
        raise ImportSourceError(str(exc)) from exc


def looks_like_http_url(value: str) -> bool:
    try:
        parsed = urlparse(value.strip())
    except Exception:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)
