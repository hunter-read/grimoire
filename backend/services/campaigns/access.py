"""Campaign membership checks that gate library and media content.

A guest, or anyone else limited to what a campaign shares with them, reaches a
book or map by its bare id; these decide whether one of their campaigns shares it.
"""
from sqlalchemy.orm import Session

from ...models import Campaign, CampaignMember


def is_member(db: Session, campaign_id: str, user_id: str) -> bool:
    return (
        db.query(CampaignMember)
        .filter_by(campaign_id=campaign_id, user_id=user_id, status="accepted")
        .first()
        is not None
    )


def user_can_access_resource(db: Session, user_id: str, resource_type: str, resource_id: str) -> bool:
    """Whether a user may access a library/media resource through a campaign share.

    True when the resource is linked (as a CampaignResource of the given type/id)
    into any campaign the user owns or is an accepted member of, AND the resource's
    visibility permits this user to see it (public → any member; private → only the
    users it's shared with; gm → owner only). Mirrors the per-resource visibility
    rule enforced by the resource-listing endpoint (`_can_see_resource`).

    This is the campaign-scoped gate for guests (and any share-limited user) on
    the file/page/download routes, which serve content by bare resource id.
    """
    from ...models import CampaignResource, CampaignResourceShare

    links = (
        db.query(CampaignResource)
        .filter_by(resource_type=resource_type, resource_id=resource_id)
        .all()
    )
    if not links:
        return False

    for r in links:
        campaign = db.query(Campaign).filter_by(id=r.campaign_id).first()
        if not campaign:
            continue
        is_owner = campaign.owner_id == user_id
        if not is_owner and not is_member(db, campaign.id, user_id):
            continue
        if is_owner or r.visibility == "public":
            return True
        if r.visibility == "private":
            shared = (
                db.query(CampaignResourceShare)
                .filter_by(resource_id=r.id, user_id=user_id)
                .first()
            )
            if shared is not None:
                return True
        # visibility == "gm": only the owner (handled above) may see it.
    return False
