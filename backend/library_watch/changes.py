"""Which filesystem changes matter, and how much of the library they need rescanned.

Pure functions over library-relative paths, kept apart from the watcher threads
so the rules can be tested without a filesystem or an observer.

A change is worth a scan when it could alter what the library holds: content
files, folders, and the marker files the scanner reads (``.grimoireignore``,
container and NSFW markers). Everything else is noise - a NAS's thumbnail
folders, an OS's ``.DS_Store``, a download's ``.part`` file, and the sidecars
Grimoire writes beside books itself, which would otherwise have every export
trigger another scan.
"""
from dataclasses import dataclass
from typing import Callable, Iterable, Optional

from ..indexer.constants import (
    AGNOSTIC_MARKER,
    FRAMES_MARKER,
    GENERIC_MARKER,
    NO_AUTO_CATEGORY_MARKER,
    NSFW_MARKER,
    ONE_PAGE_MARKER,
    PARENT_SYSTEM_MARKER,
    PUBLISHER_MARKER,
    SYSTEM_FAMILY_MARKER,
)
from ..indexer.metadata import is_exported_cover_name
from ..library_ignore import IGNORE_FILENAME

COLLECTIONS = frozenset({"books", "maps", "tokens", "audio", "models"})

# Hidden files that are not noise: the scanner reads every one of them.
_MEANINGFUL_HIDDEN = frozenset(
    {
        IGNORE_FILENAME,
        NSFW_MARKER,
        NO_AUTO_CATEGORY_MARKER,
        PARENT_SYSTEM_MARKER,
        ONE_PAGE_MARKER,
        AGNOSTIC_MARKER,
        SYSTEM_FAMILY_MARKER,
        PUBLISHER_MARKER,
        GENERIC_MARKER,
        FRAMES_MARKER,
    }
)
# Folders NAS appliances and operating systems create inside shares.
_JUNK_DIRS = frozenset({"@eadir", "#recycle", "#snapshot", "$recycle.bin", "lost+found"})
_JUNK_FILES = frozenset({"thumbs.db", "desktop.ini"})
# Files still being written by a browser, a download client, or an editor. The
# finished file arrives under its real name, and that event is the one to scan.
_PARTIAL_SUFFIXES = (
    ".part",
    ".partial",
    ".crdownload",
    ".download",
    ".tmp",
    ".temp",
    ".swp",
    ".!qb",
    "~",
)
# Sidecars Grimoire writes beside books. Scanning because of them would only
# find what the export just wrote.
_SIDECAR_SUFFIXES = (".opf",)

# What a change did, as the watcher reports it. A folder's own "modified" event
# only means something inside it changed, which arrives as its own event.
CREATED, DELETED, MOVED, MODIFIED = "created", "deleted", "moved", "modified"


@dataclass(frozen=True)
class Change:
    """One relevant change, by library-relative path with ``/`` separators."""

    path: str
    is_dir: bool
    kind: str


def is_relevant(rel: str, is_dir: bool, kind: str) -> bool:
    """Whether a change at library-relative ``rel`` could alter the library."""
    rel = rel.replace("\\", "/").strip("/")
    if not rel or rel == "." or rel.startswith("../") or rel == "..":
        return False
    if is_dir and kind == MODIFIED:
        return False
    parts = rel.split("/")
    name = parts[-1]
    # The library root's own .grimoireignore applies to every collection.
    if len(parts) == 1:
        return name == IGNORE_FILENAME
    if parts[0].lower() not in COLLECTIONS:
        return False
    for folder in parts[:-1]:
        if folder.startswith(".") or folder.lower() in _JUNK_DIRS:
            return False
    lowered = name.lower()
    if is_dir:
        return not name.startswith(".") and lowered not in _JUNK_DIRS
    if name.startswith("."):
        return name in _MEANINGFUL_HIDDEN
    if lowered in _JUNK_FILES or lowered.endswith(_PARTIAL_SUFFIXES):
        return False
    if lowered.endswith(_SIDECAR_SUFFIXES) or is_exported_cover_name(name):
        return False
    return True


def plan_scan(
    changes: Iterable[Change], folder_exists: Callable[[str, str], bool]
) -> Optional[str]:
    """The narrowest scan that covers ``changes``: a scope path, or None for a full scan.

    A scoped scan walks one top-level folder (``books/<system>``,
    ``maps/<folder>``…), which is what keeps a change to one shelf cheap on a
    large library. It is only correct when everything that changed sits inside
    that one folder, so anything wider falls back to a full scan:

    * changes in more than one top-level folder - a file moved between systems
      is a move only if one scan sees both halves;
    * a ``.grimoireignore`` change, or one at a collection's root;
    * a folder created, deleted, or renamed under ``books/``. Folders there are
      systems, and only a full scan recognises a renamed system or drops one
      whose folder is gone (scoped scans never prune systems);
    * a top-level folder that no longer exists, since there is nothing to scope to.

    ``folder_exists(collection, folder)`` is injected so this stays pure.
    """
    tops: set[tuple[str, str]] = set()
    for change in changes:
        parts = change.path.replace("\\", "/").strip("/").split("/")
        if parts[-1] == IGNORE_FILENAME or len(parts) < 3:
            return None
        if parts[0].lower() == "books" and change.is_dir and change.kind != MODIFIED:
            return None
        tops.add((parts[0], parts[1]))
    if len(tops) != 1:
        return None
    collection, folder = next(iter(tops))
    if not folder_exists(collection, folder):
        return None
    return f"{collection}/{folder}"
