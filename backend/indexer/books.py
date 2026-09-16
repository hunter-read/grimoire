"""Walking ``books/`` and resolving folders to game systems.

This is the deepest of the collection phases, because a books tree is the only
one with structure above the file: containers nest systems, systems hold
category folders, and a container may also hold loose one-page files that each
become their own system. ``_scan_books`` walks the top level, ``_scan_container``
recurses, and ``_scan_books_in_system`` does the per-file work once a folder has
been resolved to a system row.

Registering one book — the insert/update point and its change-detection rules —
lives in ``_book_records.py``; those functions are re-exported here so
``scan.py`` and the tests' patch targets are unchanged.

Patch-safety: ``generate_thumbnail`` and ``_fitz_open_with_timeout`` are stubbed
by tests via ``patch("backend.indexer.…")`` and so are called through the
package namespace (``indexer.NAME``).
"""
import logging
import os
from pathlib import Path
from ._book_records import (  # noqa: F401  (re-exported for patch compatibility)
    _derive_category,
    _do_book_page_count,
    _do_book_thumbnail,
    _handle_replaced_book,
    _refresh_signature,
    _register_book,
)
from ._subprocess import _run_with_timeout
from ._context import _ScanContext, _keep_entry, _prune_dirs, _title_from_filename
from .categories import (
    folder_category_inference_disabled,
    is_special_collection_folder,
    prettify_collection_name,
    slugify,
)
from .constants import (
    CONTAINER_AGNOSTIC,
    CONTAINER_FAMILY,
    CONTAINER_ONE_PAGE,
    CONTAINER_PARENT,
    CONTAINER_PUBLISHER,
    DOC_EXTS,
    IMAGE_EXTS,
    NO_AUTO_CATEGORY_MARKER,
    _DB_TIMEOUT,
)
from .metadata import is_exported_cover_name, is_folder_cover_name, parse_opf_metadata
from .thumbnails import archive_ext
from .systems import _SystemFolder, _register_system, _resolve_system_folder
from ..models import Book, GameSystem

logger = logging.getLogger("grimoire.indexer")


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
        if folder.container_kind and folder.container_kind != CONTAINER_AGNOSTIC:
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
        # names as category labels rather than CATEGORY_MAP inference. The
        # agnostic collection reaches here even though it carries a container
        # kind: unlike every other kind, its subfolders are *categories*
        # ("system-agnostic/maps/" is the maps category), so it is one system
        # holding books rather than a shelf of systems.
        is_special = is_special_collection_folder(folder.name) or (
            folder.container_kind == CONTAINER_AGNOSTIC
        )
        # When scoped to a path deeper than the system dir, walk only that
        # subtree; otherwise walk the whole system.
        walk_root = ctx.scope_dir if scoped else system_dir
        if _scan_books_in_system(
            ctx,
            system,
            folder.name,
            system_category_off,
            is_special,
            walk_root,
            system_root=system_dir,
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
        # The container's own shelf artwork, not a one-page game (issue #372).
        if is_folder_cover_name(path.name):
            continue
        # A cover written by the sidecar exporter is an export artifact, never
        # a game of its own.
        if is_exported_cover_name(path.name):
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
    system_root: Path | None = None,
) -> bool:
    """Walk one system's tree and register its books. Returns True if stop requested.

    ``is_special_collection`` is True for the system-agnostic and one-page
    collections, which label categories by immediate subfolder name.

    ``recurse=False`` limits the walk to files sitting directly in ``walk_root``
    (its subdirectories are separate systems, handled by ``_scan_container``).
    ``only_filename`` further narrows it to a single file, for the one-page
    container's loose-file-as-a-system case. ``system_depth`` tells category
    inference how deep the system root sits (3 for a container's children).

    ``system_root`` is the folder whose ``cover.*``/``folder.*`` image was
    claimed as the system's shelf artwork, so the walk can skip that file rather
    than registering it as a book too (issue #372). It defaults to ``walk_root``
    and only differs when the walk is narrowed to a subtree by a scoped rescan.
    """
    session = ctx.session
    ignore = ctx.ignore
    stats = ctx.stats
    cover_root = os.path.normpath(str(system_root if system_root is not None else walk_root))
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

            # The folder-cover convention claims a cover.*/folder.* image at the
            # system root as shelf artwork; it is not also a book (issue #372).
            if os.path.normpath(root) == cover_root and is_folder_cover_name(filename):
                logger.debug(f"Skipping folder cover image: {filepath}")
                continue

            # A ``<stem>.cover.jpg`` written by the sidecar exporter is not a
            # book. Indexing one would give it an exported cover of its own
            # (``<stem>.cover.cover.jpg``) and each rescan would add a further
            # level without bound.
            if is_exported_cover_name(filename):
                logger.debug(f"Skipping exported sidecar cover: {filepath}")
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
                logger.error(f"DB hang: {e} - skipping '{filename}'")
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
