"""Moving and renaming, with the indexed rows carried along.

This is the heart of the feature. ``filepath`` is the identity of every indexed
row, so a bare ``os.rename`` orphans the record and the next scan re-inserts it
without its tags, favorites, bookmarks, progress, or campaign links. Here the
move and the relink happen together: the file lands first (a failed rename must
not leave the DB pointing at a path that was never created), then the row is
updated in place — id preserved — and a DB failure rolls the file back, so disk
and database never disagree.

Sidecars travel with their content file, and derived state keyed by the old
path (thumbnails, cached content) is re-homed rather than regenerated.
"""
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from ...config import THUMB_DIR, logger
from ...services import library_fs  # package namespace, for patch-sensitive calls
from ...indexer.categories import slugify
from ...models.library import Book
from .constants import COLLECTIONS, _THUMB_SECTIONS, LibraryFSError
from .paths import (
    assert_writable,
    collection_of,
    library_root,
    safe_join,
    sidecars_for,
    to_relative,
)
from .placement import category_folder_for, resolve_book_placement

def relocate_book_for_category(db: Session, book: Any, category: str) -> Optional[str]:
    """Move a book into the folder matching its new category, best-effort.

    Changing a book's category in the metadata editor previously changed only the
    row, which the next rescan would then overwrite from the unchanged folder —
    the edit silently reverted. Moving the file makes the folder the source of
    truth it already was, so the category sticks.

    **Never raises.** This is a side effect of a metadata save that has already
    succeeded, and a read-only library is a supported configuration: a user on a
    read-only mount should get their category change recorded, not an error about
    a move they never asked for. Every failure path returns None and leaves the
    file where it is.

    Returns the new library-relative path when the file moved, else None.
    """
    filepath = getattr(book, "filepath", "") or ""
    if not filepath or not category:
        return None
    src = Path(filepath)
    if not src.is_file() or collection_of(src) != "books":
        return None

    # A read-only library must degrade silently: this is the documented
    # behaviour, not a failure to report.
    if not os.access(src.parent, os.W_OK | os.X_OK):
        return None

    dest_dir = category_folder_for(db, src, category)
    if dest_dir is None or dest_dir == src.parent:
        return None
    if not os.access(dest_dir, os.W_OK | os.X_OK):
        return None

    try:
        dest = _dest_for(dest_dir, src.name, on_conflict="rename")
    except LibraryFSError:
        return None

    try:
        os.replace(src, dest)
    except OSError as e:
        if getattr(e, "errno", None) == 18:  # EXDEV
            try:
                shutil.move(str(src), str(dest))
            except OSError as exc:
                logger.warning("Could not relocate %s for category %s: %s", src, category, exc)
                return None
        else:
            logger.warning("Could not relocate %s for category %s: %s", src, category, e)
            return None

    carried = _carry_sidecars(src, dest, is_dir=False)
    try:
        library_fs._relink(db, Book, book, dest)
        # ``_relink`` re-derives the category from the destination path. That is
        # right for a drag-and-drop move, but here the user's explicit choice is
        # the input: keep it, so a folder whose name infers to something else
        # cannot quietly overrule the edit that caused the move.
        book.category = category
    except Exception:
        _restore_sidecars(carried)
        try:
            os.replace(dest, src)
        except OSError:
            logger.error("Could not roll back relocation %s -> %s", src, dest)
        raise
    logger.info("Recategorised %s -> %s (%s)", to_relative(src), to_relative(dest), category)
    return to_relative(dest)


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
        from ..content_cache import invalidate_book_content

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

    Called by its siblings as ``library_fs._relink`` rather than directly: tests
    substitute a failing version via the package namespace to exercise the
    rollback paths, and a direct call would bypass the patch.

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
            library_fs._relink(db, model, record, Path(new_path))
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
            library_fs._relink(db, model, record, Path(new_path))
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

