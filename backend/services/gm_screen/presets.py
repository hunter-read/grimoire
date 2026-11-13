"""The community catalogue of GM screen presets.

A preset is a ready-made board - a Daggerheart screen with Fear and countdowns
already placed, a Draw Steel one whose initiative tracker has the sides take
turns. Presets live in the community add-on repository under ``gm-screens/``,
beside the character sheets, and are found the way sheets are: derived from the
add-on index the admin configured, so pointing that at a branch points every
catalogue at it.

A preset is data. It is fetched, checked against the digest its catalogue
published, and read by ``boards.parse_board``, which knows only the built-in
panel kinds and bounds every value. Applying one changes one campaign's board
and nothing else, so a campaign's GM may apply one without an admin.

Downloading is off when ``DISABLE_EXTERNAL_ADD_ON_INSTALL`` is set, the shared
switch for every community install.
"""
import json
import logging
from typing import Any, Optional

from sqlalchemy.orm import Session

from ... import config
from ...addons import credentials as source_credentials
from ...addons.authors import parse_author
from ...addons.constants import DEFAULT_INDEX_URL, external_installs_enabled
from ...addons.credentials import SourceCredentials
from ...addons.fetch import AddonFetchError, download_file, fetch_document, is_not_found
from ..characters import catalogue as sheets
from . import boards
from .panels import PanelError

logger = logging.getLogger("grimoire.gm_screen")

__all__ = [
    "PresetError",
    "downloads_enabled",
    "fetch_catalogue",
    "find_entry",
    "fetch_preset",
]

INDEX_PATH = "gm-screens/index.json"
CACHE_TTL = 3600
FETCH_TIMEOUT = 10
#: A board is a few dozen panels of small JSON. Generous, and still small.
MAX_PRESET_BYTES = 256 * 1024


class PresetError(ValueError):
    """The catalogue could not be read, or a preset is not usable."""


def downloads_enabled() -> bool:
    return external_installs_enabled()


def _assert_downloads_enabled() -> None:
    if not downloads_enabled():
        raise PresetError("Downloading GM screen presets is disabled on this server")


def _clean(value: Any, limit: int = 500) -> str:
    """A bounded plain string. The catalogue is untrusted input."""
    return value.strip()[:limit] if isinstance(value, str) else ""


def _configured_sources(db: Session) -> list[str]:
    """The add-on sources the admin configured; presets are derived from them."""
    from ...addons.registry import get_index_url as get_addon_index_url

    configured = [url.strip() for url in get_addon_index_url(db).split(",") if url.strip()]
    return configured or [DEFAULT_INDEX_URL]


def _read_source(
    configured: str, credentials: Optional[SourceCredentials]
) -> tuple[Optional[str], list[dict], Optional[str]]:
    """The first candidate URL holding a preset index: (url, entries, error).

    A candidate that answers 404 has no presets rather than a fault: an add-on
    index from before GM screens existed has no ``gm-screens/`` directory.
    """
    error: Optional[str] = None
    for url in sheets.candidate_urls(configured, INDEX_PATH):
        try:
            document = fetch_document(
                url,
                cache_ttl=CACHE_TTL,
                timeout=FETCH_TIMEOUT,
                user_agent=f"Grimoire/{config.VERSION}",
                credentials=credentials,
            )
        except AddonFetchError as exc:
            if not is_not_found(exc):
                error = error or str(exc)
            continue
        if isinstance(document, dict) and isinstance(document.get("screens"), list):
            return url, [entry for entry in document["screens"] if isinstance(entry, dict)], None
    return None, [], error


def _summarise(entry: dict, index_url: str) -> Optional[dict]:
    preset_id = _clean(entry.get("id"), 100)
    if not preset_id:
        return None
    author_name, author_url = parse_author(_clean(entry.get("author"), 120))
    try:
        panel_count = max(0, int(entry.get("panel_count") or 0))
    except (TypeError, ValueError):
        panel_count = 0
    return {
        "id": preset_id,
        "name": _clean(entry.get("name"), 200) or preset_id,
        "version": _clean(entry.get("version"), 20),
        "system": _clean(entry.get("system"), 200),
        "description": _clean(entry.get("description"), 1000),
        "author": author_name,
        "author_url": author_url,
        "license": _clean(entry.get("license"), 100),
        "panel_count": panel_count,
        "index_url": index_url,
    }


def fetch_catalogue(db: Session, show_sources: bool = True) -> dict:
    """Every preset the configured catalogues offer, named by source.

    A source that cannot be read is reported beside the presets that could be,
    rather than hiding them: one unreachable branch should not empty the list.
    The sources are the admin's configuration, so with ``show_sources`` off a
    failure is reported without its URL or the reason, which can name hosts.
    """
    _assert_downloads_enabled()
    credentials = source_credentials.load(db)

    presets: list[dict] = []
    errors: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for source in _configured_sources(db):
        index_url, entries, error = _read_source(source, credentials)
        if index_url is None:
            if error:
                errors.append(
                    {"url": source, "error": error} if show_sources else {"url": "", "error": ""}
                )
            continue
        for entry in entries:
            summary = _summarise(entry, index_url)
            if summary and (summary["id"], index_url) not in seen:
                seen.add((summary["id"], index_url))
                presets.append(summary)
    # Nothing found and nothing failed means every source answered without
    # presets - an add-on index from before GM screens existed, say.
    return {
        "presets": sorted(presets, key=lambda item: (item["system"].lower(), item["name"].lower())),
        "errors": errors,
    }


def find_entry(db: Session, preset_id: str, index_url: Optional[str] = None) -> dict:
    """The raw catalogue entry for one preset, from the source it names."""
    _assert_downloads_enabled()
    credentials = source_credentials.load(db)
    for source in _configured_sources(db):
        url, entries, _ = _read_source(source, credentials)
        if url is None or (index_url and url != index_url):
            continue
        for entry in entries:
            if _clean(entry.get("id"), 100) == preset_id:
                return {**entry, "index_url": url}
    raise PresetError("That preset is not in the catalogue")


def fetch_preset(db: Session, entry: dict) -> dict:
    """Download one preset, verify its digest, and read it as a board.

    Returns ``{"name", "panels"}`` with the panels already cleaned.
    """
    _assert_downloads_enabled()
    index_url = str(entry.get("index_url") or "")
    try:
        url = sheets.resolve_file_url(index_url, str(entry.get("path") or ""))
    except sheets.CatalogueError as exc:
        raise PresetError(str(exc)) from exc
    body = download_file(
        url,
        what="preset",
        error=PresetError,
        max_bytes=MAX_PRESET_BYTES,
        timeout=FETCH_TIMEOUT,
        credentials=source_credentials.load(db),
    )
    try:
        sheets.verify_digest(body, _clean(entry.get("sha256"), 64), what="preset")
    except sheets.CatalogueError as exc:
        raise PresetError(str(exc)) from exc
    try:
        document = json.loads(body.decode("utf-8", "replace"))
    except ValueError as exc:
        raise PresetError("That preset is not valid JSON") from exc
    try:
        panels = boards.parse_board(document)
    except PanelError as exc:
        raise PresetError(f"That preset is not a valid GM screen: {exc}") from exc
    name = _clean(document.get("name"), 200) if isinstance(document, dict) else ""
    return {"name": name or _clean(entry.get("name"), 200), "panels": panels}
