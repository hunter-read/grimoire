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

from sqlalchemy.exc import SQLAlchemyError

from ._context import _ScanContext
from ._db import _db_call
from .moves import (  # noqa: F401  (re-exported for patch compatibility)
    _detect_moves,
    _remove_stale_thumbnail,
    _rename_thumbnail_to_title,
    mark_reconciled,
)
from .system_prune import _prune_vanished_systems  # noqa: F401  (re-exported)
from ..metadata import export as sidecar_export
from ..metadata import settings as sidecar_settings
from ..models import Audio, Book, GenericMap, Model3D, Token

logger = logging.getLogger("grimoire.indexer")


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
    """
    session = ctx.session
    ignore = ctx.ignore
    scope_dir = ctx.scope_dir
    # Taken before any row is read, so a row inserted while the sweep runs (an
    # upload) is still treated as unreconciled by the next one.
    started = datetime.datetime.now(datetime.timezone.utc)

    def _scoped(query: Any, model: Any) -> Any:
        if scope_dir is not None:
            return query.filter(model.filepath.like(f"{scope_dir}{os.sep}%"))
        return query

    def _gone(filepath: str) -> bool:
        return not os.path.exists(filepath) or ignore.is_ignored(filepath, is_dir=False)

    counts = {"books": 0, "maps": 0, "tokens": 0, "audio": 0, "models": 0}
    moved = {"books": 0, "maps": 0, "tokens": 0, "audio": 0, "models": 0}
    collections = (
        ("books", Book, scan_books, "book"),
        ("maps", GenericMap, scan_maps, "map"),
        ("tokens", Token, scan_tokens, "token"),
        ("audio", Audio, scan_audio, "audio"),
        ("models", Model3D, scan_models, "model"),
    )
    # Pass 1 — re-point moved files. This runs to completion first, and commits as
    # it goes, so the missing-flag pass below sees a settled set of rows: a moved
    # file must never be reported missing on the way to being recognised.
    for key, model, enabled, _label in collections:
        if not enabled:
            continue
        gone_rows: list[Any] = []
        present_rows: list[Any] = []
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
