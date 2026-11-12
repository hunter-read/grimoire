"""Folding an old ``shared-library`` child system into its container.

Before ``shared-library/`` was reserved as a container's own shelf (issue #446)
the folder scanned as a child system like any other. The scan now re-homes its
books onto the container row and the emptied row is pruned. What an admin set on
that old row has to follow the books: its access level, and the grants that
opened it to particular users.
"""
import logging
import os
from pathlib import Path
from typing import Optional

from ._context import _ScanContext
from .systems import _resolve_system_folder
from ..models import Book, FolderAccessRule, GameSystem, UserAccessGrant
from ..models.access import RESTRICTED_LEVELS, SCOPE_SYSTEM, most_restrictive, rank

logger = logging.getLogger("grimoire.indexer")


def _old_system(
    ctx: _ScanContext, container: GameSystem, shared_dir: Path, slug_prefix: str
) -> Optional[GameSystem]:
    """The child system an earlier release made for ``shared_dir``, if it has books."""
    slug = _resolve_system_folder(shared_dir, slug_prefix=slug_prefix).slug
    session = ctx.session
    old: Optional[GameSystem] = (
        session.query(GameSystem).filter_by(slug=slug, parent_id=container.id).first()
    )
    if old is None:
        return None
    # Once its books have moved there is nothing left to carry, so a row kept
    # for its description or a campaign does not re-apply its level every scan.
    if session.query(Book.id).filter(Book.game_system_id == old.id).first() is None:
        return None
    return old


def _keep_level(ctx: _ScanContext, old: GameSystem, shared_dir: Path) -> None:
    """Hold the shelf's books to ``old``'s level with a folder rule on the shelf."""
    level = old.access_level or ""
    if level not in RESTRICTED_LEVELS:
        return
    rel = os.path.relpath(shared_dir, ctx.library_path).replace(os.sep, "/")
    session = ctx.session
    rule = session.query(FolderAccessRule).filter_by(path=rel).first()
    if rule is None:
        session.add(FolderAccessRule(path=rel, level=level))
    else:
        rule.level = most_restrictive(rule.level, level)
    logger.info(
        f"System '{old.name}' is now its container's shared shelf: "
        f"its access level ({level}) is kept as a folder restriction on '{rel}'"
    )


def _move_grants(ctx: _ScanContext, old: GameSystem, container: GameSystem) -> None:
    """Re-point ``old``'s system grants at ``container``, which now holds its books."""
    session = ctx.session
    held = {
        g.user_id: g
        for g in session.query(UserAccessGrant).filter_by(
            scope_type=SCOPE_SYSTEM, scope_id=container.id
        )
    }
    grants = (
        session.query(UserAccessGrant).filter_by(scope_type=SCOPE_SYSTEM, scope_id=old.id).all()
    )
    for grant in grants:
        keeper = held.get(grant.user_id)
        if keeper is None:
            grant.scope_id = container.id
            held[grant.user_id] = grant
            continue
        # A user granted on both keeps the grant that reaches more.
        if rank(grant.level) > rank(keeper.level):
            keeper.level = grant.level
        session.delete(grant)
    if grants:
        logger.info(
            f"Moved {len(grants)} access grant(s) from '{old.name}' to '{container.name}'"
        )


def carry_old_system_access(
    ctx: _ScanContext, container: GameSystem, shared_dir: Path, slug_prefix: str
) -> None:
    """Carry an old shared-library system's access settings onto the shelf.

    Called before the shelf's books are re-homed, and flushed with them: the
    rule is in place by the time a book stops answering to the old row.
    """
    old = _old_system(ctx, container, shared_dir, slug_prefix)
    if old is None:
        return
    _keep_level(ctx, old, shared_dir)
    _move_grants(ctx, old, container)
    ctx.session.flush()
