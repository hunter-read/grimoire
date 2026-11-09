"""Folder access rules: restricting every book beneath a library folder (issue #772).

A rule names a folder on disk (``books/D&D 5e/Core/GM``) and a restricted level.
Every book beneath that folder resolves to at least that level, so a GM's guide
filed with a system's core books can be kept from players without restricting
the whole core category. ``access_control`` folds the rules into its cascade;
this module only loads, matches and maintains them.

**Only ever stricter.** A book under several rules (a rule on the system folder
and another on a shelf inside it) takes the strictest, and the result combines
with the system and category tiers the same way. The one thing that overrides a
folder rule is the book's own level, which is how a single handout inside a
GM-only folder is still shared with the table.

This module imports only models, so ``library_fs`` can call it to carry rules
along on a folder rename without importing anything that imports it back.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from ..models import FolderAccessRule
from ..models.access import LEVEL_OPEN, RESTRICTED_LEVELS, most_restrictive
from ..models.game_types import ARMORY_FOLDER_NAMES
from ..sql_paths import path_at_or_under

# The collections holding books, matched on the first path segment the way
# ``library_fs.collection_of`` does: case-insensitively, with the British armory.
_SECTIONS = frozenset({"books", *ARMORY_FOLDER_NAMES})


class FolderAccessError(ValueError):
    """A folder rule was refused. Routers map this to a 400."""


def normalise_path(raw: str) -> str:
    """A folder path as rules store it: forward slashes, no leading or trailing one."""
    parts = [p for p in (raw or "").replace("\\", "/").split("/") if p and p != "."]
    if ".." in parts:
        raise FolderAccessError("A folder path cannot contain '..'.")
    return "/".join(parts)


def validate(path: str, level: str) -> tuple[str, str]:
    """The ``(path, level)`` to store for an incoming rule, or ``FolderAccessError``.

    The path must be a folder *inside* ``books/`` or the armory: a rule on the
    collection itself would restrict the whole library, which is what a system's
    or category's own level is for.
    """
    clean = normalise_path(path)
    parts = clean.split("/")
    if len(parts) < 2 or parts[0].lower() not in _SECTIONS:
        raise FolderAccessError("Folder restrictions apply to folders inside books/ or armory/.")
    if level not in RESTRICTED_LEVELS:
        raise FolderAccessError(f"invalid access level: {level!r}")
    return clean, level


@dataclass(frozen=True)
class FolderRules:
    """Every folder rule, loaded once and matched in memory.

    The table holds one row per restricted folder - a handful, not thousands - so
    a list view loads it up front instead of querying per book.
    """

    rules: tuple[tuple[str, str], ...] = ()

    def level_for(self, relative_path: Optional[str]) -> str:
        """The strictest rule covering the book at ``relative_path``, else open."""
        rel = (relative_path or "").replace("\\", "/")
        if not rel:
            return LEVEL_OPEN
        return most_restrictive(
            *(level for path, level in self.rules if rel.startswith(path + "/"))
        )

    def paths_at(self, levels: set[str] | list[str]) -> list[str]:
        """The folders whose rule sets one of ``levels``."""
        return [path for path, level in self.rules if level in levels]

    def __bool__(self) -> bool:
        return bool(self.rules)


def load(db: Session) -> FolderRules:
    """Every stored rule. A row holding anything but a restricted level is skipped."""
    rows = db.query(FolderAccessRule.path, FolderAccessRule.level).all()
    return FolderRules(
        tuple((path, level) for path, level in rows if path and level in RESTRICTED_LEVELS)
    )


def relink_rules(db: Session, src_rel: str, dest_rel: str) -> int:
    """Carry rules on ``src_rel`` and beneath it onto ``dest_rel``.

    Called when the file manager renames or moves a folder. A rule left on the
    old path would silently stop applying - the folder's books opening up to
    everyone - so it travels with the folder. When the destination already has
    a rule of its own, the stricter of the two is kept.
    """
    src_rel, dest_rel = normalise_path(src_rel), normalise_path(dest_rel)
    if not src_rel or src_rel == dest_rel:
        return 0
    rows = (
        db.query(FolderAccessRule)
        .filter(path_at_or_under(FolderAccessRule.path, src_rel))
        .all()
    )
    taken = {r.path: r for r in db.query(FolderAccessRule).all()}
    changed = 0
    for row in rows:
        new_path = dest_rel + row.path[len(src_rel):]
        existing = taken.get(new_path)
        if existing is not None and existing is not row:
            existing.level = most_restrictive(existing.level, row.level)
            db.delete(row)
        else:
            row.path = new_path
        changed += 1
    return changed


def purge_rules(db: Session, rel: str) -> int:
    """Drop the rules on a deleted folder and everything beneath it."""
    rel = normalise_path(rel)
    if not rel:
        return 0
    return (
        db.query(FolderAccessRule)
        .filter(path_at_or_under(FolderAccessRule.path, rel))
        .delete(synchronize_session=False)
    )
