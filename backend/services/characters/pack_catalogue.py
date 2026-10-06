"""The community catalogue of content packs, and installing from it.

A pack is bulk rules content — the SRD's spells, classes and feats — so unlike a
sheet it is **server-wide** and installing one needs an admin. What it is not is
unreachable: packs used to arrive only by copying a directory onto the server by
hand, which meant the SRD sat in the community repository with no way to get it
to anyone. This is the missing half.

Mirrors ``catalogue.py`` deliberately: the same URL derivation (so pointing the
add-on index at a branch points this at it too), the same digest verification,
and the same same-host pinning. The difference is that a pack is several files
rather than one, so each is verified against its own digest, and nothing is
written to disk until every file has passed.
"""
import logging
import os
import shutil
import tempfile
from typing import Any, Optional

from sqlalchemy.orm import Session

from ... import config
from ...addons.constants import external_installs_enabled
from ...addons.fetch import AddonFetchError, fetch_document
from .catalogue import (
    CatalogueError,
    _download,
    _resolve_sheet_url,
    compute_source_hash,
    verify_digest,
)
from . import packs as pack_store

logger = logging.getLogger("grimoire.characters.pack_catalogue")

__all__ = [
    "PackCatalogueError",
    "fetch_pack_catalogue",
    "install_pack",
]

CATALOGUE_CACHE_TTL = 3600
FETCH_TIMEOUT = 10

#: One content file. A pack is bulk data, so this is well above a sheet's cap
#: but still bounded — a hostile catalogue cannot hand us something endless.
MAX_PACK_FILE_BYTES = 8 * 1024 * 1024
#: A whole pack, across every file.
MAX_PACK_BYTES = 32 * 1024 * 1024
#: Files per pack. One `_meta.json` plus a content type each.
MAX_PACK_FILES = 64

#: Where the pack index sits relative to whichever index the admin configured.
_PACK_INDEX_PATH = "content-packs/index.json"


class PackCatalogueError(CatalogueError):
    """The pack catalogue could not be read, or a pack could not be installed."""


def _assert_downloads_enabled() -> None:
    if not external_installs_enabled():
        raise PackCatalogueError("Downloading content packs is disabled on this server")


#: Catalogue directories that sit beside each other in the community repo.
_SIBLING_DIRECTORIES = ("themes", "templates", "character-sheets", "content-packs")


def _pack_candidates(configured: str) -> list[str]:
    """The URLs worth trying for one source, in order.

    The same three-way lookup the sheet catalogue does, against the pack path:

    1. The configured URL **directly**, since a source may point straight at a
       pack catalogue.
    2. The pack path beside whichever index it names — a sibling catalogue
       directory is stepped out of first, so ``.../main/themes/index.json`` and
       ``.../main/index.json`` both land on ``.../main/content-packs/index.json``.
    3. The pack path nested **under** the configured URL's directory. This is
       what reaches a branch named after a sibling directory, where the trailing
       segment belongs to the branch name and the catalogues sit one level
       deeper.
    """
    direct = configured.strip().rstrip("/")
    if not direct:
        return []

    candidates = [direct]
    base, _, filename = direct.rpartition("/")

    if not filename.endswith(".json") or not base:
        candidates.append(f"{direct}/{_PACK_INDEX_PATH}")
        return list(dict.fromkeys(candidates))

    # Beside it, stepping out of a sibling catalogue directory first.
    directory = base.rsplit("/", 1)[-1]
    beside = base[: -len(directory) - 1] if directory in _SIBLING_DIRECTORIES else base
    candidates.append(f"{beside}/{_PACK_INDEX_PATH}")
    # And nested under it, for the branch-named-after-a-directory case.
    candidates.append(f"{base}/{_PACK_INDEX_PATH}")

    # Order preserved; the first holding packs wins.
    return list(dict.fromkeys(candidates))


def get_index_urls(db: Session) -> list[str]:
    """The pack catalogue URLs, derived from the configured add-on sources."""
    from ...addons.registry import get_index_url as get_addon_index_url

    configured = get_addon_index_url(db)
    urls = [url.strip() for url in configured.split(",") if url.strip()]
    if not urls:
        from ...addons.constants import DEFAULT_INDEX_URL

        urls = [DEFAULT_INDEX_URL]
    return urls


def fetch_pack_catalogue(
    db: Session, installed: Optional[dict[str, str]] = None
) -> dict[str, Any]:
    """Every content pack the configured catalogues offer.

    ``installed`` maps each installed pack id to its version, so each listing
    can say whether it is installed and whether the catalogue has a newer one.

    A source that cannot be read, or holds no packs, is reported rather than
    silently dropped — an empty dialog is a poor way to learn a URL is wrong.
    """
    _assert_downloads_enabled()
    installed = installed or {}

    packs: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    empty: list[dict[str, str]] = []
    resolved: list[str] = []
    seen: set = set()

    for configured in get_index_urls(db):
        index_url, document, failures = _read_source(configured)
        if document is None:
            reachable = [f for f in failures if "no content packs" not in f["error"]]
            errors.extend(reachable)
            empty.extend(f for f in failures if f not in reachable)
            resolved.append(index_url)
            continue

        resolved.append(index_url)
        for entry in document["packs"]:
            if not isinstance(entry, dict) or not entry.get("pack_id"):
                continue
            summary = _summarise(entry, index_url, installed)
            if summary["id"] in seen:
                continue
            seen.add(summary["id"])
            packs.append(summary)

    if not packs and not errors:
        errors = empty

    return {
        "packs": sorted(packs, key=lambda pack: pack["name"].lower()),
        "sources": resolved,
        "errors": errors,
        "downloads_enabled": True,
    }


def _read_source(
    configured: str,
) -> tuple[str, Optional[dict[str, Any]], list[dict[str, str]]]:
    """Read one source, returning the URL that actually held packs."""
    failures: list[dict[str, str]] = []
    candidates = _pack_candidates(configured)

    for index_url in candidates:
        try:
            document = fetch_document(
                index_url,
                cache_ttl=CATALOGUE_CACHE_TTL,
                timeout=FETCH_TIMEOUT,
                user_agent=f"Grimoire/{config.VERSION}",
            )
        except AddonFetchError as exc:
            logger.debug("Could not read a pack catalogue at %s: %s", index_url, exc)
            failures.append({"url": index_url, "error": str(exc)})
            continue

        if isinstance(document, dict) and isinstance(document.get("packs"), list):
            return index_url, document, []

        logger.debug("No pack catalogue in the document at %s", index_url)
        failures.append({"url": index_url, "error": "no content packs in that index"})

    logger.warning(
        "No pack catalogue found for %s (tried %s)", configured, ", ".join(candidates)
    )
    reason = failures[0]["error"] if failures else "no content packs in that index"
    return candidates[0], None, [{"url": candidates[0], "error": reason}]


def _summarise(entry: dict, index_url: str, installed: dict) -> dict:
    pack_id = str(entry["pack_id"])
    source_hash = compute_source_hash(index_url)
    files = [f for f in (entry.get("files") or []) if isinstance(f, dict)]
    return {
        # Namespaced by source, so two catalogues offering the same pack stay
        # distinct — the same scheme sheets use.
        "id": f"{pack_id}-{source_hash}" if source_hash else pack_id,
        "pack_id": pack_id,
        "schema_id": str(entry.get("schema_id") or ""),
        "name": str(entry.get("name") or pack_id),
        "version": str(entry.get("version") or ""),
        "description": str(entry.get("description") or ""),
        "license": str(entry.get("license") or ""),
        "license_url": str(entry.get("license_url") or ""),
        # Rendered verbatim: several open licences mandate exact wording.
        "attribution": str(entry.get("attribution") or ""),
        "source_url": str(entry.get("source_url") or ""),
        "entry_count": int(entry.get("entry_count") or 0),
        "content_types": [str(t) for t in (entry.get("content_types") or [])],
        "total_bytes": sum(int(f.get("bytes") or 0) for f in files),
        "files": files,
        "index_url": index_url,
        "installed": pack_id in installed,
        "installed_version": installed.get(pack_id, ""),
        # Offered as an update rather than a reinstall, so a newer SRD is not
        # something the admin has to notice for themselves.
        "update_available": pack_id in installed
        and _newer(str(entry.get("version") or ""), installed[pack_id]),
    }


def _version_key(version: str) -> tuple:
    """`1.10.0` sorts after `1.9.0`; anything unparseable sorts first."""
    parts = []
    for part in version.split("."):
        parts.append(int(part) if part.isdigit() else -1)
    return tuple(parts)


def _newer(offered: str, installed: str) -> bool:
    if not offered or not installed:
        return False
    return _version_key(offered) > _version_key(installed)


def install_pack(db: Session, entry: dict[str, Any]) -> str:
    """Download one pack and write it into the server's content directory.

    Every file is fetched and checked **before** anything is written, then the
    whole directory is swapped into place. A pack that fails halfway therefore
    leaves the previous copy of it standing rather than a half-written one.

    Returns the directory it installed into; the caller loads it.
    """
    _assert_downloads_enabled()

    pack_id = str(entry.get("pack_id") or "")
    # The id names a directory, so it must not be able to climb out of one.
    if not pack_id or "/" in pack_id or "\\" in pack_id or pack_id.startswith("."):
        raise PackCatalogueError("That pack has no usable id")

    index_url = entry.get("index_url") or ""
    files = [f for f in (entry.get("files") or []) if isinstance(f, dict)]
    if not files:
        raise PackCatalogueError("That catalogue entry lists no files")
    if len(files) > MAX_PACK_FILES:
        raise PackCatalogueError("That pack has too many files")
    if not any(f.get("name") == "_meta.json" for f in files):
        raise PackCatalogueError("That pack has no _meta.json")

    downloaded: dict[str, bytes] = {}
    total = 0
    for row in files:
        name = str(row.get("name") or "")
        # A pack is one flat directory of JSON files. The name is used as a
        # filename directly, so anything that could climb out of that directory
        # or land somewhere unexpected is refused rather than sanitised —
        # `_meta.json` is the only name starting with an underscore-or-dot-like
        # character that belongs here, and it contains no separator either.
        if not name or "/" in name or "\\" in name or name.startswith("."):
            raise PackCatalogueError(f"That pack names an unusable file: {name!r}")
        if not name.endswith(".json"):
            raise PackCatalogueError(f"A pack holds JSON files; {name!r} is not one")

        # Resolution, download and digest failures all raise the base
        # CatalogueError; re-raised as ours so the route answers 400 rather
        # than letting a 500 escape.
        try:
            url = _resolve_sheet_url(index_url, str(row.get("path") or ""))
            body = _download(url, MAX_PACK_FILE_BYTES, what=f"pack file {name}")
            verify_digest(body, str(row.get("sha256") or ""), what="content pack file")
        except CatalogueError as exc:
            raise PackCatalogueError(str(exc)) from exc

        total += len(body)
        if total > MAX_PACK_BYTES:
            raise PackCatalogueError("That pack is too large")
        downloaded[name] = body

    # Read at call time from the loader's module, so the installer writes where
    # the loader looks - "installed" and "on disk" can never disagree.
    content_dir = pack_store.CONTENT_DIR
    target = os.path.join(content_dir, pack_id)
    os.makedirs(content_dir, exist_ok=True)

    # Staged beside the target and swapped, so a failed write never leaves a
    # half-installed pack where a working one used to be.
    staging = tempfile.mkdtemp(prefix=f".{pack_id}.incoming", dir=content_dir)
    try:
        for name, body in downloaded.items():
            with open(os.path.join(staging, name), "wb") as handle:
                handle.write(body)
        if os.path.isdir(target):
            shutil.rmtree(target)
        os.rename(staging, target)
    except OSError as exc:
        shutil.rmtree(staging, ignore_errors=True)
        raise PackCatalogueError(f"Could not write that pack to disk: {exc}") from exc

    logger.info("Installed content pack %s (%d file(s))", pack_id, len(downloaded))
    return target
