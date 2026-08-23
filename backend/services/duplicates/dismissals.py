"""Remembering that a user said "these are not duplicates".

Detection is heuristic, so it will keep proposing the same false positive on
every scan unless the answer is stored. Issue #304 calls this out directly: a
library holding deliberate duplicates becomes unusable without it.

The subtlety is *what* to remember. Storing the group and matching it whole
fails in both directions: dismiss {A,B} and a later scan proposing {A,B,C} slips
past the key, while dismissing {A,B,C} leaves a later {A,B} unsuppressed. So a
dismissal is expanded into the **pairs** it rejects, and grouping drops those
edges. Dismissing {A,B} then permanently suppresses that relationship while a
genuinely new copy C still surfaces against both.
"""
import logging
from itertools import combinations
from typing import Any, Iterable, Optional, Sequence

from sqlalchemy.orm import Session

from ...models import Audio, Book, GenericMap, Token
from ...models.duplicates import DuplicateDismissal
from .grouping import group_key

logger = logging.getLogger("grimoire.duplicates")

_MODELS: dict[str, Any] = {
    "book": Book,
    "map": GenericMap,
    "token": Token,
    "audio": Audio,
}


def dismissed_pairs(db: Session, resource_type: str) -> set:
    """Every member pair the user has rejected for this collection."""
    pairs: set = set()
    rows = db.query(DuplicateDismissal).filter_by(resource_type=resource_type).all()
    for row in rows:
        members = list(row.member_ids or [])
        for a, b in combinations(sorted(members), 2):
            pairs.add(frozenset((a, b)))
    return pairs


def dismiss(
    db: Session,
    resource_type: str,
    member_ids: Sequence[str],
    dismissed_by: Optional[str] = None,
    note: str = "",
) -> DuplicateDismissal:
    """Record a "not duplicates" judgement. Does not commit.

    Idempotent on ``(resource_type, group_key)``: dismissing the same group twice
    updates the existing row rather than tripping the unique constraint.
    """
    unique = sorted(set(member_ids))
    key = group_key(unique)
    existing = (
        db.query(DuplicateDismissal)
        .filter_by(resource_type=resource_type, group_key=key)
        .first()
    )
    if existing:
        existing.member_ids = unique
        existing.note = note or existing.note
        return existing

    row = DuplicateDismissal(
        resource_type=resource_type,
        group_key=key,
        member_ids=unique,
        dismissed_by=dismissed_by,
        note=note,
    )
    db.add(row)
    return row


def undismiss(db: Session, dismissal_id: str) -> bool:
    """Forget a dismissal so the group can surface again. Does not commit."""
    row = db.query(DuplicateDismissal).filter_by(id=dismissal_id).first()
    if row is None:
        return False
    db.delete(row)
    return True


def sweep_stale(db: Session) -> int:
    """Drop dismissals whose members no longer all exist. Does not commit.

    A dismissal describes a specific set of rows. Once one is deleted the group
    it described cannot recur, so the row is dead weight - and keeping it would
    let a *recycled* id inherit a judgement made about a different file.
    """
    removed = 0
    for resource_type, model in _MODELS.items():
        rows = db.query(DuplicateDismissal).filter_by(resource_type=resource_type).all()
        if not rows:
            continue
        wanted: set = set()
        for row in rows:
            wanted.update(row.member_ids or [])
        if not wanted:
            continue
        alive = {
            r.id for r in db.query(model.id).filter(model.id.in_(list(wanted))).all()
        }
        for row in rows:
            members = set(row.member_ids or [])
            if not members or not members.issubset(alive):
                db.delete(row)
                removed += 1
    if removed:
        logger.info("Dropped %d stale duplicate dismissal(s)", removed)
    return removed


def list_dismissals(db: Session, resource_type: Optional[str] = None) -> list:
    """Stored dismissals, newest first."""
    query = db.query(DuplicateDismissal)
    if resource_type:
        query = query.filter_by(resource_type=resource_type)
    return query.order_by(DuplicateDismissal.created_at.desc()).all()


def expand_pairs(member_ids: Iterable[str]) -> set:
    """Every unordered pair within a group - the unit dismissal works in."""
    return {frozenset(pair) for pair in combinations(sorted(set(member_ids)), 2)}
