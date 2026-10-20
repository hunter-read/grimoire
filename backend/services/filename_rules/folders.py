"""Which naming pattern applies to a book, and keeping rules attached to folders.

A rule belongs to a folder and covers everything beneath it, with the nearest
folder winning: a pattern on ``books/D&D 5e`` names the whole system, and one on
``books/D&D 5e/Adventures`` overrides it for that shelf alone. That mirrors how
people actually name files - one scheme per collection, with the odd shelf that
came from somewhere else.

This module imports only models, so ``library_fs`` can call it to carry rules
along on a folder rename without importing anything that imports it back.
"""
import logging
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from ...models import FolderNamingRule
from .pattern import Pattern, PatternError, parse

logger = logging.getLogger("grimoire.filename_rules")

# Naming patterns describe books - their title, publisher and version are what a
# pattern reads and writes, and no other collection has those columns.
SECTION = "books"


def normalise_path(raw: str) -> str:
    """A folder path as rules store it: forward slashes, no leading or trailing one."""
    parts = [p for p in (raw or "").replace("\\", "/").split("/") if p and p != "."]
    if ".." in parts:
        raise PatternError("A folder path cannot contain '..'.")
    return "/".join(parts)


def in_section(path: str) -> bool:
    """Whether ``path`` names the books collection or a folder inside it."""
    return path == SECTION or path.startswith(SECTION + "/")


def _covers(folder: str, relative_path: str) -> bool:
    return relative_path.startswith(folder + "/")


@dataclass(frozen=True)
class FolderRule:
    path: str
    pattern: Pattern


class RuleSet:
    """Every folder rule, loaded once and matched in memory.

    The table holds one row per configured folder - a handful, not thousands -
    so a scan loads it up front instead of querying per book.
    """

    def __init__(self, rules: list[FolderRule]) -> None:
        # Deepest first, so the first covering rule is the nearest one.
        self.rules = sorted(rules, key=lambda r: r.path.count("/"), reverse=True)

    def for_book(self, relative_path: str) -> Optional[FolderRule]:
        """The rule nearest ``relative_path``'s folder, or None."""
        rel = (relative_path or "").replace("\\", "/")
        for rule in self.rules:
            if _covers(rule.path, rel):
                return rule
        return None

    def __bool__(self) -> bool:
        return bool(self.rules)


def rule_set(db: Session) -> RuleSet:
    """Load every rule. A stored pattern that no longer parses is skipped, not fatal."""
    rules: list[FolderRule] = []
    for row in db.query(FolderNamingRule).all():
        try:
            rules.append(FolderRule(row.path, parse(row.pattern)))
        except PatternError as e:
            logger.warning("Ignoring the naming pattern on '%s': %s", row.path, e)
    return RuleSet(rules)


def read_filename(rules: RuleSet, relative_path: str, filename: str) -> dict:
    """The fields the applicable pattern reads out of ``filename``; empty for none."""
    rule = rules.for_book(relative_path)
    if rule is None:
        return {}
    return rule.pattern.read(filename) or {}


def relink_rules(db: Session, src_rel: str, dest_rel: str) -> int:
    """Carry rules on ``src_rel`` and beneath it onto ``dest_rel``.

    Called when the file manager renames or moves a folder. A rule left on the
    old path would silently stop applying, and a rule already on the
    destination wins over the one arriving - it is what the admin set there.
    """
    src_rel, dest_rel = normalise_path(src_rel), normalise_path(dest_rel)
    if not src_rel or src_rel == dest_rel:
        return 0
    rows = (
        db.query(FolderNamingRule)
        .filter((FolderNamingRule.path == src_rel) | FolderNamingRule.path.startswith(src_rel + "/", autoescape=True))
        .all()
    )
    taken = {r.path for r in db.query(FolderNamingRule.path).all()}
    changed = 0
    for row in rows:
        new_path = dest_rel + row.path[len(src_rel) :]
        if new_path in taken:
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
        db.query(FolderNamingRule)
        .filter((FolderNamingRule.path == rel) | FolderNamingRule.path.startswith(rel + "/", autoescape=True))
        .delete(synchronize_session=False)
    )
