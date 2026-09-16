"""Tag administration: metadata, rename/merge, and orphan pruning.

Split out of the former single-module ``tag_service`` (issue #235). These back
the Tags page's management actions, which rewrite both the catalog and the
folder JSON columns that reference a tag by its internal key.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ...models import SHARED_CATEGORY, BookFolder, ResourceTag, Tag
from ._catalog import (
    _promote_category,
    default_display,
    get_or_create_tag,
    normalize_internal,
)
from ._folders import _FOLDER_SOURCES, folder_tags_in_use, folder_types_for_tag
from ._queries import live_link_counts


def tags_meta_for_internals(db: Session, internals: list[str]) -> dict[str, dict]:
    """Resolve tag internal keys to ``{internal, display, count}`` metadata.

    Used to enrich favorited tags. ``count`` is the number of distinct items the
    tag covers (shared links + folder-derived), matching the tags-view total.
    A favorited tag that no longer exists anywhere is omitted from the result.
    """
    keys = {normalize_internal(i) for i in internals if normalize_internal(i)}
    if not keys:
        return {}

    # Shared tags matching the keys, with their direct link counts.
    shared = {
        t.internal: {"internal": t.internal, "display": t.display, "id": t.id}
        for t in db.query(Tag).filter(Tag.internal.in_(keys)).all()
    }
    link_counts: dict[str, int] = {}
    if shared:
        # The same live-resource resolution the tags view counts with, so a
        # favorited tag does not report a total the tags page disagrees with
        # (issue #445).
        by_tag_id = live_link_counts(db)
        for internal, meta in shared.items():
            count = by_tag_id.get(meta["id"], 0)
            if count:
                link_counts[internal] = count

    # Folder-derived coverage for the same keys.
    folder = folder_tags_in_use(db)

    out: dict[str, dict] = {}
    for key in keys:
        display = None
        count = link_counts.get(key, 0)
        if key in shared:
            display = shared[key]["display"]
        if key in folder:
            display = display or folder[key]["display"]
            count += len(folder[key]["refs"])  # upper bound; folder ∪ shared rarely overlap
        if display is not None:
            out[key] = {"internal": key, "display": display, "count": count}
    return out


def rename_tag(db: Session, internal: str, new_display: str) -> Optional[Tag]:
    """Rename a tag's display value, re-keying its ``internal`` when the new
    display normalizes to a different key (e.g. fixing a typo ``freinds`` →
    ``friends`` so search-by-internal finds it).

    If another tag already owns the new internal key, this tag is merged into it
    (links re-pointed, folder JSON entries rewritten, source row deleted) and the
    surviving tag is returned. Otherwise the same row is updated in place.

    A **folder-only** tag (no ``Tag`` row yet — it exists only in folder JSON) is
    materialised into a catalog row first, so its new display is stored in the DB
    and a ``tags.json`` rescan can't revert it (the library is read-only). Returns
    ``None`` only if ``internal`` resolves to nothing at all. Callers own the
    transaction.
    """
    key = normalize_internal(internal)
    src = db.query(Tag).filter(Tag.internal == key).first()
    if src is None:
        # Folder-only tag: create its catalog row so the rename can persist.
        folder_types = folder_types_for_tag(db, key)
        if not folder_types:
            return None
        category = next(iter(folder_types)) if len(folder_types) == 1 else SHARED_CATEGORY
        src = get_or_create_tag(db, key, category=category)
        if src is None:
            return None
    display = default_display(new_display)
    if not display:
        return src
    new_internal = normalize_internal(display)

    # Same key → just update the display casing (the common rename).
    if new_internal == src.internal:
        src.display = display
        db.flush()
        return src

    # Key changes: fold any media-folder JSON entries onto the new key so folder
    # tags follow the rename too.
    _rekey_folder_tags(db, src.internal, display)

    existing = db.query(Tag).filter(Tag.internal == new_internal).first()
    if existing is None or existing.id == src.id:
        src.internal = new_internal
        src.display = display
        db.flush()
        return src

    # Collision: merge src → existing (re-point links, drop dupes, delete src).
    existing.display = display
    _promote_category(existing, src.category)
    dst_links = {
        (r.resource_type, r.resource_id)
        for r in db.query(ResourceTag).filter(ResourceTag.tag_id == existing.id)
    }
    for link in db.query(ResourceTag).filter(ResourceTag.tag_id == src.id).all():
        if (link.resource_type, link.resource_id) in dst_links:
            db.delete(link)
        else:
            link.tag_id = existing.id
    db.query(Tag).filter(Tag.id == src.id).delete(synchronize_session=False)
    db.flush()
    return existing


def _rekey_folder_tags(db: Session, old_internal: str, new_display: str) -> None:
    """Rewrite media-folder JSON tag entries matching ``old_internal`` to the new
    tag's internal key (folders store internal keys; display lives in the
    catalog), de-duplicating by key within each folder."""
    old_key = normalize_internal(old_internal)
    new_key = normalize_internal(new_display)
    folder_models = [m for m, _i, _r in _FOLDER_SOURCES] + [BookFolder]
    for folder_model in folder_models:
        for folder in db.query(folder_model).all():
            tags = folder.tags or []
            if not any(normalize_internal(raw) == old_key for raw in tags):
                continue
            rebuilt: list[str] = []
            seen: set[str] = set()
            for raw in tags:
                key = new_key if normalize_internal(raw) == old_key else normalize_internal(raw)
                if not key or key in seen:
                    continue
                seen.add(key)
                rebuilt.append(key)
            folder.tags = rebuilt


def prune_orphan_tags(db: Session) -> int:
    """Delete tags with no remaining resource links. Returns the count removed."""
    orphans = (
        db.query(Tag.id)
        .outerjoin(ResourceTag, ResourceTag.tag_id == Tag.id)
        .filter(ResourceTag.id.is_(None))
        .all()
    )
    ids = [row[0] for row in orphans]
    if ids:
        db.query(Tag).filter(Tag.id.in_(ids)).delete(synchronize_session=False)
    return len(ids)
