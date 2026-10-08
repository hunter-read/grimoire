"""The items carrying a tag, a page at a time (issues #235, #221).

The tags view lists everything a tag reaches: the items carrying it directly,
grouped by type, and every folder carrying it with that folder's contents. It
used to return all of it in one response - 28 MB and half a minute for a tag on
every token folder of a 187k-token library. Now the summary (counts per type,
folders with counts) comes first, and each section or folder fetches its items
in pages as it is opened and scrolled.

Visibility is applied in SQL, so the counts match what the user can actually
open: explicit items are dropped for a user who has opted out, and restricted
books and systems for a user without access (issue #258) - which the old
enrichment-only path never did.
"""
from typing import Any, Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import RESOURCE_TYPES, GameSystem, ResourceTag, Tag
from ...models.collections import COLLECTIONS
from ...services import access_control, tag_service, variants
from ._helpers import can_see_explicit, enrich_tagged_items

# The order the tags view presents its sections in.
TYPE_ORDER = ["system", "book", "map", "token", "audio", "model"]


class _Visibility:
    """Per-request visibility rules for one user."""

    def __init__(self, db: Session, user: CurrentUser):
        self.db = db
        self.see_explicit = can_see_explicit(db, user.id)
        self.access_user = access_control.load_user(db, user)

    def model(self, resource_type: str) -> Any:
        if resource_type == "system":
            return GameSystem
        return COLLECTIONS[resource_type].model

    def apply(self, q: Any, resource_type: str) -> Any:
        """Restrict ``q`` (over the type's model) to rows this user may see."""
        model = self.model(resource_type)
        if resource_type != "system":
            q = q.filter(variants.parent_filter(model))
        if not self.see_explicit and hasattr(model, "is_explicit"):
            q = q.filter(model.is_explicit != True)  # noqa: E712
        if resource_type == "book":
            q = access_control.visible_books(self.db, q, self.access_user)
        elif resource_type == "system":
            q = access_control.visible_systems(self.db, q, self.access_user)
        return q

    def order(self, resource_type: str) -> list:
        model = self.model(resource_type)
        if resource_type == "system":
            return [func.lower(model.name), model.id]
        key = model.sort_title if resource_type == "book" else model.sort_name
        return [key, model.id]


def _resolve_tag(db: Session, internal: str) -> tuple[str, Optional[Tag], list]:
    """``(key, tag row or None, folders carrying it)``; 404 when it is nothing."""
    key = tag_service.normalize_internal(internal)
    tag = db.query(Tag).filter(Tag.internal == key).first()
    folders = [f for f in tag_service.tagged_folders(db) if f.carries(key)]
    if tag is None and not folders:
        raise HTTPException(404, "Tag not found")
    return key, tag, folders


def _check_type(resource_type: Optional[str]) -> None:
    if resource_type is not None and resource_type not in RESOURCE_TYPES:
        raise HTTPException(
            400, f"resource_type must be one of: {', '.join(sorted(RESOURCE_TYPES))}"
        )


def _page(q: Any, vis: _Visibility, resource_type: str, limit: int, offset: int) -> list[dict]:
    """One page of ``q``'s ids as enriched display items, in name order."""
    model = vis.model(resource_type)
    ids = [
        row[0]
        for row in q.with_entities(model.id)
        .order_by(*vis.order(resource_type))
        .offset(offset)
        .limit(limit)
    ]
    refs = [{"resource_type": resource_type, "resource_id": rid} for rid in ids]
    return enrich_tagged_items(vis.db, refs, see_explicit=vis.see_explicit)


def tag_items(
    internal: str,
    resource_type: Optional[str] = Query(
        None, description="Restrict the counts, folders and item page to one resource type."
    ),
    limit: int = Query(
        100,
        ge=0,
        le=500,
        description="Directly-tagged items to return; 0 for just the counts and folders.",
    ),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A tag's summary, plus a page of the items carrying it directly.

    ``counts`` is how many items of each type carry the tag directly; ``items``
    pages through them in type order, then name order. ``folders`` lists every
    folder carrying the tag with how many items it holds - the items themselves
    come from ``/folder-items``. Counts and pages respect the caller's
    explicit-content and access settings.
    """
    _check_type(resource_type)
    key, tag, folders = _resolve_tag(db, internal)
    vis = _Visibility(db, user)
    types = [resource_type] if resource_type else TYPE_ORDER

    queries: dict[str, Any] = {}
    counts: dict[str, int] = {}
    if tag is not None:
        for rtype in types:
            model = vis.model(rtype)
            linked = select(ResourceTag.resource_id).where(
                ResourceTag.resource_type == rtype, ResourceTag.tag_id == tag.id
            )
            q = vis.apply(db.query(model).filter(model.id.in_(linked)), rtype)
            n = q.order_by(None).count()
            if n:
                queries[rtype], counts[rtype] = q, n

    # The page runs across the types in order, so offset 120 with 100 books is
    # the 20th map. A client that pages one section passes resource_type.
    items: list[dict] = []
    skip, want = offset, limit
    for rtype in types:
        if want <= 0:
            break
        n = counts.get(rtype, 0)
        if skip >= n:
            skip -= n
            continue
        items.extend(_page(queries[rtype], vis, rtype, want, skip))
        want -= min(want, n - skip)
        skip = 0

    resolver = tag_service.FolderResolver(db)
    groups = []
    for folder in folders:
        if resource_type and folder.resource_type != resource_type:
            continue
        scope = resolver.scope(folder.resource_type, folder.path)
        count = 0
        if scope is not None:
            model, criteria = scope
            q = vis.apply(db.query(model).filter(*criteria), folder.resource_type)
            count = q.order_by(None).count()
        groups.append(
            {
                "resource_type": folder.resource_type,
                "path": folder.display_path,
                "key": folder.path,
                "count": count,
            }
        )
    groups.sort(key=lambda g: (g["resource_type"], g["path"].lower()))

    display = tag.display if tag is not None else key
    if tag is None or display == key:
        # Folder-only tag: the folder JSON's casing (or the catalog's) reads
        # better than the bare key.
        meta = tag_service.folder_tag_counts(db).get(key)
        if meta:
            display = meta["display"]
    # Effective category: the stored category reconciled with every folder type
    # the tag appears on (folder tags never promote the stored row).
    category = tag_service.effective_category(
        tag.category if tag is not None else None, {f.resource_type for f in folders}
    )
    return {
        "internal": key,
        "display": display,
        "category": category,
        "counts": counts,
        "total": sum(counts.values()),
        "items": items,
        "folders": groups,
    }


def tag_folder_items(
    internal: str,
    resource_type: str = Query(..., description="The folder's resource type."),
    folder: str = Query(..., description="The folder's `key` from `/items`."),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A page of everything inside one folder carrying the tag, in name order.

    Lists the folder's whole contents, tagged or not - a folder tag applies to
    everything beneath it - including subfolders.
    """
    _check_type(resource_type)
    _key, _tag, folders = _resolve_tag(db, internal)
    if not any(f.resource_type == resource_type and f.path == folder for f in folders):
        raise HTTPException(404, "That folder does not carry this tag")
    scope = tag_service.FolderResolver(db).scope(resource_type, folder)
    if scope is None:
        return {"total": 0, "items": []}
    vis = _Visibility(db, user)
    model, criteria = scope
    q = vis.apply(db.query(model).filter(*criteria), resource_type)
    return {
        "total": q.order_by(None).count(),
        "items": _page(q, vis, resource_type, limit, offset),
    }
