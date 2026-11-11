"""Replacing an indexed file by upload, keeping its record (issues #497, #870).

``POST /api/files/upload`` with ``on_conflict=replace`` lands here. The service
layer writes the new bytes over a file Grimoire already tracks - a book, map,
token, audio file or 3D model - and this module re-reads whatever the record
learned from the old ones. Nothing the user wrote is touched: the record keeps
its id, so its tags, description, variant links, favorites, bookmarks and
campaign links all stay on it.
"""
from typing import Any

from fastapi import BackgroundTasks, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ...config import DATA_PATH, THUMB_DIR, logger
from ...indexer import refresh_book_file, refresh_media_file, reset_book_index
from ...indexer.formats import can_index
from ...models import Audio, Book, GenericMap, Model3D, Token
from ...services import library_fs as fs

# A replaced media record's collection and ORM model, by its record type.
_MEDIA: dict[str, tuple[str, Any]] = {
    "map": ("maps", GenericMap),
    "token": ("tokens", Token),
    "audio": ("audio", Audio),
    "model": ("models", Model3D),
}


def replace_file(
    db: Session,
    background_tasks: BackgroundTasks,
    destination: str,
    relative_dir: str,
    file: UploadFile,
    max_bytes: int,
) -> dict:
    """Overwrite an indexed file with the upload and re-read it, keeping its id.

    Nothing read from the old file is trusted afterwards. For a book that is the
    hash, size, page count, cover, page renders, search text and OCR checkpoint
    (see ``_refresh_book``); for a map, token, model or audio file it is the
    hash, size, thumbnail, cached renders, a model's triangle count and a track's
    duration (see ``refresh_media_file``).

    Refused while a library scan or a standalone OCR run is going, and, for a
    book, while the re-index queue is busy with that same book. The OCR worker
    resumes from a page checkpoint on its own copy of the row; swapping the file
    under it would splice the new file's pages onto the old file's text and then
    write the stale checkpoint back over the reset. The re-index queue working
    on *other* books - earlier replaces, or single-book rescans - does not block
    it (issue #657), so a batch of replaces runs back to back while their text is
    read in the background. That queue only ever reads books, so it never blocks
    a media replace; a scan does, because it writes media rows too.
    """
    from ...services.library_scan import claims, reindex_queue
    from ...services.library_scan.runner import scan_in_progress

    live = scan_in_progress()
    if live and not reindex_queue.reindex_running():
        raise HTTPException(
            status_code=409,
            detail="A library scan or OCR run is in progress - replace the file once it finishes",
        )

    claimed: list[str] = []

    def claim(record_type: str, record_id: str) -> None:
        if record_type != "book":
            return
        # With no job running, a claim still held was left by one that died.
        if not claims.claim_book(record_id, force=not live):
            raise HTTPException(
                status_code=409,
                detail="This book is being re-indexed - replace the file once it finishes",
            )
        claimed.append(record_id)

    try:
        result = fs.replace_upload(
            db,
            destination,
            file.filename or "",
            file.file,
            relative_dir=relative_dir,
            max_bytes=max_bytes,
            before_write=claim,
        )
        if result["record_type"] == "book":
            _refresh_book(db, background_tasks, result)
        else:
            _refresh_media(db, result)
        return result
    finally:
        for book_id in claimed:
            claims.release_book(book_id)


def _refresh_book(db: Session, background_tasks: BackgroundTasks, result: dict) -> None:
    """Re-read a replaced book: the cheap part now, its text in the background.

    The cheap re-read happens before responding, so the content hash changes
    (and with it every page URL) before anyone can load a page of the new file
    under the old file's cache key. Search text and OCR can take far longer: the
    book is queued for the background re-index
    (``services.library_scan.reindex_queue``), with progress on
    ``GET /api/scan-status``.
    """
    from ...services.books.documents import invalidate_book_cache
    from ...services.library_scan import reindex_queue

    book = db.get(Book, result["record_id"])
    if book is None:  # pragma: no cover - deleted between the write and here
        return
    try:
        book.is_missing = False
        book.scan_failed = False
        refresh_book_file(book, DATA_PATH, db)
        if can_index(book.mime_type):
            # Commits the refresh above along with the reset. Queued before the
            # claim is released, so a drain that skipped the book while it was
            # claimed finds it again.
            reset_book_index(book, db)
            reindex_queue.queue_reindex(book.id)
            background_tasks.add_task(reindex_queue.drain_reindex_queue)
        else:
            db.commit()
    except Exception as e:
        # The new file is already in place. A later scan sees its new size and
        # mtime and rebuilds the book the way it does any file replaced on disk.
        db.rollback()
        logger.error("Could not re-read replaced book %s: %s", result["path"], e)
    finally:
        # The cached (path, hash) lookup may have been refilled with the old hash
        # by a request that landed during the re-read.
        invalidate_book_cache()


def _refresh_media(db: Session, result: dict) -> None:
    """Re-read a replaced map, token, model or audio file before responding.

    All of it is quick - a hash, a thumbnail, a header read - so it is done here,
    and the new content hash is in place before anyone asks for the thumbnail
    or image again: the image routes build their ETags from it, so a browser
    holding the old picture revalidates and gets the new one. A mesh too heavy
    to render inline is left for the deferred preview queue, as a scan leaves
    it.
    """
    section, model = _MEDIA[result["record_type"]]
    record = db.get(model, result["record_id"])
    if record is None:  # pragma: no cover - deleted between the write and here
        return
    try:
        record.is_missing = False
        refresh_media_file(section, record, THUMB_DIR)
        db.commit()
    except Exception as e:
        # As for a book: the new file is in place, and is still served. Only what
        # the record says about it (size, hash, thumbnail) is behind.
        db.rollback()
        logger.error("Could not re-read replaced %s %s: %s", section, result["path"], e)
