"""The community catalogue of character sheets, and installing from it.

Sheets are per user, like themes, so anyone with an account may browse and
install one — no admin approval, because a sheet installed into your account
changes nothing for anyone else.

The catalogue URL is derived from the add-on index the admin already
configured, exactly as the theme catalogue is. That is what lets you point at a
branch: set the add-on index to a branch's ``index.json`` and every catalogue
derived from it — themes, note templates, and now sheets — follows.

Nothing here executes a sheet. A sheet is data: it is fetched, checked against
the digest the catalogue published, and validated by the same schema validator
an uploaded one goes through.
"""
import hashlib
import json
import logging
from typing import Any, Optional
from urllib.parse import urljoin, urlparse

from sqlalchemy.orm import Session

from ... import config
from ...addons.authors import parse_author
from ...addons.constants import (
    HTTP_MAX_BYTES,
    HTTP_MAX_REDIRECTS,
    external_installs_enabled,
)
from ...addons.fetch import AddonFetchError, fetch_document
from .schema import SchemaError, validate_schema

logger = logging.getLogger("grimoire.characters.catalogue")

__all__ = [
    "CatalogueError",
    "compute_source_hash",
    "fetch_catalogue",
    "fetch_sheet",
    "get_index_urls",
]


class CatalogueError(ValueError):
    """The sheet catalogue could not be read, or a sheet could not be installed."""


CATALOGUE_CACHE_TTL = 3600
FETCH_TIMEOUT = 10

#: A sheet is one JSON document. Bounded well below the shared add-on cap so a
#: hostile catalogue cannot hand us something enormous and call it a sheet.
MAX_SHEET_BYTES = 512 * 1024
#: A layout and a stylesheet are bounded separately, matching the engine's own
#: caps on `layout_html` and `styles`.
MAX_LAYOUT_BYTES = 256 * 1024
MAX_STYLES_BYTES = 128 * 1024

#: Where the sheet index sits relative to whichever index the admin configured.
_SHEET_INDEX_PATH = "character-sheets/index.json"

#: Used when a configured source is blank, so derivation always yields a URL.
_DEFAULT_SHEET_INDEX = (
    "https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/"
    + _SHEET_INDEX_PATH
)


def downloads_enabled() -> bool:
    return external_installs_enabled()


def _assert_downloads_enabled() -> None:
    if not downloads_enabled():
        raise CatalogueError("Downloading character sheets is disabled on this server")


def get_index_urls(db: Session) -> list[str]:
    """The sheet catalogue URLs, derived from the configured add-on sources.

    Deriving rather than adding a second setting is what makes pointing at a
    branch one change instead of three: the admin sets the add-on index once
    and every catalogue follows it.
    """
    from ...addons.registry import get_index_url as get_addon_index_url

    configured = get_addon_index_url(db)
    urls = [url.strip() for url in configured.split(",") if url.strip()]
    return urls or [_default_index_url()]


def compute_source_hash(index_url: str) -> str:
    """A short, stable fingerprint of a catalogue URL.

    Two catalogues may each offer a sheet called ``cairn``. Appending this to
    the id keeps them distinct, so installing the second does not silently
    fetch the first — the same scheme the theme catalogue uses.
    """
    if not index_url:
        return ""
    normalised = index_url.strip().rstrip("/").lower()
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()[:8]


def _default_index_url() -> str:
    from ...addons.constants import DEFAULT_INDEX_URL

    return _derive_sheet_url(DEFAULT_INDEX_URL)


#: Catalogue directories that sit beside each other in the community repo. A
#: URL pointing into one of them is rewritten to point into ours.
_SIBLING_DIRECTORIES = ("themes", "templates", "character-sheets")


def _derive_sheet_url(url: str) -> str:
    """The sheet index beside whichever index a URL points at.

    ``.../main/index.json`` and ``.../main/themes/index.json`` both resolve to
    ``.../main/character-sheets/index.json``, so an admin sets the add-on index
    once — including to a branch — and every catalogue follows it.

    The last path segment is read as a directory name, matching how the theme
    catalogue resolves the same question. That reading is ambiguous when a
    *branch* is named after a sibling directory: in
    ``.../community-add-ons/feat/character-sheets/index.json`` the
    ``character-sheets`` segment is half a branch name, not the catalogue
    directory, and the sheets actually sit one level deeper. Derivation cannot
    tell the two apart from the URL alone, so it does not try — it always
    returns the *derived* path, and the caller fetches the configured URL
    directly as well. Whichever of the two answers with a sheet document wins.
    """
    # A trailing slash would otherwise read the filename as a directory and
    # append the catalogue path to it, turning `.../index.json/` into
    # `.../index.json/character-sheets/index.json`.
    url = url.strip().rstrip("/")
    if not url:
        return _DEFAULT_SHEET_INDEX

    base, _, filename = url.rpartition("/")
    if not base:
        return f"{url}/{_SHEET_INDEX_PATH}"

    if not filename.endswith(".json"):
        # A directory rather than an index file: the catalogue sits inside it.
        return f"{url}/{_SHEET_INDEX_PATH}"

    directory = base.rsplit("/", 1)[-1]
    if filename == "index.json" and directory in _SIBLING_DIRECTORIES:
        # A sibling catalogue directory is stepped out of, so `themes/` and
        # `character-sheets/` resolve to the same place. `character-sheets` is
        # stepped out of too and then back into, which is a no-op for a URL
        # that really is our catalogue — and the thing that finds the sheets
        # under a *branch* of that name, where the segment is part of the
        # branch and the catalogue sits one level deeper.
        base = base[: -len(directory) - 1]

    return f"{base}/{_SHEET_INDEX_PATH}"


def _candidate_urls(configured: str) -> list[str]:
    """The URLs worth trying for one configured source, in order.

    Three, de-duplicated:

    1. The configured URL **directly**, since a source may point straight at a
       sheet catalogue.
    2. The derived path, which is the ordinary case — an admin configures the
       add-on index once and every catalogue follows it.
    3. The catalogue path *nested under* the configured URL's own directory.
       This is what reaches a branch named after a sibling directory: in
       ``.../community-add-ons/feat/character-sheets/index.json`` the
       ``character-sheets`` segment belongs to the branch name, and the real
       catalogue is at ``.../feat/character-sheets/character-sheets/index.json``.
       Indistinguishable from the ordinary case by inspection, so it is tried
       rather than guessed at.
    """
    direct = configured.strip().rstrip("/")
    candidates = [direct] if direct else []
    candidates.append(_derive_sheet_url(configured))

    if direct:
        base, _, filename = direct.rpartition("/")
        nested = f"{base}/{_SHEET_INDEX_PATH}" if filename.endswith(".json") else None
        if nested:
            candidates.append(nested)

    # Order preserved: the first candidate holding sheets is the one used.
    return list(dict.fromkeys(candidates))


def fetch_catalogue(db: Session, installed_ids: Optional[set] = None) -> dict[str, Any]:
    """Every sheet the configured catalogues offer.

    A source that cannot be read is skipped and logged rather than failing the
    whole browse: one unreachable branch should not hide the sheets that are
    fine.
    """
    _assert_downloads_enabled()
    installed = installed_ids or set()

    sheets: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    empty: list[dict[str, str]] = []
    seen: set = set()
    resolved: list[str] = []
    urls = get_index_urls(db)

    for configured in urls:
        index_url, document, failures = _read_source(configured)
        if document is None:
            # A source that could not be *reached* is reported straight away:
            # with several configured, a silently missing one looks like a
            # catalogue with fewer sheets in it, which is a confusing way to
            # learn a URL is wrong.
            #
            # A source that answered but held no sheets is held back instead.
            # The configured list is shared with add-ons and themes, so a
            # non-sheet index among several is ordinary rather than a mistake —
            # but if *nothing* yields sheets, saying so beats an empty dialog
            # with no explanation in it.
            reachable = [f for f in failures if "no character sheets" not in f["error"]]
            errors.extend(reachable)
            empty.extend(f for f in failures if f not in reachable)
            resolved.append(index_url)
            continue

        resolved.append(index_url)
        for entry in document["sheets"]:
            if not isinstance(entry, dict) or not entry.get("id"):
                continue
            summary = _summarise(entry, index_url, installed)
            # Keyed on the namespaced id, so this only drops a sheet one source
            # lists twice. Two sources offering the same sheet both survive,
            # which is the point of namespacing them.
            if summary["id"] in seen:
                continue
            seen.add(summary["id"])
            sheets.append(summary)

    # Nothing anywhere: now the sources that answered without sheets are the
    # explanation, so they are surfaced rather than kept quiet.
    if not sheets and not errors:
        errors = empty

    return {
        "sheets": sorted(sheets, key=lambda sheet: sheet["name"].lower()),
        "index_url": resolved[0] if resolved else _default_index_url(),
        "sources": resolved or [_default_index_url()],
        "errors": errors,
        "downloads_enabled": True,
    }


def _read_source(
    configured: str,
) -> tuple[str, Optional[dict[str, Any]], list[dict[str, str]]]:
    """Read one configured source, returning the URL that actually held sheets.

    Tries the configured URL directly before the derived one, so a source
    pointing straight at a sheet catalogue works and so does one whose branch
    is named after a sibling directory. Returns the failures rather than
    raising: a source that cannot be read must not hide the ones that can.
    """
    failures: list[dict[str, str]] = []
    candidates = _candidate_urls(configured)

    for index_url in candidates:
        try:
            document = fetch_document(
                index_url,
                cache_ttl=CATALOGUE_CACHE_TTL,
                timeout=FETCH_TIMEOUT,
                user_agent=f"Grimoire/{config.VERSION}",
            )
        except AddonFetchError as exc:
            logger.debug("Could not read a sheet catalogue at %s: %s", index_url, exc)
            failures.append({"url": index_url, "error": str(exc)})
            continue

        if isinstance(document, dict) and isinstance(document.get("sheets"), list):
            return index_url, document, []

        # An add-on or themes index, most likely: the right repo, the wrong
        # document. Recorded, but only reported if nothing else answers.
        logger.debug("No sheet catalogue in the document at %s", index_url)
        failures.append({"url": index_url, "error": "no character sheets in that index"})

    logger.warning(
        "No sheet catalogue found for %s (tried %s)", configured, ", ".join(candidates)
    )
    # One error per configured source, naming the source as the admin wrote it.
    # The candidates are how the lookup works, not URLs they chose, so citing
    # `.../character-sheets/character-sheets/index.json` back at them would
    # describe a mistake they did not make. The first candidate's message is
    # the relevant one: it is the URL they configured.
    reason = failures[0]["error"] if failures else "no character sheets in that index"
    return candidates[0], None, [{"url": candidates[0], "error": reason}]


def _summarise(entry: dict, index_url: str, installed: set) -> dict:
    author = str(entry.get("author") or "")
    # (display name, profile URL) — a GitHub username becomes a link, anything
    # else is credited as plain text, exactly as add-ons and themes do it.
    author_name, author_url = parse_author(author) if author else ("", "")
    raw_id = str(entry["id"])
    source_hash = compute_source_hash(index_url)
    return {
        # Namespaced by source so two catalogues offering the same sheet stay
        # distinct. `raw_id` is what the sheet calls itself, and what it
        # installs as.
        "id": f"{raw_id}-{source_hash}" if source_hash else raw_id,
        "raw_id": raw_id,
        "name": str(entry.get("name") or entry["id"]),
        "version": str(entry.get("version") or ""),
        "system": str(entry.get("system") or ""),
        "description": str(entry.get("description") or ""),
        "author": author_name or author,
        "author_url": author_url,
        "homepage": str(entry.get("homepage") or ""),
        "license": str(entry.get("license") or ""),
        "license_url": str(entry.get("license_url") or ""),
        "attribution": str(entry.get("attribution") or ""),
        "custom_layout": bool(entry.get("custom_layout")),
        "field_count": int(entry.get("field_count") or 0),
        "grimoire_min_version": str(entry.get("grimoire_min_version") or ""),
        "path": str(entry.get("path") or ""),
        "sha256": str(entry.get("sha256") or ""),
        # A sheet may keep its layout and stylesheet in sibling files rather
        # than inlining them as escaped JSON strings.
        "layout_path": str(entry.get("layout_path") or ""),
        "layout_sha256": str(entry.get("layout_sha256") or ""),
        "styles_path": str(entry.get("styles_path") or ""),
        "styles_sha256": str(entry.get("styles_sha256") or ""),
        "index_url": index_url,
        "installed": _is_installed(raw_id, index_url, installed),
    }


def _is_installed(raw_id: str, index_url: str, installed: set) -> bool:
    """Whether *this* copy of a sheet is the one the user has.

    Matched on the source as well as the id, so installing one catalogue's
    `cairn` does not mark another catalogue's as installed too. A schema with
    no recorded source — pasted, or written by hand — matches any copy of its
    id, because installing one would replace it.
    """
    for schema_id, source_url in installed:
        if schema_id != raw_id:
            continue
        if not source_url or source_url == index_url:
            return True
    return False


def _resolve_sheet_url(index_url: str, path: str) -> str:
    """Where a sheet's file lives, resolved against its own catalogue.

    Pinned to the catalogue's host: a catalogue may say where its files are,
    but not send us somewhere else entirely.
    """
    if not path:
        raise CatalogueError("That catalogue entry does not say where its file is")

    # A `path` is repo-relative by definition. An absolute URL is refused
    # outright rather than joined: splitting one on "/" would quietly mangle it
    # into a relative path under our own host, which lands somewhere harmless
    # but hides what the catalogue actually asked for.
    if urlparse(path).scheme or path.startswith("//"):
        raise CatalogueError("That catalogue entry's file is on an unexpected host")

    base = index_url.rsplit("/", 1)[0] + "/"
    # A catalogue entry's `path` is repo-relative (`character-sheets/cairn/...`)
    # while the index already sits inside that directory, so the segments they
    # share are dropped before joining — otherwise the directory appears twice.
    # The index's own filename is excluded from the comparison, since a
    # directory cannot overlap with `index.json`.
    index_parts = [p for p in urlparse(index_url).path.strip("/").split("/") if p][:-1]
    path_parts = [p for p in path.strip("/").split("/") if p]

    overlap = 0
    for candidate in range(min(len(index_parts), len(path_parts)), 0, -1):
        if index_parts[-candidate:] == path_parts[:candidate]:
            overlap = candidate
            break

    url = urljoin(base, "/".join(path_parts[overlap:]))
    if urlparse(url).netloc != urlparse(index_url).netloc:
        raise CatalogueError("That catalogue entry's file is on an unexpected host")
    return url


def verify_digest(body: bytes, expected: str, *, what: str = "sheet") -> None:
    """Reject a download whose digest does not match the catalogue.

    The catalogue is what the user chose to trust; a file disagreeing with it
    has been altered in transit or at rest, and is refused either way. An
    absent digest cannot be checked, which is not the same as failing.

    ``what`` names the thing in the message, since content packs verify their
    files through here too and "that sheet failed" would be wrong for them.
    """
    if not expected:
        return
    if hashlib.sha256(body).hexdigest() != expected:
        raise CatalogueError(
            f"That {what} failed its integrity check - "
            "the catalogue and the file disagree"
        )


def _download(url: str, max_bytes: int, *, what: str) -> bytes:
    """Fetch one file, bounded and with its own client.

    Not routed through ``fetch_document``: that caches and does not verify a
    digest, and every file here is fetched once, at install time, and checked
    against the catalogue that offered it.
    """
    import httpx

    try:
        with httpx.Client(
            timeout=FETCH_TIMEOUT,
            follow_redirects=True,
            max_redirects=HTTP_MAX_REDIRECTS,
            headers={"User-Agent": f"Grimoire/{config.VERSION}"},
        ) as client:
            response = client.get(url)
            if response.status_code != 200:
                raise CatalogueError(
                    f"The {what} download returned HTTP {response.status_code}"
                )
            body = response.content
    except httpx.TimeoutException as exc:
        raise CatalogueError(f"The {what} download timed out") from exc
    except httpx.HTTPError as exc:
        raise CatalogueError(f"Could not download the {what}: {exc}") from exc

    if len(body) > min(max_bytes, HTTP_MAX_BYTES):
        raise CatalogueError(f"That {what} file is too large")
    return body


def fetch_sheet(db: Session, entry: dict[str, Any]) -> dict[str, Any]:
    """Download one sheet, verify its digest, and validate it.

    Fetched with its own client rather than through ``fetch_document``, which
    caches and does not verify digests: a sheet is fetched once, at install
    time, and must be checked against the catalogue that offered it.
    """
    _assert_downloads_enabled()

    index_url = entry.get("index_url") or _default_index_url()
    url = _resolve_sheet_url(index_url, str(entry.get("path") or ""))
    body = _download(url, MAX_SHEET_BYTES, what="sheet")
    verify_digest(body, str(entry.get("sha256") or ""))

    try:
        document = json.loads(body.decode("utf-8", "replace"))
    except ValueError as exc:
        raise CatalogueError("That sheet file is not valid JSON") from exc
    if not isinstance(document, dict):
        raise CatalogueError("That sheet file is not a sheet")

    # `$schema` is an editor affordance in the repository, not part of the
    # document the engine validates.
    document.pop("$schema", None)
    # Naming a sibling file is an authoring convenience; what gets stored is
    # one self-contained document, so the sheet still renders if the
    # catalogue later moves.
    document.pop("layout_file", None)
    document.pop("styles_file", None)

    layout = _fetch_sidecar(index_url, entry, "layout", MAX_LAYOUT_BYTES)
    if layout is not None:
        document["layout_html"] = layout
    styles = _fetch_sidecar(index_url, entry, "styles", MAX_STYLES_BYTES)
    if styles is not None:
        document["styles"] = styles

    try:
        validate_schema(document)
    except SchemaError as exc:
        raise CatalogueError(f"That sheet is not valid: {exc}") from exc

    return document


def _fetch_sidecar(
    index_url: str, entry: dict[str, Any], kind: str, max_bytes: int
) -> Optional[str]:
    """Download a sheet's layout or stylesheet from its own file.

    Returns None when the catalogue lists no such file, which is the ordinary
    case for a sheet that inlines them or has none. Verified against its own
    digest, like the sheet itself: a separate file is a separate download and
    needs its own check.
    """
    path = str(entry.get(f"{kind}_path") or "")
    if not path:
        return None

    url = _resolve_sheet_url(index_url, path)
    body = _download(url, max_bytes, what=kind)
    verify_digest(body, str(entry.get(f"{kind}_sha256") or ""))
    return body.decode("utf-8", "replace")
