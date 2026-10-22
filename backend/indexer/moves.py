"""Recognising a file that moved, rather than one deleted and another added.

Split out of ``reconcile.py``. Runs inside its missing-file sweep, once the walk
knows every path that exists on disk: a row whose file is gone and a row the
walk inserted with the same bytes are the two halves of one move (issue #284).

Which present rows may be a move's *destination* is the safety rule. A row that
was already reconciled is a file sitting where it has always sat, so it never
qualifies, however well its bytes match something deleted elsewhere. Two kinds
of row do:

* rows this scan inserted (``ctx.inserted_ids``), and
* rows inserted since the last complete reconcile - by a scan that was stopped,
  or whose process died, before it got this far. Without these, a folder
  renamed while a scan was cut short came back as every file twice: the old
  rows missing, the new ones fresh and stripped of their tags and progress
  (issue #670).
"""
import datetime
import logging
import os
from typing import Any, Optional

from sqlalchemy.orm import Session

from ._context import _ScanContext, _title_from_filename
from ._subprocess import _run_with_timeout
from .constants import _DB_TIMEOUT
from ..models import AppSetting, Book, GenericMap, Model3D, Token

logger = logging.getLogger("grimoire.indexer")

# When the last complete, unscoped missing-file sweep began (naive UTC, ISO).
# Rows created after it have never been through move detection.
RECONCILED_AT_KEY = "library.reconciled_at"


# Which thumbnail subdirectory each model's covers live in. Audio is absent on
# purpose: it carries ``has_artwork``/``cover_image`` sourced from embedded tags
# or folder artwork, not a path-keyed file this module could orphan.
_THUMB_SECTIONS: dict[Any, str] = {
    GenericMap: "maps",
    Token: "tokens",
    Model3D: "models",
}


def _naive_utc(value: datetime.datetime) -> datetime.datetime:
    """``value`` as naive UTC, which is how SQLite hands ``DateTime`` columns back."""
    if value.tzinfo is not None:
        value = value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return value


def reconciled_at(session: Session) -> Optional[datetime.datetime]:
    """When the last complete sweep began, or None if none has been recorded.

    None keeps move detection to this scan's own inserts, which is what it did
    before the marker existed - so the first scan after upgrading changes nothing.
    """
    row = session.query(AppSetting).filter_by(key=RECONCILED_AT_KEY).first()
    if row is None or not row.value:
        return None
    try:
        return _naive_utc(datetime.datetime.fromisoformat(row.value))
    except ValueError:
        return None


def mark_reconciled(session: Session, started: datetime.datetime) -> None:
    """Record that every row created before ``started`` has been reconciled."""
    value = _naive_utc(started).isoformat()
    row = session.query(AppSetting).filter_by(key=RECONCILED_AT_KEY).first()
    if row is None:
        session.add(AppSetting(key=RECONCILED_AT_KEY, value=value))
    else:
        row.value = value
    session.commit()


def _is_destination(ctx: _ScanContext, record: Any) -> bool:
    """Whether ``record`` may be the new half of a move (see the module docstring)."""
    if record.id in ctx.inserted_ids:
        return True
    created = getattr(record, "created_at", None)
    if ctx.reconciled_at is None or created is None:
        return False
    return _naive_utc(created) > ctx.reconciled_at


def _pair_moves(old_rows: list, new_rows: list) -> list[tuple[Any, Any]]:
    """Pair gone rows with destination rows that share one content key.

    One of each is a move. More than one on either side is ambiguous by content
    alone - TTRPG libraries routinely hold the same PDF twice, and pairing them
    off by guesswork would attach one book's tags and reading progress to
    another. A renamed or moved folder keeps every file's name, though, so rows
    whose filename is unique on both sides of the group are still paired; the
    rest are left alone (issue #670).
    """
    if len(old_rows) == 1 and len(new_rows) == 1:
        return [(old_rows[0], new_rows[0])]

    def by_name(rows: list) -> dict[str, list]:
        grouped: dict[str, list] = {}
        for row in rows:
            grouped.setdefault(row.filename, []).append(row)
        return grouped

    old_named, new_named = by_name(old_rows), by_name(new_rows)
    return [
        (olds[0], new_named[name][0])
        for name, olds in old_named.items()
        if len(olds) == 1 and len(new_named.get(name, [])) == 1
    ]


def _remove_stale_thumbnail(ctx: _ScanContext, model: Any, old: Any) -> None:
    """Delete the thumbnail a moved map/token left behind at its old path.

    Thumbnail filenames embed a hash of the *filepath*, so a move leaves the old
    file unreferenced: the walk has already written a fresh one under the new
    path's name, and nothing will ever serve or clean up the old one.

    Named from ``_title_from_filename(old.filename)`` rather than a stored title,
    because that is what :func:`_scan_media` used when it wrote the file — maps
    and tokens have no ``title`` column.

    Best-effort: a thumbnail that cannot be removed is wasted disk, never a
    reason to fail the scan.
    """
    section = _THUMB_SECTIONS.get(model)
    if section is None or not getattr(old, "has_thumbnail", False):
        return
    stale = ctx.thumb_path(section, _title_from_filename(old.filename), old.filepath)
    try:
        os.remove(stale)
    except FileNotFoundError:
        pass
    except OSError as e:
        logger.debug("Could not remove stale thumbnail %s: %s", stale, e)


def _rename_thumbnail_to_title(
    ctx: _ScanContext, rendered_title: str, kept_title: str, filepath: str
) -> None:
    """Rename a move's fresh cover from the rendered title to the kept one.

    Thumbnails are stored as ``<slugified title>_<hash of filepath>.webp``. After
    a move the surviving row keeps its own title — which may have been edited in
    the UI — while the file on disk was named from the title the walk derived
    from the filename. The serving endpoint falls back to a glob on the hash, so
    this is a tidiness fix rather than a correctness one; doing it keeps the fast
    exact-name path working instead of pushing every moved book onto the glob.

    Best-effort by design: a failure here leaves a servable thumbnail in place,
    so it must never interrupt the scan.
    """
    src = ctx.thumb_path("books", rendered_title, filepath)
    dest = ctx.thumb_path("books", kept_title, filepath)
    if src == dest:
        return
    try:
        if os.path.isfile(src):
            os.replace(src, dest)
    except OSError as e:
        logger.debug("Could not rename thumbnail %s -> %s: %s", src, dest, e)


def _detect_moves(ctx: _ScanContext, model: Any, gone: list, present: list) -> int:
    """Re-point rows whose file moved instead of leaving them missing (issue #284).

    Without this a move reads as a delete plus an insert: the old row is flagged
    ``is_missing`` and a brand-new row appears at the new path, silently dropping
    the tags, favorites, bookmarks, and read progress attached to the old row's id.
    Matching on content hash recovers the connection — same bytes, new location.

    The surviving row also inherits the destination row's thumbnail state, since
    the walk has already rendered a cover at the new path (issue #394).

    ``gone`` are rows whose file no longer exists; ``present`` are rows whose file
    does. Rows are grouped by ``(content_hash, file_size)``, only destination rows
    qualify (see :func:`_is_destination`), and :func:`_pair_moves` decides which
    pairs within a group are unambiguous.
    """
    session = ctx.session
    by_hash: dict[tuple, list] = {}
    for record in gone:
        if record.content_hash:
            by_hash.setdefault((record.content_hash, record.file_size), []).append(record)
    if not by_hash:
        return 0

    candidates: dict[tuple, list] = {}
    for record in present:
        if not _is_destination(ctx, record):
            continue
        key = (record.content_hash, record.file_size)
        if key in by_hash:
            candidates.setdefault(key, []).append(record)

    moved = 0
    for key, old_rows in by_hash.items():
        new_rows = candidates.get(key, [])
        if not new_rows:
            continue
        pairs = _pair_moves(old_rows, new_rows)
        if len(pairs) < min(len(old_rows), len(new_rows)):
            logger.info(
                "Ambiguous move for hash %s (%d gone, %d found, %d paired by name) - "
                "leaving the rest as-is",
                key[0][:12],
                len(old_rows),
                len(new_rows),
                len(pairs),
            )
        for old, new in pairs:
            _apply_move(ctx, model, old, new)
            moved += 1

    if moved:
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, "commit detected moves")
        except (TimeoutError, Exception) as e:
            logger.error(f"DB error saving detected moves: {e}")
            session.rollback()
            return 0
    return moved


def _apply_move(ctx: _ScanContext, model: Any, old: Any, new: Any) -> None:
    """Carry ``new``'s location onto ``old`` and drop ``new``. Not committed."""
    session = ctx.session
    # The old row's caches are keyed by its former path; the file's bytes now
    # live somewhere else, so those entries are unreachable garbage. Its search
    # rows are not: they are keyed by the id the old row keeps, and a move is
    # only matched on identical bytes, so the text is still right. Passing no
    # ``db`` keeps them - dropping them while the row stayed ``indexed`` left
    # the book unsearchable for good (issue #503).
    if model is Book:
        from ..services.content_cache import invalidate_book_content

        thumb = ctx.thumb_path("books", old.title, old.filepath) if old.has_thumbnail else None
        invalidate_book_content(old.id, old.filepath, thumb_path=thumb)
    else:
        # Maps and tokens have no page renders or search rows to drop, but
        # their thumbnail is path-keyed just like a book's, so the file at the
        # old path is dead weight the moment the row moves. Only books went
        # through the invalidation above, which left one orphaned WebP per
        # moved map or token accumulating forever (issue #394).
        _remove_stale_thumbnail(ctx, model, old)

    logger.info(f"Detected move: '{old.filepath}' -> '{new.filepath}'")
    # Carry the new location onto the *old* row so its id — and everything
    # referencing it — survives. ``filepath`` is UNIQUE, so the duplicate the
    # walk inserted has to be deleted and flushed *before* the old row can
    # take its path, or the UPDATE trips the constraint.
    new_filepath, new_filename = new.filepath, new.filename
    new_relative, new_system = new.relative_path, getattr(new, "game_system_id", None)
    new_category = getattr(new, "category", None)
    # The walk already rendered a cover for the file at its new path, onto
    # the row about to be discarded. Thumbnail filenames are path-derived, so
    # that render is the *live* one and the old row's was the stale file just
    # deleted above; inheriting the flag hands the survivor the cover that
    # actually exists. Leaving it False stranded a perfectly good WebP on
    # disk that nothing would ever serve or clean up, and the book showed a
    # blank cover until a full "Rescan and Re-index" (issue #394).
    new_has_thumbnail = getattr(new, "has_thumbnail", False)
    new_title = getattr(new, "title", None)
    session.delete(new)
    session.flush()

    old.filepath = new_filepath
    old.filename = new_filename
    old.relative_path = new_relative
    old.is_missing = False
    if model is Book:
        # Remember where the book came from and went: a system that every book
        # left this way was renamed or emptied, not just unvisited (issue #670).
        if old.game_system_id and new_system and old.game_system_id != new_system:
            ctx.vacated_systems.setdefault(old.game_system_id, set()).add(new_system)
        old.game_system_id = new_system
        old.category = new_category
        old.has_thumbnail = bool(new_has_thumbnail)
        # The cover was written as ``slugify(<new row's title>)_<hash>.webp``.
        # A survivor whose title was customised in the UI keeps that title, so
        # rename the file to match rather than relying on the serving glob.
        if new_has_thumbnail and new_title and new_title != old.title:
            _rename_thumbnail_to_title(ctx, new_title, old.title, new_filepath)
