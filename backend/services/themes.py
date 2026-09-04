"""Colour themes: validation, and the remote catalogue of community themes.

A theme is a small map of colour tokens that overrides the app's palette. Two
things make that safe to accept from a stranger:

  * a **closed allowlist** of token names, so a theme can only set colours the
    app already draws with — never an arbitrary CSS property; and
  * a **strict colour grammar**, so a value cannot close its declaration and
    open another one.

Both are enforced here, on the way in *and* on the way out, so a row edited
directly in the database is no more dangerous than an uploaded file.

Themes are never executed — they are data. Downloading obeys the shared
``DISABLE_EXTERNAL_ADD_ON_INSTALL`` switch; authoring and upload keep working
when it is set, so a locked-down server can still use a hand-copied theme.
"""
import hashlib
import logging
import re
from typing import Any, Optional
from urllib.parse import urljoin, urlparse

from sqlalchemy.orm import Session

from .. import config
from ..addons.constants import (
    HTTP_MAX_BYTES,
    HTTP_MAX_REDIRECTS,
    external_installs_enabled,
)
from ..addons.authors import parse_author
from ..addons.fetch import AddonFetchError, fetch_document
from ..models import AppSetting

logger = logging.getLogger("grimoire.themes")

SETTING_INDEX_URL = "themes.index_url"

CATALOGUE_CACHE_TTL = 3600

# A theme document is a small JSON/YAML file. Bounded well below the shared
# add-on cap so a hostile catalogue cannot hand us a huge "theme".
MAX_THEME_BYTES = 64 * 1024

# Two requests back to back; see the same note in wiki_template_catalogue.
FETCH_TIMEOUT = 10

THEME_MODES = ("light", "dark")

#: App modes: which side of the product a user is in. Grimoire is TTRPG, Codex
#: is wargaming. Distinct from a theme's *colour* mode (light/dark), which is
#: why the two are never both called "mode" in code.
#:
#: A theme declares the app mode it was built for so the picker can lead with
#: themes made for the one you are in — but it is a preference, not a
#: restriction: any theme can be selected in either, because a palette that
#: works is a palette that works.
APP_MODES = ("grimoire", "codex")
DEFAULT_APP_MODE = "grimoire"

#: Themes bundled with the app. Their colours live in the frontend stylesheet
#: rather than here — the server only needs to name them so the picker can list
#: them beside installed ones, and so selecting one validates.
#:
#: The empty id is each app mode's own default palette.
BUILT_IN_THEMES: dict[str, list[dict[str, str]]] = {
    "grimoire": [
        {"id": "", "name": "Grimoire", "app_mode": "grimoire"},
        {"id": "codex", "name": "Codex", "app_mode": "codex"},
    ],
    "codex": [
        {"id": "", "name": "Codex", "app_mode": "codex"},
        {"id": "grimoire", "name": "Grimoire", "app_mode": "grimoire"},
    ],
}


def built_in_themes(app_mode: str = DEFAULT_APP_MODE) -> list[dict[str, str]]:
    """Bundled themes, the active app mode's own default listed first."""
    return BUILT_IN_THEMES.get(app_mode, BUILT_IN_THEMES[DEFAULT_APP_MODE])


def is_built_in(theme_id: str, app_mode: str = DEFAULT_APP_MODE) -> bool:
    return any(t["id"] == theme_id for t in built_in_themes(app_mode))


#: Every token a theme may set. Mirrors THEME_TOKENS in
#: frontend/src/utils/theme.js — the two lists must stay in step, and a test
#: asserts they do.
THEME_TOKENS: tuple[str, ...] = (
    "bg-deep",
    "bg-panel",
    "bg-card",
    "bg-card-hover",
    "bg-input",
    "border",
    "border-light",
    "accent",
    "accent-dim",
    "accent-bright",
    "accent-alt",
    "on-accent",
    "text",
    "text-dim",
    "text-muted",
    "red",
    "green",
    "blue",
    "danger",
    "danger-fill",
    "on-danger",
    "on-media",
    "on-media-border",
    "warning",
    "success",
    "tag-bg",
    "tag-border",
    "mark-bg",
    "invite-bg",
    "overlay",
    "shadow",
    "scrim",
    "scrim-strong",
    "type-book",
    "type-map",
    "type-token",
    "type-audio",
    "type-file",
    # The accent marking an item that has other versions. See the note beside
    # this entry in the frontend list.
    "variant",
)

# Colour grammar. Deliberately narrow — hex, rgb/rgba, hsl/hsla, and a couple of
# keywords. Anything with a semicolon, a url(), a comment, or a nested var()
# fails to match and is dropped rather than sanitised: a colour we do not fully
# understand is not worth guessing at.
_COLOR_RE = re.compile(
    r"^(?:#[0-9a-f]{3,8}"
    r"|rgba?\(\s*[\d.\s,%/]+\)"
    r"|hsla?\(\s*[\d.\s,%/]+(?:deg)?[\d.\s,%/]*\)"
    r"|transparent|currentcolor|inherit)$",
    re.IGNORECASE,
)

MAX_COLOR_LENGTH = 64

# A theme id becomes part of a URL path and a database key, so keep it plain.
_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_ID_LENGTH = 100


class ThemeError(Exception):
    """A theme could not be fetched, parsed, or validated.

    Carries a message safe to show the user — the UI surfaces these directly.
    """


def is_safe_color(value: Any) -> bool:
    """True when ``value`` is a colour we will write into a stylesheet."""
    return (
        isinstance(value, str)
        and len(value) <= MAX_COLOR_LENGTH
        and bool(_COLOR_RE.match(value.strip()))
    )


def sanitize_tokens(tokens: Any) -> dict[str, str]:
    """Keep only allowlisted token names holding a valid colour.

    Silently drops the rest: a theme with one bad value should still install and
    render, rather than failing wholesale over a typo.
    """
    if not isinstance(tokens, dict):
        return {}
    return {
        name: str(tokens[name]).strip()
        for name in THEME_TOKENS
        if name in tokens and is_safe_color(tokens[name])
    }


def valid_theme_id(value: Any) -> bool:
    return isinstance(value, str) and len(value) <= MAX_ID_LENGTH and bool(_ID_RE.match(value))


def slugify_id(name: str) -> str:
    """Derive a theme id from a display name, for a theme authored in the app."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return (slug or "custom")[:MAX_ID_LENGTH].strip("-") or "custom"


def parse_variants(payload: dict[str, Any], fallback_mode: str) -> dict[str, dict[str, str]]:
    """Extract a theme's per-colour-mode token sets.

    A theme may ship both a light and a dark palette in one document:

        {"variants": {"light": {...}, "dark": {...}}}

    A single-mode theme keeps the older flat shape and becomes a one-variant
    map keyed by its own ``mode``, so both forms are the same thing downstream
    and nothing already written has to be restructured.

    Variants that set no recognised colour are dropped rather than kept as an
    empty palette, which would render as "theme applied, nothing changed".
    """
    raw = payload.get("variants")
    if isinstance(raw, dict):
        variants = {}
        for mode in THEME_MODES:
            tokens = sanitize_tokens(raw.get(mode))
            if tokens:
                variants[mode] = tokens
        if variants:
            return variants

    tokens = sanitize_tokens(payload.get("tokens"))
    return {fallback_mode: tokens} if tokens else {}


def parse_theme(payload: Any) -> dict[str, Any]:
    """Validate a theme document into its stored shape.

    Returns ``{id, name, mode, app_mode, variants, tokens, version}``, where
    ``variants`` maps a colour mode to its token set and ``mode`` names the
    theme's primary one (the dark palette when it ships both, matching the app
    default). ``tokens`` is kept as the primary variant so older callers and
    stored rows keep working.

    Raises ``ThemeError`` when the document is unusable — no id, or no token the
    app recognises. A theme that sets nothing would install as a no-op and look
    like a silent failure, so it is rejected loudly instead.
    """
    if not isinstance(payload, dict):
        raise ThemeError("A theme must be a JSON object")

    raw_id = payload.get("id")
    name = str(payload.get("name") or "").strip()
    theme_id = raw_id if valid_theme_id(raw_id) else slugify_id(name)
    if not name:
        name = str(theme_id).replace("-", " ").title()

    declared = str(payload.get("mode") or "dark").lower()
    if declared not in THEME_MODES:
        declared = "dark"

    app_mode = str(payload.get("app_mode") or DEFAULT_APP_MODE).lower()
    if app_mode not in APP_MODES:
        app_mode = DEFAULT_APP_MODE

    variants = parse_variants(payload, declared)
    if not variants:
        raise ThemeError("That theme does not set any colours Grimoire recognises")

    # The primary mode is the declared one when the theme actually ships it,
    # else whichever single variant it does ship.
    mode = declared if declared in variants else next(iter(variants))

    return {
        "id": theme_id,
        "name": name[:120],
        "mode": mode,
        "app_mode": app_mode,
        "variants": variants,
        "tokens": variants[mode],
        "version": str(payload.get("version") or "")[:20],
    }


def variant_for(variants: Any, mode: str, fallback: Any = None) -> dict[str, str]:
    """The token set to apply for a resolved colour mode.

    Falls back to whatever the theme does ship when it has no variant for this
    mode: a one-mode theme stays visible rather than silently switching itself
    off half the time.
    """
    if isinstance(variants, dict) and variants:
        exact = variants.get(mode)
        if isinstance(exact, dict) and exact:
            return sanitize_tokens(exact)
        for value in variants.values():
            if isinstance(value, dict) and value:
                return sanitize_tokens(value)
    return sanitize_tokens(fallback)


def downloads_enabled() -> bool:
    return external_installs_enabled()


def _assert_downloads_enabled() -> None:
    if not downloads_enabled():
        raise ThemeError("Downloading themes is disabled on this server")


def get_index_url(db: Session) -> str:
    """The catalogue URL: an operator's override, else the built-in default."""
    row = db.query(AppSetting).filter_by(key=SETTING_INDEX_URL).first()
    custom = (row.value or "").strip() if row and row.value else ""
    return custom or config.DEFAULT_THEME_INDEX_URL


def is_custom_url(db: Session) -> bool:
    return get_index_url(db) != config.DEFAULT_THEME_INDEX_URL


def fetch_catalogue(db: Session) -> dict[str, Any]:
    """Fetch and cache the community theme index."""
    _assert_downloads_enabled()
    url = get_index_url(db)
    try:
        doc = fetch_document(
            url,
            cache_ttl=CATALOGUE_CACHE_TTL,
            timeout=FETCH_TIMEOUT,
            user_agent=f"Grimoire/{config.VERSION}",
        )
    except AddonFetchError as exc:
        raise ThemeError(str(exc)) from exc
    if not isinstance(doc, dict):
        raise ThemeError("The theme catalogue is not in the expected format")
    return doc


def list_entries(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """The catalogue's themes, with untrusted strings bounded."""
    raw = doc.get("themes")
    if not isinstance(raw, list):
        return []
    out = []
    for entry in raw:
        if not isinstance(entry, dict) or not valid_theme_id(entry.get("id")):
            continue
        author_name, author_url = _author(entry)
        out.append(
            {
                "id": entry["id"],
                "name": str(entry.get("name") or entry["id"])[:120],
                "description": str(entry.get("description") or "")[:500],
                "mode": (
                    str(entry.get("mode") or "dark").lower()
                    if str(entry.get("mode") or "dark").lower() in THEME_MODES
                    else "dark"
                ),
                "app_mode": (
                    str(entry.get("app_mode") or DEFAULT_APP_MODE).lower()
                    if str(entry.get("app_mode") or DEFAULT_APP_MODE).lower() in APP_MODES
                    else DEFAULT_APP_MODE
                ),
                "modes": [
                    m
                    for m in THEME_MODES
                    if m in (entry.get("modes") or [])
                ]
                or [str(entry.get("mode") or "dark").lower()],
                "version": str(entry.get("version") or "")[:20],
                "author": author_name,
                "author_url": author_url,
                "path": str(entry.get("path") or ""),
                "sha256": str(entry.get("sha256") or ""),
                "grimoire_min_version": str(entry.get("grimoire_min_version") or "")[:20],
            }
        )
    return out


def _author(entry: dict[str, Any]) -> tuple[str, str]:
    """The byline name and its GitHub URL, if the declared author is a username."""
    return parse_author(str(entry.get("author") or "")[:120])


def find_entry(doc: dict[str, Any], theme_id: str) -> Optional[dict[str, Any]]:
    for entry in list_entries(doc):
        if entry["id"] == theme_id:
            return entry
    return None


def _resolve_theme_url(index_url: str, path: str) -> str:
    """Resolve a catalogue-relative theme path, pinned to the catalogue's host.

    ``path`` is repo-relative (``themes/x/x.json``) while the index lives inside
    the repo at ``<repo>/themes/index.json``, so resolving one against the other
    naively doubles the shared segment. Mirrors the wiki-template catalogue,
    which is the stronger of the two existing patterns: the add-on installer
    does no host check at all.
    """
    if not path:
        raise ThemeError("That theme has no file to download")

    # A catalogue entry names a file *inside* the repository. An absolute URL,
    # a scheme-relative one, or a root-relative one is refused outright rather
    # than resolved: splitting it on "/" would otherwise fold the foreign host
    # into a path segment and quietly fetch the wrong file.
    if "//" in path or ":" in path or path.startswith("/"):
        raise ThemeError("That theme's file is on an unexpected host")

    base = index_url.rsplit("/", 1)[0] + "/"
    segments = [s for s in path.split("/") if s and s != "."]
    if ".." in segments:
        raise ThemeError("That theme's path is not valid")

    base_segments = [s for s in urlparse(base).path.split("/") if s]
    overlap = 0
    for candidate in range(min(len(base_segments), len(segments)), 0, -1):
        if base_segments[-candidate:] == segments[:candidate]:
            overlap = candidate
            break

    url = urljoin(base, "/".join(segments[overlap:]))
    if urlparse(url).netloc != urlparse(index_url).netloc:
        raise ThemeError("That theme's file is on an unexpected host")
    return url


def verify_digest(body: bytes, expected: str) -> None:
    """Reject a download whose digest does not match the catalogue.

    The catalogue is the thing the user chose to trust; a file that does not
    match it has been altered in transit or at rest, and we refuse it either
    way. An absent digest is not an error — it just cannot be checked.
    """
    if not expected:
        return
    if hashlib.sha256(body).hexdigest() != expected:
        raise ThemeError(
            "That theme failed its integrity check - the catalogue and the file disagree"
        )


def fetch_theme(db: Session, entry: dict[str, Any]) -> dict[str, Any]:
    """Download one theme, verify its digest, and validate it.

    Fetched with its own client rather than ``fetch_document`` because that
    helper caches and does not verify a digest; a theme is fetched once, at
    install time, and must be checked against the catalogue.
    """
    _assert_downloads_enabled()
    import json

    import httpx

    url = _resolve_theme_url(get_index_url(db), entry.get("path", ""))
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
                raise ThemeError(f"The theme download returned HTTP {response.status_code}")
            body = response.content
    except httpx.TimeoutException as exc:
        raise ThemeError("The theme download timed out") from exc
    except httpx.HTTPError as exc:
        raise ThemeError(f"Could not download the theme: {exc}") from exc

    if len(body) > min(MAX_THEME_BYTES, HTTP_MAX_BYTES):
        raise ThemeError("That theme file is too large")

    verify_digest(body, str(entry.get("sha256") or ""))

    try:
        doc = json.loads(body.decode("utf-8", "replace"))
    except ValueError as exc:
        raise ThemeError("That theme file is not valid JSON") from exc

    theme = parse_theme(doc)
    # The catalogue is the thing the user chose to trust, so its metadata wins
    # over whatever the file claims about itself.
    theme["id"] = entry["id"]
    theme["name"] = entry.get("name") or theme["name"]
    theme["version"] = entry.get("version") or theme["version"]
    return theme
