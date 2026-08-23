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
from typing import Callable, Optional

from sqlalchemy.orm import Session

from ..library_ignore import IgnoreMatcher
from ..models import GenericMap, Token
from ._context import (  # noqa: F401  (re-exported: patched as backend.indexer.scan.<name>)
    _ScanContext,
    _count_eligible_files,
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
from .constants import (
    ARCHIVE_EXTS,
    AUDIO_EXTS,
    DOC_EXTS,
    IMAGE_EXTS,
    MAP_IMAGE_EXTS,
    MEDIA_ARCHIVE_EXTS,
)
from .hashing import (  # noqa: F401  (re-exported: patched as backend.indexer.scan.hash_file)
    apply_signature,
    changed_content,
    file_signature,
    hash_file,
    signature_matches,
)
from .media import _scan_audio, _scan_media  # noqa: F401
from .metadata import resolve_collection_dir, resolve_scope
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
) -> dict:
    """Scan the library directory and register all files in the database.

    on_progress(scanned_books, total_books, scanned_maps, total_maps, scanned_tokens,
    total_tokens, scanned_audio, total_audio) is called after each file is processed if provided.

    should_stop() is an optional callable that returns True when the scan should abort early.

    scope_path, when given, restricts the scan to a single subtree (relative to the
    library root, e.g. "books/D&D 5e/adventure").  Only the matching collection is
    walked and the missing-file sweep is limited to that subtree.

    metadata_mode controls how sidecar metadata is applied to already-indexed books:
    "new" (default) leaves existing records alone, "missing" fills empty fields from
    OPF sidecars, "replace" overwrites fields wherever the sidecar provides a value.
    """
    library = Path(library_path)
    books_dir = resolve_collection_dir(library, "books")
    maps_dir = resolve_collection_dir(library, "maps")
    tokens_dir = resolve_collection_dir(library, "tokens")
    audio_dir = resolve_collection_dir(library, "audio")
    thumb_dir = Path(data_path) / "thumbnails"
    stats = {
        "new_systems": 0,
        # Systems dropped because their folder vanished or became ignored.
        "removed_systems": 0,
        "new_books": 0,
        "new_maps": 0,
        "new_tokens": 0,
        "new_audio": 0,
        "updated_books": 0,
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
    scan_maps = scope_section in (None, "maps")
    scan_tokens = scope_section in (None, "tokens")
    scan_audio = scope_section in (None, "audio")

    # For a scoped books scan, walk only the scope dir; otherwise iterate every system.
    books_walk_dir = scope_dir if scope_section == "books" else books_dir
    maps_walk_dir = scope_dir if scope_section == "maps" else maps_dir
    tokens_walk_dir = scope_dir if scope_section == "tokens" else tokens_dir
    audio_walk_dir = scope_dir if scope_section == "audio" else audio_dir

    totals = {
        "books": (
            _count_eligible_files(
                books_walk_dir,
                DOC_EXTS | IMAGE_EXTS | ARCHIVE_EXTS,
                ignore,
                skip_exported_covers=True,
            )
            if scan_books and books_walk_dir.exists()
            else 0
        ),
        "maps": (
            _count_eligible_files(maps_walk_dir, MAP_IMAGE_EXTS | MEDIA_ARCHIVE_EXTS, ignore)
            if scan_maps and maps_walk_dir.exists()
            else 0
        ),
        "tokens": (
            _count_eligible_files(tokens_walk_dir, IMAGE_EXTS | MEDIA_ARCHIVE_EXTS, ignore)
            if scan_tokens and tokens_walk_dir.exists()
            else 0
        ),
        "audio": (
            _count_eligible_files(audio_walk_dir, AUDIO_EXTS | MEDIA_ARCHIVE_EXTS, ignore)
            if scan_audio and audio_walk_dir.exists()
            else 0
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
        should_stop=should_stop,
        stats=stats,
        totals=totals,
    )

    ctx.emit_progress()

    if scan_books and books_dir.exists():
        _scan_books(ctx, books_dir)
        if ctx.stop_requested():
            return stats

    if scan_maps and maps_walk_dir.exists():
        _scan_media(ctx, maps_walk_dir, "maps", MAP_IMAGE_EXTS, GenericMap, (300, 400))
        if ctx.stop_requested():
            return stats

    if scan_tokens and tokens_walk_dir.exists():
        _scan_media(ctx, tokens_walk_dir, "tokens", IMAGE_EXTS, Token, (200, 200))
        if ctx.stop_requested():
            return stats

    if scan_audio and audio_walk_dir.exists():
        _scan_audio(ctx, audio_walk_dir)
        if ctx.stop_requested():
            return stats

    _apply_tags_from_library(library_path, session, scope_dir=scope_dir)

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

    _reconcile_missing(ctx, scan_books, scan_maps, scan_tokens, scan_audio)

    # --- Drop systems whose folder is gone or now ignored ---
    # Only meaningful after a full walk of books/: that walk is what populates
    # ``seen_system_ids``, so pruning off a scan that never looked at books (a
    # maps-only scope, or a library with no books/ dir yet) would delete every
    # system in the database.
    if scan_books and books_dir.exists():
        stats["removed_systems"] = _prune_vanished_systems(ctx)

    return stats
