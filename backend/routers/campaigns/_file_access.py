"""Who may read one of a campaign's uploaded files.

The owner reads everything. Anyone else is held to the visibility of the
resource that links the file in (public, private and shared with them, or gm);
a file with no linking resource is the owner's alone. Pages can share a file
further:

* the picture of a map page the user can read - putting a picture on a shared
  map page is sharing it;
* for the copy a campaign keeps of a library map that was never linked as a
  resource, a page the user can read that embeds it (``[[image:<id>]]``): the
  embed was the map's, rewritten to point at the copy when the map was deleted.

The copy of a map that *was* linked follows that link and nothing else, so a
GM-only map stays GM-only on a public map page, before and after it leaves the
library (``services/campaigns/map_copies.py``). Callers check campaign
membership first.
"""

from typing import Any

from sqlalchemy.orm import Session

from ...auth import CurrentUser
from ...models import (
    Campaign,
    CampaignFile,
    CampaignResource,
    CampaignResourceShare,
    User,
    WikiPage,
)
from ...text.wikilinks import iter_links
from ._helpers import strip_gm_secrets
from ._wiki_helpers import can_view_page

_EMBED_PREFIXES = ("image:", "file:")


def can_read_campaign_file(db: Session, campaign: Campaign, user_id: str, file_id: str) -> bool:
    """Whether a campaign member may read one of the campaign's uploaded files."""
    if campaign.owner_id == user_id:
        return True
    res = (
        db.query(CampaignResource)
        .filter_by(campaign_id=campaign.id, resource_type="file", resource_id=file_id)
        .first()
    )
    if res is not None and res.visibility == "public":
        return True
    if (
        res is not None
        and res.visibility == "private"
        and db.query(CampaignResourceShare).filter_by(resource_id=res.id, user_id=user_id).first()
        is not None
    ):
        return True
    cf = db.query(CampaignFile).filter_by(id=file_id, campaign_id=campaign.id).first()
    if cf is None or cf.map_copy == "linked":
        return False
    viewer = _viewer(db, user_id)
    if viewer is None:
        return False
    if _shown_on_readable_map_page(db, campaign, viewer, file_id):
        return True
    return cf.map_copy == "unlinked" and _embedded_in_readable_page(db, campaign, viewer, file_id)


def _viewer(db: Session, user_id: str) -> CurrentUser | None:
    user = db.query(User).filter_by(id=user_id).first()
    if user is None:
        return None
    return CurrentUser(id=user.id, username=user.username, role=user.role or "")


def _shown_on_readable_map_page(
    db: Session, campaign: Campaign, viewer: CurrentUser, file_id: str
) -> bool:
    pages = (
        db.query(WikiPage)
        .filter_by(campaign_id=campaign.id, page_type="map", map_file_id=file_id)
        .all()
    )
    return any(can_view_page(p, campaign, viewer, db) for p in pages)


def _embeds(body: str, file_id: str) -> bool:
    for m in iter_links(body):
        target = m.group(1).strip()
        lowered = target.lower()
        for prefix in _EMBED_PREFIXES:
            if lowered.startswith(prefix) and target[len(prefix):].strip() == file_id:
                return True
    return False


def _embedded_in_readable_page(
    db: Session, campaign: Any, viewer: CurrentUser, file_id: str
) -> bool:
    """Whether a page ``viewer`` can read embeds the file where they can see it.

    The body is read as the viewer gets it, so an embed inside a ``||GM
    secret||`` shares nothing.
    """
    pages = (
        db.query(WikiPage)
        .filter(WikiPage.campaign_id == campaign.id, WikiPage.body.contains(file_id, autoescape=True))
        .all()
    )
    return any(
        _embeds(strip_gm_secrets(p.body or ""), file_id) and can_view_page(p, campaign, viewer, db)
        for p in pages
    )
