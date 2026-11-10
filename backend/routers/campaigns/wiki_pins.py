"""Pin endpoint handlers for map pages (issue #578).

Anyone who can edit a map page can add, move, edit and delete its pins - the
same rule as its text. Two things are narrower:

* Only the GM makes a pin GM-only, or makes a GM-only pin visible again. Those
  pins are the GM's to keep, the way ``||secrets||`` are.
* A pin can only be edited by someone who can see it. Anyone else gets a 404,
  so a GM-only pin, or one linking a page they can't read, stays invisible
  rather than turning up as "forbidden".

Visibility rules, serialisation and stub creation live in ``_wiki_maps.py``.
"""

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import WikiMapPin, WikiPage
from ._helpers import get_campaign_or_404
from ._schemas import WikiMapPinCreate, WikiMapPinUpdate
from ._wiki_helpers import _rebuild_link_rows, can_edit_page, can_view_page
from ._wiki_maps import (
    MAP_PAGE_TYPE,
    PIN_VISIBILITIES,
    pin_out,
    pin_visible,
    resolve_pin_target,
)


def _editable_map_page(db: Session, campaign_id: str, page_id: str, user: CurrentUser):
    c = get_campaign_or_404(db, campaign_id)
    page = db.query(WikiPage).filter_by(id=page_id, campaign_id=campaign_id).first()
    if page is None or not can_view_page(page, c, user, db):
        raise HTTPException(404, "Page not found")
    if page.page_type != MAP_PAGE_TYPE:
        raise HTTPException(400, "Only a map page has pins")
    if not can_edit_page(page, c, user, db):
        raise HTTPException(403, "Not authorised to edit this page")
    return c, page


def _check_visibility(c, user: CurrentUser, value: str) -> str:
    if value not in PIN_VISIBILITIES:
        raise HTTPException(400, "Invalid visibility")
    if value == "gm" and c.owner_id != user.id:
        raise HTTPException(403, "Only the GM can make a pin GM-only")
    return value


def _target(db: Session, target_page_id):
    return db.query(WikiPage).filter_by(id=target_page_id).first() if target_page_id else None


def create_pin(
    campaign_id: str,
    page_id: str,
    data: WikiMapPinCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c, page = _editable_map_page(db, campaign_id, page_id, current_user)
    visibility = _check_visibility(c, current_user, data.visibility or "page")
    target_id = resolve_pin_target(
        db, c, page, current_user, data.target_page_id, data.target_title
    )
    pin = WikiMapPin(
        page_id=page.id,
        x=data.x,
        y=data.y,
        label=data.label.strip(),
        target_page_id=target_id,
        icon=data.icon or None,
        icon_color=data.icon_color or None,
        visibility=visibility,
        sort_order=db.query(WikiMapPin).filter_by(page_id=page.id).count(),
        created_by_id=current_user.id,
    )
    db.add(pin)
    db.flush()
    _rebuild_link_rows(db, campaign_id, page)
    db.commit()
    db.refresh(pin)
    return pin_out(pin, _target(db, pin.target_page_id), True)


def _pin_or_404(db: Session, c, page: WikiPage, pin_id: str, user: CurrentUser) -> WikiMapPin:
    pin = db.query(WikiMapPin).filter_by(id=pin_id, page_id=page.id).first()
    if pin is None or not pin_visible(pin, _target(db, pin.target_page_id), c, user, db):
        raise HTTPException(404, "Pin not found")
    return pin


def update_pin(
    campaign_id: str,
    page_id: str,
    pin_id: str,
    data: WikiMapPinUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c, page = _editable_map_page(db, campaign_id, page_id, current_user)
    pin = _pin_or_404(db, c, page, pin_id, current_user)

    if data.x is not None:
        pin.x = data.x
    if data.y is not None:
        pin.y = data.y
    if data.label is not None:
        pin.label = data.label.strip()
    if data.icon is not None:
        pin.icon = data.icon or None
    if data.icon_color is not None:
        pin.icon_color = data.icon_color or None
    if data.visibility is not None and data.visibility != pin.visibility:
        pin.visibility = _check_visibility(c, current_user, data.visibility)
    # A title names a page (or a new stub); "" for the id unlinks the pin.
    if data.target_title is not None and data.target_title.strip():
        pin.target_page_id = resolve_pin_target(db, c, page, current_user, None, data.target_title)
    elif data.target_page_id is not None:
        pin.target_page_id = (
            resolve_pin_target(db, c, page, current_user, data.target_page_id, None)
            if data.target_page_id
            else None
        )

    db.flush()
    _rebuild_link_rows(db, campaign_id, page)
    db.commit()
    db.refresh(pin)
    return pin_out(pin, _target(db, pin.target_page_id), True)


def delete_pin(
    campaign_id: str,
    page_id: str,
    pin_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c, page = _editable_map_page(db, campaign_id, page_id, current_user)
    pin = _pin_or_404(db, c, page, pin_id, current_user)
    db.delete(pin)
    db.flush()
    _rebuild_link_rows(db, campaign_id, page)
    db.commit()
