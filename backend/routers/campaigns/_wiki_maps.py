"""Map pages: the picture a page shows and the pins on it (issue #578).

A map page (``page_type = "map"``) is a wiki page built around one map. Its
picture is a library map, by id, or - once that map has left the library - the
campaign's own copy of it (``map_file_id``). Neither is a path, so a map moved or
renamed in the library, in the app or outside it, keeps its page.

Pins are the places on the map. Two rules decide who sees one:

* a ``gm`` pin is the campaign GM's alone, like a ``||GM secret||``;
* a pin linking a page is seen only by those who can see that page too, so a
  public map never gives away a GM-only page's title, label or position.

Whoever can see the map page sees its unlinked pins - which is why deleting a
pin's page must not simply unlink it (``release_pins_to``). The handlers live in
``wiki_pins.py``; this module is what they and ``wiki.get_page`` share.
"""

import os
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser
from ...models import CampaignFile, CampaignResource, CampaignResourceShare, GenericMap, WikiPage
from ...models.wiki_maps import WikiMapPin
from ...text.wikilinks import clean_title, slugify
from ._helpers import can_see_resource
from ._wiki_helpers import _ensure_unique_slug, can_edit_page, can_view_page
from .uploads import can_read_campaign_file

MAP_PAGE_TYPE = "map"
PIN_VISIBILITIES = ("page", "gm")

# The maps a map page can show: still images a browser draws as they are. PDF
# and video maps are left for later (they need a page or a frame picked).
_IMAGE_MAP_EXTS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"})


def is_image_map(m: GenericMap) -> bool:
    return os.path.splitext(m.filename or m.filepath or "")[1].lower() in _IMAGE_MAP_EXTS


def _visible_map_resource(
    db: Session, campaign: Any, user: CurrentUser, map_id: str
) -> Optional[CampaignResource]:
    res = (
        db.query(CampaignResource)
        .filter_by(campaign_id=campaign.id, resource_type="map", resource_id=map_id)
        .first()
    )
    if res is None:
        return None
    shares = {
        res.id: {
            s.user_id for s in db.query(CampaignResourceShare).filter_by(resource_id=res.id).all()
        }
    }
    return res if can_see_resource(res, campaign.owner_id == user.id, user.id, shares) else None


def check_library_map(db: Session, campaign: Any, user: CurrentUser, map_id: str) -> str:
    """Validate a library map for a map page and return its id.

    It must be an image map linked to the campaign and visible to ``user``. The
    link is what lets every member open it: a guest may only open library maps
    a campaign shares with them, so an unlinked map would draw for the GM and
    nobody else. The GM's map picker links one on the spot.
    """
    m = db.query(GenericMap).filter_by(id=map_id).first()
    if m is None or m.is_missing:
        raise HTTPException(400, "Unknown map")
    if not is_image_map(m):
        raise HTTPException(400, "A map page can only show an image map")
    if _visible_map_resource(db, campaign, user, map_id) is None:
        raise HTTPException(400, "Link the map to the campaign first")
    return m.id


def check_campaign_image(db: Session, campaign: Any, user: CurrentUser, file_id: str) -> str:
    """Validate one of the campaign's own image files for a map page."""
    cf = db.query(CampaignFile).filter_by(id=file_id, campaign_id=campaign.id).first()
    if cf is None or not cf.is_image or not can_read_campaign_file(db, campaign, user.id, cf.id):
        raise HTTPException(400, "Unknown campaign image")
    return cf.id


def apply_map_choice(
    db: Session,
    campaign: Any,
    page: WikiPage,
    user: CurrentUser,
    map_id: Optional[str],
    map_file_id: Optional[str],
) -> None:
    """Set a map page's picture from a create/update payload.

    ``None`` leaves a field alone and ``""`` clears it. Choosing one source
    clears the other, so a page never holds two pictures - that is also what
    *Replace map* does to a page whose map has gone. Pins are kept either way:
    their coordinates are fractions of the picture, so they land in the same
    places on a replacement of the same map.
    """
    if page.page_type != MAP_PAGE_TYPE:
        return
    if map_id:
        if map_id != page.map_id:
            page.map_id = check_library_map(db, campaign, user, map_id)
        page.map_file_id = None
    elif map_file_id:
        if map_file_id != page.map_file_id:
            page.map_file_id = check_campaign_image(db, campaign, user, map_file_id)
        page.map_id = None
    else:
        if map_id == "":
            page.map_id = None
        if map_file_id == "":
            page.map_file_id = None


def resolve_page_map(db: Session, page: WikiPage) -> Optional[dict]:
    """What a map page shows, or None for any other page type.

    A library map that is gone, or flagged missing by a scan, falls through to
    the campaign copy if there is one, then to ``missing``: the page shows a
    placeholder with *Replace map*, and its pins wait for the new picture.
    ``none`` is a map page that has not been given a picture yet.
    """
    if page.page_type != MAP_PAGE_TYPE:
        return None
    if not page.map_id and not page.map_file_id:
        # Never given a picture (a page made from a template, say), as opposed
        # to one whose picture has gone - the UI words the two differently.
        return {"source": "none", "id": None, "name": None, "has_thumbnail": False}
    if page.map_id:
        m = db.query(GenericMap).filter_by(id=page.map_id).first()
        if m is not None and not m.is_missing:
            return {
                "source": "library",
                "id": m.id,
                "name": m.filename,
                "has_thumbnail": bool(m.has_thumbnail),
            }
    if page.map_file_id:
        cf = (
            db.query(CampaignFile)
            .filter_by(id=page.map_file_id, campaign_id=page.campaign_id)
            .first()
        )
        if cf is not None:
            return {"source": "file", "id": cf.id, "name": cf.filename, "has_thumbnail": True}
    return {"source": "missing", "id": None, "name": None, "has_thumbnail": False}


def _targets(db: Session, pins: list[WikiMapPin]) -> dict[str, WikiPage]:
    ids = {p.target_page_id for p in pins if p.target_page_id}
    if not ids:
        return {}
    return {p.id: p for p in db.query(WikiPage).filter(WikiPage.id.in_(ids)).all()}


def pin_visible(
    pin: WikiMapPin,
    target: Optional[WikiPage],
    campaign: Any,
    user: CurrentUser,
    db: Session,
) -> bool:
    """Whether ``user`` may see ``pin``. The caller has checked the map page."""
    if pin.visibility == "gm" and campaign.owner_id != user.id:
        return False
    if pin.target_page_id:
        # Unreadable and nonexistent read the same, so a pin never confirms
        # that a page someone cannot see exists.
        return target is not None and can_view_page(target, campaign, user, db)
    return True


def pin_out(pin: WikiMapPin, target: Optional[WikiPage], can_edit: bool) -> dict:
    return {
        "id": pin.id,
        "x": pin.x,
        "y": pin.y,
        "label": pin.label or "",
        "target_page_id": pin.target_page_id,
        "target_title": target.title if target is not None else None,
        "target_icon": target.icon if target is not None else None,
        "target_icon_color": target.icon_color if target is not None else None,
        "icon": pin.icon,
        "icon_color": pin.icon_color,
        "visibility": pin.visibility or "page",
        "sort_order": pin.sort_order or 0,
        "can_edit": can_edit,
    }


def visible_pins(
    db: Session, campaign: Any, page: WikiPage, user: CurrentUser
) -> list[tuple[WikiMapPin, Optional[WikiPage]]]:
    """The page's pins ``user`` may see, each with its target page (or None)."""
    pins = list(page.map_pins)
    targets = _targets(db, pins)
    out = []
    for pin in pins:
        target = targets.get(pin.target_page_id or "")
        if pin_visible(pin, target, campaign, user, db):
            out.append((pin, target))
    return out


def pins_for(db: Session, campaign: Any, page: WikiPage, user: CurrentUser) -> list[dict]:
    """``visible_pins`` serialised for the page detail."""
    if page.page_type != MAP_PAGE_TYPE:
        return []
    can_edit = can_edit_page(page, campaign, user, db)
    return [pin_out(pin, target, can_edit) for pin, target in visible_pins(db, campaign, page, user)]


def pin_link_target_ids(db: Session, page_id: str) -> set[str]:
    """Pages the pins on ``page_id`` link to, for its backlink rows.

    GM pins are left out. A backlink is shown to whoever can see the map page,
    so counting one would tell players that an unrevealed spot on a map they
    can read leads to a page they can.
    """
    return {
        tid
        for (tid,) in db.query(WikiMapPin.target_page_id).filter(
            WikiMapPin.page_id == page_id,
            WikiMapPin.target_page_id.isnot(None),
            WikiMapPin.visibility != "gm",
        )
        if tid
    }


def pinned_source_ids(db: Session, target_page_id: str) -> set[str]:
    """Map pages with a non-GM pin to ``target_page_id`` - the "pinned on" backlinks."""
    return {
        pid
        for (pid,) in db.query(WikiMapPin.page_id).filter(
            WikiMapPin.target_page_id == target_page_id, WikiMapPin.visibility != "gm"
        )
    }


def release_pins_to(db: Session, campaign: Any, page: WikiPage, user: CurrentUser) -> None:
    """Settle the pins linking ``page``, which ``user`` is about to delete.

    An unlinked pin is shown to everyone who sees its map, so unlinking is only
    safe when the page was public: nobody new sees the pin. A pin to a
    restricted page was hidden from whoever could not read that page, and must
    not surface to them once the page is gone:

    * the GM deleting a restricted page of their own keeps the pin as a GM-only
      one, on a map they can see - an unrevealed spot stays theirs;
    * any other pin goes with the page. No pin setting reproduces "the people
      this page was shared with", and a GM-only pin would hand a player's
      private spot to the GM.

    Call it before the delete, on every path that deletes a page: the foreign
    key's ``SET NULL`` alone would leave each of these pins unlinked.
    """
    pins = db.query(WikiMapPin).filter_by(target_page_id=page.id).all()
    if not pins:
        return
    gm_keeps = user.id == campaign.owner_id and page.created_by_id == user.id
    map_pages = {
        p.id: p
        for p in db.query(WikiPage).filter(WikiPage.id.in_({pin.page_id for pin in pins})).all()
    }
    for pin in pins:
        if page.visibility != "group":
            map_page = map_pages.get(pin.page_id)
            if not (
                gm_keeps
                and map_page is not None
                and can_view_page(map_page, campaign, user, db)
            ):
                db.delete(pin)
                continue
            pin.visibility = "gm"
        pin.target_page_id = None
    db.flush()


def resolve_pin_target(
    db: Session,
    campaign: Any,
    page: WikiPage,
    user: CurrentUser,
    target_page_id: Optional[str],
    target_title: Optional[str],
) -> Optional[str]:
    """The page id a pin should link to, creating a stub for a new title.

    By id, the page must be one ``user`` can see. By title, a page ``user`` can
    see under that title is reused, and otherwise a stub is created exactly as a
    ``[[Page Title]]`` link would make one - with the map page's visibility, so a
    pin on a shared map doesn't spawn a page only its author can open. Neither
    given: an unlinked pin.
    """
    if target_page_id:
        target = db.query(WikiPage).filter_by(id=target_page_id, campaign_id=campaign.id).first()
        if target is None or not can_view_page(target, campaign, user, db):
            raise HTTPException(400, "Invalid target page")
        if target.id == page.id:
            raise HTTPException(400, "A pin cannot link to its own map page")
        return target.id
    title = clean_title(target_title)
    if not title:
        return None
    existing = (
        db.query(WikiPage).filter_by(campaign_id=campaign.id, slug=slugify(title)).first()
    )
    if (
        existing is not None
        and existing.id != page.id
        and can_view_page(existing, campaign, user, db)
    ):
        return existing.id
    stub = WikiPage(
        campaign_id=campaign.id,
        title=title,
        slug=_ensure_unique_slug(db, campaign.id, slugify(title)),
        body="",
        visibility=page.visibility,
        page_type="note",
        created_by_id=user.id,
    )
    db.add(stub)
    db.flush()
    return stub.id
