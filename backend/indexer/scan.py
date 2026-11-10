"""Library filesystem scan.

``scan_library`` walks the library tree and registers books, maps, tokens, and
audio in the database, then applies ``tags.json`` folder tags and reconciles the
missing-file flags. This module is now just the orchestrator: it resolves the
scope, counts the work, builds the shared ``_ScanContext``, and runs the phases
in order. The phases themselves live in focused siblings:

* ``_context`` — ``_ScanContext``, the walk filters, and the file counter
* ``systems``  — resolving ``books/`` folders into ``GameSystem`` rows
* ``books``    — the books walk, containers, and ``Book`` registration
* ``media``    — maps, tokens, and audio
* ``reconcile``— missing-file sweep, move detection, system pruning, sidecars

Phase order is load-bearing and documented at each call below.

Import-compatibility: the phase helpers are re-imported into this module's
namespace, so ``patch("backend.indexer.scan.<name>")`` and attribute access on
``backend.indexer.scan`` keep working exactly as before the split.
"""
import logging
from pathlib import Path
from typing import AbstractSet, Any, Callable, Optional

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..library_ignore import IgnoreMatcher
from ..models import Audio, Book, GenericMap, Model3D, Token
from ..models.game_types import ARMORY_SECTION, GAME_TYPE_WARGAME
from ._context import (  # noqa: F401  (re-exported: patched as backend.indexer.scan.<name>)
    _ScanContext,
    _count_eligible_files,
    _count_registered,
    _keep_entry,
    _prune_dirs,
    _title_from_filename,
)
from .books import (  # noqa: F401  (re-exported for patch compatibility)
    _child_display_name,
    _derive_category,
    _do_book_page_count,
    _do_book_thumbnail,
    _handle_replaced_book,
    _refresh_signature,
    _register_book,
    _scan_books,
    _scan_books_in_system,
    _scan_container,
    _scan_one_page_loose_files,
)
from .categories import (  # noqa: F401  (re-exported for patch compatibility)
    agnostic_category,
    detect_container_kind,
    folder_category_inference_disabled,
    guess_category,
    has_nsfw_marker,
    is_one_page_folder,
    is_special_collection_folder,
    is_system_agnostic_folder,
    prettify_collection_name,
    slugify,
    strip_container_suffix,
    strip_sort_prefix,
)
from .models3d import MODEL_EXTS
from .constants import (
    ARCHIVE_EXTS,
    AUDIO_EXTS,
    DOC_EXTS,
    IMAGE_EXTS,
    MAP_IMAGE_EXTS,
    MEDIA_ARCHIVE_EXTS,
)
from .added_dates import first_import_done, mark_first_import_done
from .factions import prune_empty_factions
from ._db import _db_call
from .hashing import (  # noqa: F401  (re-exported: patched as backend.indexer.scan.hash_file)
    apply_signature,
    changed_content,
    file_signature,
    hash_file,
    signature_matches,
)
from .media import _enrich_model, _scan_audio, _scan_media  # noqa: F401
from .metadata import resolve_armory_dir, resolve_collection_dir, resolve_scope
from .moves import reconciled_at
from .reconcile import (  # noqa: F401  (re-exported for patch compatibility)
    _detect_moves,
    _export_sidecars_for_new_books,
    _prune_vanished_systems,
    _reconcile_missing,
)
from .systems import (  # noqa: F401  (re-exported for patch compatibility)
    _SystemFolder,
    _adopt_existing_system,
    _register_system,
    _resolve_system_folder,
    _unique_system_name,
)
from .tags import _apply_tags_from_library

logger = logging.getLogger("grimoire.indexer")


def scan_library(
    library_path: str,
    data_path: str,
    session: Session,
    on_progress: Optional[Callable[..., None]] = None,
    should_stop: Optional[Callable[[], bool]] = None,
    scope_path: str | None = None,
    metadata_mode: str = "new",
    on_phase: Optional[Callable[[str, int, int], None]] = None,
) -> dict:
    """Scan the library directory and register all files in the database.

    on_progress(scanned_books, total_books, scanned_maps, total_maps, scanned_tokens,
    total_tokens, scanned_audio, total_audio, scanned_models, total_models) is called
    after each file is processed if provided.

    should_stop() is an optional callable that returns True when the scan should abort early.

    on_phase(phase, done, total) reports the steps after the walk, which can take
    a long time on a large library: "reconciling" (records checked for a missing
    file) and "pruning" (systems whose folder is gone).

    scope_path, when given, restricts the scan to a single subtree (relative to the
    library root, e.g. "books/D&D 5e/adventure").  Only the matching collection is
    walked and the missing-file sweep is limited to that subtree.

    metadata_mode controls how sidecar metadata is applied to already-indexed books:
    "new" (default) leaves existing records alone, "missing" fills empty fields from
    OPF sidecars, "replace" overwrites fields wherever the sidecar provides a value.
    """
    library = Path(library_path)
    books_dir = resolve_collection_dir(library, "books")
    # Wargame books: the same <System>/<Category>/<Book> layout as books/, read
    # with the wargame vocabulary and its factions (models/game_types.py).
    armory_dir = resolve_armory_dir(library)
    maps_dir = resolve_collection_dir(library, "maps")
    tokens_dir = resolve_collection_dir(library, "tokens")
    audio_dir = resolve_collection_dir(library, "audio")
    models_dir = resolve_collection_dir(library, "models")
    thumb_dir = Path(data_path) / "thumbnails"
    stats = {
        "new_systems": 0,
        # Systems dropped because their folder vanished or became ignored.
        "removed_systems": 0,
        "new_books": 0,
        "new_maps": 0,
        "new_tokens": 0,
        "new_audio": 0,
        "new_models": 0,
        "updated_books": 0,
        # Media rows given a thumbnail after the fact — a format that became
        # thumbnailable after the row was first registered (Universal VTT maps).
        "updated_maps": 0,
        "updated_tokens": 0,
        "updated_models": 0,
        "indexed_pages": 0,
        # Books whose bytes changed under an unchanged path, and files recognised
        # as moved rather than deleted-and-re-added (issue #284).
        "replaced_books": 0,
        "moved_books": 0,
        "moved_maps": 0,
        "moved_tokens": 0,
        "moved_audio": 0,
        "errors": 0,
    }

    # --- Resolve scope (which collections to walk, and the subtree root) ---
    scope_section: str | None = None
    scope_dir: Path | None = None
    if scope_path:
        scope_section, scope_dir = resolve_scope(library_path, scope_path)
        logger.debug(f"Scoped scan: section={scope_section}, dir={scope_dir}, mode={metadata_mode}")

    # Matcher for .grimoireignore rules across the whole library tree (issue
    # #224).  Built once from the library root; queried per path in each walk.
    ignore = IgnoreMatcher(library_path)

    scan_books = scope_section in (None, "books")
    scan_armory = scope_section in (None, ARMORY_SECTION)
    scan_maps = scope_section in (None, "maps")
    scan_tokens = scope_section in (None, "tokens")
    scan_audio = scope_section in (None, "audio")
    scan_models = scope_section in (None, "models")

    # For a scoped books scan, walk only the scope dir; otherwise iterate every system.
    def walk_dir(section: str, collection_dir: Path) -> Path:
        return scope_dir if scope_section == section and scope_dir is not None else collection_dir

    books_walk_dir = walk_dir("books", books_dir)
    armory_walk_dir = walk_dir(ARMORY_SECTION, armory_dir)
    maps_walk_dir = walk_dir("maps", maps_dir)
    tokens_walk_dir = walk_dir("tokens", tokens_dir)
    audio_walk_dir = walk_dir("audio", audio_dir)
    models_walk_dir = walk_dir("models", models_dir)

    def count(model: Any, walk: Path, extensions: AbstractSet[str], **kw: Any) -> int:
        """The progress total for one walk, without walking it when that can be helped.

        A rescan takes it from the rows the last scan left under ``walk``. Only
        when there are none - the library's first import - is the tree walked
        to count it, and that scan is busy hashing and thumbnailing every file,
        so the extra walk is small beside it.
        """
        if not walk.exists():
            return 0
        return _count_registered(session, model, walk) or _count_eligible_files(
            walk, extensions, ignore, **kw
        )

    def count_books(walk: Path) -> int:
        return count(Book, walk, DOC_EXTS | IMAGE_EXTS | ARCHIVE_EXTS, skip_exported_covers=True)

    totals = {
        # Armory books are books: they count, and report progress, with books/.
        "books": (count_books(books_walk_dir) if scan_books else 0)
        + (count_books(armory_walk_dir) if scan_armory else 0),
        "maps": (
            count(GenericMap, maps_walk_dir, MAP_IMAGE_EXTS | MEDIA_ARCHIVE_EXTS)
            if scan_maps
            else 0
        ),
        "tokens": (
            count(Token, tokens_walk_dir, IMAGE_EXTS | MEDIA_ARCHIVE_EXTS) if scan_tokens else 0
        ),
        "audio": (
            count(Audio, audio_walk_dir, AUDIO_EXTS | MEDIA_ARCHIVE_EXTS) if scan_audio else 0
        ),
        "models": (
            count(Model3D, models_walk_dir, MODEL_EXTS | MEDIA_ARCHIVE_EXTS) if scan_models else 0
        ),
    }

    ctx = _ScanContext(
        library_path=library_path,
        session=session,
        ignore=ignore,
        thumb_dir=thumb_dir,
        scope_dir=scope_dir,
        scope_section=scope_section,
        scope_path=scope_path,
        metadata_mode=metadata_mode,
        on_progress=on_progress,
        on_phase=on_phase,
        should_stop=should_stop,
        stats=stats,
        totals=totals,
        date_inserts=first_import_done(session),
        reconciled_at=reconciled_at(session),
    )

    ctx.emit_progress(force=True)

    if scan_books and books_dir.exists():
        _scan_books(ctx, books_dir)
        ctx.emit_progress(force=True)
        if ctx.stop_requested():
            return stats

    if scan_armory and armory_dir.exists():
        _scan_books(ctx, armory_dir, GAME_TYPE_WARGAME)
        ctx.emit_progress(force=True)
        if ctx.stop_requested():
            return stats

    if scan_maps and maps_walk_dir.exists():
        _scan_media(ctx, maps_walk_dir, "maps", MAP_IMAGE_EXTS, GenericMap, (300, 400))
        ctx.emit_progress(force=True)
        if ctx.stop_requested():
            return stats

    if scan_tokens and tokens_walk_dir.exists():
        _scan_media(ctx, tokens_walk_dir, "tokens", IMAGE_EXTS, Token, (200, 200))
        ctx.emit_progress(force=True)
        if ctx.stop_requested():
            return stats

    if scan_audio and audio_walk_dir.exists():
        _scan_audio(ctx, audio_walk_dir)
        ctx.emit_progress(force=True)
        if ctx.stop_requested():
            return stats

    if scan_models and models_walk_dir.exists():
        # Square thumbnails: a miniature is rendered into a fixed box rather
        # than cropped from a source image, so there is no aspect to preserve.
        _scan_media(
            ctx,
            models_walk_dir,
            "models",
            MODEL_EXTS,
            Model3D,
            (300, 300),
            enrich=_enrich_model,
        )
        ctx.emit_progress(force=True)
        if ctx.stop_requested():
            return stats

    # The walks noted each tags.json they passed, so this reads those files
    # rather than walking the media tree a second time.
    _apply_tags_from_library(
        library_path, session, scope_dir=scope_dir, tags_dirs=ctx.tags_json_dirs
    )

    # --- Write sidecars for the books this scan added ---
    # After tags, deliberately: tags.json is applied above, and a sidecar written
    # before that would describe the book without them.
    _export_sidecars_for_new_books(ctx)

    # --- Mark / unmark missing files ---
    # After walking the filesystem, any DB record whose file is gone gets
    # is_missing=True; records that exist on disk have is_missing cleared.
    # A file newly matched by a ``.grimoireignore`` rule (still on disk but now
    # excluded) is treated as gone too, so it disappears from the UI; clearing
    # the rule brings it back on the next scan. When scoped, only reconcile
    # records under the scope subtree so unrelated corners are left untouched.
    if ctx.stop_requested():
        return stats

    _reconcile_missing(
        ctx, scan_books or scan_armory, scan_maps, scan_tokens, scan_audio, scan_models
    )

    # --- Drop systems whose folder is gone or now ignored ---
    # Only meaningful after a full walk of books/: that walk is what populates
    # ``seen_system_ids``, so pruning off a scan that never looked at books (a
    # maps-only scope, or a library with no books/ dir yet) would delete every
    # system in the database. The armory is walked in the same full scan, so
    # its systems are seen too; with no armory/ folder there is nothing to see,
    # and its systems go once their books are gone.
    if scan_books and books_dir.exists():
        stats["removed_systems"] = _prune_vanished_systems(ctx)

    # --- Drop factions left empty ---
    # After the sweep, so a moved wargame book has been re-linked to the
    # factions its new folders name and the ones it left can go.
    if scan_books or scan_armory:
        try:
            if prune_empty_factions(session):
                _db_call(session.commit, "commit pruned factions", session)
        except SQLAlchemyError as e:
            logger.error(f"DB error pruning empty factions: {e}")
            session.rollback()

    # A complete walk of the whole library ends the undated first import
    # (issue #199). A scoped or interrupted scan saw only part of it, so the
    # rest of the import must stay undated too. Recorded on every full scan, not
    # just the first, so an upgraded install (dated by migration 0040's backfill)
    # pins the setting rather than relying on its dated rows surviving.
    if scope_path is None:
        mark_first_import_done(session)

    return stats
