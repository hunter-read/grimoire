"""Admin-only structural file management for the library (issue #302).

Handlers stay thin: every filesystem decision, path guard, and DB relink lives in
``services/library_fs.py``, so the same primitive can back the bulk browser, the
per-item affordances, and (later) the automated reorganisation of issue #53
without three implementations drifting apart.

The one thing handled here rather than there is the error mapping — the service
raises ``LibraryFSError`` carrying a code, and this module turns it into the
right HTTP status so the UI can distinguish "already exists" from "read-only
mount" without parsing prose.
"""
import os
from pathlib import Path
from typing import Optional

from fastapi import Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_admin
from ...config import get_db, logger
from ...indexer.constants import SINGLETON_CONTAINER_KINDS
from ...services import library_fs as fs
from ._schemas import (
    BrowseEntry,
    BrowseResponse,
    CreateFolderRequest,
    DeleteFolderRequest,
    MarkersRequest,
    MoveRequest,
    MoveResponse,
    RenameRequest,
    ScaffoldRequest,
)

# Hard ceiling on entries returned for one folder. Well past any hand-curated
# shelf, but small enough that the response stays a few hundred KB and the
# client stays responsive on a folder holding tens of thousands of files.
MAX_ENTRIES = 2000

# Ceiling on a single uploaded file. Generous enough for a scanned rulebook or a
# map pack, low enough that a runaway or malicious upload cannot fill the volume
# in one request.
MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024

# Counting a folder's children is capped: the row only needs to convey scale, and
# an exact count of a 40,000-file folder costs a full directory walk per row.
CHILD_COUNT_CAP = 1000

# LibraryFSError codes → HTTP status. Anything unmapped is a 400.
_STATUS = {
    "forbidden": 403,
    "not_found": 404,
    "conflict": 409,
    "read_only": 409,
    "too_large": 413,
    "io_error": 500,
    "noop": 400,
    "invalid": 400,
}


def _http(e: fs.LibraryFSError) -> HTTPException:
    return HTTPException(status_code=_STATUS.get(e.code, 400), detail=e.message)


def browse(
    path: str = "",
    limit: int = MAX_ENTRIES,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """List one library folder, merged with what Grimoire knows about its files.

    The listing is deliberately DB-aware rather than a raw directory read: the
    point of managing files *inside* Grimoire is seeing which entries are indexed
    records carrying tags and progress, and which are loose files the scanner
    ignored. A pure filesystem listing would make those indistinguishable.

    Bounded on purpose. A single folder can hold tens of thousands of files, and
    an unbounded listing would serialise all of them, ship them, and hand the
    browser a list it cannot usefully render. ``limit`` caps the entries returned
    and ``total`` reports the true count, so the UI can say what it is hiding
    rather than silently showing a partial folder.
    """
    try:
        target = fs.safe_join(path, must_exist=True) if path else fs.library_root()
    except fs.LibraryFSError as e:
        raise _http(e) from e
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Not a folder")

    limit = max(1, min(limit, MAX_ENTRIES))
    section = fs.collection_of(target)
    model = fs.COLLECTIONS.get(section) if section else None

    entries: list[BrowseEntry] = []
    try:
        children = sorted(os.scandir(target), key=lambda e: (not e.is_dir(), e.name.lower()))
    except OSError as e:
        logger.warning("Could not read library folder %s: %s", target, e)
        raise HTTPException(status_code=500, detail="Could not read that folder") from e

    # Sidecars are metadata *about* content, not content: showing a book's
    # .opf/.nfo/.grimoire.yaml and exported cover would triple the size of a
    # folder listing with files the user never put there and cannot usefully
    # act on. They still move with their book - see ``fs.sidecars_for``.
    names = {c.name for c in children}
    visible = [
        c
        for c in children
        if not c.name.startswith(".")
        and (c.is_dir() or not fs.is_sidecar(Path(c.path), siblings=names))
    ]
    total = len(visible)
    children = visible[:limit]

    # One query for the whole page rather than one per file. Matched on exact
    # filepaths — the previous prefix match pulled in every *descendant* row too,
    # so opening a system folder loaded records for its entire subtree.
    records: dict = {}
    if model is not None:
        wanted = [c.path for c in children if not c.is_dir()]
        if wanted:
            for row in db.query(model).filter(model.filepath.in_(wanted)).all():
                records[row.filepath] = row

    for child in children:
        child_path = Path(child.path)
        if child.is_dir():
            markers = fs.read_folder_markers(child_path)
            # A books/<system> folder maps to a GameSystem row, which carries
            # editable metadata (description, genres, cover). Surfacing it lets a
            # system folder offer the same "edit metadata" action a file does.
            system = fs.system_for_folder(db, child_path)
            entries.append(
                BrowseEntry(
                    name=child.name,
                    path=fs.to_relative(child_path),
                    is_dir=True,
                    container_kind=markers["container_kind"] or None,
                    nsfw=markers["nsfw"],
                    child_count=_child_count(child_path),
                    record_id=getattr(system, "id", None),
                    title=getattr(system, "name", None),
                    collection="system" if system is not None else None,
                )
            )
            continue

        record = records.get(child.path)
        try:
            size = child.stat().st_size
        except OSError:
            size = None
        entries.append(
            BrowseEntry(
                name=child.name,
                path=fs.to_relative(child_path),
                is_dir=False,
                size=size,
                record_id=getattr(record, "id", None),
                title=getattr(record, "title", None),
                collection=section if record is not None else None,
                has_thumbnail=bool(getattr(record, "has_thumbnail", False)),
                is_missing=bool(getattr(record, "is_missing", False)),
            )
        )

    root = fs.library_root()
    parent = (
        None if target == root else fs.to_relative(target.parent) if target.parent != root else ""
    )
    # Which one-of-a-kind collections are already claimed, and by whom. The UI
    # uses this to drop those options rather than offering a choice the API
    # would then refuse.
    taken = {
        kind: path
        for kind in SINGLETON_CONTAINER_KINDS
        if (path := fs.find_singleton_container(kind)) is not None
    }
    return BrowseResponse(
        path="" if target == root else fs.to_relative(target),
        parent=parent,
        writable=os.access(target, os.W_OK | os.X_OK),
        entries=entries,
        total=total,
        truncated=total > len(entries),
        singletons_taken=taken,
    )


def _child_count(path: Path) -> Optional[int]:
    """Roughly how many children a folder has, for the row's trailing count.

    Stops counting at ``CHILD_COUNT_CAP``. This runs once per folder in a
    listing, so on a network mount the difference between "peek at a few entries"
    and "walk 40,000 of them" is the difference between a listing that returns
    promptly and one that appears to hang. The UI only needs to distinguish
    empty / small / large, and shows a "+" past the cap.

    Returns None when the folder cannot be read, which the UI renders as no count
    rather than a misleading zero.
    """
    try:
        with os.scandir(path) as it:
            n = 0
            for entry in it:
                if entry.name.startswith("."):
                    continue
                n += 1
                if n >= CHILD_COUNT_CAP:
                    break
            return n
    except OSError:
        return None


def move_files(
    req: MoveRequest,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Move files/folders into a destination folder, relinking their records."""
    try:
        result = fs.move_paths(db, req.sources, req.destination, on_conflict=req.on_conflict)
    except fs.LibraryFSError as e:
        raise _http(e) from e
    logger.info(
        "Library move: %d item(s) -> %s (%d skipped)",
        result.count,
        req.destination,
        len(result.skipped),
    )
    return MoveResponse(moved=result.moved, skipped=result.skipped, count=result.count)


def rename_file(
    req: RenameRequest,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Rename a file or folder on disk, relinking every record beneath it."""
    try:
        result = fs.rename_path(db, req.path, req.new_name)
    except fs.LibraryFSError as e:
        raise _http(e) from e
    logger.info("Library rename: %s -> %s", result["from"], result["to"])
    return result


def create_folder(
    req: CreateFolderRequest,
    _: CurrentUser = Depends(require_admin),
):
    """Create a folder, writing container/NSFW marker files when asked."""
    try:
        return fs.create_folder(
            req.parent, req.name, container_kind=req.container_kind, nsfw=req.nsfw
        )
    except fs.LibraryFSError as e:
        raise _http(e) from e


def update_markers(
    req: MarkersRequest,
    _: CurrentUser = Depends(require_admin),
):
    """Set or clear a folder's container-kind and NSFW markers."""
    try:
        return fs.set_folder_markers(
            req.path, container_kind=req.container_kind, nsfw=req.nsfw
        )
    except fs.LibraryFSError as e:
        raise _http(e) from e


def delete_folder(
    req: DeleteFolderRequest,
    _: CurrentUser = Depends(require_admin),
):
    """Delete an empty folder left behind by a reorganisation."""
    try:
        return fs.delete_empty_folder(req.path)
    except fs.LibraryFSError as e:
        raise _http(e) from e


def scaffold_categories(
    req: ScaffoldRequest,
    _: CurrentUser = Depends(require_admin),
):
    """Create the standard category folders inside a system folder."""
    try:
        return fs.scaffold_categories(req.path)
    except fs.LibraryFSError as e:
        raise _http(e) from e


def upload_file(
    destination: str = Form(...),
    relative_dir: str = Form(""),
    on_conflict: str = Form("rename"),
    file: UploadFile = File(...),
    _: CurrentUser = Depends(require_admin),
):
    """Upload one file into a library folder.

    Deliberately **one file per request**. A single multi-file request would make
    the whole batch succeed or fail together, and a 200-file import that dies on
    file 40 would leave the user with no idea which 39 landed. Per-file requests
    let the client report progress as each one completes and retry only the ones
    that failed.

    ``relative_dir`` carries the sub-path from a folder upload so the dropped
    structure is recreated; it is validated against the library root like any
    other path. The default conflict policy is ``rename`` rather than ``skip``:
    an upload is an explicit "add this", so landing it under a suffixed name is
    friendlier than discarding it — and it still never overwrites.
    """
    try:
        return fs.save_upload(
            destination,
            file.filename or "",
            file.file,
            relative_dir=relative_dir,
            on_conflict=on_conflict,
            max_bytes=MAX_UPLOAD_BYTES,
        )
    except fs.LibraryFSError as e:
        raise _http(e) from e
    finally:
        file.file.close()
