"""Linked-resource endpoint handlers: list, add, update, reorder, remove.

A resource links a campaign to a library item (book/map/token) or a GM-uploaded
campaign file. Visibility is one of:
  public  — every accepted member sees it
  private — only the GM and the users in the resource's shares see it
  gm      — only the GM (owner) sees it
Within a category (or built-in type group) resources keep a manual sort_order.
"""

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import (
    Audio,
    Book,
    CampaignFile,
    CampaignResource,
    CampaignResourceShare,
    GenericMap,
    Token,
)
from ._helpers import (
    assert_can_manage,
    can_see_resource as _can_see_resource,
    can_view,
    get_campaign_or_404,
)
from ._schemas import ResourceAdd, ResourceBulkAdd, ResourceReorder, ResourceUpdate

_VISIBILITIES = ("public", "private", "gm")
_VIS_ORDER = {"public": 0, "private": 1, "gm": 2}


def _resource_meta(db, rtype: str, rid: str):
    """Return (name, has_thumbnail, is_image) for a linked resource of any type.

    is_image is True only for campaign-file resources that hold an image upload —
    those render inline (with a thumbnail) instead of as a download card.
    """
    if rtype == "book":
        obj = db.query(Book).filter_by(id=rid).first()
        return (obj.title, obj.has_thumbnail, False) if obj else (rid, False, False)
    if rtype == "map":
        obj = db.query(GenericMap).filter_by(id=rid).first()
        return (obj.filename, obj.has_thumbnail, False) if obj else (rid, False, False)
    if rtype == "token":
        obj = db.query(Token).filter_by(id=rid).first()
        return (obj.filename, obj.has_thumbnail, False) if obj else (rid, False, False)
    if rtype == "audio":
        obj = db.query(Audio).filter_by(id=rid).first()
        return (obj.title or obj.filename, bool(obj.has_artwork), False) if obj else (rid, False, False)
    if rtype == "file":
        obj = db.query(CampaignFile).filter_by(id=rid).first()
        if not obj:
            return (rid, False, False)
        # An image file is its own thumbnail (served via the file endpoint).
        return (obj.filename, bool(obj.is_image), bool(obj.is_image))
    return (rid, False, False)


def _resolve_category(db, campaign_id: str, category_id):
    from ...models import CampaignCategory

    if category_id in (None, ""):
        return None
    cat = (
        db.query(CampaignCategory)
        .filter_by(id=category_id, campaign_id=campaign_id, kind="resource")
        .first()
    )
    if not cat:
        raise HTTPException(400, "Invalid category")
    return cat.id


def _serialize(db, r: CampaignResource, share_map=None, include_shares=False) -> dict:
    name, has_thumb, is_image = _resource_meta(db, r.resource_type, r.resource_id)
    out = {
        "id": r.id,
        "resource_type": r.resource_type,
        "resource_id": r.resource_id,
        "name": name,
        "has_thumbnail": has_thumb,
        "is_image": is_image,
        "visibility": r.visibility,
        "category_id": r.category_id,
        "sort_order": r.sort_order,
    }
    if include_shares:
        ids = share_map.get(r.id) if share_map is not None else None
        if ids is None:
            ids = {
                s.user_id
                for s in db.query(CampaignResourceShare).filter_by(resource_id=r.id).all()
            }
        out["shared_user_ids"] = sorted(ids)
    return out


def _apply_shares(db, resource_id: str, user_ids) -> None:
    db.query(CampaignResourceShare).filter_by(resource_id=resource_id).delete()
    for uid in set(user_ids or []):
        db.add(CampaignResourceShare(resource_id=resource_id, user_id=uid))


def list_resources(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")

    is_owner = c.owner_id == current_user.id
    resources = db.query(CampaignResource).filter_by(campaign_id=campaign_id).all()

    # Pre-load shares for private resources in one pass.
    share_map = {}
    for s in (
        db.query(CampaignResourceShare)
        .filter(
            CampaignResourceShare.resource_id.in_([r.id for r in resources] or [""])
        )
        .all()
    ):
        share_map.setdefault(s.resource_id, set()).add(s.user_id)

    out = [
        _serialize(db, r, share_map, include_shares=is_owner)
        for r in resources
        if _can_see_resource(r, is_owner, current_user.id, share_map)
    ]
    # Order: public, then private, then gm; then by manual sort_order, then name.
    out.sort(key=lambda d: (_VIS_ORDER.get(d["visibility"], 9), d["sort_order"], d["name"].lower()))
    return out


def add_resource(
    campaign_id: str, data: ResourceAdd, current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    if data.resource_type not in ("book", "map", "token", "audio", "file"):
        raise HTTPException(400, "Invalid resource_type")

    existing = (
        db.query(CampaignResource)
        .filter_by(
            campaign_id=campaign_id,
            resource_type=data.resource_type,
            resource_id=data.resource_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(409, "Resource already linked")

    visibility = data.visibility if data.visibility in _VISIBILITIES else "gm"
    category_id = _resolve_category(db, campaign_id, data.category_id)
    max_order = (
        db.query(CampaignResource).filter_by(campaign_id=campaign_id).count()
    )
    res = CampaignResource(
        campaign_id=campaign_id,
        resource_type=data.resource_type,
        resource_id=data.resource_id,
        visibility=visibility,
        category_id=category_id,
        sort_order=max_order,
    )
    db.add(res)
    db.flush()
    if visibility == "private":
        _apply_shares(db, res.id, data.shared_user_ids)
    db.commit()
    db.refresh(res)
    return _serialize(db, res, include_shares=True)


def bulk_add_resources(
    campaign_id: str,
    data: ResourceBulkAdd,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Link many resources at once. Duplicates and unknown types are skipped
    silently so one bad entry doesn't fail the whole batch. Returns the rows
    that were actually created."""
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)

    existing_keys = {
        (r.resource_type, r.resource_id)
        for r in db.query(CampaignResource).filter_by(campaign_id=campaign_id).all()
    }
    order = len(existing_keys)
    created = []
    for item in data.resources:
        if item.resource_type not in ("book", "map", "token", "audio", "file"):
            continue
        key = (item.resource_type, item.resource_id)
        if key in existing_keys:
            continue
        existing_keys.add(key)
        visibility = item.visibility if item.visibility in _VISIBILITIES else "gm"
        res = CampaignResource(
            campaign_id=campaign_id,
            resource_type=item.resource_type,
            resource_id=item.resource_id,
            visibility=visibility,
            category_id=_resolve_category(db, campaign_id, item.category_id),
            sort_order=order,
        )
        order += 1
        db.add(res)
        db.flush()
        if visibility == "private":
            _apply_shares(db, res.id, item.shared_user_ids)
        created.append(res)

    db.commit()
    return [_serialize(db, r, include_shares=True) for r in created]


def update_resource(
    campaign_id: str,
    resource_id: str,
    data: ResourceUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    res = db.query(CampaignResource).filter_by(id=resource_id, campaign_id=campaign_id).first()
    if not res:
        raise HTTPException(404, "Resource not found")

    if data.visibility is not None:
        if data.visibility not in _VISIBILITIES:
            raise HTTPException(400, "Invalid visibility")
        res.visibility = data.visibility
    if data.category_id is not None:
        res.category_id = _resolve_category(db, campaign_id, data.category_id)
    if data.shared_user_ids is not None:
        _apply_shares(db, res.id, data.shared_user_ids)
    # Shares only matter for private visibility; clear them otherwise.
    if res.visibility != "private":
        db.query(CampaignResourceShare).filter_by(resource_id=res.id).delete()

    db.commit()
    db.refresh(res)
    return _serialize(db, res, include_shares=True)


def reorder_resources(
    campaign_id: str,
    data: ResourceReorder,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Apply a new manual order from an ordered list of resource ids."""
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    by_id = {
        r.id: r
        for r in db.query(CampaignResource).filter_by(campaign_id=campaign_id).all()
    }
    order = 0
    for rid in data.ordered_ids:
        r = by_id.get(rid)
        if r:
            r.sort_order = order
            order += 1
    db.commit()
    return {"ok": True}


def remove_resource(
    campaign_id: str, resource_id: str, current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    res = db.query(CampaignResource).filter_by(id=resource_id, campaign_id=campaign_id).first()
    if res:
        # If this links a campaign-uploaded file, remove the file too.
        if res.resource_type == "file":
            _delete_campaign_file(db, campaign_id, res.resource_id)
        db.delete(res)
        db.commit()


def _delete_campaign_file(db, campaign_id: str, file_id: str) -> None:
    import os

    from ...config import CAMPAIGN_UPLOAD_DIR, logger

    f = db.query(CampaignFile).filter_by(id=file_id, campaign_id=campaign_id).first()
    if not f:
        return
    path = os.path.join(CAMPAIGN_UPLOAD_DIR, "files", f.stored_path)
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError as e:
        # DB row is still deleted below; a leftover file on disk is not fatal but
        # is logged so it can be cleaned up manually.
        logger.warning("Failed to remove campaign file %s: %s", path, e)
    db.delete(f)
