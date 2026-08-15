"""Library filesystem scan.

``scan_library`` walks the library tree and registers books, maps, tokens, and
audio in the database, then applies ``tags.json`` folder tags and reconciles the
missing-file flags.  The four collection phases and the missing-file sweep are
split into focused helpers driven by a shared ``_ScanContext``; ``scan_library``
itself is the orchestrator.

Patch-safety: ``generate_thumbnail`` and ``_fitz_open_with_timeout`` are stubbed
by tests via ``patch("backend.indexer.…")`` and so are called through the
package namespace (``indexer.NAME``).
"""
import os
import re
import hashlib
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import indexer  # package namespace, for patch-sensitive calls
from ..library_ignore import IgnoreMatcher
from ..models import (
    Audio,
    Book,
    GameSystem,
    GenericMap,
    Token,
)
from ..services import tag_service
from ._subprocess import _run_with_timeout
from .hashing import (
    apply_signature,
    changed_content,
    file_signature,
    hash_file,
    signature_matches,
)
from .categories import (
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
    CONTAINER_FAMILY,
    CONTAINER_ONE_PAGE,
    CONTAINER_PARENT,
    CONTAINER_PUBLISHER,
    DOC_EXTS,
    IMAGE_EXTS,
    MAP_IMAGE_EXTS,
    MEDIA_ARCHIVE_EXTS,
    NO_AUTO_CATEGORY_MARKER,
    UNCATEGORIZED,
    _COMIC_ARCHIVE_EXTS,
    _DB_TIMEOUT,
)
from .metadata import (
    _apply_opf_to_book,
    _find_opf_meta,
    _read_audio_metadata,
    _find_folder_artwork,
    parse_opf_metadata,
    resolve_collection_dir,
    resolve_scope,
)
from .tags import _apply_tags_from_library
from .thumbnails import archive_ext, archive_mime

logger = logging.getLogger("grimoire.indexer")


def _prune_dirs(root: str, dirs: list[str], ignore: Optional[IgnoreMatcher]) -> list[str]:
    """Return the walk subdirectories to descend into.

    Drops hidden dirs (``.``-prefixed) and, when an ``ignore`` matcher is given,
    any directory excluded by a ``.grimoireignore`` rule — pruning the whole
    subtree so ignored folders are never walked.
    """
    return [
        d
        for d in dirs
        if not d.startswith(".")
        and not (ignore and ignore.is_ignored(os.path.join(root, d), is_dir=True))
    ]


def _keep_entry(path: Path, ignore: Optional[IgnoreMatcher], *, is_dir: bool) -> bool:
    """Return True if a directly-enumerated entry should be scanned.

    The ``os.walk`` paths prune with :func:`_prune_dirs`, but the system and
    container walks list a directory themselves (``Path.iterdir``) and so need
    the same hidden-plus-``.grimoireignore`` test applied per entry (issue #333).
    """
    return not path.name.startswith(".") and not (
        ignore and ignore.is_ignored(str(path), is_dir=is_dir)
    )


def _count_eligible_files(
    directory: Path, extensions: set, ignore: Optional[IgnoreMatcher] = None
) -> int:
    """Count non-hidden files with matching extensions under directory.

    When an ``ignore`` matcher is supplied, directories and files excluded by a
    ``.grimoireignore`` rule are skipped so the count matches what the scan will
    actually process (keeping progress totals accurate).
    """
    count = 0
    for root, dirs, files in os.walk(directory):
        dirs[:] = _prune_dirs(root, dirs, ignore)
        for f in files:
            if f.startswith("."):
                continue
            if ignore and ignore.is_ignored(os.path.join(root, f), is_dir=False):
                continue
            if Path(f).suffix.lower() in extensions or archive_ext(f) in extensions:
                count += 1
    return count


@dataclass
class _ScanContext:
    """Shared state threaded through the collection-scan phase helpers."""

    library_path: str
    session: Session
    ignore: IgnoreMatcher
    thumb_dir: Path
    scope_dir: Path | None
    scope_section: str | None
    scope_path: str | None
    metadata_mode: str
    on_progress: Optional[Callable[..., None]]
    should_stop: Optional[Callable[[], bool]]
    stats: dict
    totals: dict  # {"books": int, "maps": int, "tokens": int, "audio": int}
    scanned: dict = field(
        default_factory=lambda: {"books": 0, "maps": 0, "tokens": 0, "audio": 0}
    )
    # Ids of rows inserted by this scan. Move detection only accepts one of these
    # as a destination — a pre-existing row is a file that did not move, even when
    # its contents match something deleted elsewhere.
    inserted_ids: set = field(default_factory=set)
    # Ids of every GameSystem this scan walked to (registered or re-registered).
    # A row absent from this set has no folder behind it any more — see
    # ``_prune_vanished_systems``.
    seen_system_ids: set = field(default_factory=set)

    def stop_requested(self) -> bool:
        return bool(self.should_stop and self.should_stop())

    def emit_progress(self) -> None:
        if self.on_progress:
            self.on_progress(
                self.scanned["books"],
                self.totals["books"],
                self.scanned["maps"],
                self.totals["maps"],
                self.scanned["tokens"],
                self.totals["tokens"],
                self.scanned["audio"],
                self.totals["audio"],
            )

    def thumb_path(self, section: str, title: str, filepath: str) -> str:
        return os.path.join(
            self.thumb_dir,
            section,
            f"{slugify(title)}_{hashlib.md5(filepath.encode()).hexdigest()[:8]}.webp",
        )


def _title_from_filename(filename: str) -> str:
    return Path(filename).stem.replace("_", " ").replace("-", " ").strip()


@dataclass
class _SystemFolder:
    """A books folder resolved into the system row it should map to."""

    path: Path
    name: str
    slug: str
    is_nsfw: bool
    container_kind: str


def _resolve_system_folder(system_dir: Path, slug_prefix: str = "") -> _SystemFolder:
    """Interpret a books folder name into the system it describes.

    Peels off, in order: the ``(nsfw)`` suffix (or ``.nsfw`` marker), the
    ``(parent-system)``/``(one-page)`` container suffix, and any leading
    sort-order prefix (``!$%``). ``slug_prefix`` namespaces the slug for a
    container's children so two containers can both hold a ``core`` folder
    without colliding on the unique ``slug`` column.
    """
    raw_name = system_dir.name
    is_nsfw = bool(re.search(r"\(nsfw\)", raw_name, re.IGNORECASE)) or has_nsfw_marker(system_dir)
    name = re.sub(r"\s*\(nsfw\)\s*", "", raw_name, flags=re.IGNORECASE).strip()
    name, suffix_kind = strip_container_suffix(name)
    # Must happen before slug/name/special-collection derivation.
    name = strip_sort_prefix(name)
    container_kind = suffix_kind or detect_container_kind(system_dir, name)
    slug = slugify(name)
    return _SystemFolder(
        path=system_dir,
        name=name,
        slug=f"{slug_prefix}{slug}" if slug_prefix else slug,
        is_nsfw=is_nsfw,
        container_kind=container_kind,
    )


def _adopt_existing_system(
    ctx: _ScanContext, name: str, new_slug: str
) -> Optional[GameSystem]:
    """Claim a pre-existing flat system for a container, or return None.

    Reorganising ``books/Dungeons & Dragons 5e/`` into
    ``books/Dungeons & Dragons/5e/`` changes a system's derived slug but not the
    name the scanner generates for it. Rather than orphan the old row (and trip
    the unique ``name`` constraint inserting a new one), re-slug the existing
    system so its books, metadata, and tags follow it into the container.

    Only unclaimed systems are adopted: a row already sitting inside another
    container belongs to that one, and is left alone.
    """
    session = ctx.session
    try:
        existing = _run_with_timeout(
            lambda: session.query(GameSystem).filter_by(name=name).first(),
            _DB_TIMEOUT,
            f"query system by name '{name}'",
        )
    except TimeoutError as e:
        logger.error(f"DB hang: {e} — cannot adopt system '{name}'")
        return None
    if existing is None or existing.parent_id or existing.container_kind:
        return None
    logger.info(f"Adopting existing system '{name}' into its container (slug -> {new_slug})")
    existing.slug = new_slug
    return existing


def _unique_system_name(ctx: _ScanContext, name: str, slug: str) -> str:
    """Return ``name``, or a suffixed variant when the name is already taken.

    ``game_systems.name`` is unique. A folder layout can legitimately generate a
    name that collides with an unrelated existing system, and a scan must not die
    on that — so disambiguate with the slug, then a counter.
    """
    session = ctx.session
    try:
        taken = _run_with_timeout(
            lambda: session.query(GameSystem).filter_by(name=name).first(),
            _DB_TIMEOUT,
            f"query system by name '{name}'",
        )
    except TimeoutError as e:
        logger.error(f"DB hang: {e} — using name '{name}' as-is")
        return name
    if taken is None:
        return name
    candidate = f"{name} ({slug})"
    suffix = 2
    while True:
        try:
            clash = _run_with_timeout(
                lambda c=candidate: session.query(GameSystem).filter_by(name=c).first(),
                _DB_TIMEOUT,
                f"query system by name '{candidate}'",
            )
        except TimeoutError:
            return candidate
        if clash is None:
            logger.warning(
                f"System name '{name}' is already in use; registering this folder as "
                f"'{candidate}'. Rename it in the UI to something clearer."
            )
            return candidate
        candidate = f"{name} ({slug}-{suffix})"
        suffix += 1


def _register_system(
    ctx: _ScanContext,
    folder: _SystemFolder,
    *,
    display_name: str | None = None,
    parent: Optional[GameSystem] = None,
    edition: str = "",
    system_family: str = "",
    publisher: str = "",
    attribute_parent: bool = True,
) -> Optional[GameSystem]:
    """Insert or update the GameSystem row for one folder. None on DB failure.

    ``display_name`` overrides the stored name for a container's children (e.g.
    "Dungeons & Dragons 5e" for the ``5e`` folder). It is only ever applied to a
    freshly created row or one whose ``name_is_custom`` is false, so a user's
    rename survives every subsequent rescan.

    ``system_family``/``publisher`` carry a family or publisher container's name
    down onto its children (issue #301), so the folder structure populates the
    metadata fields that already exist. Both follow the same rule as ``edition``:
    filled in only when the child has no value of its own, so metadata from an
    OPF sidecar, an add-on, or a manual edit is never overwritten by a rescan.

    ``attribute_parent`` is whether the container's name means "this child is a
    variant of X" — true only for a parent-system shelf. Family, publisher, and
    generic shelves hold independent systems, so they leave ``parent_system``
    empty rather than implying an edition relationship that isn't there.
    """
    session = ctx.session
    stats = ctx.stats
    name = display_name or folder.name
    logger.debug(f"DB: querying system '{folder.slug}'")
    try:
        system = _run_with_timeout(
            lambda slug=folder.slug: session.query(GameSystem).filter_by(slug=slug).first(),
            _DB_TIMEOUT,
            f"query system '{folder.slug}'",
        )
    except TimeoutError as e:
        logger.error(f"DB hang: {e} — skipping system '{name}'")
        stats["errors"] += 1
        return None

    if system is None and parent is not None:
        # Adopting an existing flat system into a container. Someone who
        # reorganised books/Dungeons & Dragons 5e/ into
        # books/Dungeons & Dragons/5e/ already has a "Dungeons & Dragons 5e" row
        # holding all their books, metadata, and tags; ``name`` is unique, so
        # inserting a second one would fail. Re-point the existing row at its new
        # container instead, keeping everything attached to it.
        system = _adopt_existing_system(ctx, name, folder.slug)

    if system is None:
        # ``name`` is unique and may still be taken by an unrelated system (or one
        # already owned by a different container), so fall back to a suffixed name
        # rather than crashing the whole scan.
        name = _unique_system_name(ctx, name, folder.slug)

    is_agnostic = is_system_agnostic_folder(folder.name)
    # The one-page flag marks the *collection*, not its children: a child of a
    # one-page container is an ordinary small system and counts toward the
    # library's system total (issue #262).
    is_one_page = folder.container_kind == CONTAINER_ONE_PAGE or (
        parent is None and is_one_page_folder(folder.name)
    )
    if not system:
        system = GameSystem(
            name=name,
            slug=folder.slug,
            is_explicit=folder.is_nsfw,
            is_system_agnostic=is_agnostic,
            is_one_page=is_one_page,
            container_kind=folder.container_kind,
            parent_id=parent.id if parent else None,
            parent_system=parent.name if parent and attribute_parent else "",
            edition=edition,
            system_family=system_family,
            publishers=[{"name": publisher}] if publisher else [],
        )
        session.add(system)
        logger.debug(f"DB: flushing new system '{name}'")
        try:
            _run_with_timeout(session.flush, _DB_TIMEOUT, f"flush system '{name}'")
        except TimeoutError as e:
            logger.error(f"DB hang: {e} — skipping system '{name}'")
            session.rollback()
            stats["errors"] += 1
            return None
        stats["new_systems"] += 1
        logger.info(f"Found a new game system: {name}" + (" (mature)" if folder.is_nsfw else ""))
    else:
        if folder.is_nsfw and not system.is_explicit:
            system.is_explicit = True
        if is_agnostic and not system.is_system_agnostic:
            system.is_system_agnostic = True
        if is_one_page and not system.is_one_page:
            system.is_one_page = True
        if (system.container_kind or "") != folder.container_kind:
            system.container_kind = folder.container_kind
        if parent is not None and system.parent_id != parent.id:
            system.parent_id = parent.id
        # Folder-derived name/parentage refresh, unless the user has renamed it.
        if not system.name_is_custom and system.name != name:
            system.name = name
        if parent is not None:
            # Only edition containers imply a parent_system; see the insert path.
            if not system.parent_system and attribute_parent:
                system.parent_system = parent.name
            if edition and not system.edition:
                system.edition = edition
        if system_family and not system.system_family:
            system.system_family = system_family
        if publisher and not system.publishers:
            system.publishers = [{"name": publisher}]

    # Folder cover convention: a cover.*/folder.* image at the system root
    # becomes the system's cover (precedence: folder > uploaded > book cover).
    # Stored library-relative so it survives moves of the whole library dir.
    artwork = _find_folder_artwork(str(folder.path))
    new_folder_cover = os.path.relpath(artwork, ctx.library_path) if artwork else ""
    if (system.folder_cover_path or "") != new_folder_cover:
        system.folder_cover_path = new_folder_cover
    # This folder exists, so the row is backed by something on disk.
    ctx.seen_system_ids.add(system.id)
    return system


def _scan_books(ctx: _ScanContext, books_dir: Path) -> None:
    """Walk the books tree, registering systems and their books.

    Returns early (leaving ``ctx.stats`` as-is) if a stop is requested mid-walk.
    """
    session = ctx.session

    # Global kill-switch for folder-name category inference (env-over-DB).
    # When on, every book falls back to the neutral UNCATEGORIZED category.
    category_inference_off = folder_category_inference_disabled(session)
    # When scoped, the owning system is the first path segment under books/;
    # otherwise iterate every top-level system folder.
    scope_parts = (
        Path(ctx.scope_path.replace("\\", "/").strip("/")).parts if ctx.scope_path else ()
    )
    scoped = ctx.scope_section == "books" and len(scope_parts) > 1
    if scoped:
        system_dirs = [books_dir / scope_parts[1]]
    else:
        # Whole library, or scope == "books" root: iterate every system.
        system_dirs = sorted(books_dir.iterdir())
    # Same two-pass split as ``_scan_container`` (issue #352): register every
    # top-level system first, so a stop while indexing one system's books cannot
    # leave the systems after it in the walk unregistered.
    registered: list[tuple[Path, _SystemFolder, GameSystem]] = []
    for system_dir in system_dirs:
        if not system_dir.is_dir() or not _keep_entry(system_dir, ctx.ignore, is_dir=True):
            continue

        folder = _resolve_system_folder(system_dir)
        system = _register_system(ctx, folder)
        if system is None:
            continue
        registered.append((system_dir, folder, system))

    if registered:
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, "commit top-level systems")
        except (TimeoutError, Exception) as e:
            logger.error(f"DB error saving top-level systems: {e}")
            session.rollback()
            ctx.stats["errors"] += 1
            return

    for system_dir, folder, system in registered:
        if folder.container_kind:
            # The folder holds systems, not categories — recurse one level.
            if _scan_container(ctx, system, folder, category_inference_off, scope_parts):
                return
            continue

        # Per-system opt-out: a marker file at the system root disables
        # folder-name category inference for just this system.
        system_category_off = category_inference_off or (
            system_dir / NO_AUTO_CATEGORY_MARKER
        ).exists()
        # Both special collections (agnostic + one-page) use immediate-subfolder
        # names as category labels rather than CATEGORY_MAP inference.
        is_special = is_special_collection_folder(folder.name)
        # When scoped to a path deeper than the system dir, walk only that
        # subtree; otherwise walk the whole system.
        walk_root = ctx.scope_dir if scoped else system_dir
        if _scan_books_in_system(
            ctx, system, folder.name, system_category_off, is_special, walk_root
        ):
            return


def _child_display_name(container: GameSystem, folder: _SystemFolder, kind: str) -> str:
    """Default display name for a container's child system.

    Parent-system containers name their editions after the pair, since an
    edition folder alone ("5e") is meaningless out of context:
    "Dungeons & Dragons" + "5e" → "Dungeons & Dragons 5e". One-page children are
    standalone games, so their folder/file name is prettified and used as-is
    ("honey-heist" → "Honey Heist"). Family, publisher, and generic children are
    likewise whole systems with names that already stand alone ("Pathfinder"
    inside "d20 System"), so they are never prefixed with the container's name.

    Either way this is only a *default* — the name is user-editable afterwards,
    which is how irregular cases get handled (D&D's "2e" folder renamed to
    "Advanced Dungeons & Dragons").
    """
    if kind == CONTAINER_PARENT:
        return f"{container.name} {folder.name}".strip()
    return prettify_collection_name(folder.name)


def _scan_container(
    ctx: _ScanContext,
    container: GameSystem,
    container_folder: _SystemFolder,
    category_inference_off: bool,
    scope_parts: tuple[str, ...],
    depth: int = 1,
    register_only: bool = False,
) -> bool:
    """Register a container folder's children as systems. True if stop requested.

    ``register_only`` runs the registration half alone — every child (and, for a
    nested container, every grandchild) gets its row, and no books are indexed.
    ``_scan_books`` uses it as a pre-pass so an interrupted scan still leaves a
    complete set of systems behind (issue #352).

    Each immediate subdirectory becomes a system whose own tree is then scanned
    with ordinary category inference (so ``cbr+pnk/core/`` and
    ``cbr+pnk/character-sheets/`` land in the right categories). For a one-page
    container, each loose file at the container root additionally becomes a
    single-book system of its own — ``honey-heist.pdf`` is a whole game, not a
    stray file (issue #262).

    Loose files at a *parent-system* container's root have no such meaning, so
    they stay attached to the container row as ordinary books rather than being
    silently dropped.

    A child that is itself a container is recursed into rather than scanned for
    books — a family holding a multi-edition system ("d20 System" → "Pathfinder"
    → 1e/2e) is the realistic case for family and publisher containers (issue
    #301). ``depth`` counts the containers above a child so category inference
    still starts at the folder *below* the system, however deep the nesting.
    """
    kind = container_folder.container_kind
    container_dir = container_folder.path
    # Family and publisher containers push their name onto each child's
    # metadata; edition and one-page containers carry no such attribution.
    child_family = container.name if kind == CONTAINER_FAMILY else ""
    child_publisher = container.name if kind == CONTAINER_PUBLISHER else ""
    # Only a parent-system shelf means "this child is a variant of me". The
    # other kinds hold independent games, so claiming "Honey Heist" is a
    # variant of "One-Page RPGs" would be wrong — and would surface a bogus
    # entry in the Parent System filter.
    attribute_parent = kind == CONTAINER_PARENT
    # A rescan scoped inside the container (books/<container>/<child>/…) should
    # only touch that child.
    scoped_child = scope_parts[2] if len(scope_parts) > 2 else None

    try:
        entries = sorted(container_dir.iterdir())
    except OSError as e:
        logger.error(f"Cannot read container folder '{container_dir}': {e}")
        ctx.stats["errors"] += 1
        return False

    child_dirs = [d for d in entries if d.is_dir() and _keep_entry(d, ctx.ignore, is_dir=True)]

    # Pass 1 — register every child system before indexing any books (issue #352).
    # Registering and indexing in one loop meant a stop partway through the first
    # edition's books returned before the later editions had rows at all, so an
    # interrupted scan left a half-populated shelf. Registration is cheap (one row
    # per folder, no file reads), so doing all of it up front makes the set of
    # editions complete as soon as the container is walked, however early the
    # indexing is cut short.
    registered: list[tuple[Path, _SystemFolder, GameSystem]] = []
    for child_dir in child_dirs:
        if scoped_child and child_dir.name != scoped_child:
            continue
        child_folder = _resolve_system_folder(child_dir, slug_prefix=f"{container_folder.slug}--")
        child = _register_system(
            ctx,
            child_folder,
            display_name=_child_display_name(container, child_folder, kind),
            parent=container,
            edition=child_folder.name if kind == CONTAINER_PARENT else "",
            system_family=child_family,
            publisher=child_publisher,
            attribute_parent=attribute_parent,
        )
        if child is None:
            continue
        registered.append((child_dir, child_folder, child))
        if child_folder.container_kind and not register_only:
            # A nested container holds systems of its own. Register that whole
            # subtree now, while still in the registration pass, so an
            # interrupted scan leaves every level of the shelf complete.
            _scan_container(
                ctx,
                child,
                child_folder,
                category_inference_off,
                scope_parts[1:],
                depth + 1,
                register_only=True,
            )

    # Persist the rows now, so a stop (or a crash) during pass 2 still leaves the
    # shelf complete rather than rolling the registrations back with it.
    if registered:
        try:
            _run_with_timeout(
                ctx.session.commit, _DB_TIMEOUT, f"commit child systems of '{container.name}'"
            )
        except (TimeoutError, Exception) as e:
            logger.error(f"DB error saving child systems of '{container.name}': {e}")
            ctx.session.rollback()
            ctx.stats["errors"] += 1
            return False

    # Pass 2 — index each child's books (the expensive part, and the one that stops).
    for child_dir, child_folder, child in registered:
        if child_folder.container_kind:
            # Nested container (e.g. a parent-system inside a family). Recurse
            # so its own children register as systems rather than treating the
            # edition folders as book categories.
            if _scan_container(
                ctx,
                child,
                child_folder,
                category_inference_off,
                scope_parts[1:],
                depth + 1,
                register_only=register_only,
            ):
                return True
            continue
        if register_only:
            continue
        child_category_off = category_inference_off or (
            child_dir / NO_AUTO_CATEGORY_MARKER
        ).exists()
        if _scan_books_in_system(
            ctx,
            child,
            child_folder.name,
            child_category_off,
            False,
            child_dir,
            system_depth=2 + depth,
        ):
            return True

    if scoped_child:
        return False

    loose_files = [f for f in entries if f.is_file() and _keep_entry(f, ctx.ignore, is_dir=False)]
    if kind == CONTAINER_ONE_PAGE:
        # Each loose file is a system of its own, so this belongs in the
        # registration pass as much as the child folders do.
        return _scan_one_page_loose_files(
            ctx, container, container_folder, loose_files, register_only=register_only
        )
    if register_only:
        # Loose files here are ordinary books on the container's own row; no
        # system to create, so nothing for the registration pass to do.
        return False
    # Every other container kind: loose files belong to the container itself.
    return _scan_books_in_system(
        ctx,
        container,
        container_folder.name,
        category_inference_off,
        False,
        container_dir,
        recurse=False,
    )


def _scan_one_page_loose_files(
    ctx: _ScanContext,
    container: GameSystem,
    container_folder: _SystemFolder,
    loose_files: list[Path],
    register_only: bool = False,
) -> bool:
    """Register each loose file under a one-page container as its own system.

    ``one-page-rpgs/honey-heist.pdf`` becomes the system "Honey Heist" holding
    that single book, so it carries its own metadata, tags, and system filters
    exactly like a folder-backed game.

    ``register_only`` creates the rows without indexing the books, for the
    registration pre-pass described in :func:`_scan_container`.
    """
    for path in loose_files:
        ext = path.suffix.lower()
        if ext not in DOC_EXTS and ext not in IMAGE_EXTS and not archive_ext(path.name):
            continue
        stem = _title_from_filename(path.name)
        child_folder = _SystemFolder(
            path=path.parent,
            name=stem,
            slug=f"{container_folder.slug}--{slugify(stem)}",
            is_nsfw=container.is_explicit,
            container_kind="",
        )
        child = _register_system(
            ctx,
            child_folder,
            display_name=prettify_collection_name(stem),
            parent=container,
            # A one-page game is not a variant of the collection holding it.
            attribute_parent=False,
        )
        if child is None:
            continue
        if register_only:
            continue
        if _scan_books_in_system(
            ctx,
            child,
            child_folder.name,
            False,
            False,
            path.parent,
            recurse=False,
            only_filename=path.name,
        ):
            return True
    return False


def _scan_books_in_system(
    ctx: _ScanContext,
    system: GameSystem,
    system_name: str,
    system_category_off: bool,
    is_special_collection: bool,
    walk_root: Path,
    recurse: bool = True,
    only_filename: str | None = None,
    system_depth: int = 2,
) -> bool:
    """Walk one system's tree and register its books. Returns True if stop requested.

    ``is_special_collection`` is True for the system-agnostic and one-page
    collections, which label categories by immediate subfolder name.

    ``recurse=False`` limits the walk to files sitting directly in ``walk_root``
    (its subdirectories are separate systems, handled by ``_scan_container``).
    ``only_filename`` further narrows it to a single file, for the one-page
    container's loose-file-as-a-system case. ``system_depth`` tells category
    inference how deep the system root sits (3 for a container's children).
    """
    session = ctx.session
    ignore = ctx.ignore
    stats = ctx.stats
    for root, dirs, files in os.walk(walk_root):
        dirs[:] = _prune_dirs(root, dirs, ignore)
        if not recurse:
            dirs[:] = []
        if only_filename is not None:
            files = [f for f in files if f == only_filename]

        # Collect cover image filenames declared in any OPF files in this
        # directory so we can skip them — Calibre exports a cover JPG that
        # would otherwise appear as a 1-page book entry.
        opf_cover_filenames: set[str] = set()
        for f in files:
            if Path(f).suffix.lower() == ".opf":
                opf_data = parse_opf_metadata(os.path.join(root, f))
                cover_fn = opf_data.get("cover_image_filename")
                if cover_fn:
                    opf_cover_filenames.add(cover_fn)

        for filename in sorted(files):
            if filename.startswith("."):
                continue

            filepath = os.path.join(root, filename)
            ext = Path(filename).suffix.lower()
            arc_ext = archive_ext(filename)

            if ext not in DOC_EXTS and ext not in IMAGE_EXTS and not arc_ext:
                continue

            if ignore.is_ignored(filepath, is_dir=False):
                logger.debug(f"Ignored by .grimoireignore: {filepath}")
                continue

            if filename in opf_cover_filenames:
                logger.debug(f"Skipping OPF cover image: {filepath}")
                continue

            ctx.scanned["books"] += 1
            ctx.emit_progress()
            if ctx.stop_requested():
                logger.debug("scan_library: stop requested during books scan.")
                return True

            relative_path = os.path.relpath(filepath, ctx.library_path)

            logger.debug(
                f"Scanning book ({ctx.scanned['books']}/{ctx.totals['books']}): {filepath}"
            )
            logger.debug(f"DB: querying existing book '{filepath}'")
            try:
                existing = _run_with_timeout(
                    lambda fp=filepath: session.query(Book).filter_by(filepath=fp).first(),
                    _DB_TIMEOUT,
                    f"query book '{filepath}'",
                )
            except TimeoutError as e:
                logger.error(f"DB hang: {e} — skipping '{filename}'")
                stats["errors"] += 1
                continue

            book, needs_thumbnail, needs_page_count = _register_book(
                ctx,
                existing,
                system,
                system_name,
                system_category_off,
                is_special_collection,
                root,
                filename,
                filepath,
                relative_path,
                ext,
                arc_ext,
                system_depth,
            )
            if book is None:
                continue

            thumb_path = ctx.thumb_path("books", book.title, filepath)
            if needs_thumbnail:
                _do_book_thumbnail(ctx, book, filepath, filename, thumb_path)
            if needs_page_count:
                _do_book_page_count(ctx, book, filepath, filename)
    return False


def _derive_category(
    system_category_off: bool,
    is_special_collection: bool,
    relative_path: str,
    system_depth: int,
) -> str:
    """The category slug for a book, given how its owning system infers them."""
    if system_category_off:
        return UNCATEGORIZED
    if is_special_collection:
        return agnostic_category(relative_path)
    return guess_category(relative_path, system_depth)


def _refresh_signature(ctx: _ScanContext, record: Any, filepath: str) -> tuple[bool, bool]:
    """Update ``record``'s stat signature/hash. Returns ``(contents_changed, wrote)``.

    The cheap gate that keeps rescans affordable. When ``(mtime, size)`` still
    matches what we stored, this returns immediately having read no file content
    and written nothing — the common case for every file in the library on every
    scan, and the reason a rescan stays as fast as it is today.

    Only a stat mismatch (or a row that has never been hashed) triggers a read, and
    only a *differing digest* counts as a change: a touched-but-identical file, or a
    network mount reporting a coarse mtime, costs one hash and nothing more.

    A first-time backfill reports ``changed=False``. Rows created before content
    hashing existed have no stored digest, and treating that as a change would
    re-render the entire library on the first scan after upgrading.
    """
    signature = file_signature(filepath)
    if signature is None:
        return False, False
    mtime, size = signature
    if signature_matches(record, mtime, size):
        return False, False

    new_hash = hash_file(filepath, should_stop=ctx.should_stop)
    changed = changed_content(record, new_hash)
    apply_signature(record, mtime, size, new_hash)
    return changed, True


def _handle_replaced_book(ctx: _ScanContext, book: Book, filepath: str, filename: str) -> None:
    """Reset a book whose file was replaced in place so the scan rebuilds it.

    Everything derived from the old bytes is dropped (page renders, open handle,
    search rows, thumbnail), then the completeness flags the scan keys off are
    cleared so the normal thumbnail / page-count / indexing phases regenerate it.
    Without the reset the file would keep its stale page count and cover, because
    those phases only run when their flag says the work is outstanding.
    """
    from ..services.content_cache import invalidate_book_content

    logger.info(f"Contents changed on disk, re-indexing: {filename}")
    thumb_path = ctx.thumb_path("books", book.title, filepath) if book.has_thumbnail else None
    invalidate_book_content(book.id, filepath, db=ctx.session, thumb_path=thumb_path)

    book.has_thumbnail = False
    book.page_count = 0
    book.indexed = False
    book.index_failed = False
    book.index_error = ""
    book.scan_failed = False
    book.ocr_pending = False
    book.ocr_pages_done = 0
    ctx.stats["replaced_books"] = ctx.stats.get("replaced_books", 0) + 1


def _register_book(
    ctx: _ScanContext,
    existing: Optional[Book],
    system: GameSystem,
    system_name: str,
    system_category_off: bool,
    is_special_collection: bool,
    root: str,
    filename: str,
    filepath: str,
    relative_path: str,
    ext: str,
    arc_ext: str,
    system_depth: int = 2,
) -> tuple[Optional[Book], bool, bool]:
    """Insert or resume a single book row.

    Returns ``(book, needs_thumbnail, needs_page_count)``; ``book`` is None when
    the file should be skipped (already complete, stat failure, or a DB error).
    """
    session = ctx.session
    stats = ctx.stats
    if existing:
        # A book's owning system can change without the file moving: turning a
        # folder into a container (issues #261/#262) re-homes its contents from
        # the container row onto the new per-game child systems. Books are keyed
        # by filepath, so without this they would stay attached to the old system
        # and simply vanish from the UI.
        if existing.game_system_id != system.id:
            logger.info(
                f"Re-homing '{filename}' from its previous system to '{system_name}'"
            )
            existing.game_system_id = system.id
            existing.category = _derive_category(
                system_category_off, is_special_collection, relative_path, system_depth
            )
            try:
                _run_with_timeout(
                    session.commit, _DB_TIMEOUT, f"commit re-home '{filepath}'"
                )
                stats["updated_books"] += 1
            except (TimeoutError, IntegrityError) as e:
                logger.error(f"DB error re-homing '{filename}': {e}")
                session.rollback()
        # Re-apply sidecar metadata to already-indexed books when
        # requested (modes "missing"/"replace") — see _apply_opf_to_book.
        if ctx.metadata_mode in ("missing", "replace"):
            opf_meta = _find_opf_meta(root, filename)
            changed = _apply_opf_to_book(existing, opf_meta, ctx.metadata_mode)
            # OPF ``tags`` are shared tags (issue #235), applied via the service.
            # In "missing" mode only fill when the book has no tags yet.
            opf_tags = opf_meta.get("tags")
            if opf_tags:
                current = tag_service.display_tags_for_resource(session, "book", existing.id)
                if ctx.metadata_mode == "replace" or not current:
                    tag_service.set_resource_tags(session, "book", existing.id, opf_tags)
                    changed = True
            if changed:
                logger.debug(f"Refreshing metadata for '{filename}' (mode={ctx.metadata_mode})")
                try:
                    _run_with_timeout(
                        session.commit,
                        _DB_TIMEOUT,
                        f"commit metadata refresh '{filepath}'",
                    )
                    stats["updated_books"] += 1
                except (TimeoutError, IntegrityError) as e:
                    logger.error(f"DB hang refreshing metadata for '{filename}': {e}")
                    session.rollback()
        # Detect an in-place replacement before the completeness checks below:
        # those only ask whether work is *outstanding*, so a fully-indexed book
        # whose bytes were swapped would otherwise be skipped forever.
        replaced, wrote_signature = _refresh_signature(ctx, existing, filepath)
        if replaced:
            _handle_replaced_book(ctx, existing, filepath, filename)
        if wrote_signature:
            try:
                _run_with_timeout(
                    session.commit, _DB_TIMEOUT, f"commit signature '{filepath}'"
                )
            except (TimeoutError, IntegrityError) as e:
                logger.error(f"DB error saving file signature for '{filename}': {e}")
                session.rollback()

        if existing.scan_failed and not replaced:
            logger.debug(f"Already registered, skipping: {filename}")
            return None, False, False
        # Archives are opaque: only comic-book variants get a
        # cover thumbnail, and none carry a page count.
        thumbnailable = ext in IMAGE_EXTS or ext == ".pdf" or arc_ext in _COMIC_ARCHIVE_EXTS
        needs_thumbnail = thumbnailable and not existing.has_thumbnail
        needs_page_count = ext == ".pdf" and existing.page_count == 0 and not existing.index_error
        if ext in IMAGE_EXTS and existing.page_count == 0:
            existing.page_count = 1
        if not needs_thumbnail and not needs_page_count:
            logger.debug(f"Already registered, skipping: {filename}")
            return None, False, False
        logger.debug(f"Resuming incomplete scan for: {filename}")
        return existing, needs_thumbnail, needs_page_count

    category = _derive_category(
        system_category_off, is_special_collection, relative_path, system_depth
    )
    title = _title_from_filename(filename)

    signature = file_signature(filepath)
    if signature is None:
        logger.warning(f"Cannot stat file, skipping: {filepath}")
        return None, False, False
    file_mtime, file_size = signature
    # Hash new files once, here. This is the only unconditional read, and it pays
    # for both halves of the feature: later scans compare against it to spot an
    # in-place replacement, and _reconcile_missing matches on it to recognise a
    # file that was moved rather than deleted (issue #284).
    content_hash = hash_file(filepath, should_stop=ctx.should_stop)

    # Check sibling <stem>.opf first, then Calibre's metadata.opf in the same dir.
    opf_meta = _find_opf_meta(root, filename)
    if opf_meta:
        logger.debug(f"Applying OPF metadata to '{filename}'")

    book = Book(
        game_system_id=system.id,
        title=opf_meta.get("title", title),
        filename=filename,
        filepath=filepath,
        relative_path=relative_path,
        category=category,
        file_size=file_size,
        file_mtime=file_mtime,
        content_hash=content_hash,
        mime_type=(
            "application/pdf"
            if ext == ".pdf"
            else archive_mime(arc_ext)
            if arc_ext
            else f"image/{ext[1:]}"
        ),
        authors=opf_meta.get("authors"),
        description=opf_meta.get("description"),
        publisher=opf_meta.get("publisher"),
        year=opf_meta.get("year"),
    )

    # Commit the book record first so that if a subsequent
    # hang kills the worker, the file is already in the DB and
    # won't be re-processed on the next startup scan.
    session.add(book)
    logger.debug(f"DB: committing new book '{filename}'")
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit book '{filepath}'")
        ctx.inserted_ids.add(book.id)
        # OPF ``subjects`` become shared tags on the book (issue #235).
        opf_tags = opf_meta.get("tags")
        if opf_tags:
            tag_service.set_resource_tags(session, "book", book.id, opf_tags)
            session.commit()
        stats["new_books"] += 1
        logger.info(f"Added book: {title} ({category}) in {system_name}")
    except TimeoutError as e:
        logger.error(f"DB hang: {e} — rolling back '{filename}'")
        session.rollback()
        stats["errors"] += 1
        return None, False, False
    except IntegrityError:
        session.rollback()
        logger.debug(f"Book already exists, skipping: {filepath}")
        return None, False, False
    # Archives are opaque: only comic-book variants get a
    # cover thumbnail, and none carry a page count.
    needs_thumbnail = ext in IMAGE_EXTS or ext == ".pdf" or arc_ext in _COMIC_ARCHIVE_EXTS
    needs_page_count = ext == ".pdf"
    if ext in IMAGE_EXTS:
        book.page_count = 1
    return book, needs_thumbnail, needs_page_count


def _do_book_thumbnail(
    ctx: _ScanContext, book: Book, filepath: str, filename: str, thumb_path: str
) -> None:
    session = ctx.session
    # Set scan_failed before the potentially-hanging operation.
    # If the worker is killed mid-hang this flag persists, preventing
    # the file from being retried on the next scan. A clean cancel
    # clears it below so the file is resumed normally next time.
    book.scan_failed = True
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit scan_failed '{filepath}'")
    except (TimeoutError, IntegrityError) as e:
        logger.error(f"DB hang writing scan_failed for '{filename}': {e}")
        session.rollback()
    logger.debug(f"Generating thumbnail: {filepath}")
    if indexer.generate_thumbnail(filepath, thumb_path, should_stop=ctx.should_stop):
        book.has_thumbnail = True
    if ctx.stop_requested():
        # Cancelled — clear the flag so the file is resumed next scan.
        book.scan_failed = False
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit thumbnail '{filepath}'")
    except (TimeoutError, IntegrityError) as e:
        logger.error(f"DB hang saving thumbnail for '{filename}': {e}")
        session.rollback()


def _do_book_page_count(ctx: _ScanContext, book: Book, filepath: str, filename: str) -> None:
    session = ctx.session
    stats = ctx.stats
    if not book.scan_failed:
        book.scan_failed = True
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit scan_failed '{filepath}'")
        except (TimeoutError, IntegrityError) as e:
            logger.error(f"DB hang writing scan_failed for '{filename}': {e}")
            session.rollback()
    logger.debug(f"Opening PDF for page count: {filepath}")
    try:
        doc = indexer._fitz_open_with_timeout(filepath, should_stop=ctx.should_stop)
        book.page_count = len(doc)
        doc.close()
        logger.debug(f"Page count: {book.page_count} pages in '{filename}'")
        book.scan_failed = False
        _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit page_count '{filepath}'")
    except Exception as e:
        if ctx.stop_requested():
            # Cancelled — clear the flag so the file is resumed next scan.
            book.scan_failed = False
        else:
            logger.error(f"Could not read page count for '{filename}': {e}")
            book.index_error = str(e)[:500]
            stats["errors"] += 1
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit scan_failed '{filepath}'")
        except (TimeoutError, IntegrityError) as e2:
            logger.error(f"DB hang saving index_error for '{filename}': {e2}")
            session.rollback()


def _scan_media(
    ctx: _ScanContext,
    walk_dir: Path,
    section: str,
    exts: set,
    model: Any,
    thumb_size: tuple,
) -> None:
    """Shared walk for maps and tokens (image files → thumbnailed records).

    Archives (zip/rar/7z/tar) are registered too (issue #250) — map packs and art
    collections are often distributed zipped alongside supplementary files. They
    are opaque: no thumbnail is generated, since there is no image to render.

    Returns early if a stop is requested mid-walk.
    """
    session = ctx.session
    ignore = ctx.ignore
    stats = ctx.stats
    for root, dirs, files in os.walk(walk_dir):
        dirs[:] = _prune_dirs(root, dirs, ignore)

        for filename in sorted(files):
            if filename.startswith("."):
                continue

            filepath = os.path.join(root, filename)
            ext = Path(filename).suffix.lower()
            # archive_ext handles two-part suffixes (.tar.gz) that Path.suffix
            # cannot, so match on it rather than on `ext`.
            arc_ext = archive_ext(filename)

            if ext not in exts and arc_ext not in MEDIA_ARCHIVE_EXTS:
                continue

            if ignore.is_ignored(filepath, is_dir=False):
                logger.debug(f"Ignored by .grimoireignore: {filepath}")
                continue

            ctx.scanned[section] += 1
            ctx.emit_progress()
            if ctx.stop_requested():
                logger.debug(f"scan_library: stop requested during {section} scan.")
                return

            relative_path = os.path.relpath(filepath, ctx.library_path)
            singular = section[:-1]

            logger.debug(
                f"Scanning {singular} ({ctx.scanned[section]}/{ctx.totals[section]}): {filepath}"
            )
            logger.debug(f"DB: querying existing {singular} '{filepath}'")
            try:
                existing = _run_with_timeout(
                    lambda fp=filepath: session.query(model).filter_by(filepath=fp).first(),
                    _DB_TIMEOUT,
                    f"query {singular} '{filepath}'",
                )
            except TimeoutError as e:
                logger.error(f"DB hang: {e} — skipping '{filename}'")
                stats["errors"] += 1
                continue
            if existing:
                logger.debug(f"Already registered, skipping: {filename}")
                continue

            title = _title_from_filename(filename)

            signature = file_signature(filepath)
            if signature is None:
                logger.warning(f"Cannot stat file, skipping: {filepath}")
                continue
            file_mtime, file_size = signature

            record = model(
                filename=filename,
                filepath=filepath,
                relative_path=relative_path,
                file_size=file_size,
                file_mtime=file_mtime,
                # Hashed once on insert so a later move of this file is
                # recognised rather than read as a delete plus an add.
                content_hash=hash_file(filepath, should_stop=ctx.should_stop),
            )

            # Archives are opaque blobs — nothing to render a thumbnail from.
            if not arc_ext:
                thumb_path = ctx.thumb_path(section, title, filepath)
                logger.debug(f"Generating thumbnail: {filepath}")
                if indexer.generate_thumbnail(
                    filepath, thumb_path, size=thumb_size, should_stop=ctx.should_stop
                ):
                    record.has_thumbnail = True

            session.add(record)
            logger.debug(f"DB: committing new {singular} '{filename}'")
            try:
                _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit {singular} '{filepath}'")
                ctx.inserted_ids.add(record.id)
                stats[f"new_{section}"] += 1
                logger.info(f"Added {singular}: {title}")
            except TimeoutError as e:
                logger.error(f"DB hang: {e} — rolling back '{filename}'")
                session.rollback()
                stats["errors"] += 1
            except IntegrityError:
                session.rollback()
                logger.debug(f"{singular.capitalize()} already exists, skipping: {filepath}")


def _scan_audio(ctx: _ScanContext, walk_dir: Path) -> None:
    """Walk the audio tree, registering tracks with their metadata and artwork flag."""
    session = ctx.session
    ignore = ctx.ignore
    stats = ctx.stats
    for root, dirs, files in os.walk(walk_dir):
        dirs[:] = _prune_dirs(root, dirs, ignore)

        for filename in sorted(files):
            if filename.startswith("."):
                continue

            filepath = os.path.join(root, filename)
            ext = Path(filename).suffix.lower()
            arc_ext = archive_ext(filename)

            if ext not in AUDIO_EXTS and arc_ext not in MEDIA_ARCHIVE_EXTS:
                continue

            if ignore.is_ignored(filepath, is_dir=False):
                logger.debug(f"Ignored by .grimoireignore: {filepath}")
                continue

            ctx.scanned["audio"] += 1
            ctx.emit_progress()
            if ctx.stop_requested():
                logger.debug("scan_library: stop requested during audio scan.")
                return

            relative_path = os.path.relpath(filepath, ctx.library_path)

            logger.debug(
                f"Scanning audio ({ctx.scanned['audio']}/{ctx.totals['audio']}): {filepath}"
            )
            logger.debug(f"DB: querying existing audio '{filepath}'")
            try:
                existing = _run_with_timeout(
                    lambda fp=filepath: session.query(Audio).filter_by(filepath=fp).first(),
                    _DB_TIMEOUT,
                    f"query audio '{filepath}'",
                )
            except TimeoutError as e:
                logger.error(f"DB hang: {e} — skipping '{filename}'")
                stats["errors"] += 1
                continue
            if existing:
                logger.debug(f"Already registered, skipping: {filename}")
                continue

            signature = file_signature(filepath)
            if signature is None:
                logger.warning(f"Cannot stat file, skipping: {filepath}")
                continue
            file_mtime, file_size = signature

            # Archives carry no tags/duration and no embedded art (issue #250):
            # register them as opaque, downloadable items with empty metadata.
            if arc_ext:
                meta = {"duration": 0.0, "title": "", "artist": "", "album": "", "embedded_art": None}
                has_artwork = False
            else:
                meta = _read_audio_metadata(filepath)
                has_artwork = bool(meta["embedded_art"]) or _find_folder_artwork(root) is not None

            track = Audio(
                filename=filename,
                filepath=filepath,
                relative_path=relative_path,
                file_size=file_size,
                file_mtime=file_mtime,
                # Hashed once on insert — see the note in _scan_media.
                content_hash=hash_file(filepath, should_stop=ctx.should_stop),
                duration=meta["duration"],
                title=meta["title"],
                artist=meta["artist"],
                album=meta["album"],
                has_artwork=has_artwork,
            )

            session.add(track)
            logger.debug(f"DB: committing new audio '{filename}'")
            try:
                _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit audio '{filepath}'")
                ctx.inserted_ids.add(track.id)
                stats["new_audio"] += 1
                logger.info(f"Added audio: {meta['title'] or filename}")
            except TimeoutError as e:
                logger.error(f"DB hang: {e} — rolling back '{filename}'")
                session.rollback()
                stats["errors"] += 1
            except IntegrityError:
                session.rollback()
                logger.debug(f"Audio already exists, skipping: {filepath}")


def _detect_moves(ctx: _ScanContext, model: Any, gone: list, present: list) -> int:
    """Re-point rows whose file moved instead of leaving them missing (issue #284).

    Without this a move reads as a delete plus an insert: the old row is flagged
    ``is_missing`` and a brand-new row appears at the new path, silently dropping
    the tags, favorites, bookmarks, and read progress attached to the old row's id.
    Matching on content hash recovers the connection — same bytes, new location.

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
                    "Ambiguous move for hash %s (%d gone, %d found) — leaving as-is",
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
            old.has_thumbnail = False

        logger.info(f"Detected move: '{old.filepath}' -> '{new.filepath}'")
        # Carry the new location onto the *old* row so its id — and everything
        # referencing it — survives. ``filepath`` is UNIQUE, so the duplicate the
        # walk inserted has to be deleted and flushed *before* the old row can
        # take its path, or the UPDATE trips the constraint.
        new_filepath, new_filename = new.filepath, new.filename
        new_relative, new_system = new.relative_path, getattr(new, "game_system_id", None)
        new_category = getattr(new, "category", None)
        session.delete(new)
        session.flush()

        old.filepath = new_filepath
        old.filename = new_filename
        old.relative_path = new_relative
        old.is_missing = False
        if model is Book:
            old.game_system_id = new_system
            old.category = new_category
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
        logger.error(f"DB hang: {e} — skipping system pruning")
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
                "metadata — leaving it in place"
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
            f"Recognised {total_moved} moved file(s) — kept their tags, favorites, "
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
            _count_eligible_files(books_walk_dir, DOC_EXTS | IMAGE_EXTS | ARCHIVE_EXTS, ignore)
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
