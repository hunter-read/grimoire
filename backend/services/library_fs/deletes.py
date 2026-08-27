"""Deleting files and folders, and purging what they left behind.

Deletion has to clear more than the file: the indexed row, its sidecars, and the
derived artefacts keyed by its path (thumbnails, cached content) all go too, or
the library accumulates orphans that the scanner will never revisit. Folder
deletion is deliberately two-tier — an empty folder is a cheap, unconfirmed
operation, while a folder with content requires the caller to echo its name back
as confirmation.
"""
import os
import shutil
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from ...config import logger
from ...indexer.constants import CONTAINER_MARKERS, NSFW_MARKER
from ...models.library import Book
from .constants import _THUMB_SECTIONS, LibraryFSError
from .moves import _records_under, _section_for_model, _thumb_file, _thumb_key
from .paths import (
    assert_writable,
    collection_of,
    is_sidecar,
    library_root,
    safe_join,
    sidecars_for,
    to_relative,
)
from .references import purge_references


def _purge_derived(db: Session, model: Any, record: Any) -> None:
    """Drop everything derived from a record whose file is being deleted.

    The mirror of ``_fix_caches``: where a move re-homes the thumbnail and drops
    the rendered pages, a delete drops both. Nothing will regenerate them and the
    row that named them is about to go, so leaving either behind would strand
    files under DATA_PATH that no code path can ever find again.
    """
    section = _THUMB_SECTIONS.get(_section_for_model(model))
    if section and getattr(record, "has_thumbnail", False):
        thumb = _thumb_file(section, _thumb_key(record), record.filepath)
        try:
            thumb.unlink()
        except OSError as e:
            if getattr(e, "errno", None) != 2:  # ENOENT - already gone
                logger.warning("Could not delete thumbnail %s: %s", thumb, e)

    if model is Book:
        from ..content_cache import invalidate_book_content

        invalidate_book_content(record.id, record.filepath, db=db)


def _delete_records(
    db: Session, affected: list[tuple[Any, Any, str]], *, purge: bool = True
) -> int:
    """Remove indexed rows for deleted files, purging their derived artifacts.

    Deleting the row is what distinguishes this from a move: there is no file to
    point at any more, so keeping the record would leave a permanently missing
    entry in every view.

    Everything hanging off the id — bookmarks, favorites, tags, campaign links —
    is removed first by :func:`purge_references`. Nothing in the schema does that
    for us: the polymorphic references carry no foreign key, and ``bookmarks``
    has one with no ``ondelete``, so deleting a bookmarked book used to fail
    outright with an IntegrityError instead of cascading.

    ``purge`` splits the *derived-artifact* half for callers that delete the rows
    *before* the files. Dropping thumbnails and rendered pages is not
    transactional — a later rollback cannot bring them back — so a caller that
    might still fail must delete the rows first and purge only once the files are
    actually gone. Reference rows are unaffected by that split: they live in the
    database and roll back with everything else.
    """
    for model, record, _old in affected:
        if purge:
            _purge_derived(db, model, record)
        purge_references(db, model, record.id)
        db.delete(record)
    return len(affected)


def delete_record(db: Session, model: Any, record: Any, *, delete_file: bool = True) -> dict:
    """Delete one library row by id, with its references, artifacts, and file.

    The id-keyed counterpart to :func:`delete_path`, which resolves what to
    delete from a path and requires that path to still exist on disk. Duplicate
    resolution needs the other direction: the user picked a *record* — the copy
    with worse metadata, or the one whose file a rescan has already lost — and
    the row has to go whether or not the file is still there.

    ``delete_file=False`` drops the row and keeps the file, for "this is indexed
    twice, forget one" rather than "delete this download".
    """
    filepath = record.filepath
    target = Path(filepath)
    companions = sidecars_for(target) if delete_file else []

    purge_references(db, model, record.id)
    _purge_derived(db, model, record)
    db.delete(record)

    removed_file = False
    if delete_file:
        try:
            target.unlink()
            removed_file = True
        except OSError as e:
            errno = getattr(e, "errno", None)
            if errno == 30:  # EROFS
                # Nothing is committed yet, so the row survives with the file.
                db.rollback()
                raise LibraryFSError(
                    "The library is mounted read-only, so it cannot be modified.",
                    code="read_only",
                ) from e
            if errno != 2:  # ENOENT - the row outlived its file, which is fine
                db.rollback()
                raise LibraryFSError(f"Could not delete: {e}", code="io_error") from e

        for sidecar in companions:
            try:
                sidecar.unlink()
            except OSError as e:
                logger.warning("Could not delete sidecar %s: %s", sidecar, e)

    db.commit()
    logger.info("Deleted record %s (%s), file removed: %s", record.id, filepath, removed_file)
    return {"id": record.id, "path": filepath, "file_deleted": removed_file}


def delete_path(db: Session, path: str, *, confirm_name: Optional[str] = None) -> dict:
    """Delete a file, or a folder and everything under it, from the library.

    Irreversible, so the guard scales with the blast radius rather than being
    uniform. A file (and its sidecars) goes on request; a folder holding nothing
    but empty descendants and markers goes on request too, since sweeping up the
    shells a reorganisation leaves behind is routine. A folder that still holds
    *content* requires ``confirm_name`` to match its name exactly — the one case
    where a mis-click could destroy a collection, and where making the user type
    the name proves they read which folder they were about to lose.

    "Empty" is deliberately recursive: a folder of empty folders holds nothing a
    user would miss, and forcing them to delete a nested shell one level at a
    time would be busywork that teaches them to click through the guard.
    """
    target = safe_join(path, must_exist=True)
    if target == library_root():
        raise LibraryFSError("The library root cannot be deleted", code="forbidden")
    if collection_of(target) is None:
        raise LibraryFSError("That path cannot be deleted", code="forbidden")
    assert_writable(target.parent)

    if not target.is_dir():
        return _delete_file(db, target)

    # Collection folders (`books/`, `maps/`…) are structural: the scanner expects
    # them and removing one would take the whole collection with it.
    if to_relative(target).count("/") == 0:
        raise LibraryFSError("Collection folders cannot be deleted", code="forbidden")

    if folder_has_content(target):
        expected = target.name
        if (confirm_name or "").strip() != expected:
            raise LibraryFSError(
                f"This folder is not empty. Type its name ({expected}) to confirm deletion.",
                code="confirm_required",
            )
    return _delete_folder_tree(db, target)


def _delete_file(db: Session, target: Path) -> dict:
    """Delete one file, its sidecars, and the record that indexed it."""
    affected = _records_under(db, target)
    companions = sidecars_for(target)

    try:
        target.unlink()
    except OSError as e:
        if getattr(e, "errno", None) == 30:  # EROFS
            raise LibraryFSError(
                "The library is mounted read-only, so it cannot be modified.",
                code="read_only",
            ) from e
        raise LibraryFSError(f"Could not delete: {e}", code="io_error") from e

    # Sidecars only describe the file that just went, so they follow it. Failures
    # are logged rather than raised: the content is already gone, and aborting
    # over a leftover .opf would leave a worse mess than the leftover itself.
    for sidecar in companions:
        try:
            sidecar.unlink()
        except OSError as e:
            logger.warning("Could not delete sidecar %s: %s", sidecar, e)

    records = _delete_records(db, affected)
    db.commit()
    logger.info("Library delete: %s (%d record(s))", to_relative(target), records)
    return {"path": to_relative(target), "records": records, "files": 1}


def _delete_folder_tree(db: Session, target: Path) -> dict:
    """Delete a folder and everything beneath it, with its records.

    The rows go before the tree does. A ``rmtree`` that fails halfway leaves some
    files gone and some present, and the DB can be rolled back to match reality
    only if it has not been committed yet — so the commit happens last, once the
    disk is known to be in the state the DB describes.
    """
    affected = _records_under(db, target)
    files = sum(1 for _ in target.rglob("*") if _.is_file())
    # Rows now, derived artifacts after the tree is actually gone. Purging first
    # would destroy thumbnails and rendered pages that the rollback below cannot
    # restore, leaving books that still exist with no cover until a rescan.
    purgeable = [(model, record) for model, record, _ in affected]
    records = _delete_records(db, affected, purge=False)

    try:
        shutil.rmtree(target)
    except OSError as e:
        db.rollback()
        if getattr(e, "errno", None) == 30:  # EROFS
            raise LibraryFSError(
                "The library is mounted read-only, so it cannot be modified.",
                code="read_only",
            ) from e
        raise LibraryFSError(f"Could not delete folder: {e}", code="io_error") from e

    for model, record in purgeable:
        _purge_derived(db, model, record)
    db.commit()
    logger.info(
        "Library delete: %s and %d file(s) (%d record(s))", to_relative(target), files, records
    )
    return {"path": to_relative(target), "records": records, "files": files}


def folder_has_content(target: Path) -> bool:
    """Whether a folder holds anything a user would miss, at any depth.

    Marker files and sidecars do not count: a marker is Grimoire's own bookkeeping,
    and a sidecar without its content is already an orphan. Nested folders are
    recursed into rather than counted, so a shell of empty shells reads as empty
    and can be swept without the typed-name guard.
    """
    known_markers = set(CONTAINER_MARKERS.values()) | {NSFW_MARKER}
    try:
        children = list(os.scandir(target))
    except OSError:
        # Unreadable is treated as "has content": refusing to sweep a folder we
        # cannot inspect is the safe direction to fail in.
        return True

    names = {c.name for c in children}
    for child in children:
        if child.is_dir():
            if folder_has_content(Path(child.path)):
                return True
            continue
        if child.name in known_markers or child.name.startswith("."):
            continue
        if is_sidecar(Path(child.path), siblings=names):
            continue
        return True
    return False


def delete_empty_folder(path: str) -> dict:
    """Remove a folder that holds nothing but markers and empty descendants.

    Kept as the narrow, DB-free primitive for the sweep-up case. Anything holding
    real content goes through ``delete_path``, which takes a session (records must
    be removed with the files) and demands the typed-name confirmation.
    """
    target = safe_join(path, must_exist=True)
    if not target.is_dir():
        raise LibraryFSError("Not a folder", code="invalid")
    if target == library_root() or collection_of(target) is None:
        raise LibraryFSError("That folder cannot be deleted", code="forbidden")
    if to_relative(target).count("/") == 0:
        raise LibraryFSError("Collection folders cannot be deleted", code="forbidden")
    assert_writable(target.parent)

    if folder_has_content(target):
        raise LibraryFSError("Folder is not empty", code="conflict")

    try:
        shutil.rmtree(target)
    except OSError as e:
        raise LibraryFSError(f"Could not delete folder: {e}", code="io_error") from e
    return {"path": to_relative(target)}


def unindex_path(db: Session, path: str) -> dict:
    """Forget a file or folder's indexed rows, leaving the files untouched.

    The soft counterpart to :func:`delete_path`. Nothing is unlinked: only the
    rows, and everything keyed to their ids, go. A rescan walks the same library
    it always did, so anything still on disk and not excluded comes straight
    back, which is exactly the point. It exists for the two cases where the file
    is not the problem:

    * A ``.grimoireignore`` was just added and the now-excluded item should stop
      showing up without waiting for a full cleanup pass.
    * Something was deleted from the filesystem outside Grimoire and left a row
      pointing at nothing, and the user wants that one entry gone rather than a
      whole-library cleanup.

    Both of those happen on libraries that may be mounted read-only, and neither
    needs the path to still exist, so this deliberately skips the writability
    probe and the ``must_exist`` resolution that :func:`delete_path` performs.
    The path is still confined to the library root, and the same structural
    guards apply: the root and the collection folders are never unindexable,
    since forgetting one would silently empty a whole collection.
    """
    target = safe_join(path)
    if target == library_root():
        raise LibraryFSError("The library root cannot be deleted", code="forbidden")
    if collection_of(target) is None:
        raise LibraryFSError("That path cannot be deleted", code="forbidden")
    if target.is_dir() and to_relative(target).count("/") == 0:
        raise LibraryFSError("Collection folders cannot be deleted", code="forbidden")

    affected = _records_under(db, target)
    records = _delete_records(db, affected)
    db.commit()
    logger.info("Library unindex: %s (%d record(s))", to_relative(target), records)
    return {"path": to_relative(target), "records": records, "files": 0}
