"""Filesystem-check and cleanup helpers for the maintenance router."""
import os
import threading
from pathlib import Path

from ...config import LIBRARY_PATH, logger
from ...indexer.metadata import resolve_collection_dir
from ...models.collections import iter_specs
from ...models import RESOURCE_TYPES, Book, BookFolder, Campaign, GameSystem, ResourceTag
from ...services import tag_service
from ...services.library_fs.references import purge_references, purge_system_references

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
        # The system row carries tags and favorites of its own, and nothing in
        # the schema collects them: they are polymorphic references with no
        # foreign key. Skipping this is how a tag came to report a count with
        # nothing behind it (issue #445).
        purge_system_references(db, system.id)
        db.delete(system)
        db.commit()
        logger.debug(f"Cleanup: committed removal of system id={system.id}")
        deleted.add(system.id)
        count += 1

    return count


def _prune_stale_folders(db) -> int:
    """Delete media folder-tag rows whose directory is no longer on disk.

    Folder rows are keyed by path rather than id, so they are the one kind of row
    a rename or delete outside Grimoire cannot carry along. In-app moves now
    rewrite them (``library_fs._relink_folders``), but a directory renamed
    straight on the filesystem still strands its row — which then shows in the
    tags view as a folder group for a folder that does not exist, and keeps its
    tags counted against nothing (issue #445).

    Book folders are deliberately excluded: a ``BookFolder.path`` is
    ``{system_id}/{category}/subfolder…``, not a disk path, so there is no
    directory to test it against. :func:`_prune_orphaned_book_folders` collects
    those by the books they cover instead.
    """
    library = Path(LIBRARY_PATH)
    count = 0
    for spec in iter_specs():
        if spec.singular == "book":
            continue
        section_dir = resolve_collection_dir(library, spec.section)
        for row in db.query(spec.folder_model).all():
            if _path_exists(str(section_dir / row.path)):
                continue
            logger.info(
                "Cleanup: removing folder tags for missing %s folder '%s'",
                spec.singular,
                row.path,
            )
            db.delete(row)
            count += 1
    if count:
        db.commit()
    return count


def _prune_orphaned_book_folders(db) -> int:
    """Delete book folder-tag rows that no longer cover any book.

    A ``BookFolder.path`` is ``{system_id}/{category}/subfolder…`` rather than a
    disk path, so it cannot be tested against the filesystem. What makes it stale
    is the same thing either way: the shelf it described is gone. A row whose
    system no longer exists, or that covers no book at all, is collected here.
    """
    rows = db.query(BookFolder).all()
    if not rows:
        return 0

    system_ids = {sid for (sid,) in db.query(GameSystem.id).all()}
    depths = tag_service.system_category_depths(db)
    covered: set[str] = set()
    for sid, category, rel in db.query(
        Book.game_system_id, Book.category, Book.relative_path
    ).all():
        covered |= tag_service._book_folder_ancestor_paths(
            sid or "", category or "", rel, depths.get(sid or "", 2)
        )

    # A folder under a system that currently holds no books at all is left alone:
    # that is what an interrupted or not-yet-run scan looks like, and dropping the
    # row there would discard user-set folder tags the next scan would want back.
    # Only a folder whose system is gone, or that covers nothing while its system
    # demonstrably has books, is stale.
    stocked_systems = {
        sid for (sid,) in db.query(Book.game_system_id).distinct() if sid
    }

    count = 0
    for row in rows:
        if row.path in covered:
            continue
        head = row.path.split("/")[0]
        if head in system_ids and head not in stocked_systems:
            continue
        logger.info("Cleanup: removing folder tags for stale book folder '%s'", row.path)
        db.delete(row)
        count += 1
    if count:
        db.commit()
    return count


def _prune_orphaned_tag_links(db) -> int:
    """Delete ``resource_tags`` rows whose resource is gone, then tags left bare.

    ``resource_tags`` is polymorphic — a type discriminator plus a bare id — so
    it carries no foreign key and nothing in the schema collects a link when its
    resource is deleted. ``purge_references`` handles the paths that go through
    it, but the cascade behind ``GameSystem.books`` deletes books without ever
    passing through it, and a row deleted by an older version never did.

    The visible symptom is issue #445: ``GET /api/tags`` counted these links
    while ``/items`` resolved them against the resource tables and dropped them,
    so a tag could report a count with nothing behind it. The listing no longer
    counts dead links either way; this removes them so the table stops growing.
    """
    removed = 0
    by_type: dict[str, set[str]] = {}
    for rtype in RESOURCE_TYPES:
        live = tag_service.live_resource_ids(db, rtype, parents_only=False)
        by_type[rtype] = live

    for link in db.query(ResourceTag).all():
        live = by_type.get(link.resource_type)
        if live is None or link.resource_id in live:
            continue
        db.delete(link)
        removed += 1

    if removed:
        db.flush()
    # A tag row with no links left is invisible everywhere but still occupies its
    # internal key, so a later tag of the same name inherits its display casing.
    orphans = tag_service.prune_orphan_tags(db)
    if removed or orphans:
        db.commit()
        logger.info(
            "Cleanup: removed %d orphaned tag link(s) and %d empty tag(s)", removed, orphans
        )
    return removed


def _do_cleanup(db) -> dict:
    """Delete DB records whose files no longer exist on disk.

    Commits after each deleted record so the write lock is released between
    rows and doesn't block concurrent scanner sessions.
    """
    removed = {spec.section: 0 for spec in iter_specs()}
    removed["systems"] = 0
    removed["folders"] = 0
    removed["tag_links"] = 0

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

    # Maps, tokens, audio and models differ only in their model class, so they
    # run through one loop driven by the collection registry rather than four
    # copies of it — which is also what keeps a newly added collection from
    # being silently skipped here.
    for spec in iter_specs():
        if spec.singular == "book":
            continue
        rows = db.query(spec.model).all()
        logger.debug(f"Cleanup: checking {len(rows)} {spec.singular}(s)")
        for row in rows:
            logger.debug(
                f"Cleanup: checking {spec.singular} '{row.filename}' ({row.filepath})"
            )
            if not _path_exists(row.filepath):
                logger.info(
                    f"Cleanup: removing missing {spec.singular} "
                    f"'{row.filename}' ({row.filepath})"
                )
                purge_references(db, spec.model, row.id)
                db.delete(row)
                db.commit()
                logger.debug(f"Cleanup: committed removal of {spec.singular} id={row.id}")
                removed[spec.section] += 1
            else:
                logger.debug(
                    f"Cleanup: {spec.singular} '{row.filename}' present - skipping"
                )

    # Path-keyed and polymorphic rows last: both are resolved against what the
    # sweeps above have just finished removing, so running them earlier would
    # judge staleness against a library state that is about to change.
    removed["folders"] = _prune_stale_folders(db) + _prune_orphaned_book_folders(db)
    removed["tag_links"] = _prune_orphaned_tag_links(db)

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
