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
    DEFAULT_CACHE_TTL as CATALOGUE_CACHE_TTL,
    DEFAULT_INDEX_URL as DEFAULT_ADDON_INDEX_URL,
    HTTP_MAX_BYTES,
    HTTP_MAX_REDIRECTS,
    external_installs_enabled,
)
from ..addons.fetch import AddonFetchError, fetch_document

logger = logging.getLogger("grimoire.wiki_templates")

SETTING_INDEX_URL = "addons.index_url"

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


def get_index_urls(db: Session) -> list[str]:
    """The template catalogue URLs, derived from configured add-on sources."""
    from ..addons.registry import get_index_url as get_addon_index_url

    addon_urls_str = get_addon_index_url(db)
    addon_urls = [u.strip() for u in addon_urls_str.split(",") if u.strip()]
    return addon_urls or [config.DEFAULT_WIKI_TEMPLATE_INDEX_URL]


def get_index_url(db: Session) -> str:
    urls = get_index_urls(db)
    if not urls:
        return config.DEFAULT_WIKI_TEMPLATE_INDEX_URL
    if urls[0] == DEFAULT_ADDON_INDEX_URL:
        return config.DEFAULT_WIKI_TEMPLATE_INDEX_URL
    return urls[0]


def set_index_url(db: Session, url: str) -> None:
    if url and not url.startswith(("http://", "https://")):
        raise TemplateCatalogueError("index URL must be an http(s) URL")
    from ..addons.registry import set_index_url as set_addon_index_url
    set_addon_index_url(db, url)


def is_custom_url(db: Session) -> bool:
    urls = get_index_urls(db)
    if not urls:
        return False
    return len(urls) != 1 or get_index_url(db) != config.DEFAULT_WIKI_TEMPLATE_INDEX_URL


def _derive_template_url(url: str) -> str:
    if url.endswith("templates/index.json"):
        return url
    if url.endswith("themes/index.json"):
        # Explicit theme index URL; do not attempt to derive templates from it
        return url
    if url.endswith("index.yaml"):
        return url.replace("index.yaml", "templates/index.json")
    base = url.rsplit("/", 1)[0]
    return f"{base}/templates/index.json"


def fetch_catalogue(db: Session, force: bool = False) -> dict:
    """Fetch and merge community note template indexes from configured sources."""
    _assert_downloads_enabled()
    urls = get_index_urls(db)

    all_templates: list[dict] = []
    all_folders: list[dict] = []
    last_error: Optional[Exception] = None
    invalid_format = False

    for url in urls:
        # If the URL explicitly points to a theme index, do not fetch note templates from it
        if url.endswith("themes/index.json"):
            logger.debug("Skipping template fetch for explicit theme index URL %s", url)
            continue

        doc = None
        try:
            doc = fetch_document(
                url,
                user_agent=f"Grimoire/{config.VERSION}",
                cache_ttl=CATALOGUE_CACHE_TTL,
                force=force,
                timeout=FETCH_TIMEOUT,
            )
            if not isinstance(doc, dict):
                invalid_format = True
        except AddonFetchError as exc:
            last_error = exc
            logger.debug("Could not fetch template source %s directly: %s", url, exc)

        # If the fetched document is explicitly a theme index, skip attempting to parse templates from it
        if isinstance(doc, dict) and "themes" in doc and not isinstance(doc.get("templates"), list) and not isinstance(doc.get("folders"), list):
            logger.debug("Skipping template fetch for explicit theme index document %s", url)
            continue

        # 1. Direct match: URL returns a Template Index schema (has "templates" or "folders").
        # If this source directly serves a template catalogue, process its contents
        # and skip trying the derived templates/index.json path.
        if isinstance(doc, dict) and (isinstance(doc.get("templates"), list) or isinstance(doc.get("folders"), list)):
            if isinstance(doc.get("folders"), list):
                all_folders.extend(doc["folders"])
            if isinstance(doc.get("templates"), list):
                for t in doc["templates"]:
                    if isinstance(t, dict):
                        t["index_url"] = url
                all_templates.extend(doc["templates"])
            continue

        # 2. Add-on Index or unknown URL: try derived templates/index.json path
        derived_url = _derive_template_url(url)
        if derived_url != url:
            try:
                derived_doc = fetch_document(
                    derived_url,
                    user_agent=f"Grimoire/{config.VERSION}",
                    cache_ttl=CATALOGUE_CACHE_TTL,
                    force=force,
                    timeout=FETCH_TIMEOUT,
                )
                if not isinstance(derived_doc, dict):
                    invalid_format = True
                if isinstance(derived_doc, dict) and (isinstance(derived_doc.get("templates"), list) or isinstance(derived_doc.get("folders"), list)):
                    if isinstance(derived_doc.get("folders"), list):
                        all_folders.extend(derived_doc["folders"])
                    if isinstance(derived_doc.get("templates"), list):
                        for t in derived_doc["templates"]:
                            if isinstance(t, dict):
                                t["index_url"] = derived_url
                        all_templates.extend(derived_doc["templates"])
            except AddonFetchError as exc:
                last_error = exc
                logger.debug("Skipping templates from derived URL %s: %s", derived_url, exc)

    if not all_templates and not all_folders:
        if len(urls) == 1:
            if last_error:
                raise TemplateCatalogueError(str(last_error))
            if invalid_format:
                raise TemplateCatalogueError("Index is not in the expected format")

    primary_url = _derive_template_url(urls[0]) if urls else config.DEFAULT_WIKI_TEMPLATE_INDEX_URL
    return {
        "templates": all_templates,
        "folders": all_folders,
        "index_url": primary_url,
        "default_index_url": config.DEFAULT_WIKI_TEMPLATE_INDEX_URL,
        "is_custom_url": is_custom_url(db),
    }


def _clean_str(value: Any, limit: int = 500) -> str:
    """A bounded plain string. The catalogue is untrusted input."""
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def _entries(catalogue: dict) -> list[dict]:
    raw = catalogue.get("templates")
    return [entry for entry in raw if isinstance(entry, dict)] if isinstance(raw, list) else []


def build_tree(catalogue: dict) -> list[dict]:
    """Group catalogue entries into the folder tree the browser renders."""
    names = {}
    raw_folders = catalogue.get("folders")
    if isinstance(raw_folders, list):
        for folder in raw_folders:
            if isinstance(folder, dict):
                path = _clean_str(folder.get("path"), 200)
                name = _clean_str(folder.get("name"), 200)
                if path:
                    names[path] = name or path

    grouped: dict[str, dict[str, dict]] = {}
    for entry in _entries(catalogue):
        template_id = _clean_str(entry.get("id"), 100)
        if not template_id:
            continue
        folder = _clean_str(entry.get("folder"), 200)
        author_name, author_url = parse_author(_clean_str(entry.get("author"), 120))
        index_url = _clean_str(entry.get("index_url"), 500)
        version = _clean_str(entry.get("version"), 20)

        folder_group = grouped.setdefault(folder, {})
        if template_id not in folder_group:
            folder_group[template_id] = {
                "id": template_id,
                "name": _clean_str(entry.get("name"), 200) or template_id,
                "version": version,
                "system": _clean_str(entry.get("system"), 200),
                "category": _clean_str(entry.get("category"), 200) or "General",
                "description": _clean_str(entry.get("description"), 500),
                "author": author_name,
                "author_url": author_url,
                "index_url": index_url,
                "available_in": [{"index_url": index_url, "version": version}] if index_url else [],
            }
        else:
            existing = folder_group[template_id]
            if index_url and not any(s["index_url"] == index_url for s in existing["available_in"]):
                existing["available_in"].append({"index_url": index_url, "version": version})

    def folder_label(path: str) -> str:
        if not path:
            return "Generic"
        return names.get(path) or path.rsplit("/", 1)[-1]

    def sort_key(path: str) -> tuple[int, str]:
        label = folder_label(path)
        return (0 if label.lower() == "generic" else 1, label.lower())

    tree = []
    for path in sorted(grouped, key=sort_key):
        templates_list = list(grouped[path].values())
        tree.append(
            {
                "path": path,
                "name": folder_label(path),
                "templates": sorted(
                    templates_list,
                    key=lambda t: (t["category"].lower(), t["name"].lower()),
                ),
            }
        )
    return tree


def find_entry(catalogue: dict, template_id: str, index_url: Optional[str] = None) -> Optional[dict]:
    for entry in _entries(catalogue):
        if _clean_str(entry.get("id"), 100) == template_id:
            if not index_url or _clean_str(entry.get("index_url"), 500) == index_url:
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

    index_url = entry.get("index_url") or get_index_url(db)
    url = _resolve_body_url(index_url, entry)
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
