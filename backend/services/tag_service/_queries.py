"""Tag queries that span resources: liveness filtering and usage counts.

Split out of the former single-module ``tag_service`` (issue #235). A tag's
links can outlive the items they point at (a deleted book leaves its
``ResourceTag`` row behind until a prune), so these helpers resolve which links
still refer to something real before counting or listing them.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from .. import variants
from ...models.collections import COLLECTIONS
from ...models import GameSystem, ResourceTag, Tag
from ._catalog import normalize_internal, tag_dict


def live_resource_ids(
    db: Session, resource_type: str, *, parents_only: bool = True
) -> set[str]:
    """Ids of the rows of ``resource_type`` a tag may legitimately count.

    A ``ResourceTag`` carries no foreign key (the discriminator + a bare id), so
    nothing in the schema removes a link when its resource goes away, and the
    cascade behind ``GameSystem.books`` deletes books without ever passing
    through :func:`~backend.services.library_fs.references.purge_references`.
    The result is links that outlive their carrier: issue #445 saw a tag report
    ``count: 1`` while ``/items`` returned nothing at all.

    ``parents_only`` additionally drops variant children, because a tag view is
    a browse surface and every other one — listings, search, the library stats —
    hides a variant behind its parent (``services/variants``). Counting the
    printer-friendly cut separately is what made a broad category tag read 539
    when the shelf holds 331 books.

    Returned as a set for callers to intersect against, so resolving a whole
    listing stays one query per type rather than one per tag.
    """
    spec = COLLECTIONS.get(resource_type)
    if spec is not None:
        q = db.query(spec.model.id)
        if parents_only:
            q = q.filter(variants.parent_filter(spec.model))
        return {row[0] for row in q.all()}
    if resource_type == "system":
        # Systems are not a collection and have no variants.
        return {row[0] for row in db.query(GameSystem.id).all()}
    return set()


def filter_live_refs(
    db: Session, refs: list[dict], *, parents_only: bool = True
) -> list[dict]:
    """Drop refs whose resource row is gone (or is a hidden variant child).

    Shares :func:`live_resource_ids` with the counting path so a tag's ``count``
    and its ``/items`` list can no longer disagree — they are now derived from
    the same population rather than one reading the join table and the other
    reading the resource tables.
    """
    by_type: dict[str, set[str]] = {}
    out: list[dict] = []
    for ref in refs:
        rtype = ref["resource_type"]
        if rtype not in by_type:
            by_type[rtype] = live_resource_ids(db, rtype, parents_only=parents_only)
        if ref["resource_id"] in by_type[rtype]:
            out.append(ref)
    return out


def resources_for_tag(
    db: Session, internal: str, *, resource_type: Optional[str] = None
) -> list[dict]:
    """Every live resource carrying the tag with the given internal key.

    Returns ``[{resource_type, resource_id}]``; optionally filtered to one type.
    Refs whose resource row is gone, and variant children hidden behind a parent,
    are dropped here rather than downstream — so this returns exactly the
    population :func:`live_link_counts` counts.
    """
    tag = db.query(Tag).filter(Tag.internal == normalize_internal(internal)).first()
    if tag is None:
        return []
    q = db.query(ResourceTag).filter(ResourceTag.tag_id == tag.id)
    if resource_type is not None:
        q = q.filter(ResourceTag.resource_type == resource_type)
    refs = [
        {"resource_type": r.resource_type, "resource_id": r.resource_id}
        for r in q.all()
    ]
    return filter_live_refs(db, refs)


def live_link_counts(
    db: Session, resource_type: Optional[str] = None
) -> dict[str, int]:
    """``{tag_id: live link count}`` — links whose resource still exists and shows.

    Deliberately not ``COUNT(*)`` over ``resource_tags``. That is what the count
    used to be, and because the join table carries no foreign key it counted rows
    whose resource had been deleted or hidden behind a variant parent, while
    ``/items`` resolved the same links against the resource tables and dropped
    them. The two answers came from two different populations; issue #445 is that
    gap. Resolving both from :func:`live_resource_ids` is what closes it.

    One query per resource type present, not one per tag, so a library with
    hundreds of tags still costs a handful of queries.
    """
    q = db.query(ResourceTag.tag_id, ResourceTag.resource_type, ResourceTag.resource_id)
    if resource_type is not None:
        q = q.filter(ResourceTag.resource_type == resource_type)

    rows = q.all()
    live_by_type: dict[str, set[str]] = {}
    counts: dict[str, int] = {}
    for tag_id, rtype, rid in rows:
        if rtype not in live_by_type:
            live_by_type[rtype] = live_resource_ids(db, rtype)
        if rid in live_by_type[rtype]:
            counts[tag_id] = counts.get(tag_id, 0) + 1
    return counts


def tags_in_use(db: Session, resource_type: Optional[str] = None) -> list[dict]:
    """Tags that are attached to at least one resource, with a usage count.

    Scoped to ``resource_type`` when given (issue #235.3: only show tags used on
    the current page). Sorted by display value. Each entry adds ``count``.

    "In use" means carried by a resource that still exists and is not a hidden
    variant child, so a tag whose every carrier has been deleted drops out of the
    listing entirely rather than lingering with a count nothing can explain.
    """
    counts = live_link_counts(db, resource_type)
    if not counts:
        return []
    tags = db.query(Tag).filter(Tag.id.in_(list(counts.keys()))).all()
    tags.sort(key=lambda t: t.display.lower())
    return [{**tag_dict(tag), "count": counts[tag.id]} for tag in tags]
