"""Tags API endpoint handlers (issue #235).

The tags page and cross-resource tag features read from the shared-tag tables via
``tag_service``. Listing and per-tag item views are readable by any authenticated
user (explicit items are filtered per-user); mutations require gm/admin.
"""
from typing import Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_gm_or_admin
from ...config import get_db
from ...models import RESOURCE_TYPES, Favorite, ResourceTag, Tag
from ...services import tag_service
from ._helpers import can_see_explicit, enrich_tagged_items
from ._schemas import TagCreate, TagDisplayUpdate, TagMerge


def _merge_folder_tags(db: Session, shared: list[dict], in_use_by: Optional[str]) -> list[dict]:
    """Fold folder-derived tags into a shared-tag listing, keyed by internal.

    A tag present in both keeps its shared display and sums the two counts
    (folder items not already carrying the shared tag add to the total); a
    folder-only tag is added with its resolved item count. A tag's ``category``
    is its *effective* category: the stored ``Tag.category`` reconciled with the
    resource types of any folders carrying it, so e.g. a tag on a book (direct)
    and a map folder resolves to ``shared``. Result is sorted by display,
    case-insensitively.
    """
    # Resolve folder tags across all types (unscoped), so a tag's effective
    # category reflects every type it appears on even when the listing itself is
    # scoped to one page.
    folder = tag_service.folder_tags_in_use(db)
    folder_types: dict[str, set[str]] = {
        internal: {r["resource_type"] for r in info["refs"]}
        for internal, info in folder.items()
    }
    # Folder refs to fold into counts respect the page scope (in_use_by).
    scoped_folder = (
        folder if in_use_by is None else tag_service.folder_tags_in_use(db, in_use_by)
    )

    by_internal = {t["internal"]: dict(t) for t in shared}
    for entry in by_internal.values():
        entry["category"] = tag_service.effective_category(
            entry.get("category"), folder_types.get(entry["internal"], set())
        )
        if entry["internal"] in scoped_folder:
            entry["count"] += len(scoped_folder[entry["internal"]]["refs"])
    for internal, info in scoped_folder.items():
        if internal in by_internal:
            continue
        # A folder-only tag has no shared-tag row; its category is derived purely
        # from the folder resource types it appears on.
        by_internal[internal] = {
            "internal": internal,
            "display": info["display"],
            "category": tag_service.effective_category(None, folder_types.get(internal, set())),
            "count": len(info["refs"]),
        }
    return sorted(by_internal.values(), key=lambda t: t["display"].lower())


def list_tags(
    in_use_by: Optional[str] = Query(
        None,
        description=(
            "Restrict to tags used on this resource type (system|book|map|token|audio); "
            "each result carries a usage count. Omit for all tags."
        ),
    ),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """All tags, or (with ``in_use_by``) just those used on a resource type.

    Folder-derived tags (from ``tags.json``/folder tagging) are merged in and
    counted by the items they cover, so they appear in the tags view alongside
    shared item tags. Each tag carries ``is_favorite`` for the current user.
    """
    if in_use_by is not None and in_use_by not in RESOURCE_TYPES:
        raise HTTPException(400, f"in_use_by must be one of: {', '.join(sorted(RESOURCE_TYPES))}")

    if in_use_by is not None:
        shared = tag_service.tags_in_use(db, in_use_by)
    else:
        # All shared tags (used or not), with usage counts.
        counts = {
            row[0]: row[1]
            for row in db.query(ResourceTag.tag_id, func.count(ResourceTag.id))
            .group_by(ResourceTag.tag_id)
            .all()
        }
        shared = [
            {
                "internal": t.internal,
                "display": t.display,
                "category": t.category,
                "count": counts.get(t.id, 0),
            }
            for t in db.query(Tag).all()
        ]

    merged = _merge_folder_tags(db, shared, in_use_by)
    fav = {
        r.item_id
        for r in db.query(Favorite).filter_by(user_id=user.id, item_type="tag").all()
    }
    for tg in merged:
        tg["is_favorite"] = tg["internal"] in fav
    return {"tags": merged}


def tag_items(
    internal: str,
    resource_type: Optional[str] = Query(
        None, description="Restrict returned items to this resource type."
    ),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every item carrying the given tag, enriched like the favorites view.

    Includes items that carry the tag directly (shared tag) and items that
    inherit it from a folder tag (``tags.json``/folder tagging).
    """
    if resource_type is not None and resource_type not in RESOURCE_TYPES:
        raise HTTPException(
            400, f"resource_type must be one of: {', '.join(sorted(RESOURCE_TYPES))}"
        )
    key = tag_service.normalize_internal(internal)
    tag = db.query(Tag).filter(Tag.internal == key).first()
    see_explicit = can_see_explicit(db, user.id)

    # Directly-tagged items (shared tag). Folder-derived items are shown as folder
    # groups below rather than mixed into the flat item list.
    direct_refs = tag_service.resources_for_tag(db, internal, resource_type=resource_type)

    # Folders carrying the tag, each rendered with everything inside (issue #235
    # follow-up: show the folder like the media pages do).
    folder_groups = tag_service.folders_for_tag(db, key, resource_type=resource_type)

    if tag is None and not folder_groups and not direct_refs:
        raise HTTPException(404, "Tag not found")

    display = tag.display if tag is not None else key
    if display == key:
        # Folder-only tag: use the folder's display casing when available.
        fmeta = tag_service.folder_tags_in_use(db, resource_type).get(key)
        if fmeta:
            display = fmeta["display"]

    # Effective category: reconcile the stored category (direct usage) with every
    # media-folder type the tag appears on (folder tags never promote the stored
    # row), so e.g. a book tag also on a map folder resolves to shared.
    folder_types = {g["resource_type"] for g in tag_service.folders_for_tag(db, key)}
    category = tag_service.effective_category(
        tag.category if tag is not None else None, folder_types
    )

    items = enrich_tagged_items(db, direct_refs, see_explicit=see_explicit)
    folders = [
        {
            "resource_type": g["resource_type"],
            "path": g["path"],
            "items": enrich_tagged_items(db, g["items"], see_explicit=see_explicit),
        }
        for g in folder_groups
    ]
    return {
        "internal": key,
        "display": display,
        "category": category,
        "items": items,
        "folders": folders,
    }


def create_tag(
    body: TagCreate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Create a tag up-front (idempotent by internal key)."""
    tag = tag_service.get_or_create_tag(db, body.value, display=body.display)
    if tag is None:
        raise HTTPException(400, "Tag value must not be blank")
    db.commit()
    return {"internal": tag.internal, "display": tag.display, "category": tag.category}


def update_tag_display(
    internal: str,
    body: TagDisplayUpdate,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Rename a tag. Its ``internal`` match key follows the new display when the
    normalized form changes (so a typo fix like ``freinds`` → ``friends`` also
    fixes search-by-internal); if that key already exists, the tags are merged."""
    if not body.display.strip():
        raise HTTPException(400, "display must not be blank")
    tag = tag_service.rename_tag(db, internal, body.display)
    if tag is None:
        raise HTTPException(404, "Tag not found")
    db.commit()
    return {"internal": tag.internal, "display": tag.display}


def merge_tag(
    internal: str,
    body: TagMerge,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Merge this tag into another: re-point all links, then delete this tag."""
    src = db.query(Tag).filter(Tag.internal == tag_service.normalize_internal(internal)).first()
    if src is None:
        raise HTTPException(404, "Tag not found")
    dst = tag_service.get_or_create_tag(db, body.into)
    if dst is None:
        raise HTTPException(400, "Merge target must not be blank")
    if dst.id == src.id:
        raise HTTPException(400, "Cannot merge a tag into itself")

    # Re-point every link from src → dst, skipping ones that would duplicate.
    existing = {
        (r.resource_type, r.resource_id)
        for r in db.query(ResourceTag).filter(ResourceTag.tag_id == dst.id)
    }
    for link in db.query(ResourceTag).filter(ResourceTag.tag_id == src.id).all():
        if (link.resource_type, link.resource_id) in existing:
            db.delete(link)
        else:
            link.tag_id = dst.id
    db.query(Tag).filter(Tag.id == src.id).delete(synchronize_session=False)
    db.commit()
    return {"internal": dst.internal, "display": dst.display}


def delete_tag(
    internal: str,
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Delete a tag: unlink it from every resource and strip it from any folder
    tags. Folder-derived tags (no shared-tag row) are still handled — their folder
    associations are removed (a rescan may reapply them from ``tags.json``)."""
    key = tag_service.normalize_internal(internal)
    tag = db.query(Tag).filter(Tag.internal == key).first()
    folders_changed = tag_service.remove_tag_from_folders(db, key)
    if tag is None and folders_changed == 0:
        raise HTTPException(404, "Tag not found")
    if tag is not None:
        db.query(ResourceTag).filter(ResourceTag.tag_id == tag.id).delete(
            synchronize_session=False
        )
        db.query(Tag).filter(Tag.id == tag.id).delete(synchronize_session=False)
    db.commit()
