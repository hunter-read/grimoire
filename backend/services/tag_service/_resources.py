"""Per-resource tag reads and writes (books, maps, tokens, audio, models).

Split out of the former single-module ``tag_service`` (issue #235). These are
the ``ResourceTag`` link-table operations: setting, adding, and reading the tags
attached to one item or a batch of items.
"""
from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.orm import Session

from ...models import RESOURCE_TYPES, ResourceTag, Tag
from ._catalog import get_or_create_tag, normalize_internal, tag_dict


def set_resource_tags(
    db: Session, resource_type: str, resource_id: str, raw_tags: Iterable[str]
) -> list[dict]:
    """Replace all tags on a resource with the given list, returning the new set.

    Input strings are normalised and de-duplicated by internal key. Tags not in
    the new list are unlinked from this resource (orphaned tag rows are left for
    :func:`prune_orphan_tags` / the tags page to clean up). Order of the returned
    list follows first-seen order of the input.
    """
    if resource_type not in RESOURCE_TYPES:
        raise ValueError(f"Unknown resource_type: {resource_type!r}")

    seen: set[str] = set()
    resolved: list[Tag] = []
    for raw in raw_tags or []:
        internal = normalize_internal(raw)
        if not internal or internal in seen:
            continue
        seen.add(internal)
        # The category this tag is being used in is the resource type; a new tag
        # takes it, an existing one may be promoted to shared.
        tag = get_or_create_tag(db, raw, category=resource_type)
        if tag is not None:
            resolved.append(tag)

    # Remove links no longer present.
    db.query(ResourceTag).filter(
        ResourceTag.resource_type == resource_type,
        ResourceTag.resource_id == resource_id,
    ).delete(synchronize_session=False)

    for tag in resolved:
        db.add(
            ResourceTag(
                tag_id=tag.id,
                resource_type=resource_type,
                resource_id=resource_id,
            )
        )
    db.flush()
    return [tag_dict(t) for t in resolved]


def add_resource_tags(
    db: Session, resource_type: str, resource_id: str, raw_tags: Iterable[str]
) -> list[dict]:
    """Add tags to a resource **without removing** any it already has.

    Used by ``tags.json`` application (the library is read-only, so ``tags.json``
    is an additive input): a new tag creates its catalog row with the entered
    casing; an existing tag keeps its display and is linked if not already. Never
    unlinks. Returns the tags added this call (skipping ones already present).
    """
    if resource_type not in RESOURCE_TYPES:
        raise ValueError(f"Unknown resource_type: {resource_type!r}")

    existing = {
        r.tag_id
        for r in db.query(ResourceTag.tag_id).filter(
            ResourceTag.resource_type == resource_type,
            ResourceTag.resource_id == resource_id,
        )
    }
    seen: set[str] = set()
    added: list[Tag] = []
    for raw in raw_tags or []:
        internal = normalize_internal(raw)
        if not internal or internal in seen:
            continue
        seen.add(internal)
        tag = get_or_create_tag(db, raw, category=resource_type)
        if tag is None or tag.id in existing:
            continue
        db.add(
            ResourceTag(
                tag_id=tag.id,
                resource_type=resource_type,
                resource_id=resource_id,
            )
        )
        existing.add(tag.id)
        added.append(tag)
    db.flush()
    return [tag_dict(t) for t in added]


def sync_tags_from_payload(
    db: Session, resource_type: str, resource_id: str, payload: dict
) -> Optional[list[dict]]:
    """If ``payload`` carries a ``tags`` key, mirror it into the join table.

    Used by resource update handlers that apply a ``model_dump`` payload: they
    still ``setattr`` the legacy JSON column, and this keeps the shared-tag tables
    in lock-step (dual-write during the parallel-run period). Returns the new tag
    list when tags were present, else ``None`` (nothing to do).
    """
    if "tags" not in payload:
        return None
    return set_resource_tags(db, resource_type, resource_id, payload.get("tags") or [])


def tags_for_resource(db: Session, resource_type: str, resource_id: str) -> list[dict]:
    """All tags on one resource, sorted by display value (case-insensitive)."""
    rows = (
        db.query(Tag)
        .join(ResourceTag, ResourceTag.tag_id == Tag.id)
        .filter(
            ResourceTag.resource_type == resource_type,
            ResourceTag.resource_id == resource_id,
        )
        .all()
    )
    rows.sort(key=lambda t: t.display.lower())
    return [tag_dict(t) for t in rows]


def tags_for_resources(
    db: Session, resource_type: str, resource_ids: list[str]
) -> dict[str, list[dict]]:
    """Batch variant of :func:`tags_for_resource`, keyed by resource id.

    Ids with no tags are omitted; callers should default to ``[]``.
    """
    if not resource_ids:
        return {}
    rows = (
        db.query(ResourceTag.resource_id, Tag)
        .join(Tag, ResourceTag.tag_id == Tag.id)
        .filter(
            ResourceTag.resource_type == resource_type,
            ResourceTag.resource_id.in_(resource_ids),
        )
        .all()
    )
    out: dict[str, list[Tag]] = {}
    for rid, tag in rows:
        out.setdefault(rid, []).append(tag)
    result: dict[str, list[dict]] = {}
    for rid, tags in out.items():
        tags.sort(key=lambda t: t.display.lower())
        result[rid] = [tag_dict(t) for t in tags]
    return result


def display_tags_for_resource(db: Session, resource_type: str, resource_id: str) -> list[str]:
    """A resource's tags as display strings, sorted case-insensitively.

    This is the read used by API responses (which expose ``tags`` as a plain
    string list); it sources tags from the shared-tag tables rather than the
    legacy JSON column.
    """
    return [t["display"] for t in tags_for_resource(db, resource_type, resource_id)]


def display_tags_for_resources(
    db: Session, resource_type: str, resource_ids: list[str]
) -> dict[str, list[str]]:
    """Batch variant of :func:`display_tags_for_resource`, keyed by resource id.

    Every requested id is present in the result (empty list when untagged), so
    callers can index directly without a fallback.
    """
    enriched = tags_for_resources(db, resource_type, resource_ids)
    return {rid: [t["display"] for t in enriched.get(rid, [])] for rid in resource_ids}
