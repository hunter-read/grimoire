"""Path resolution, containment, and sidecar identification.

The foundation layer every other module in this package builds on. Two rules
live here and are not re-derived anywhere else: a caller-supplied path is only
ever turned into a real one by :func:`safe_join` (which resolves both sides
before the containment check), and the library root is deliberately *not*
symlink-resolved, so the paths produced here match the ``filepath`` values the
scanner stored.
"""
import os
from pathlib import Path
from typing import Optional

from ...config import LIBRARY_PATH
from ...indexer.constants import (
    ARCHIVE_EXTS,
    AUDIO_EXTS,
    DOC_EXTS,
    IMAGE_EXTS,
    MAP_IMAGE_EXTS,
)
from ...metadata.formats import COVER_SUFFIX, SIDECAR_SUFFIXES
from .constants import COLLECTIONS, LibraryFSError


def library_root() -> Path:
    """The library root exactly as configured, *without* resolving symlinks.

    Deliberately unresolved. The scanner builds every stored ``filepath`` by
    joining onto ``LIBRARY_PATH`` verbatim, so a library reached through a
    symlink (``/var`` on macOS, a symlinked media mount on a NAS) is recorded in
    the DB under the symlinked form. Resolving here would make every path this
    module produces fail to match those rows — the move would succeed on disk and
    silently relink nothing.

    Traversal safety does not depend on this: ``safe_join`` resolves both sides
    when it performs the containment check.
    """
    return Path(LIBRARY_PATH)


def safe_join(relative: str, *, must_exist: bool = False) -> Path:
    """Resolve a caller-supplied library-relative path, or raise.

    This is the only way caller input becomes a filesystem path in this module.
    It rejects anything that escapes the library root — ``..`` segments, absolute
    paths, and symlinks pointing outside — by comparing the *fully resolved*
    candidate against the *fully resolved* root, so a symlinked subfolder cannot
    be used as a bridge out of the library.

    The value returned is the **unresolved** join, so it stays comparable with the
    ``filepath`` values the scanner stored. Only the safety check resolves.
    """
    root = library_root()
    cleaned = (relative or "").strip().replace("\\", "/")
    if not cleaned.strip("/"):
        raise LibraryFSError("Path is empty", code="invalid")
    if "\x00" in cleaned:
        raise LibraryFSError("Path contains an invalid character", code="invalid")
    # An absolute path is never a valid library-relative path. Silently
    # reinterpreting it as relative would turn "/etc/passwd" into a real library
    # path and hide the caller's mistake.
    if cleaned.startswith("/"):
        raise LibraryFSError("Path must be relative to the library root", code="forbidden")

    candidate = root / cleaned
    resolved_root = root.resolve()
    resolved = candidate.resolve()
    if resolved != resolved_root and not resolved.is_relative_to(resolved_root):
        raise LibraryFSError("Path escapes the library root", code="forbidden")
    if must_exist and not candidate.exists():
        raise LibraryFSError(f"Path does not exist: {cleaned}", code="not_found")
    # Normalise away any interior "." / ".." now that containment is proven, so
    # the result is a clean path that still matches stored filepaths.
    return Path(os.path.normpath(str(candidate)))


def to_relative(path: Path) -> str:
    """Express an absolute library path as a forward-slashed relative path.

    Falls back to the resolved forms when the direct comparison fails, so a path
    that arrived symlink-resolved (or a root that is itself a symlink) still
    relativises instead of raising.
    """
    root = library_root()
    try:
        return str(path.relative_to(root)).replace("\\", "/")
    except ValueError:
        return str(path.resolve().relative_to(root.resolve())).replace("\\", "/")


def collection_of(path: Path) -> Optional[str]:
    """The collection (``books``/``maps``/…) a library path belongs to, if any.

    Matched case-insensitively on the first path segment, mirroring
    ``resolve_collection_dir`` — a library root may hold ``Books`` rather than
    ``books`` on a case-sensitive filesystem.
    """
    try:
        rel = to_relative(path)
    except ValueError:
        return None
    head = rel.split("/")[0].lower()
    return head if head in COLLECTIONS else None


# Everything export can write beside a content file. The cover's compound
# ``.cover.jpg`` is what lets it be listed here at all: a bare ``.jpg`` could
# not be told apart from ordinary library content (a map, a token, an image
# book), so hiding it would risk hiding the content itself.
_COMPANION_SUFFIXES = (*SIDECAR_SUFFIXES, COVER_SUFFIX)

# Content a sidecar can belong to. A sidecar is only recognised as one when it
# sits beside a file the library actually indexes, so an orphaned ``.opf`` stays
# visible and manageable rather than silently disappearing.
_CONTENT_EXTS = DOC_EXTS | IMAGE_EXTS | AUDIO_EXTS | MAP_IMAGE_EXTS | ARCHIVE_EXTS


def sidecar_stem(name: str) -> Optional[str]:
    """The content stem a sidecar filename belongs to, or ``None``.

    Compound suffixes are why this cannot be ``os.path.splitext``: that would
    reduce ``Guide.grimoire.json`` to ``Guide.grimoire`` and the pairing check
    would never find ``Guide.pdf``. Suffixes are tested longest-first for the
    same reason - ``.cover.jpg`` must win over ``.jpg``.
    """
    lowered = name.lower()
    for suffix in sorted(_COMPANION_SUFFIXES, key=len, reverse=True):
        if lowered.endswith(suffix) and len(name) > len(suffix):
            return name[: -len(suffix)]
    return None


def _has_content_sibling(directory: Path, stem: str, names: set[str]) -> bool:
    """Whether ``stem`` names an indexable file in this directory.

    ``names`` is the directory listing the caller already has, so a folder of
    n entries costs one scan rather than one stat per candidate.
    """
    lowered = {n.lower() for n in names}
    return any(f"{stem}{ext}".lower() in lowered for ext in _CONTENT_EXTS)


def is_sidecar(path: Path, *, siblings: Optional[set[str]] = None) -> bool:
    """Whether ``path`` is metadata *about* library content rather than content.

    True only for a file that both carries a companion suffix **and** sits next
    to content with the same stem. The pairing requirement is deliberate: it is
    what keeps a hand-maintained ``.opf`` whose book has been deleted from
    vanishing out of the file manager.
    """
    stem = sidecar_stem(path.name)
    if stem is None:
        return False

    directory = path.parent
    if siblings is None:
        try:
            siblings = {e.name for e in os.scandir(directory)}
        except OSError:
            return False
    return _has_content_sibling(directory, stem, siblings)


def sidecars_for(content: Path) -> list[Path]:
    """Every sidecar file that belongs to ``content``, on disk now.

    Used to carry them along on a move or rename. Only files that exist are
    returned, so a book exported in one format does not drag phantom paths.
    """
    stem = content.name[: -len(content.suffix)] if content.suffix else content.name
    directory = content.parent
    candidates = (directory / f"{stem}{suffix}" for suffix in _COMPANION_SUFFIXES)
    return [p for p in candidates if p.is_file()]


def library_writable() -> bool:
    """Whether the library root can be written to at all.

    A cheap probe of the root, used to decide whether the UI offers destructive
    file actions anywhere outside the file manager. Deliberately root-level: a
    per-folder answer would need a stat per row, and a read-only *mount* is the
    case this exists to detect. Individual operations still check their own
    target, so a folder made read-only on its own is caught where it matters.
    """
    root = library_root()
    return root.is_dir() and os.access(root, os.W_OK | os.X_OK)


def assert_writable(path: Path) -> None:
    """Raise a clear error when ``path``'s filesystem cannot be written.

    A read-only bind mount is a supported way to run Grimoire, and the failure it
    produces (``EROFS`` deep inside a rename) is opaque. Checking up front turns
    it into an actionable message instead of a 500. The directory itself is
    probed, since write permission on the *parent* is what a create/move needs.
    """
    probe = path if path.is_dir() else path.parent
    if not os.access(probe, os.W_OK | os.X_OK):
        raise LibraryFSError(
            "The library is mounted read-only, so it cannot be modified. "
            "Remount it read-write to manage files from Grimoire.",
            code="read_only",
        )


# ---------------------------------------------------------------------------
# Re-deriving a book's system and category after a move
# ---------------------------------------------------------------------------

