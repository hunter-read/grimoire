"""The post-walk sweep: missing files, moves, vanished systems, sidecars.

Everything here runs after the collection phases, when the scan knows the full
set of paths that exist on disk. That ordering is what makes move detection
possible: a row whose file is gone and a row inserted with matching content are
the two halves of one move, and only a completed walk can pair them (issue
#284). Move detection lives in ``moves`` and system pruning in
``system_prune``; both are re-exported here.

``_prune_vanished_systems`` is deliberately gated by its caller on a full books
walk, since ``seen_system_ids`` is only populated by that walk.
"""
import datetime
import logging
import os
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ._context import _ScanContext
from ._db import _db_call
from .moves import (  # noqa: F401  (re-exported for patch compatibility)
    _detect_moves,
    _is_destination,
    _remove_stale_thumbnail,
    _rename_thumbnail_to_title,
    mark_reconciled,
)
from .system_prune import _prune_vanished_systems  # noqa: F401  (re-exported)
from ..metadata import export as sidecar_export
from ..metadata import settings as sidecar_settings
from ..models import Audio, Book, GenericMap, Model3D, Token
from ..sql_paths import path_under

logger = logging.getLogger("grimoire.indexer")

# Records checked between progress reports in ``_reconcile_missing``.
_PROGRESS_EVERY = 250
# Rows held in memory at once while the sweep reads a collection.
_READ_BATCH = 1000
# Ids per ``IN (...)`` when flags are written. SQLite builds before 3.32 cap
# a statement at 999 bound variables.
_WRITE_BATCH = 500


def _reconcile_missing(
    ctx: _ScanContext,
    scan_books: bool,
    scan_maps: bool,
    scan_tokens: bool,
    scan_audio: bool,
    scan_models: bool = True,
) -> None:
    """Mark / unmark ``is_missing`` for every record after the walk.

    Any DB record whose file is gone (or newly ``.grimoireignore``-excluded) gets
    ``is_missing=True``; records that exist on disk have it cleared.  When scoped,
    only records under the scope subtree are reconciled.

    Rows whose file merely *moved* are re-pointed first (see ``_detect_moves``) so
    they are never reported missing and keep their tags/favorites/progress.

    A row whose path the walk just visited is present, with no stat: the walk
    found the file and applied the same ignore rules to it (``ctx.seen_paths``).
    Only the rest - files that are gone, and rows the walk could not have seen -
    are looked up on disk. Rows are read as a few columns, a batch at a time,
    rather than as whole objects all at once, so a 50,000-file library does not
    hold 50,000 rows in memory to check them.
    """
    session = ctx.session
    ignore = ctx.ignore
    scope_dir = ctx.scope_dir
    # Taken before any row is read, so a row inserted while the sweep runs (an
    # upload) is still treated as unreconciled by the next one.
    started = datetime.datetime.now(datetime.timezone.utc)

    def _scoped(query: Any, model: Any) -> Any:
        if scope_dir is not None:
            return query.filter(path_under(model.filepath, f"{scope_dir}{os.sep}"))
        return query

    counts = {"books": 0, "maps": 0, "tokens": 0, "audio": 0, "models": 0}
    moved = {"books": 0, "maps": 0, "tokens": 0, "audio": 0, "models": 0}
    collections = (
        ("books", Book, scan_books, "book"),
        ("maps", GenericMap, scan_maps, "map"),
        ("tokens", Token, scan_tokens, "token"),
        ("audio", Audio, scan_audio, "audio"),
        ("models", Model3D, scan_models, "model"),
    )
    # On a slow mount this is minutes of work after the walk has already
    # reported 100%, so it reports its own progress rather than looking like a
    # hang (issue #748).
    total = sum(
        _scoped(session.query(func.count(model.id)), model).scalar() or 0
        for _key, model, enabled, _label in collections
        if enabled
    )
    checked = 0

    def _tick() -> None:
        nonlocal checked
        checked += 1
        if checked % _PROGRESS_EVERY == 0:
            ctx.emit_phase("reconciling", checked, total)

    ctx.emit_phase("reconciling", 0, total)
    # Which ids to flag and which to clear, written once every collection has
    # been read. Ids only, so the lists stay small however large the library.
    flags: list[tuple[Any, list[str], bool]] = []
    for key, model, enabled, label in collections:
        if not enabled:
            continue
        seen = ctx.seen_paths.get(key, set())

        def _gone(filepath: str, seen: set[str] = seen) -> bool:
            if filepath in seen:
                return False
            return not os.path.exists(filepath) or ignore.is_ignored(filepath, is_dir=False)

        columns = [
            model.id,
            model.filepath,
            model.filename,
            model.is_missing,
            model.content_hash,
            model.file_size,
            model.created_at,
        ]
        if hasattr(model, "title"):
            columns.append(model.title)
        gone_rows: list[Any] = []
        destinations: list[Any] = []
        newly_gone: list[Any] = []
        back: list[str] = []
        for row in _scoped(session.query(*columns), model).yield_per(_READ_BATCH):
            _tick()
            if _gone(row.filepath):
                if row.content_hash:
                    gone_rows.append(row)
                if not row.is_missing:
                    newly_gone.append(row)
            else:
                # Only a destination can be the new half of a move, and on a
                # settled library there are none - so the present rows kept
                # here are the few this scan (or an interrupted one) added.
                if _is_destination(ctx, row):
                    destinations.append(row)
                if row.is_missing:
                    back.append(row.id)

        # Moves are settled first, and committed, so a moved file is never
        # reported missing on the way to being recognised. The ids they touch
        # - survivors re-pointed, duplicates deleted - are already right.
        touched: set[str] = set()
        moved[key] = _detect_moves(ctx, model, gone_rows, destinations, touched=touched)

        missing_ids = []
        for row in newly_gone:
            if row.id in touched:
                continue
            missing_ids.append(row.id)
            name = getattr(row, "title", None) or row.filename
            logger.warning(f"Missing {label}: '{name}' ({row.filepath})")
        counts[key] = len(missing_ids)
        flags.append((model, missing_ids, True))
        flags.append((model, [i for i in back if i not in touched], False))

    ctx.emit_phase("reconciling", total, total)
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
        for model, ids, value in flags:
            _set_missing(session, model, ids, value)
        _db_call(session.commit, "commit missing flags")
        # Only a sweep of every collection reconciles every row; a scoped one
        # leaves rows elsewhere still waiting for move detection.
        if scope_dir is None and all(enabled for _k, _m, enabled, _l in collections):
            mark_reconciled(session, started)
    except SQLAlchemyError as e:
        logger.error(f"DB error saving missing flags: {e}")
        session.rollback()

    ctx.stats["missing_books"] = missing_books
    ctx.stats["missing_maps"] = missing_maps
    ctx.stats["missing_tokens"] = missing_tokens
    ctx.stats["missing_audio"] = missing_audio
    ctx.stats["moved_books"] = moved["books"]
    ctx.stats["moved_maps"] = moved["maps"]
    ctx.stats["moved_tokens"] = moved["tokens"]
    ctx.stats["moved_audio"] = moved["audio"]


def _set_missing(session: Session, model: Any, ids: list[str], value: bool) -> None:
    """Set ``is_missing`` on the rows with these ids, a batch of ids per statement.

    Written straight to the table: the rows were read as columns, so there are
    no loaded objects to update, and dirtying one object per row is the cost
    this avoids.
    """
    for i in range(0, len(ids), _WRITE_BATCH):
        chunk = ids[i : i + _WRITE_BATCH]
        _db_call(
            lambda: session.query(model)
            .filter(model.id.in_(chunk))
            .update({model.is_missing: value}, synchronize_session=False),
            "update missing flags",
        )


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
