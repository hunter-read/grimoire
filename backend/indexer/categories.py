"""Folder-name → book-category inference, plus the shared ``slugify`` helper."""
import re
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from .. import config
from ..models import AppSetting
from .constants import (
    CATEGORY_MAP,
    CONTAINER_MARKERS,
    CONTAINER_ONE_PAGE,
    CONTAINER_PRECEDENCE,
    NO_AUTO_CATEGORY_MARKER,  # noqa: F401  (re-exported for callers)
    NSFW_MARKER,
    UNCATEGORIZED,
    _CONTAINER_SUFFIXES,
    _ONE_PAGE_SLUGS,
    _SYSTEM_AGNOSTIC_SLUGS,
)

logger = logging.getLogger("grimoire.indexer")


# Leading characters people prepend to system folders purely to steer the
# alphabetical sort order of their file browser (e.g. "!!Dungeons & Dragons").
# Only these three are recognized, and only as a contiguous leading run — once a
# non-special character is read, the rest is the real name.
_SORT_PREFIX_CHARS = "!$%"


def strip_sort_prefix(name: str) -> str:
    """Strip leading sort-order prefix characters (``!$%``) from a folder name.

    Only the contiguous run of these characters at the very start is removed;
    everything from the first non-prefix character onward is kept verbatim
    (including internal ``!``/``$``/``%``). Surrounding whitespace is trimmed.
    """
    return name.lstrip(_SORT_PREFIX_CHARS).strip()


def slugify(name: str) -> str:
    """Create a URL-safe slug from a name."""
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


def is_system_agnostic_folder(folder_name: str) -> bool:
    """Return True if this top-level books folder should be treated as system-agnostic."""
    return slugify(folder_name) in _SYSTEM_AGNOSTIC_SLUGS


def is_one_page_folder(folder_name: str) -> bool:
    """Return True if this top-level books folder is the one-page / small-RPG collection."""
    return slugify(folder_name) in _ONE_PAGE_SLUGS


def is_special_collection_folder(folder_name: str) -> bool:
    """Return True for any special collection folder (agnostic or one-page).

    Both use their immediate subfolder name as the category label rather than
    the normal CATEGORY_MAP inference.
    """
    return is_system_agnostic_folder(folder_name) or is_one_page_folder(folder_name)


def prettify_collection_name(name: str) -> str:
    """Humanize a slug-like folder or file stem into a display name.

    ``honey-heist`` → ``Honey Heist``. Words already containing an uppercase
    letter are left alone so deliberate casing survives (``cbr+PNK``); the
    frontend applies the shared acronym table on top of this when rendering.
    """
    words = re.split(r"[\s_-]+", name.replace("-", " ").strip())
    return " ".join(w if any(c.isupper() for c in w) else w.capitalize() for w in words if w)


def strip_container_suffix(name: str) -> tuple[str, str]:
    """Split a container suffix (``(parent-system)``, ``(publisher)``, …) off a name.

    Returns ``(clean_name, container_kind)`` where ``container_kind`` is one of
    the ``CONTAINER_*`` kinds, or ``""`` when the name carries no container
    suffix. Matched case-insensitively anywhere in the name, exactly like the
    ``(nsfw)`` marker it mirrors.

    A name carrying more than one suffix resolves to the most specific kind per
    ``CONTAINER_PRECEDENCE``, and *every* recognised suffix is stripped either
    way — a leftover ``(publisher)`` in the stored system name would be a
    display bug, not a second declaration.
    """
    matched: list[str] = []
    clean = name
    for suffix, kind in _CONTAINER_SUFFIXES.items():
        pattern = rf"\s*\({re.escape(suffix)}\)\s*"
        if re.search(pattern, clean, re.IGNORECASE):
            matched.append(kind)
            clean = re.sub(pattern, " ", clean, flags=re.IGNORECASE)
    if not matched:
        return name, ""
    winner = next(k for k in CONTAINER_PRECEDENCE if k in matched)
    return clean.strip(), winner


def detect_container_kind(system_dir: Path, folder_name: str) -> str:
    """Return the container kind for a top-level books folder, or ``""``.

    A folder becomes a container of systems (rather than a system holding
    categories) through any of three equivalent declarations:

    1. a marker file at the folder root (``.parent-system-container``,
       ``.one-page-container``, ``.system-family-container``,
       ``.publisher-container``),
    2. an equivalent folder-name suffix (``(parent-system)``, ``(publisher)``,
       …) — handled by ``strip_container_suffix`` before this is called, since
       the suffix has to come off the stored system name either way,
    3. one of the reserved one-page collection slugs (``one-page-rpgs``,
       ``micro-rpgs``, …), which imply a one-page container.

    When a folder carries several markers the most specific kind wins, per
    ``CONTAINER_PRECEDENCE``. Marker files are all checked before the
    reserved-slug fallback, so a user can force a reserved-slug folder into
    another flavour instead.

    Note that the reserved *system-agnostic* slugs deliberately do **not** imply
    a container. An agnostic folder is a single system whose subfolders are
    categories (``system-agnostic/maps/`` is the "maps" category); promoting it
    to a container would make each subfolder its own system and re-file every
    book in an existing agnostic library. The agnostic container kind exists for
    users who explicitly want that shape, and only via an explicit marker.
    """
    for kind in CONTAINER_PRECEDENCE:
        if (system_dir / CONTAINER_MARKERS[kind]).exists():
            return kind
    if is_one_page_folder(folder_name):
        return CONTAINER_ONE_PAGE
    return ""


def has_nsfw_marker(system_dir: Path) -> bool:
    """Return True if a ``.nsfw`` marker file sits at this folder's root.

    Equivalent to the ``(nsfw)`` folder-name suffix, offered for parity with the
    other folder-level indicators (some filesystems and sync tools make
    parenthesised folder names awkward).
    """
    return (system_dir / NSFW_MARKER).exists()


def _normalize_folder(name: str) -> str:
    """Collapse hyphens, underscores, and whitespace to a single space for category matching."""
    return re.sub(r"[-_\s]+", " ", name.lower()).strip()


def _token_matches_keyword(token: str, kw_token: str) -> bool:
    """Match a single folder token against a single keyword on word boundaries.

    Accepts an exact match or a simple English plural of the keyword
    (``supplement`` -> ``supplements``, ``bestiary`` -> ``bestiaries``) so that
    folders like ``Supplements`` or ``Maps`` still classify, while incidental
    substrings (``mm`` inside ``gamma``) no longer do.
    """
    if token == kw_token:
        return True
    if token == kw_token + "s":
        return True
    if token == kw_token + "es":
        return True
    if kw_token.endswith("y") and token == kw_token[:-1] + "ies":
        return True
    return False


def _keyword_matches(keyword: str, tokens: list[str]) -> bool:
    """Return True if ``keyword`` matches ``tokens`` on whole-word boundaries.

    Single-word keywords must match a whole token (so ``mm`` no longer matches
    inside ``gamma``). Multi-word keywords (e.g. ``character sheet``) match as a
    contiguous run of tokens.
    """
    kw_tokens = keyword.split()
    n = len(kw_tokens)
    for i in range(len(tokens) - n + 1):
        if all(_token_matches_keyword(tokens[i + j], kw_tokens[j]) for j in range(n)):
            return True
    return False


def _match_category(segment: str) -> str | None:
    """Return the CATEGORY_MAP category a single folder ``segment`` matches, or None."""
    tokens = _normalize_folder(segment).split()
    for category, keywords in CATEGORY_MAP.items():
        if any(_keyword_matches(kw, tokens) for kw in keywords):
            return category
    return None


def folder_category_inference_disabled(session: Session) -> bool:
    """Return True when folder-name category inference is globally disabled.

    The DISABLE_FOLDER_CATEGORY_INFERENCE env var, when set, pins the value and
    overrides the DB setting (mirroring config's other env-over-DB overrides).
    Otherwise the ``disable_folder_category_inference`` AppSetting is consulted,
    defaulting to enabled (inference on).
    """
    if config.DISABLE_FOLDER_CATEGORY_INFERENCE_ENV is not None:
        return config.DISABLE_FOLDER_CATEGORY_INFERENCE_ENV
    row = (
        session.query(AppSetting)
        .filter_by(key="disable_folder_category_inference")
        .first()
    )
    return bool(row) and row.value == "true"


def guess_category(filepath: str, system_depth: int = 2) -> str:
    """Infer book category from path segments.

    The top-level category folder (the first folder under the system root, e.g.
    ``core`` in ``books/Shadowrun/core/Companions/x.pdf``) is the deliberate
    category the user chose, so it takes priority: if it matches a keyword, that
    category wins even when a deeper subfolder (``Companions``, ``DM Guide``)
    incidentally matches a different keyword. Only when the top-level folder does
    not match do we scan deeper subfolders innermost-first, then fall back to the
    top-level folder name as a custom category slug.

    ``system_depth`` is the index of the category folder within the path — 2 for
    the standard ``books/<system>/<category>/`` layout, 3 for a system nested
    inside a container folder (``books/<container>/<system>/<category>/``, issues
    #261/#262).
    """
    segments = filepath.replace("\\", "/").split("/")
    # segments[-1] is the filename; the category folder is the first segment
    # under the system root.
    folder_segments = segments[:-1]
    if len(folder_segments) > system_depth:
        top_category_folder = folder_segments[system_depth]
        matched = _match_category(top_category_folder)
        if matched is not None:
            return matched
        # Top-level folder is a custom (non-keyword) category. Its name wins over
        # any keyword-matching subfolder nested beneath it.
        return slugify(top_category_folder)
    # No dedicated category folder under the system root — scan whatever folders
    # exist innermost-first for a keyword match.
    for segment in reversed(folder_segments):
        matched = _match_category(segment)
        if matched is not None:
            return matched
    return "core"


def agnostic_category(relative_path: str) -> str:
    """Return the category for a book inside the system-agnostic folder.

    Path structure: books/{SystemName}/{CategoryFolder}/.../{file}
    The immediate subfolder under the system dir becomes the category slug.
    Books sitting directly in the system dir fall back to 'uncategorized'.
    """
    # relative_path is relative to library root: books/<agnostic folder>/<cat>/.../<file>
    parts = relative_path.replace("\\", "/").split("/")
    # parts[0]=books, parts[1]=system dir, parts[2]=category dir or filename
    if len(parts) > 3:
        return slugify(parts[2])
    return UNCATEGORIZED
