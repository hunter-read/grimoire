"""The remote catalogue of community wiki note templates.

Templates live in a community repository (the same one that hosts add-ons, under
``templates/``). This module fetches that catalogue, verifies a downloaded body
against the digest the catalogue declares, and shapes the result into the folder
tree the browser renders.

Nothing here writes to the database: a fetched template becomes a
``WikiTemplate`` row only when a GM chooses to download it, which the router
does. Templates are never executed or installed — they are markdown.

Downloading is disabled outright by ``DISABLE_EXTERNAL_ADD_ON_INSTALL`` — the
shared switch covering every community install — in which case every function
here refuses rather than reaching the network.
"""
import hashlib
import logging
from typing import Any, Optional
from urllib.parse import urljoin, urlparse

from sqlalchemy.orm import Session

from .. import config
from ..addons.authors import parse_author
from ..addons.constants import (
    HTTP_MAX_BYTES,
    HTTP_MAX_REDIRECTS,
    external_installs_enabled,
)
from ..addons.fetch import AddonFetchError, fetch_document
from ..models import AppSetting

logger = logging.getLogger("grimoire.wiki_templates")

# app_settings key holding an operator's custom catalogue URL. Empty/absent
# means "use the built-in default".
SETTING_INDEX_URL = "wiki_templates.index_url"

# The catalogue is a small JSON document that changes rarely, so an hour of
# caching keeps the browser instant without going stale in any way that matters.
CATALOGUE_CACHE_TTL = 3600

# A template body is a markdown page. Far below the shared add-on cap, but
# bounded on its own so a hostile catalogue cannot hand us a huge "page".
MAX_BODY_BYTES = 512 * 1024

# Both fetches are small static files from a CDN, so they either answer quickly
# or are not going to. The add-on default (30s) is sized for whole-catalogue
# scrapes; a download does *two* requests back to back, and 2 × 30s is long
# enough for a reverse proxy to give up first and hand the user an opaque 502
# instead of our own error message. Fail fast and say what happened.
FETCH_TIMEOUT = 10


class TemplateCatalogueError(Exception):
    """The catalogue could not be fetched, or is not usable.

    Carries a message safe to show a GM — the browser surfaces these directly.
    """


def downloads_enabled() -> bool:
    return external_installs_enabled()


def _assert_downloads_enabled() -> None:
    if not downloads_enabled():
        raise TemplateCatalogueError(
            "Downloading note templates is disabled on this server"
        )


def get_index_url(db: Session) -> str:
    """The catalogue URL: an operator's override, else the built-in default."""
    row = db.query(AppSetting).filter_by(key=SETTING_INDEX_URL).first()
    custom = (row.value or "").strip() if row and row.value else ""
    return custom or config.DEFAULT_WIKI_TEMPLATE_INDEX_URL


def set_index_url(db: Session, url: str) -> None:
    """Persist a custom catalogue URL. An empty value restores the default."""
    value = (url or "").strip()
    if value and not value.startswith(("http://", "https://")):
        raise TemplateCatalogueError("The catalogue URL must be an http(s) URL")
    row = db.query(AppSetting).filter_by(key=SETTING_INDEX_URL).first()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=SETTING_INDEX_URL, value=value))


def is_custom_url(db: Session) -> bool:
    return get_index_url(db) != config.DEFAULT_WIKI_TEMPLATE_INDEX_URL


def fetch_catalogue(db: Session, force: bool = False) -> dict:
    """The parsed catalogue document, served from the on-disk cache when fresh."""
    _assert_downloads_enabled()
    url = get_index_url(db)
    try:
        raw = fetch_document(
            url,
            user_agent=f"Grimoire/{config.VERSION}",
            cache_ttl=CATALOGUE_CACHE_TTL,
            force=force,
            timeout=FETCH_TIMEOUT,
        )
    except AddonFetchError as exc:
        raise TemplateCatalogueError(str(exc)) from exc

    if not isinstance(raw, dict):
        raise TemplateCatalogueError("The catalogue is not in the expected format")
    return raw


def _clean_str(value: Any, limit: int = 500) -> str:
    """A bounded plain string. The catalogue is untrusted input."""
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def _entries(catalogue: dict) -> list[dict]:
    raw = catalogue.get("templates")
    return [entry for entry in raw if isinstance(entry, dict)] if isinstance(raw, list) else []


def build_tree(catalogue: dict) -> list[dict]:
    """Group catalogue entries into the folder tree the browser renders.

    Folders come back sorted with the generic one pinned first and the rest
    alphabetical by display name, which is the order a GM scanning for their
    system expects. A template filed at the top level lands in the generic
    folder rather than a nameless one.
    """
    names = {}
    raw_folders = catalogue.get("folders")
    if isinstance(raw_folders, list):
        for folder in raw_folders:
            if isinstance(folder, dict):
                path = _clean_str(folder.get("path"), 200)
                name = _clean_str(folder.get("name"), 200)
                if path:
                    names[path] = name or path

    grouped: dict[str, list[dict]] = {}
    for entry in _entries(catalogue):
        template_id = _clean_str(entry.get("id"), 100)
        if not template_id:
            continue
        folder = _clean_str(entry.get("folder"), 200)
        author_name, author_url = parse_author(_clean_str(entry.get("author"), 120))
        grouped.setdefault(folder, []).append(
            {
                "id": template_id,
                "name": _clean_str(entry.get("name"), 200) or template_id,
                "version": _clean_str(entry.get("version"), 20),
                "system": _clean_str(entry.get("system"), 200),
                "category": _clean_str(entry.get("category"), 200) or "General",
                "description": _clean_str(entry.get("description"), 500),
                "author": author_name,
                "author_url": author_url,
            }
        )

    def folder_label(path: str) -> str:
        if not path:
            return "Generic"
        return names.get(path) or path.rsplit("/", 1)[-1]

    def sort_key(path: str) -> tuple[int, str]:
        label = folder_label(path)
        # "Generic" always leads; everything else is alphabetical.
        return (0 if label.lower() == "generic" else 1, label.lower())

    tree = []
    for path in sorted(grouped, key=sort_key):
        tree.append(
            {
                "path": path,
                "name": folder_label(path),
                "templates": sorted(
                    grouped[path],
                    key=lambda t: (t["category"].lower(), t["name"].lower()),
                ),
            }
        )
    return tree


def find_entry(catalogue: dict, template_id: str) -> Optional[dict]:
    for entry in _entries(catalogue):
        if _clean_str(entry.get("id"), 100) == template_id:
            return entry
    return None


def _resolve_body_url(index_url: str, entry: dict) -> str:
    """The absolute URL of a template's markdown body.

    Resolved against the catalogue URL and then required to stay on the same
    host: the catalogue is community data, and a path it supplies must not be
    able to redirect a fetch somewhere else.
    """
    body_path = _clean_str(entry.get("body_path"), 400).lstrip("/")
    if not body_path:
        raise TemplateCatalogueError("That template does not declare a body file")

    # `body_path` is *repo-relative* (`templates/dnd-5e/…/x.md`), while the index
    # lives inside the repo at `<repo>/templates/index.json`. Resolving one
    # against the other naively doubles the shared segment
    # (`…/templates/templates/…`) and 404s every download.
    #
    # The index's directory is a suffix of the repo root plus some path, and the
    # body path starts from that same root — so drop the longest run of leading
    # segments the two already agree on, then resolve what's left.
    base = index_url.rsplit("/", 1)[0] + "/"
    base_segments = [s for s in urlparse(base).path.split("/") if s]
    body_segments = body_path.split("/")

    overlap = 0
    for depth in range(min(len(base_segments), len(body_segments)), 0, -1):
        if base_segments[-depth:] == body_segments[:depth]:
            overlap = depth
            break

    url = urljoin(base, "/".join(body_segments[overlap:]))
    if urlparse(url).netloc != urlparse(index_url).netloc:
        raise TemplateCatalogueError("That template's body is on an unexpected host")
    if not url.startswith(("http://", "https://")):
        raise TemplateCatalogueError("That template's body is not an http(s) URL")
    return url


def fetch_body(db: Session, entry: dict) -> str:
    """Download and verify one template's markdown body."""
    _assert_downloads_enabled()
    import httpx

    url = _resolve_body_url(get_index_url(db), entry)
    headers = {"User-Agent": f"Grimoire/{config.VERSION}"}
    try:
        with httpx.Client(
            timeout=FETCH_TIMEOUT,
            follow_redirects=True,
            max_redirects=HTTP_MAX_REDIRECTS,
            headers=headers,
        ) as client:
            response = client.get(url)
            if response.status_code != 200:
                raise TemplateCatalogueError(
                    f"The template download returned HTTP {response.status_code}"
                )
            body = response.content
    except httpx.TimeoutException as exc:
        raise TemplateCatalogueError("The template download timed out") from exc
    except httpx.HTTPError as exc:
        raise TemplateCatalogueError(f"Could not download the template: {exc}") from exc

    if len(body) > min(MAX_BODY_BYTES, HTTP_MAX_BYTES):
        raise TemplateCatalogueError("That template's body is too large")

    expected = _clean_str(entry.get("body_sha256"), 64)
    if expected:
        actual = hashlib.sha256(body).hexdigest()
        if actual != expected:
            raise TemplateCatalogueError(
                "That template failed its integrity check - the catalogue and "
                "the file disagree"
            )

    return body.decode("utf-8", "replace")
