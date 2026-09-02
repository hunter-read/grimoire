"""The post-walk sweep: missing files, moves, vanished systems, sidecars.

Everything here runs after the collection phases, when the scan knows the full
set of paths that exist on disk. That ordering is what makes move detection
possible: a row whose file is gone and a row inserted by this same scan with
matching content are the two halves of one move, and only a completed walk can
pair them (issue #284). ``ctx.inserted_ids`` is the guard — a *pre-existing*
row is a file that did not move, however well its bytes match.

``_prune_vanished_systems`` is deliberately gated by its caller on a full books
walk, since ``seen_system_ids`` is only populated by that walk.
"""
import logging
import os
from typing import Any

from ._context import _ScanContext, _title_from_filename
from ._subprocess import _run_with_timeout
from .constants import _DB_TIMEOUT
from ..metadata import export as sidecar_export
from ..metadata import settings as sidecar_settings
from ..models import Audio, Book, GameSystem, GenericMap, Token

logger = logging.getLogger("grimoire.indexer")


# Which thumbnail subdirectory each model's covers live in. Audio is absent on
# purpose: it carries ``has_artwork``/``cover_image`` sourced from embedded tags
# or folder artwork, not a path-keyed file this module could orphan.
_THUMB_SECTIONS: dict[Any, str] = {GenericMap: "maps", Token: "tokens"}


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
    does. A move is accepted only when exactly one gone row and exactly one
    *newly inserted* row share a ``(content_hash, file_size)`` key. Anything
    ambiguous is left alone: TTRPG libraries routinely hold the same PDF under two
    systems, and pairing duplicates off by guesswork would attach one book's tags
    and reading progress to another.
    """
    session = ctx.session
    by_hash: dict[tuple, list] = {}
    for record in gone:
        if record.content_hash:
            by_hash.setdefault((record.content_hash, record.file_size), []).append(record)
    if not by_hash:
        return 0

    # Only rows this scan just inserted can be a move destination. A row that
    # already existed is a file sitting where it has always sat: if it happens to
    # share its bytes with something deleted elsewhere (identical duplicates are
    # common), claiming it as the move target would rewrite and then delete a book
    # that never moved.
    candidates: dict[tuple, list] = {}
    for record in present:
        if record.id not in ctx.inserted_ids:
            continue
        key = (record.content_hash, record.file_size)
        if key in by_hash:
            candidates.setdefault(key, []).append(record)

    moved = 0
    for key, old_rows in by_hash.items():
        new_rows = candidates.get(key, [])
        if len(old_rows) != 1 or len(new_rows) != 1:
            if new_rows:
                logger.info(
                    "Ambiguous move for hash %s (%d gone, %d found) - leaving as-is",
                    key[0][:12],
                    len(old_rows),
                    len(new_rows),
                )
            continue
        old, new = old_rows[0], new_rows[0]

        # The old row's caches are keyed by its former path; the file's bytes now
        # live somewhere else, so those entries are unreachable garbage.
        if model is Book:
            from ..services.content_cache import invalidate_book_content

            thumb = ctx.thumb_path("books", old.title, old.filepath) if old.has_thumbnail else None
            invalidate_book_content(old.id, old.filepath, db=session, thumb_path=thumb)
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
            old.game_system_id = new_system
            old.category = new_category
            old.has_thumbnail = bool(new_has_thumbnail)
            # The cover was written as ``slugify(<new row's title>)_<hash>.webp``.
            # A survivor whose title was customised in the UI keeps that title, so
            # rename the file to match rather than relying on the serving glob.
            if new_has_thumbnail and new_title and new_title != old.title:
                _rename_thumbnail_to_title(ctx, new_title, old.title, new_filepath)
        moved += 1

    if moved:
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, "commit detected moves")
        except (TimeoutError, Exception) as e:
            logger.error(f"DB error saving detected moves: {e}")
            session.rollback()
            return 0
    return moved


def _prune_vanished_systems(ctx: _ScanContext) -> int:
    """Delete system rows whose folder is gone or newly ``.grimoireignore``-excluded.

    Files get an ``is_missing`` sweep (see :func:`_reconcile_missing`), but system
    rows had no equivalent, so a folder that stopped being scanned left its
    ``GameSystem`` behind forever — visible in the library with no way to remove
    it. The reported case is a Synology ``@eaDir`` folder registered before its
    ``.grimoireignore`` rule was added: the rule correctly hides the *books*, but
    the system row it had already created survived every rescan (issue #354).

    Deliberately conservative — a row is only dropped when **all** of:

    * this scan never walked to it (so no folder maps to it any more),
    * it owns no content of any kind, including through child systems, and
    * a user has not adapted it (renamed it, or given it a description, cover,
      or other metadata), since that signals a row worth keeping even when the
      shelf is momentarily empty.

    Scoped rescans prune nothing: they only walk one subtree, so every system
    outside it would look unseen.

    Only systems belonging to **this** library are considered. A database can
    outlive the library path pointed at it (someone re-points ``LIBRARY_PATH``,
    or several libraries share one database, as the test suite does), and
    "unseen by this scan" would otherwise mean "delete everything the other
    library owns".  A row is in scope only when its books sit under this
    library root, or it was created by this very scan.
    """
    if ctx.scope_dir is not None:
        return 0

    session = ctx.session
    try:
        systems = _run_with_timeout(
            lambda: session.query(GameSystem).all(), _DB_TIMEOUT, "query systems for pruning"
        )
    except TimeoutError as e:
        logger.error(f"DB hang: {e} - skipping system pruning")
        return 0

    unseen = [s for s in systems if s.id not in ctx.seen_system_ids]
    if not unseen:
        return 0

    # Which systems does this library account for? Anchored on absolute book
    # paths, since that is the only link from a system row back to a directory.
    root = os.path.join(os.path.abspath(ctx.library_path), "")
    in_this_library: set = set()
    for system_id, filepath in session.query(Book.game_system_id, Book.filepath).filter(
        Book.game_system_id.isnot(None)
    ):
        if filepath and os.path.abspath(filepath).startswith(root):
            in_this_library.add(system_id)

    # Books are the only collection tied to a system — maps, tokens, and audio
    # are deliberately system-agnostic — so one distinct query covers ownership.
    #
    # Only books still *present* count. A row flagged ``is_missing`` is exactly
    # what the vanished/ignored folder leaves behind, so counting those would
    # make every such system permanently unprunable — the bug being fixed.
    owning = {
        row[0]
        for row in session.query(Book.game_system_id)
        .filter(Book.game_system_id.isnot(None), Book.is_missing.isnot(True))
        .distinct()
        .all()
    }
    # A container whose children survive must survive too, or the children are
    # orphaned. Parentage is one level in practice but resolved transitively.
    keep_parents: set = set()
    by_id = {s.id: s for s in systems}
    for system in systems:
        if system.id in owning or system.id in ctx.seen_system_ids:
            node = system
            while node.parent_id:
                keep_parents.add(node.parent_id)
                node = by_id.get(node.parent_id)
                if node is None:
                    break

    removed = 0
    for system in unseen:
        # Not this library's row to delete — see the docstring.
        if system.id not in in_this_library:
            continue
        if system.id in owning or system.id in keep_parents:
            continue
        if system.name_is_custom or system.description or system.cover_image:
            logger.info(
                f"System '{system.name}' has no folder any more but carries user "
                "metadata - leaving it in place"
            )
            continue
        logger.info(f"Removing system '{system.name}': its folder is gone or now ignored")
        session.delete(system)
        removed += 1

    if removed:
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, "commit system pruning")
        except (TimeoutError, Exception) as e:
            logger.error(f"DB error pruning systems: {e}")
            session.rollback()
            return 0
    return removed


def _reconcile_missing(
    ctx: _ScanContext,
    scan_books: bool,
    scan_maps: bool,
    scan_tokens: bool,
    scan_audio: bool,
) -> None:
    """Mark / unmark ``is_missing`` for every record after the walk.

    Any DB record whose file is gone (or newly ``.grimoireignore``-excluded) gets
    ``is_missing=True``; records that exist on disk have it cleared.  When scoped,
    only records under the scope subtree are reconciled.

    Rows whose file merely *moved* are re-pointed first (see ``_detect_moves``) so
    they are never reported missing and keep their tags/favorites/progress.
    """
    session = ctx.session
    ignore = ctx.ignore
    scope_dir = ctx.scope_dir

    def _scoped(query: Any, model: Any) -> Any:
        if scope_dir is not None:
            return query.filter(model.filepath.like(f"{scope_dir}{os.sep}%"))
        return query

    def _gone(filepath: str) -> bool:
        return not os.path.exists(filepath) or ignore.is_ignored(filepath, is_dir=False)

    counts = {"books": 0, "maps": 0, "tokens": 0, "audio": 0}
    moved = {"books": 0, "maps": 0, "tokens": 0, "audio": 0}
    collections = (
        ("books", Book, scan_books, "book"),
        ("maps", GenericMap, scan_maps, "map"),
        ("tokens", Token, scan_tokens, "token"),
        ("audio", Audio, scan_audio, "audio"),
    )
    # Pass 1 — re-point moved files. This runs to completion first, and commits as
    # it goes, so the missing-flag pass below sees a settled set of rows: a moved
    # file must never be reported missing on the way to being recognised.
    for key, model, enabled, _label in collections:
        if not enabled:
            continue
        gone_rows, present_rows = [], []
        for record in _scoped(session.query(model), model).all():
            (gone_rows if _gone(record.filepath) else present_rows).append(record)
        moved[key] = _detect_moves(ctx, model, gone_rows, present_rows)

    # Pass 2 — flag whatever is still unaccounted for. Rows are re-read because
    # pass 1 may have re-pointed and deleted some.
    for key, model, enabled, label in collections:
        if not enabled:
            continue
        for record in _scoped(session.query(model), model).all():
            gone = _gone(record.filepath)
            if gone != bool(record.is_missing):
                record.is_missing = gone
                if gone:
                    counts[key] += 1
                    name = getattr(record, "title", None) or record.filename
                    logger.warning(f"Missing {label}: '{name}' ({record.filepath})")

    missing_books = counts["books"]
    missing_maps = counts["maps"]
    missing_tokens = counts["tokens"]
    missing_audio = counts["audio"]
    total_moved = sum(moved.values())
    if total_moved:
        logger.info(
            f"Recognised {total_moved} moved file(s) - kept their tags, favorites, "
            f"and reading progress instead of re-adding them."
        )
    if missing_books or missing_maps or missing_tokens or missing_audio:
        logger.warning(
            f"Some files are no longer on disk: {missing_books} book(s), {missing_maps} map(s), "
            f"{missing_tokens} token(s), {missing_audio} audio file(s)."
        )
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, "commit missing flags")
    except (TimeoutError, Exception) as e:
        logger.error(f"DB hang saving missing flags: {e}")
        session.rollback()

    ctx.stats["missing_books"] = missing_books
    ctx.stats["missing_maps"] = missing_maps
    ctx.stats["missing_tokens"] = missing_tokens
    ctx.stats["missing_audio"] = missing_audio
    ctx.stats["moved_books"] = moved["books"]
    ctx.stats["moved_maps"] = moved["maps"]
    ctx.stats["moved_tokens"] = moved["tokens"]
    ctx.stats["moved_audio"] = moved["audio"]


def _export_sidecars_for_new_books(ctx: "_ScanContext") -> None:
    """Create sidecars for the books this scan inserted, if export is on.

    Keeps an export-enabled library complete as files arrive, rather than only
    when an admin remembers to run the backfill. Only ``ctx.inserted_ids`` are
    considered — an already-indexed book is either untouched or handled by the
    edit-triggered refresh, and rewriting the whole library on every scan would
    be both slow and destructive to sidecars a user has edited.

    Never creates a file that already exists, and never raises: sidecar export is
    secondary to the scan that triggered it.
    """
    if not ctx.inserted_ids:
        return
    try:
        if not sidecar_settings.export_enabled(ctx.session):
            return

        books = (
            ctx.session.query(Book).filter(Book.id.in_(list(ctx.inserted_ids))).all()
        )
        written = 0
        for book in books:
            sidecar_export.export_new_book(ctx.session, book)
            written += 1
        if written:
            logger.info("Wrote metadata sidecars for %d new book(s).", written)
    except Exception:  # noqa: BLE001 - a sidecar must never fail the scan
        logger.exception("Could not write sidecars for newly scanned books")
