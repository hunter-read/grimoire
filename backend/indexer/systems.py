"""Resolving books folders into ``GameSystem`` rows.

A folder under ``books/`` is not simply a system: its name encodes an ``(nsfw)``
suffix, an optional container suffix (``(parent-system)``, ``(one-page)``, …),
and a leading sort-order prefix, all of which are peeled off before the row is
matched or created. ``_register_system`` is the single place a system row is
created or re-adopted, so the slug-collision and rename-adoption rules live
together rather than being re-derived at each call site.

"""
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ._context import _ScanContext
from .categories import (
    detect_container_kind,
    has_nsfw_marker,
    is_one_page_folder,
    is_system_agnostic_folder,
    slugify,
    strip_container_suffix,
    strip_sort_prefix,
)
from .constants import (
    CONTAINER_AGNOSTIC,
    CONTAINER_ONE_PAGE,
    _DB_TIMEOUT,
)
from .metadata import _find_folder_artwork
from ._subprocess import _run_with_timeout
from ..models import GameSystem

logger = logging.getLogger("grimoire.indexer")


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
        logger.error(f"DB hang: {e} - cannot adopt system '{name}'")
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
        logger.error(f"DB hang: {e} - using name '{name}' as-is")
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
        logger.error(f"DB hang: {e} - skipping system '{name}'")
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

    # The reserved folder names claim the collection implicitly; the explicit
    # container marker claims it for a folder named anything else. Either way the
    # row is the agnostic collection, so the library shows it in the special
    # strip rather than as an ordinary game system.
    is_agnostic = is_system_agnostic_folder(folder.name) or (
        folder.container_kind == CONTAINER_AGNOSTIC
    )
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
            logger.error(f"DB hang: {e} - skipping system '{name}'")
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

