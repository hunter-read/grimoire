"""Filesystem-check and cleanup helpers for the maintenance router."""
import os
import threading

from ...config import logger
from ...models import Audio, Book, Campaign, GameSystem, GenericMap, Token
from ...services.library_fs.references import purge_references

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
        logger.warning(f"Cleanup: filesystem check timed out for '{filepath}' - skipping")
        return True
    return result[0]


def _prune_orphaned_systems(db) -> int:
    """Delete game systems left with no books after the book sweep.

    Orphaned systems otherwise linger in the campaign-creation picker even
    though their library entries are gone. Three things keep a system alive:

    * it still has books;
    * a campaign references it, so deleting would dangle ``system_id``;
    * it has a surviving child, which is what keeps a container alive.

    That last rule is what issue #309 was about. A container folder holds no
    books of its own — the books sit under its children — so the plain
    "no books" test marked every container as an orphan. Deleting one then
    cascaded through ``GameSystem.children`` (``delete-orphan``) and took the
    editions *and their books* with it, making a whole system tree vanish on
    the first cleanup after a scan.

    Note the rule is deliberately phrased over ``parent_id`` rather than
    ``container_kind``: every container kind is protected the same way, so
    kinds added later (system-family and publisher, issue #301) are covered
    without touching this function. Nested containers work for the same reason
    — the deepest-first walk resolves the inner shelf before the outer one.

    Systems are walked deepest-first so that a container whose children all get
    pruned in this pass is still collected in the same pass.
    """
    systems = db.query(GameSystem).all()
    logger.debug(f"Cleanup: checking {len(systems)} game system(s) for orphans")

    by_id = {s.id: s for s in systems}
    children: dict[str, list[str]] = {}
    for system in systems:
        if system.parent_id:
            children.setdefault(system.parent_id, []).append(system.id)

    def _depth(system) -> int:
        """Distance from the tree root, guarding against a parent_id cycle."""
        depth, seen, cur = 0, {system.id}, system
        while cur.parent_id and cur.parent_id in by_id and cur.parent_id not in seen:
            seen.add(cur.parent_id)
            cur = by_id[cur.parent_id]
            depth += 1
        return depth

    deleted: set[str] = set()
    count = 0
    for system in sorted(systems, key=_depth, reverse=True):
        # Deliberately counts variants too: a system whose only remaining
        # books are printer-friendly cuts is NOT empty, and pruning it here
        # would cascade through GameSystem.books and delete them.
        book_count = db.query(Book).filter_by(game_system_id=system.id).count()
        if book_count > 0:
            continue
        campaign_count = db.query(Campaign).filter_by(system_id=system.id).count()
        if campaign_count > 0:
            logger.debug(
                f"Cleanup: empty system '{system.name}' still referenced by "
                f"{campaign_count} campaign(s) - keeping"
            )
            continue
        surviving = [cid for cid in children.get(system.id, []) if cid not in deleted]
        if surviving:
            logger.debug(
                f"Cleanup: container '{system.name}' has {len(surviving)} surviving "
                f"child system(s) - keeping"
            )
            continue
        logger.info(f"Cleanup: removing empty game system '{system.name}' (id={system.id})")
        db.delete(system)
        db.commit()
        logger.debug(f"Cleanup: committed removal of system id={system.id}")
        deleted.add(system.id)
        count += 1

    return count


def _do_cleanup(db) -> dict:
    """Delete DB records whose files no longer exist on disk.

    Commits after each deleted record so the write lock is released between
    rows and doesn't block concurrent scanner sessions.
    """
    removed = {"books": 0, "maps": 0, "tokens": 0, "audio": 0, "systems": 0}

    books = db.query(Book).all()
    logger.debug(f"Cleanup: checking {len(books)} book(s)")
    for book in books:
        logger.debug(f"Cleanup: checking book '{book.title}' ({book.filepath})")
        if not _path_exists(book.filepath):
            logger.info(f"Cleanup: removing missing book '{book.title}' ({book.filepath})")
            logger.debug(f"Cleanup: purging references for book id={book.id}")
            purge_references(db, Book, book.id)
            db.delete(book)
            db.commit()
            logger.debug(f"Cleanup: committed removal of book id={book.id}")
            removed["books"] += 1
        else:
            logger.debug(f"Cleanup: book '{book.title}' present - skipping")

    removed["systems"] += _prune_orphaned_systems(db)

    maps = db.query(GenericMap).all()
    logger.debug(f"Cleanup: checking {len(maps)} map(s)")
    for m in maps:
        logger.debug(f"Cleanup: checking map '{m.filename}' ({m.filepath})")
        if not _path_exists(m.filepath):
            logger.info(f"Cleanup: removing missing map '{m.filename}' ({m.filepath})")
            purge_references(db, GenericMap, m.id)
            db.delete(m)
            db.commit()
            logger.debug(f"Cleanup: committed removal of map id={m.id}")
            removed["maps"] += 1
        else:
            logger.debug(f"Cleanup: map '{m.filename}' present - skipping")

    tokens = db.query(Token).all()
    logger.debug(f"Cleanup: checking {len(tokens)} token(s)")
    for t in tokens:
        logger.debug(f"Cleanup: checking token '{t.filename}' ({t.filepath})")
        if not _path_exists(t.filepath):
            logger.info(f"Cleanup: removing missing token '{t.filename}' ({t.filepath})")
            purge_references(db, Token, t.id)
            db.delete(t)
            db.commit()
            logger.debug(f"Cleanup: committed removal of token id={t.id}")
            removed["tokens"] += 1
        else:
            logger.debug(f"Cleanup: token '{t.filename}' present - skipping")

    audio = db.query(Audio).all()
    logger.debug(f"Cleanup: checking {len(audio)} audio track(s)")
    for a in audio:
        logger.debug(f"Cleanup: checking audio '{a.filename}' ({a.filepath})")
        if not _path_exists(a.filepath):
            logger.info(f"Cleanup: removing missing audio '{a.filename}' ({a.filepath})")
            purge_references(db, Audio, a.id)
            db.delete(a)
            db.commit()
            logger.debug(f"Cleanup: committed removal of audio id={a.id}")
            removed["audio"] += 1
        else:
            logger.debug(f"Cleanup: audio '{a.filename}' present - skipping")

    return removed


def run_cleanup_sync() -> None:
    """Synchronous wrapper used by the scheduler."""
    from ...config import SessionLocal

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
