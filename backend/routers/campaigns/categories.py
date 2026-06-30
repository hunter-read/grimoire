"""GM-defined categories for grouping linked resources.

Categories are scoped to a campaign and a `kind`. Today only "resource" is
created — wiki pages nest under parent pages instead of using flat note
categories (see WikiPage.parent_id), so "note" is no longer a creatable kind.
The note branches below remain for the one-time migration window and for any
legacy rows that predate the conversion. Only the campaign owner manages
categories. Deleting one either leaves its items uncategorized
(mode="uncategorize") or removes them (mode="delete_items").
"""

from fastapi import Depends, HTTPException, Query

from ...auth import CurrentUser, get_current_user
from ...config import SessionLocal
from ...models import CampaignCategory, CampaignResource, WikiPage, WikiPageLink
from ._helpers import assert_can_manage, can_view, get_campaign_or_404
from ._schemas import (
    CategoryCreate,
    CategoryReorder,
    CategoryUpdate,
    ResourceGroupOrder,
)

_KINDS = ("note", "resource")
_TYPE_GROUP_KEYS = ("type:book", "type:map", "type:token", "type:audio", "type:file")


def _serialize(cat: CampaignCategory) -> dict:
    return {
        "id": cat.id,
        "name": cat.name,
        "kind": cat.kind,
        "icon": cat.icon,
        "sort_order": cat.sort_order,
    }


def list_categories(
    campaign_id: str,
    kind: str = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        if not can_view(c, current_user, db):
            raise HTTPException(403, "Not a member of this campaign")
        q = db.query(CampaignCategory).filter_by(campaign_id=campaign_id)
        if kind:
            if kind not in _KINDS:
                raise HTTPException(400, "Invalid kind")
            q = q.filter_by(kind=kind)
        cats = q.order_by(CampaignCategory.sort_order, CampaignCategory.name).all()
        return [_serialize(cat) for cat in cats]
    finally:
        db.close()


def create_category(
    campaign_id: str,
    data: CategoryCreate,
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user, db)
        if data.kind not in _KINDS:
            raise HTTPException(400, "Invalid kind")
        if data.kind == "note":
            # Wiki pages now nest under parent pages; note categories are retired.
            raise HTTPException(400, "Note categories are no longer supported; nest pages instead")
        name = data.name.strip()
        if not name:
            raise HTTPException(400, "Category name is required")

        # Append to the end of its kind's order.
        max_order = (
            db.query(CampaignCategory)
            .filter_by(campaign_id=campaign_id, kind=data.kind)
            .count()
        )
        cat = CampaignCategory(
            campaign_id=campaign_id,
            kind=data.kind,
            name=name,
            icon=(data.icon or None),
            sort_order=max_order,
        )
        db.add(cat)
        db.commit()
        db.refresh(cat)
        return _serialize(cat)
    finally:
        db.close()


def update_category(
    campaign_id: str,
    category_id: str,
    data: CategoryUpdate,
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user, db)
        cat = (
            db.query(CampaignCategory)
            .filter_by(id=category_id, campaign_id=campaign_id)
            .first()
        )
        if not cat:
            raise HTTPException(404, "Category not found")
        if data.name is not None:
            name = data.name.strip()
            if not name:
                raise HTTPException(400, "Category name is required")
            cat.name = name
        if data.icon is not None:
            cat.icon = data.icon or None
        db.commit()
        return _serialize(cat)
    finally:
        db.close()


def reorder_categories(
    campaign_id: str,
    data: CategoryReorder,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Apply a new sort order from an ordered list of category ids (a single kind)."""
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user, db)
        cats = {
            cat.id: cat
            for cat in db.query(CampaignCategory).filter_by(campaign_id=campaign_id).all()
        }
        order = 0
        for cid in data.ordered_ids:
            cat = cats.get(cid)
            if cat:
                cat.sort_order = order
                order += 1
        db.commit()
        return {"ok": True}
    finally:
        db.close()


def set_resource_group_order(
    campaign_id: str,
    data: ResourceGroupOrder,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Persist the display order of the resource panel's groups.

    Accepts an ordered list of group keys mixing the built-in type groups
    ("type:book" etc.) with resource categories ("cat:<id>"). Unknown keys and
    type-group keys are stored verbatim so the order survives; category keys are
    validated against this campaign's resource categories and silently dropped if
    they no longer exist.
    """
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user, db)
        valid_cat_ids = {
            cat.id
            for cat in db.query(CampaignCategory)
            .filter_by(campaign_id=campaign_id, kind="resource")
            .all()
        }
        cleaned = []
        seen = set()
        for key in data.ordered_keys:
            if key in seen:
                continue
            if key in _TYPE_GROUP_KEYS:
                cleaned.append(key)
                seen.add(key)
            elif key.startswith("cat:") and key[4:] in valid_cat_ids:
                cleaned.append(key)
                seen.add(key)
        c.resource_group_order = cleaned
        db.commit()
        return {"ok": True, "resource_group_order": cleaned}
    finally:
        db.close()


def delete_category(
    campaign_id: str,
    category_id: str,
    mode: str = Query("uncategorize"),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Delete a category. mode: 'uncategorize' (default) or 'delete_items'.

    delete_items removes the contained items: wiki pages are deleted (with their
    link rows), resources are unlinked from the campaign (library content is
    untouched).
    """
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user, db)
        cat = (
            db.query(CampaignCategory)
            .filter_by(id=category_id, campaign_id=campaign_id)
            .first()
        )
        if not cat:
            return
        if mode not in ("uncategorize", "delete_items"):
            raise HTTPException(400, "Invalid mode")

        if cat.kind == "note":
            pages = db.query(WikiPage).filter_by(campaign_id=campaign_id, category_id=cat.id).all()
            if mode == "delete_items":
                page_ids = [p.id for p in pages]
                if page_ids:
                    db.query(WikiPageLink).filter(
                        (WikiPageLink.source_page_id.in_(page_ids))
                        | (WikiPageLink.target_page_id.in_(page_ids))
                    ).delete(synchronize_session=False)
                for p in pages:
                    db.delete(p)
            else:
                for p in pages:
                    p.category_id = None
        else:  # resource
            resources = (
                db.query(CampaignResource)
                .filter_by(campaign_id=campaign_id, category_id=cat.id)
                .all()
            )
            if mode == "delete_items":
                for r in resources:
                    db.delete(r)
            else:
                for r in resources:
                    r.category_id = None

        # Flush item changes first so no row still references the category when
        # SQLite enforces the foreign key on the category delete.
        db.flush()
        db.delete(cat)
        db.commit()
    finally:
        db.close()
