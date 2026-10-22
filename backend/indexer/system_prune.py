"""Dropping system rows whose folder is gone, and recognising renamed ones.

Split out of ``reconcile.py``. Files get an ``is_missing`` sweep, but a
``GameSystem`` row has no file of its own, so this is its equivalent: after a
full walk of ``books/``, a row the walk never reached has no folder behind it
any more. :func:`_prune_vanished_systems` is gated by its caller on a full,
unscoped books walk, since ``seen_system_ids`` is only populated by that walk.

Two things happen here, in order:

1. **Renames are adopted.** Renaming ``books/Sword World 1/`` to
   ``books/Sword World 1.0/`` makes the walk create a new row for the new name,
   and move detection carries every book across to it. The old row - with the
   description, cover, tags, campaign links, and access grants a user gave it -
   would then sit empty beside the new one (issue #670). When every book an
   unseen row lost went to one row this scan created, that is a rename: the old
   row takes the new folder's identity and the new row is dropped, so the id
   everything points at survives, exactly as a moved book keeps its own.
2. **Vanished rows are pruned**, conservatively - see the function docstring.
"""
import logging
import os
import re
from typing import Any

from ._context import _ScanContext
from ._subprocess import _run_with_timeout
from .constants import _DB_TIMEOUT
from ..models import Book, GameSystem
from ..models.campaigns import Campaign

logger = logging.getLogger("grimoire.indexer")

# What the folder decides about a system: refreshed from the folder on every
# scan by ``_register_system_row``, so an adopted row takes them from the new one.
_FOLDER_FIELDS = (
    "slug",
    "is_explicit",
    "is_system_agnostic",
    "is_one_page",
    "container_kind",
    "parent_id",
    "folder_cover_path",
)
# What a container fills in on its children only while the child has no value of
# its own. The adopted row keeps what it has and takes the rest.
_FILL_FIELDS = ("parent_system", "edition", "system_family", "publishers")


def _unsuffixed_name(session: Any, name: str, slug: str, old: GameSystem) -> str:
    """``name`` without the clash suffix the walk added because ``old`` held it.

    Renaming a collection re-creates the systems on it under new slugs while the
    old rows still hold their names, so the walk registers each as
    ``Game (shelf-press--game)`` (see ``_unique_system_name``). Once the old row
    is adopted the plain name is free again - unless some other system has it.
    """
    match = re.fullmatch(rf"(.*) \({re.escape(slug)}(?:-\d+)?\)", name)
    if match is None:
        return name
    base = match.group(1)
    taken = (
        session.query(GameSystem.id)
        .filter(GameSystem.name == base, GameSystem.id != old.id)
        .first()
    )
    return name if taken else base


def _adopt_rename(ctx: _ScanContext, old: GameSystem, new: GameSystem) -> None:
    """Give ``old`` the folder identity of ``new``, then drop ``new``. Not committed.

    ``new`` was created by this scan, so everything attached to it - its books
    and, for a container, its child systems - arrived with this scan too and
    simply moves across.
    """
    session = ctx.session
    session.query(Book).filter(Book.game_system_id == new.id).update(
        {Book.game_system_id: old.id}, synchronize_session="fetch"
    )
    session.query(GameSystem).filter(GameSystem.parent_id == new.id).update(
        {GameSystem.parent_id: old.id}, synchronize_session="fetch"
    )
    # Both collections cascade ``delete-orphan``: anything still loaded in them
    # would be deleted along with ``new``.
    session.expire(new, ["books", "children"])

    folder = {field: getattr(new, field) for field in _FOLDER_FIELDS}
    fill = {field: getattr(new, field) for field in _FILL_FIELDS}
    name = new.name
    # ``slug`` and ``name`` are unique, so the new row has to be gone first.
    session.delete(new)
    session.flush()

    for field, value in folder.items():
        setattr(old, field, value)
    for field, value in fill.items():
        if value and not getattr(old, field):
            setattr(old, field, value)
    if not old.name_is_custom:
        old.name = _unsuffixed_name(session, name, folder["slug"], old)
    session.flush()

    ctx.seen_system_ids.discard(new.id)
    ctx.created_system_ids.discard(new.id)
    ctx.seen_system_ids.add(old.id)
    logger.info(f"Recognised renamed system folder: '{old.name}' kept its metadata and links")


def _adopt_renamed_systems(ctx: _ScanContext) -> int:
    """Adopt every unambiguous rename (see the module docstring). Commits.

    A pair qualifies when the old row was not walked to, all the books it lost
    to moves went to a single row, that row was created by this scan, and no
    other old row claims the same new one. A container is adopted the same way,
    once its children have been: their former parents are paired with their new
    ones, so renaming ``Sword World (family)`` keeps the shelf along with the
    systems on it.
    """
    session = ctx.session
    adopted = 0
    vacated: dict = {k: set(v) for k, v in ctx.vacated_systems.items()}
    while vacated:
        claims: dict[str, list[str]] = {}
        for old_id, new_ids in vacated.items():
            if old_id in ctx.seen_system_ids or len(new_ids) != 1:
                continue
            new_id = next(iter(new_ids))
            if new_id in ctx.created_system_ids:
                claims.setdefault(new_id, []).append(old_id)

        parents: dict = {}
        for new_id, old_ids in claims.items():
            if len(old_ids) != 1:
                continue
            old, new = session.get(GameSystem, old_ids[0]), session.get(GameSystem, new_id)
            if old is None or new is None:
                continue
            # A book still present under the old row means its folder is not
            # simply renamed - leave the pair to the ordinary prune.
            if (
                session.query(Book.id)
                .filter(Book.game_system_id == old.id, Book.is_missing.isnot(True))
                .first()
            ):
                continue
            old_parent, new_parent = old.parent_id, new.parent_id
            try:
                with session.begin_nested():
                    _adopt_rename(ctx, old, new)
            except Exception as e:  # noqa: BLE001 - one bad pair must not stop the rest
                logger.error(f"Could not carry system '{old.name}' over to its new folder: {e}")
                continue
            adopted += 1
            if old_parent and new_parent and old_parent != new_parent:
                parents.setdefault(old_parent, set()).add(new_parent)
        vacated = parents

    if adopted:
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, "commit renamed systems")
        except (TimeoutError, Exception) as e:
            logger.error(f"DB error saving renamed systems: {e}")
            session.rollback()
            return 0
    return adopted


def _depth(system: GameSystem, by_id: dict) -> int:
    depth, node = 0, system
    while node.parent_id and node.parent_id in by_id and depth < 32:
        depth += 1
        node = by_id[node.parent_id]
    return depth


def _prune_vanished_systems(ctx: _ScanContext) -> int:
    """Delete system rows whose folder is gone or newly ``.grimoireignore``-excluded.

    The reported case that started this is a Synology ``@eaDir`` folder
    registered before its ``.grimoireignore`` rule was added: the rule correctly
    hides the *books*, but the system row it had already created survived every
    rescan (issue #354).

    Renames are adopted first (:func:`_adopt_renamed_systems`). After that a row
    is only dropped when **all** of:

    * this scan never walked to it (so no folder maps to it any more),
    * it owns no present content of any kind, including through child systems,
    * a user has not adapted it (renamed it, or given it a description or
      cover), since that signals a row worth keeping even when the shelf is
      momentarily empty, and
    * no campaign is played in it.

    Its missing books go with it, so their bookmarks, tags, favorites, and
    campaign links are cleared first: ``bookmarks.book_id`` is a foreign key
    with no ``ondelete``, and a single bookmarked missing book used to fail the
    whole prune - every vanished system in the library stayed, on every scan
    (issue #670). Each row is deleted in its own savepoint for the same reason.

    Scoped rescans prune nothing: they only walk one subtree, so every system
    outside it would look unseen.

    Only systems belonging to **this** library are considered. A database can
    outlive the library path pointed at it, or be shared by several libraries
    as the test suite does, and "unseen by this scan" would otherwise mean
    "delete everything the other library owns". A row is in scope when its books
    sit under this library root, or this scan walked to it or moved books out
    of it. That last one is what clears the "0 books" shelf a folder emptied by
    moves used to leave behind (issue #670): once every book had moved away,
    nothing tied the row to this library any more, so it was never pruned.
    """
    if ctx.scope_dir is not None:
        return 0

    _adopt_renamed_systems(ctx)

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

    by_id = {s.id: s for s in systems}
    # Which systems does this library account for? Anchored on absolute book
    # paths, since that is the main link from a system row back to a directory.
    root = os.path.join(os.path.abspath(ctx.library_path), "")
    in_this_library: set = set()
    for system_id, filepath in session.query(Book.game_system_id, Book.filepath).filter(
        Book.game_system_id.isnot(None)
    ):
        if filepath and os.path.abspath(filepath).startswith(root):
            in_this_library.add(system_id)

    # A *container* owns no books of its own — its children do — so the book-path
    # anchor can never place one in this library. A row this scan walked to is
    # self-evidently this library's; so is one it moved books out of.
    in_this_library |= ctx.seen_system_ids & set(by_id)
    in_this_library |= set(ctx.vacated_systems) & set(by_id)
    # Ownership flows *up*: a container belongs to this library when any of its
    # descendants does, so a container is still claimed on the very scan that
    # prunes its children (nothing is deleted until the loop below).
    pending = [s for s in systems if s.id in in_this_library]
    while pending:
        node = pending.pop()
        parent = by_id.get(node.parent_id) if node.parent_id else None
        if parent is not None and parent.id not in in_this_library:
            in_this_library.add(parent.id)
            pending.append(parent)

    # Books are the only collection tied to a system — maps, tokens, and audio
    # are deliberately system-agnostic — so one distinct query covers ownership.
    # Only books still *present* count: a row flagged ``is_missing`` is exactly
    # what the vanished folder leaves behind.
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
    for system in systems:
        if system.id in owning or system.id in ctx.seen_system_ids:
            node = system
            while node.parent_id:
                keep_parents.add(node.parent_id)
                node = by_id.get(node.parent_id)
                if node is None:
                    break

    from ..services.library_fs.references import purge_system_references

    removed = 0
    # Children first, so a container is only considered once its shelf is clear.
    for system in sorted(unseen, key=lambda s: _depth(s, by_id), reverse=True):
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
        if session.query(Campaign.id).filter(Campaign.system_id == system.id).first():
            logger.info(
                f"System '{system.name}' has no folder any more but a campaign is "
                "played in it - leaving it in place"
            )
            continue
        if session.query(GameSystem.id).filter(GameSystem.parent_id == system.id).first():
            # A child that could not be pruned still hangs off it.
            continue
        name = system.name
        try:
            with session.begin_nested():
                purge_system_references(session, system.id)
                session.delete(system)
        except Exception as e:  # noqa: BLE001 - one row must not keep the rest
            logger.error(f"Could not remove system '{name}': {e}")
            continue
        logger.info(f"Removing system '{name}': its folder is gone or now ignored")
        removed += 1

    if removed:
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, "commit system pruning")
        except (TimeoutError, Exception) as e:
            logger.error(f"DB error pruning systems: {e}")
            session.rollback()
            return 0
    return removed
