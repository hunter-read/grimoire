"""Structural filesystem operations on the library, with the DB kept in step.

Grimoire has always treated the library as read-only: the scanner walks it, and
every structural change (renaming a mistyped folder, moving a book into the right
category, creating a container) happened in some other tool, followed by a
rescan. This module is the write half (issue #302).

The whole design turns on one constraint: **path is identity**. ``filepath`` is
the unique key for every indexed row, so a naive ``os.rename`` orphans the record
— the next scan flags the old row missing and inserts a fresh one, dropping the
tags, favorites, bookmarks, reading progress, campaign links, and FTS text
attached to the old id. Issue #284 solved that for moves made *outside* the app
by matching content hashes after the fact. Here we already know the source and
the destination, so there is nothing to detect: the move and the relink happen
together, in one transaction, and the row's id never changes.

Ordering matters and is deliberate throughout. Validate before touching the disk;
move the file before writing the DB (a failed rename must not leave the DB
pointing at a path that was never created); and let a DB failure roll the file
back to where it came from, so the two never disagree. The alternative — DB
first — can strand a row pointing at a file that does not exist, which is exactly
the state this feature exists to prevent.

Path handling is likewise uniform: every caller-supplied path is treated as
hostile and resolved against the library root before use, because these are the
first endpoints in the app that write to arbitrary library locations.
"""
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..config import LIBRARY_PATH, THUMB_DIR, logger
from ..indexer.categories import (
    UNCATEGORIZED,
    agnostic_category,
    guess_category,
    is_one_page_folder,
    is_special_collection_folder,
    is_system_agnostic_folder,
    slugify,
    strip_container_suffix,
    strip_sort_prefix,
)
from ..indexer.constants import (
    ARCHIVE_EXTS,
    AUDIO_EXTS,
    CONTAINER_AGNOSTIC,
    CONTAINER_MARKERS,
    CONTAINER_ONE_PAGE,
    DOC_EXTS,
    IMAGE_EXTS,
    MAP_IMAGE_EXTS,
    NSFW_MARKER,
    SINGLETON_CONTAINER_KINDS,
)
from ..indexer.thumbnails import archive_ext
from ..metadata.formats import COVER_SUFFIX, SIDECAR_SUFFIXES
from ..models.library import Book, GameSystem
from ..models.media import Audio, GenericMap, Token

# The four indexed collections, and the model that owns each one. Keyed by the
# top-level library folder so a caller can go from a path straight to its model.
COLLECTIONS: dict[str, Any] = {
    "books": Book,
    "maps": GenericMap,
    "tokens": Token,
    "audio": Audio,
}

# Thumbnails live under DATA_PATH/thumbnails/<section>/ for these collections
# only; tokens and audio have no rendered thumbnail on disk.
_THUMB_SECTIONS = {"books": "books", "maps": "maps"}

# Upload chunk size. Large enough that syscall overhead is irrelevant on a
# multi-hundred-MB book, small enough that memory stays flat per request.
_UPLOAD_CHUNK = 1 << 20

# The category folders `scaffold_categories` creates for a system, in the order
# they should appear. Plural, human-readable spellings deliberately — each one
# is verified to infer back to its canonical category slug (``Adventures`` →
# ``adventure``), so a user gets folders that both read well in a file browser
# and classify correctly on the next scan.
SCAFFOLD_CATEGORY_FOLDERS = (
    "Core",
    "Supplements",
    "Adventures",
    "Character Sheets",
    "Maps",
    "Handouts",
    "Homebrew",
    "Starter Sets",
)


class LibraryFSError(Exception):
    """A structural operation failed for a reason the user should see.

    Carries an HTTP-ish ``code`` so the router can map failures to status codes
    without re-deriving them from message text.
    """

    def __init__(self, message: str, code: str = "invalid") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


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


def _system_folder_name(raw_name: str) -> str:
    """The system name the scanner would derive from a folder name.

    Mirrors ``_resolve_system_folder``: peel the ``(nsfw)`` marker, the container
    suffix, then any sort prefix. Kept in step with the scanner so a moved book
    lands on the same system row a rescan would have given it.
    """
    import re

    name = re.sub(r"\s*\(nsfw\)\s*", "", raw_name, flags=re.IGNORECASE).strip()
    name, _ = strip_container_suffix(name)
    return strip_sort_prefix(name)


def resolve_book_placement(db: Session, dest_file: Path) -> tuple[Optional[str], str]:
    """Return ``(game_system_id, category)`` for a book at ``dest_file``.

    A move across systems has to answer the same question the scanner answers
    during a walk, but without a walk: which system row owns this path, and what
    category does the folder structure imply? Both are re-derived from the
    destination path so the record matches what the next rescan would produce —
    if they disagreed, the rescan would silently rewrite the move.

    The system is matched by *name* against existing rows rather than created:
    creating systems is ``create_folder``'s job, and a move should never
    invent one as a side effect.
    """
    rel = to_relative(dest_file)
    parts = rel.split("/")
    # parts: books/<system>/[...]/<file>  — anything shorter has no system folder.
    if len(parts) < 3:
        return None, UNCATEGORIZED

    system_folder = parts[1]
    system_name = _system_folder_name(system_folder)
    system = (
        db.query(GameSystem).filter(GameSystem.name == system_name).first()
        or db.query(GameSystem).filter(GameSystem.slug == slugify(system_name)).first()
    )

    # A system nested one level inside a container folder shifts every
    # subsequent segment right by one; the scanner expresses that as
    # `system_depth`. Detect it by asking whether the matched system has a
    # parent, which is what a container membership records.
    depth = 2
    if system is not None and getattr(system, "parent_id", None):
        depth = 3
        # The real system folder is the second segment inside the container.
        if len(parts) > 2:
            nested_name = _system_folder_name(parts[2])
            nested = db.query(GameSystem).filter(GameSystem.name == nested_name).first()
            if nested is not None:
                system = nested

    if is_special_collection_folder(system_folder):
        return (system.id if system else None), agnostic_category(rel)
    return (system.id if system else None), guess_category(rel, system_depth=depth)


# ---------------------------------------------------------------------------
# Cache fixups
# ---------------------------------------------------------------------------


def _thumb_file(section: str, title: str, filepath: str) -> Path:
    """The on-disk thumbnail for a record, keyed exactly as the scanner keys it."""
    import hashlib

    return Path(THUMB_DIR) / section / (
        f"{slugify(title)}_{hashlib.md5(filepath.encode()).hexdigest()[:8]}.webp"
    )


def _rehome_thumbnail(record: Any, section: str, old_path: str, new_path: str) -> bool:
    """Move a record's cached thumbnail to its new path-derived name.

    Thumbnail filenames embed ``md5(filepath)``, so a move makes the existing file
    unreachable. Renaming it is much cheaper than dropping it and forcing a
    re-render of every moved item — a bulk reorganisation would otherwise
    re-render the whole library. Returns True when the record still has a
    thumbnail afterwards.
    """
    if not getattr(record, "has_thumbnail", False):
        return False
    src = _thumb_file(section, record.title, old_path)
    dst = _thumb_file(section, record.title, new_path)
    if src == dst:
        return True
    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        os.replace(src, dst)
        return True
    except OSError as e:
        # Not fatal: the next scan regenerates it. Clearing the flag is what makes
        # that happen, so a failure here degrades to a re-render rather than a
        # permanently broken image.
        logger.warning("Could not move thumbnail %s -> %s: %s", src, dst, e)
        return False


def _fix_caches(db: Session, model: Any, record: Any, old_path: str, new_path: str) -> None:
    """Re-point every path-keyed cache after a record's file moved.

    Books carry the most derived state: rendered pages (disk + Valkey), an open
    document handle, and FTS rows, all keyed by the old path. Those are dropped
    outright — pages re-render on demand and the FTS text is re-indexed by the
    next scan — while the thumbnail is renamed rather than discarded, since
    nothing would regenerate it until a rescan.
    """
    section = _THUMB_SECTIONS.get(_section_for_model(model))
    if section:
        record.has_thumbnail = _rehome_thumbnail(record, section, old_path, new_path)

    if model is Book:
        from .content_cache import invalidate_book_content

        # The thumbnail was just re-homed under the new key, so it must not be
        # deleted here — pass no thumb_path and let the rename stand.
        invalidate_book_content(record.id, old_path, db=db, thumb_path=None)


def _section_for_model(model: Any) -> str:
    for section, m in COLLECTIONS.items():
        if m is model:
            return section
    return ""


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------


@dataclass
class MoveResult:
    """What a move/rename actually did, for the response and the audit log."""

    moved: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.moved)


def _find_record(db: Session, path: Path) -> tuple[Optional[Any], Optional[Any]]:
    """Locate the indexed row for a file path, with its model.

    Returns ``(None, None)`` for an unindexed file — a sidecar, an ``.opf``, a
    cover image. Those are still moved on disk; there is simply no row to relink.
    """
    section = collection_of(path)
    if not section:
        return None, None
    model = COLLECTIONS[section]
    record = db.query(model).filter(model.filepath == str(path)).first()
    return record, (model if record is not None else None)


def _relink(db: Session, model: Any, record: Any, dest: Path) -> None:
    """Carry a new location onto an existing row, preserving its id.

    This is the heart of the feature. Everything referencing the record — tags,
    favorites, bookmarks, progress, campaign links, FTS rows — is keyed by id, so
    updating the path in place keeps all of it attached. Creating a new row and
    deleting the old one would look equivalent and lose every one of them.
    """
    old_path = record.filepath
    record.filepath = str(dest)
    record.filename = dest.name
    record.relative_path = to_relative(dest)
    # The file demonstrably exists at the destination, so clear any stale
    # missing flag left by an earlier scan.
    record.is_missing = False

    if model is Book:
        system_id, category = resolve_book_placement(db, dest)
        # Only overwrite the system when the destination resolves to one; a book
        # moved somewhere unrecognised keeps its current system rather than
        # becoming orphaned.
        if system_id:
            record.game_system_id = system_id
        record.category = category

    _fix_caches(db, model, record, old_path, str(dest))


def _carry_sidecars(src: Path, dest: Path, *, is_dir: bool) -> list[tuple[Path, Path]]:
    """Move ``src``'s sidecars alongside it, re-stemming them onto ``dest``.

    A sidecar is named from its content's stem, so a move that renames the file
    (a conflict-resolving ``ArtifactName (2).pdf``, or a rename outright) has to
    rewrite the sidecar's name too, or the pair silently breaks: the scanner
    looks for ``<stem>.opf`` and would no longer find it.

    Returns the ``(from, to)`` pairs actually moved so the caller can undo them
    if the database work that follows fails. Failures here are logged rather than
    raised - the content file has already moved, and refusing to complete the
    operation over a metadata file would leave the worse mess.

    ``is_dir`` must be captured by the caller *before* the move: this runs after
    the rename, when ``src`` no longer exists and would report False for a folder.
    """
    if is_dir:
        # A folder move carries its contents already; the sidecars inside it
        # keep both their names and their neighbours.
        return []

    moved: list[tuple[Path, Path]] = []
    dest_stem = dest.name[: -len(dest.suffix)] if dest.suffix else dest.name
    for sidecar in sidecars_for(src):
        suffix = sidecar.name[len(src.name) - len(src.suffix) :]
        target = dest.parent / f"{dest_stem}{suffix}"
        if target.exists():
            logger.warning("Not moving sidecar %s: %s already exists", sidecar, target)
            continue
        try:
            os.replace(sidecar, target)
        except OSError as e:
            if getattr(e, "errno", None) == 18:  # EXDEV - different filesystems
                try:
                    shutil.move(str(sidecar), str(target))
                except OSError as exc:
                    logger.warning("Could not move sidecar %s: %s", sidecar, exc)
                    continue
            else:
                logger.warning("Could not move sidecar %s: %s", sidecar, e)
                continue
        moved.append((sidecar, target))
    return moved


def _restore_sidecars(moved: list[tuple[Path, Path]]) -> None:
    """Put carried sidecars back, for when the DB work after a move failed."""
    for original, target in moved:
        try:
            os.replace(target, original)
        except OSError as e:
            logger.error("Could not roll back sidecar %s -> %s: %s", target, original, e)


def _dest_for(dest_dir: Path, name: str, *, on_conflict: str) -> Path:
    """Resolve the final destination path, applying the collision policy.

    ``skip`` and ``rename`` both exist because bulk moves and single moves want
    different things: a bulk reorganisation should step over a collision and
    report it, while a deliberate single move is better served by landing the
    file under a suffixed name than by silently doing nothing. Overwriting is
    never implicit — it would destroy a file and the metadata attached to it.
    """
    target = dest_dir / name
    if not target.exists():
        return target
    if on_conflict == "skip":
        raise LibraryFSError(f"A file named '{name}' already exists there", code="conflict")
    stem, suffix = Path(name).stem, Path(name).suffix
    for i in range(2, 1000):
        candidate = dest_dir / f"{stem} ({i}){suffix}"
        if not candidate.exists():
            return candidate
    raise LibraryFSError(f"Could not find a free name for '{name}'", code="conflict")


def move_paths(
    db: Session,
    sources: list[str],
    destination: str,
    *,
    on_conflict: str = "skip",
) -> MoveResult:
    """Move files and folders into ``destination``, relinking every indexed row.

    Accepts a mix of files and folders so the UI can drag a whole category across
    without enumerating its contents. A folder move relinks every record beneath
    it, since each one's path changed.

    Collisions and per-item failures are collected rather than raised: a bulk
    move of forty files should not abort on the one that clashes, and the caller
    needs to know which ones did not make it.
    """
    dest_dir = safe_join(destination, must_exist=True)
    if not dest_dir.is_dir():
        raise LibraryFSError("Destination is not a folder", code="invalid")
    assert_writable(dest_dir)

    result = MoveResult()
    for raw in sources:
        try:
            src = safe_join(raw, must_exist=True)
            _move_one(db, src, dest_dir, on_conflict, result)
        except LibraryFSError as e:
            result.skipped.append({"path": raw, "reason": e.message, "code": e.code})
        except OSError as e:
            logger.warning("Move failed for %s: %s", raw, e)
            result.skipped.append({"path": raw, "reason": str(e), "code": "io_error"})

    if result.moved:
        db.commit()
    return result


def _move_one(
    db: Session, src: Path, dest_dir: Path, on_conflict: str, result: MoveResult
) -> None:
    """Move one file or folder and relink whatever it contained."""
    if src == library_root():
        raise LibraryFSError("The library root cannot be moved", code="forbidden")
    if src.is_dir() and dest_dir.is_relative_to(src):
        # Moving a folder into itself or its own descendant would detach the
        # subtree; the OS error for this is obscure, so name it plainly.
        raise LibraryFSError("A folder cannot be moved inside itself", code="invalid")
    if src.parent == dest_dir:
        raise LibraryFSError("Already in that folder", code="noop")

    assert_writable(src.parent)
    dest = _dest_for(dest_dir, src.name, on_conflict=on_conflict)

    # Collect affected rows *before* the move, while their stored paths still
    # match what is on disk. Capture the directory-ness now too: after the
    # rename, ``src`` no longer exists, so a later ``is_dir()`` would report
    # False and collapse every child onto the destination folder itself.
    was_dir = src.is_dir()
    affected = _records_under(db, src)

    try:
        os.replace(src, dest)
    except OSError as e:
        if getattr(e, "errno", None) == 18:  # EXDEV — different filesystems
            shutil.move(str(src), str(dest))
        elif getattr(e, "errno", None) == 30:  # EROFS
            raise LibraryFSError(
                "The library is mounted read-only, so it cannot be modified.",
                code="read_only",
            ) from e
        else:
            raise

    # Sidecars follow their content: they describe this file, and leaving them
    # behind would both orphan them and break the pairing the scanner reads.
    carried = _carry_sidecars(src, dest, is_dir=was_dir)

    try:
        for model, record, old_path in affected:
            new_path = dest / Path(old_path).relative_to(src) if was_dir else dest
            _relink(db, model, record, Path(new_path))
    except Exception:
        # The DB could not be brought in line with the disk. Put the file back so
        # the two agree, rather than leaving rows pointing at a path that moved.
        db.rollback()
        _restore_sidecars(carried)
        try:
            os.replace(dest, src)
        except OSError:
            logger.error("Could not roll back move %s -> %s; DB and disk disagree", src, dest)
        raise

    result.moved.append({"from": to_relative(src), "to": to_relative(dest), "records": len(affected)})


def _records_under(db: Session, path: Path) -> list[tuple[Any, Any, str]]:
    """Every indexed row at, or beneath, ``path``.

    A file yields at most one row; a folder yields everything under it, matched
    by path prefix. The trailing separator on the prefix keeps ``Core`` from
    also matching a sibling ``Core Rules``.
    """
    section = collection_of(path)
    if not section:
        return []
    model = COLLECTIONS[section]
    if path.is_dir():
        prefix = str(path) + os.sep
        rows = db.query(model).filter(model.filepath.startswith(prefix)).all()
    else:
        rows = db.query(model).filter(model.filepath == str(path)).all()
    return [(model, r, r.filepath) for r in rows]


def rename_path(db: Session, target: str, new_name: str) -> dict:
    """Rename a file or folder in place, relinking every record beneath it.

    Distinct from the existing display-name edit, which only changes the DB
    title: this changes the bytes on disk. ``new_name`` is a bare name, never a
    path — accepting a path here would make rename a second, less-guarded move.
    """
    src = safe_join(target, must_exist=True)
    if src == library_root():
        raise LibraryFSError("The library root cannot be renamed", code="forbidden")

    clean = (new_name or "").strip()
    if not clean or clean in (".", ".."):
        raise LibraryFSError("Name is empty", code="invalid")
    if "/" in clean or "\\" in clean or "\x00" in clean:
        raise LibraryFSError("Name cannot contain a path separator", code="invalid")

    assert_writable(src.parent)
    dest = src.parent / clean
    if dest == src:
        return {"from": to_relative(src), "to": to_relative(src), "records": 0}
    if dest.exists():
        raise LibraryFSError(f"'{clean}' already exists", code="conflict")

    # Both captured before the rename: afterwards ``src`` is gone, and treating a
    # renamed folder as a file would collapse its children onto the folder path.
    was_dir = src.is_dir()
    affected = _records_under(db, src)
    try:
        os.replace(src, dest)
    except OSError as e:
        if getattr(e, "errno", None) == 30:
            raise LibraryFSError(
                "The library is mounted read-only, so it cannot be modified.",
                code="read_only",
            ) from e
        raise LibraryFSError(f"Could not rename: {e}", code="io_error") from e

    # Re-stem the sidecars onto the new name, or the pair breaks: the scanner
    # looks for ``<new stem>.opf`` and the old one would no longer match.
    carried = _carry_sidecars(src, dest, is_dir=was_dir)

    try:
        for model, record, old_path in affected:
            new_path = dest / Path(old_path).relative_to(src) if was_dir else dest
            _relink(db, model, record, Path(new_path))
        db.commit()
    except Exception:
        db.rollback()
        _restore_sidecars(carried)
        try:
            os.replace(dest, src)
        except OSError:
            logger.error("Could not roll back rename %s -> %s", src, dest)
        raise

    return {"from": to_relative(src), "to": to_relative(dest), "records": len(affected)}


def create_folder(
    parent: str,
    name: str,
    *,
    container_kind: str = "",
    nsfw: bool = False,
) -> dict:
    """Create a folder, optionally declaring it a container and/or NSFW.

    The marker files are the point. Container and NSFW conventions are currently
    documented rather than enforced, so a user has to recall the exact filename
    (``.parent-system-container``, ``.nsfw``) and create it by hand in another
    tool. Writing them here means the folder *is* what the user asked for the
    moment it exists, and the next scan interprets it correctly with no further
    steps.
    """
    parent_dir = safe_join(parent, must_exist=True)
    if not parent_dir.is_dir():
        raise LibraryFSError("Parent is not a folder", code="invalid")
    assert_writable(parent_dir)

    clean = (name or "").strip()
    if not clean or clean in (".", ".."):
        raise LibraryFSError("Name is empty", code="invalid")
    if "/" in clean or "\\" in clean or "\x00" in clean:
        raise LibraryFSError("Name cannot contain a path separator", code="invalid")

    if container_kind and container_kind not in CONTAINER_MARKERS:
        raise LibraryFSError(f"Unknown container kind: {container_kind}", code="invalid")
    if container_kind:
        _assert_singleton_free(container_kind, None)

    target = parent_dir / clean
    if target.exists():
        raise LibraryFSError(f"'{clean}' already exists", code="conflict")

    try:
        target.mkdir(parents=False)
    except OSError as e:
        if getattr(e, "errno", None) == 30:
            raise LibraryFSError(
                "The library is mounted read-only, so it cannot be modified.",
                code="read_only",
            ) from e
        raise LibraryFSError(f"Could not create folder: {e}", code="io_error") from e

    markers = []
    if container_kind:
        markers.append(CONTAINER_MARKERS[container_kind])
    if nsfw:
        markers.append(NSFW_MARKER)
    for marker in markers:
        try:
            (target / marker).touch()
        except OSError as e:
            logger.warning("Could not write marker %s in %s: %s", marker, target, e)

    return {
        "path": to_relative(target),
        "name": clean,
        "container_kind": container_kind,
        "nsfw": nsfw,
        "markers": markers,
    }


def system_for_folder(db: Session, path: Path) -> Optional[Any]:
    """The ``GameSystem`` a books folder represents, if any.

    A system folder is not an indexed *file*, so it has no row keyed by path —
    but it does correspond to a system, and that system carries the metadata a
    user wants to edit (description, genres, publisher, cover). Resolving it here
    lets a folder offer the same "edit metadata" affordance a file does.

    Matched on the same derived name/slug the scanner uses, so the folder and the
    row agree even when the folder name carries ``(nsfw)``, a container suffix, or
    a sort prefix. Only direct children of ``books/`` are systems; anything deeper
    is a category folder.
    """
    rel = to_relative(path)
    parts = rel.split("/")
    if len(parts) != 2 or parts[0].lower() != "books":
        return None
    name = _system_folder_name(parts[1])
    return (
        db.query(GameSystem).filter(GameSystem.name == name).first()
        or db.query(GameSystem).filter(GameSystem.slug == slugify(name)).first()
    )


def find_singleton_container(kind: str, *, ignore: Optional[Path] = None) -> Optional[str]:
    """Return the library-relative path of the folder already claiming ``kind``.

    Only meaningful for the kinds in ``SINGLETON_CONTAINER_KINDS`` — the ones
    that name *the* collection of their sort rather than a repeatable shelf.

    Scans only the top level of ``books/``, which is the only depth these
    collections are recognised at, so this stays a single cheap directory read
    rather than a walk of the library.
    """
    if kind not in SINGLETON_CONTAINER_KINDS:
        return None
    books = library_root() / "books"
    marker = CONTAINER_MARKERS[kind]
    try:
        children = [c for c in books.iterdir() if c.is_dir()]
    except OSError:
        return None
    for child in children:
        if ignore is not None and child == ignore:
            continue
        if (child / marker).exists():
            return to_relative(child)
        # The reserved slugs claim the collection without a marker file, so a
        # folder simply *named* by the convention counts as the incumbent.
        if kind == CONTAINER_ONE_PAGE and is_one_page_folder(child.name):
            return to_relative(child)
        if kind == CONTAINER_AGNOSTIC and is_system_agnostic_folder(child.name):
            return to_relative(child)
    return None


def _assert_singleton_free(kind: str, target: Optional[Path]) -> None:
    """Refuse a second folder claiming a one-of-a-kind collection.

    Two "one-page RPGs" folders would each claim to be the home of every tiny
    game, and identical books in each would be filed under different systems.
    The UI hides the option once one exists, but the check lives here so the API
    cannot be talked into an inconsistent library.
    """
    existing = find_singleton_container(kind, ignore=target)
    if existing:
        raise LibraryFSError(
            f"'{existing}' is already the {kind} collection, and there can only be one. "
            "Change that folder first if you want this one to take over.",
            code="conflict",
        )


def set_folder_markers(
    path: str, *, container_kind: Optional[str] = None, nsfw: Optional[bool] = None
) -> dict:
    """Add or remove container/NSFW markers on an existing folder.

    Separate from ``create_folder`` because reclassifying an existing shelf is a
    distinct, common operation — marking a folder NSFW, or promoting one that has
    grown into a parent system — and neither should require recreating it.
    ``None`` leaves that aspect untouched.
    """
    target = safe_join(path, must_exist=True)
    if not target.is_dir():
        raise LibraryFSError("Not a folder", code="invalid")
    assert_writable(target)

    if container_kind is not None:
        if container_kind and container_kind not in CONTAINER_MARKERS:
            raise LibraryFSError(f"Unknown container kind: {container_kind}", code="invalid")
        if container_kind:
            _assert_singleton_free(container_kind, target)
        # Container kinds are mutually exclusive: clear all, then set the chosen
        # one, so switching kinds cannot leave two markers fighting over
        # precedence.
        for marker in CONTAINER_MARKERS.values():
            _remove_marker(target / marker)
        if container_kind:
            _write_marker(target / CONTAINER_MARKERS[container_kind])

    if nsfw is not None:
        if nsfw:
            _write_marker(target / NSFW_MARKER)
        else:
            _remove_marker(target / NSFW_MARKER)

    return read_folder_markers(target)


def _write_marker(path: Path) -> None:
    try:
        path.touch()
    except OSError as e:
        raise LibraryFSError(f"Could not write marker file: {e}", code="io_error") from e


def _remove_marker(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    except OSError as e:
        logger.warning("Could not remove marker %s: %s", path, e)


def read_folder_markers(target: Path) -> dict:
    """The container kind and NSFW state a folder currently declares on disk."""
    kind = ""
    for k, marker in CONTAINER_MARKERS.items():
        if (target / marker).exists():
            kind = k
            break
    return {
        "path": to_relative(target),
        "container_kind": kind,
        "nsfw": (target / NSFW_MARKER).exists(),
    }


def allowed_upload_exts(destination: Path) -> set[str]:
    """The file extensions worth uploading into ``destination``.

    Scoped to the collection, because an upload the scanner will never index is
    an upload that silently does nothing: an ``.mp3`` under ``books/`` is invisible
    to every view in the app. Restricting to what each tree indexes turns that
    into an error the user can act on at the moment they make it.

    Archives are accepted everywhere the scanner registers them (books, maps,
    tokens), matching ``ARCHIVE_EXTS``/``MEDIA_ARCHIVE_EXTS``.
    """
    section = collection_of(destination)
    if section == "books":
        return DOC_EXTS | IMAGE_EXTS | ARCHIVE_EXTS
    if section == "maps":
        return MAP_IMAGE_EXTS | ARCHIVE_EXTS
    if section == "tokens":
        return IMAGE_EXTS | ARCHIVE_EXTS
    if section == "audio":
        return AUDIO_EXTS
    return set()


def _upload_ext(filename: str) -> str:
    """The extension an upload will be judged by, honouring two-part archives."""
    return archive_ext(filename) or Path(filename.lower()).suffix


def validate_upload_name(filename: str, destination: Path) -> str:
    """Return the safe base name for an upload, or raise.

    Browsers send whatever the client claims, so this is a trust boundary: the
    name is reduced to its final component (defeating ``../`` and absolute paths
    smuggled through the multipart body) before anything touches the filesystem.
    """
    raw = (filename or "").strip().replace("\\", "/")
    name = os.path.basename(raw)
    if not name or name in (".", ".."):
        raise LibraryFSError("That file has no usable name", code="invalid")
    if "\x00" in name:
        raise LibraryFSError("File name contains an invalid character", code="invalid")
    # Dotfiles are how folders declare their container kind and NSFW state;
    # letting an upload write one would reclassify a shelf without saying so.
    if name.startswith("."):
        raise LibraryFSError("Hidden files cannot be uploaded", code="invalid")

    allowed = allowed_upload_exts(destination)
    if not allowed:
        raise LibraryFSError(
            "Files can only be uploaded into books, maps, tokens, or audio",
            code="invalid",
        )
    ext = _upload_ext(name)
    if ext not in allowed:
        raise LibraryFSError(
            f"'{ext or name}' is not a file type this part of the library indexes",
            code="invalid",
        )
    return name


def save_upload(
    destination: str,
    filename: str,
    stream: Any,
    *,
    relative_dir: str = "",
    on_conflict: str = "skip",
    max_bytes: Optional[int] = None,
) -> dict:
    """Stream one uploaded file into the library.

    Written in chunks rather than read whole: library files are routinely
    hundreds of megabytes, and buffering one in memory per concurrent upload is
    the difference between a working import and an OOM.

    ``relative_dir`` carries the sub-path from a folder upload (the browser's
    ``webkitRelativePath`` minus the file name), so a dropped folder keeps its
    structure. It is validated exactly like any other caller-supplied path.

    The file lands under a temporary name and is renamed into place only once it
    is fully written, so an interrupted upload never leaves a truncated file for
    the scanner to index as a real book.
    """
    dest_dir = safe_join(destination, must_exist=True)
    if not dest_dir.is_dir():
        raise LibraryFSError("Destination is not a folder", code="invalid")

    if relative_dir:
        # Re-validated against the library root rather than trusted: this comes
        # from the browser, and a folder upload is the one place a client sends
        # a whole path.
        dest_dir = safe_join(f"{to_relative(dest_dir)}/{relative_dir}")
        if not dest_dir.exists():
            try:
                dest_dir.mkdir(parents=True, exist_ok=True)
            except OSError as e:
                raise LibraryFSError(f"Could not create {relative_dir}: {e}", code="io_error") from e

    assert_writable(dest_dir)
    name = validate_upload_name(filename, dest_dir)
    target = _dest_for(dest_dir, name, on_conflict=on_conflict)

    tmp = target.with_name(f".{target.name}.part")
    written = 0
    try:
        with open(tmp, "wb") as out:
            while True:
                chunk = stream.read(_UPLOAD_CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if max_bytes is not None and written > max_bytes:
                    raise LibraryFSError("File is too large", code="too_large")
                out.write(chunk)
        if written == 0:
            raise LibraryFSError("File is empty", code="invalid")
        os.replace(tmp, target)
    except LibraryFSError:
        _cleanup_partial(tmp)
        raise
    except OSError as e:
        _cleanup_partial(tmp)
        if getattr(e, "errno", None) == 30:
            raise LibraryFSError(
                "The library is mounted read-only, so it cannot be modified.",
                code="read_only",
            ) from e
        if getattr(e, "errno", None) == 28:
            raise LibraryFSError("The disk is full", code="io_error") from e
        raise LibraryFSError(f"Could not save the file: {e}", code="io_error") from e

    logger.info("Uploaded %s (%d bytes)", to_relative(target), written)
    return {"path": to_relative(target), "name": target.name, "size": written}


def _cleanup_partial(tmp: Path) -> None:
    """Remove a half-written upload so the scanner never sees it."""
    try:
        tmp.unlink()
    except FileNotFoundError:
        pass
    except OSError as e:
        logger.warning("Could not remove partial upload %s: %s", tmp, e)


def scaffold_categories(path: str) -> dict:
    """Create the standard category folders inside a system folder.

    Setting up a new system means creating the same handful of folders every
    time, named exactly as the scanner's category inference expects. Doing it by
    hand is tedious and easy to get subtly wrong — "Adventures" works, "Modules"
    silently becomes a custom category — so this writes the canonical set.

    Only offered under ``books/``, since categories are a books-tree concept.
    Existing folders are left alone and reported separately, so running this on a
    partly-organised system fills the gaps instead of failing.
    """
    target = safe_join(path, must_exist=True)
    if not target.is_dir():
        raise LibraryFSError("Not a folder", code="invalid")
    if collection_of(target) != "books":
        raise LibraryFSError(
            "Category folders only apply to the books library", code="invalid"
        )
    # `books/` itself holds systems, not categories.
    if to_relative(target).count("/") < 1:
        raise LibraryFSError(
            "Pick a system folder inside books/ rather than the books folder itself",
            code="invalid",
        )
    assert_writable(target)

    # Which categories the folder already covers, however they happen to be
    # spelled. Matching on the *inferred category* rather than the folder name is
    # the point: "Rules", "Rulebooks" and "core" all classify as `core`, so
    # adding a "Core" folder beside them would split one category across two
    # shelves and leave the user tidying up after the button that was supposed
    # to tidy for them.
    covered: dict[str, str] = {}
    try:
        for child in target.iterdir():
            if not child.is_dir() or child.name.startswith("."):
                continue
            category = guess_category(f"{to_relative(child)}/x.pdf")
            covered.setdefault(category, child.name)
    except OSError as e:
        logger.warning("Could not read %s while scaffolding: %s", target, e)

    created: list[str] = []
    existing: list[str] = []
    for name in SCAFFOLD_CATEGORY_FOLDERS:
        category = guess_category(f"{to_relative(target)}/{name}/x.pdf")
        held_by = covered.get(category)
        if held_by is not None:
            existing.append(held_by)
            continue
        child = target / name
        if child.exists():
            existing.append(name)
            continue
        try:
            child.mkdir()
            created.append(name)
            # Claim the category so a later name mapping to the same one (were
            # the list ever to contain two) cannot create a duplicate.
            covered[category] = name
        except OSError as e:
            if getattr(e, "errno", None) == 30:
                raise LibraryFSError(
                    "The library is mounted read-only, so it cannot be modified.",
                    code="read_only",
                ) from e
            logger.warning("Could not create category folder %s: %s", child, e)

    return {"path": to_relative(target), "created": created, "existing": existing}


def delete_empty_folder(path: str) -> dict:
    """Remove a folder that holds nothing but marker files.

    Deliberately refuses non-empty folders. Reorganising leaves empty shells
    behind and sweeping them up is part of the job, but recursive deletion of
    library content is a different and far more dangerous feature than this issue
    asks for — there is no undo, and the blast radius is the user's collection.
    """
    target = safe_join(path, must_exist=True)
    if not target.is_dir():
        raise LibraryFSError("Not a folder", code="invalid")
    if target == library_root() or collection_of(target) is None:
        raise LibraryFSError("That folder cannot be deleted", code="forbidden")
    if to_relative(target).count("/") == 0:
        raise LibraryFSError("Collection folders cannot be deleted", code="forbidden")
    assert_writable(target.parent)

    known_markers = set(CONTAINER_MARKERS.values()) | {NSFW_MARKER}
    leftovers = [e.name for e in target.iterdir() if e.name not in known_markers]
    if leftovers:
        raise LibraryFSError("Folder is not empty", code="conflict")

    for marker in known_markers:
        _remove_marker(target / marker)
    try:
        target.rmdir()
    except OSError as e:
        raise LibraryFSError(f"Could not delete folder: {e}", code="io_error") from e
    return {"path": to_relative(target)}
