"""Tag queries that span resources: liveness filtering and usage counts.

Split out of the former single-module ``tag_service`` (issue #235). A tag's
links can outlive the items they point at (a deleted book leaves its
``ResourceTag`` row behind until a prune), so these helpers resolve which links
still refer to something real before counting or listing them.
"""
from __future__ import annotations

from typing import Optional

from typing import Any

from sqlalchemy import exists, func
from sqlalchemy.orm import Session

from .. import variants
from ...models.collections import COLLECTIONS
from ...models import GameSystem, ResourceTag, Tag
from ._catalog import normalize_internal, tag_dict


def _resource_model(resource_type: str) -> tuple[Any, bool]:
    """``(model, has_variants)`` for a tag's resource type, or ``(None, False)``."""
    spec = COLLECTIONS.get(resource_type)
    if spec is not None:
        return spec.model, True
    if resource_type == "system":
        return GameSystem, False
    return None, False


def _taggable_types() -> list[str]:
    return [*COLLECTIONS, "system"]


def live_links(db: Session, resource_type: str) -> Any:
    """A query over ``resource_type``'s links whose resource is live and shows.

    Selects whole rows; callers narrow it with ``with_entities`` (the tag ids,
    the resource ids, a count). The existence check is what drops links to
    deleted rows, and the parent filter what drops hidden variant children: the
    population :func:`live_resource_ids` describes, resolved in SQL rather than
    by intersecting id sets in Python (issue #221).

    ``EXISTS`` rather than a join on purpose. SQLite plans the join by scanning
    the resource table and probing the links, which reads every row of a
    187k-token table; the correlated form walks the links and checks each
    against the narrow ``(id, variant_parent_id)`` index instead - about
    fifteen times faster. ``None`` for a type with no table.
    """
    model, has_variants = _resource_model(resource_type)
    if model is None:
        return None
    live = exists().where(model.id == ResourceTag.resource_id)
    if has_variants:
        live = live.where(variants.parent_filter(model))
    return db.query(ResourceTag).filter(ResourceTag.resource_type == resource_type, live)


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
    refs: list[dict] = []
    for rtype in [resource_type] if resource_type else _taggable_types():
        q = live_links(db, rtype)
        if q is None:
            continue
        rows = q.filter(ResourceTag.tag_id == tag.id).with_entities(ResourceTag.resource_id)
        refs.extend({"resource_type": rtype, "resource_id": rid} for (rid,) in rows)
    return refs


def live_link_counts(
    db: Session, resource_type: Optional[str] = None
) -> dict[str, int]:
    """``{tag_id: live link count}`` — links whose resource still exists and shows.

    Deliberately not ``COUNT(*)`` over ``resource_tags``. That is what the count
    used to be, and because the join table carries no foreign key it counted rows
    whose resource had been deleted or hidden behind a variant parent, while
    ``/items`` resolved the same links against the resource tables and dropped
    them. The two answers came from two different populations; issue #445 is that
    gap. Both now read :func:`live_links`, which is what closes it.

    One grouped query per resource type, joined in SQL. This used to fetch every
    link and every resource id into Python and intersect them, which on a
    library of a few hundred thousand files cost seconds per tag listing
    (issue #221).
    """
    counts: dict[str, int] = {}
    for rtype in [resource_type] if resource_type else _taggable_types():
        q = live_links(db, rtype)
        if q is None:
            continue
        rows = q.with_entities(ResourceTag.tag_id, func.count()).group_by(ResourceTag.tag_id)
        for tag_id, n in rows:
            counts[tag_id] = counts.get(tag_id, 0) + n
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
