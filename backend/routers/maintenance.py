"""Maintenance router — admin-only housekeeping tasks."""

import os
import threading

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from ..config import SessionLocal, logger
from ..auth import require_admin, CurrentUser
from ..models import Book, Bookmark, GenericMap, Token

router = APIRouter(prefix="/maintenance", tags=["maintenance"])

_FS_TIMEOUT = 5  # seconds before an os.path.exists() call is treated as hung


def _path_exists(filepath: str) -> bool:
    """Return whether filepath exists, with a timeout guard against hung mounts."""
    result = [None]

    def _check():
        try:
            result[0] = os.path.exists(filepath)
        except Exception:
            result[0] = False

    t = threading.Thread(target=_check, daemon=True)
    t.start()
    t.join(_FS_TIMEOUT)
    if t.is_alive():
        # Thread is stuck — treat the path as present to avoid false deletion
        logger.warning(f"Cleanup: filesystem check timed out for '{filepath}' — skipping")
        return True
    return result[0]


def _do_cleanup(db) -> dict:
    """Delete DB records whose files no longer exist on disk.

    Commits after each deleted record so the write lock is released between
    rows and doesn't block concurrent scanner sessions.
    """
    removed = {"books": 0, "maps": 0, "tokens": 0}

    books = db.query(Book).all()
    logger.debug(f"Cleanup: checking {len(books)} book(s)")
    for book in books:
        logger.debug(f"Cleanup: checking book '{book.title}' ({book.filepath})")
        if not _path_exists(book.filepath):
            logger.info(f"Cleanup: removing missing book '{book.title}' ({book.filepath})")
            logger.debug(f"Cleanup: deleting FTS index for book id={book.id}")
            db.execute(text("DELETE FROM book_search WHERE book_id = :id"), {"id": book.id})
            bookmark_count = db.query(Bookmark).filter_by(book_id=book.id).count()
            logger.debug(f"Cleanup: deleting {bookmark_count} bookmark(s) for book id={book.id}")
            db.query(Bookmark).filter_by(book_id=book.id).delete()
            db.delete(book)
            db.commit()
            logger.debug(f"Cleanup: committed removal of book id={book.id}")
            removed["books"] += 1
        else:
            logger.debug(f"Cleanup: book '{book.title}' present — skipping")

    maps = db.query(GenericMap).all()
    logger.debug(f"Cleanup: checking {len(maps)} map(s)")
    for m in maps:
        logger.debug(f"Cleanup: checking map '{m.filename}' ({m.filepath})")
        if not _path_exists(m.filepath):
            logger.info(f"Cleanup: removing missing map '{m.filename}' ({m.filepath})")
            db.delete(m)
            db.commit()
            logger.debug(f"Cleanup: committed removal of map id={m.id}")
            removed["maps"] += 1
        else:
            logger.debug(f"Cleanup: map '{m.filename}' present — skipping")

    tokens = db.query(Token).all()
    logger.debug(f"Cleanup: checking {len(tokens)} token(s)")
    for t in tokens:
        logger.debug(f"Cleanup: checking token '{t.filename}' ({t.filepath})")
        if not _path_exists(t.filepath):
            logger.info(f"Cleanup: removing missing token '{t.filename}' ({t.filepath})")
            db.delete(t)
            db.commit()
            logger.debug(f"Cleanup: committed removal of token id={t.id}")
            removed["tokens"] += 1
        else:
            logger.debug(f"Cleanup: token '{t.filename}' present — skipping")

    return removed


@router.post("/cleanup-missing", summary="Remove DB entries for missing files")
def cleanup_missing(_: CurrentUser = Depends(require_admin)):
    from .library import _helpers as _lib

    logger.debug("Cleanup: manual trigger received")
    if _lib._get_status()["running"]:
        logger.debug("Cleanup: blocked — library scan is currently running")
        raise HTTPException(status_code=409, detail="A library scan is already running; retry after it completes.")

    logger.debug("Cleanup: no scan running, proceeding")
    db = SessionLocal()
    try:
        removed = _do_cleanup(db)
        logger.info(f"Cleanup complete: {removed}")
        return {"removed": removed}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def run_cleanup_sync() -> None:
    """Synchronous wrapper used by the scheduler."""
    logger.debug("Cleanup: scheduled run starting")
    db = SessionLocal()
    try:
        removed = _do_cleanup(db)
        logger.info(f"Cleanup complete: {removed}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
