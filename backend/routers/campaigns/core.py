"""Campaign CRUD and resource-listing endpoint handlers.

Member management lives in ``members.py`` and the library resource picker in
``resource_search.py`` (issue #152); route registration stays centralised in
``__init__.py`` so the external API surface is unchanged.
"""

import datetime

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_admin
from ...config import get_db
from ...models import (
    Campaign,
    CampaignMember,
    CampaignResource,
    CampaignResourceShare,
    User,
)
from ._helpers import (
    assert_can_manage,
    build_members,
    can_see_resource,
    can_view,
    get_campaign_or_404,
    is_gm_or_admin,
    serialize_campaign,
    user_has_campaign_access,
)
from ._schemas import (
    CampaignArchive,
    CampaignConvert,
    CampaignCreate,
    CampaignUpdate,
)


def list_campaigns(
    include_archived: bool = False,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Campaigns the user owns or belongs to.

    Archived campaigns are left out unless ``include_archived`` is set, so the
    default list stays the active games. The flag returns archived campaigns
    *alongside* the active ones (rather than only archived), letting the UI
    toggle between "active" and "everything" with one request either way.
    """
    owned_q = db.query(Campaign).filter_by(owner_id=current_user.id)
    if not include_archived:
        owned_q = owned_q.filter(Campaign.is_archived.is_(False))
    owned = owned_q.all()

    all_memberships = (
        db.query(CampaignMember)
        .filter(
            CampaignMember.user_id == current_user.id,
            CampaignMember.status.in_(["accepted", "invited"]),
        )
        .all()
    )
    membership_status = {m.campaign_id: m.status for m in all_memberships}
    member_campaign_ids = set(membership_status.keys())
    member_campaigns = []
    if member_campaign_ids:
        member_q = db.query(Campaign).filter(
            Campaign.id.in_(member_campaign_ids),
            Campaign.owner_id != current_user.id,
        )
        if not include_archived:
            member_q = member_q.filter(Campaign.is_archived.is_(False))
        member_campaigns = member_q.all()

    def _members(c):
        rows = db.query(CampaignMember).filter_by(campaign_id=c.id).all()
        all_users = {u.id: u for u in db.query(User).all()}
        return [
            {
                "user_id": m.user_id,
                "username": all_users[m.user_id].username if m.user_id in all_users else "",
                "display_name": all_users[m.user_id].display_name
                if m.user_id in all_users
                else None,
                "status": m.status,
                "character_name": m.character_name,
            }
            for m in rows
        ]

    result = []
    for c in owned:
        d = serialize_campaign(c, _members(c), db)
        d["invitation_status"] = None
        result.append(d)
    for c in member_campaigns:
        d = serialize_campaign(c, _members(c), db)
        d["invitation_status"] = membership_status.get(c.id)
        result.append(d)
    return result


def list_invites(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pending campaign invitations for the current user.

    Returns the minimal fields the app-level invite banner needs: one entry per
    GM campaign the user has been invited to but not yet accepted or declined.
    """
    invited = (
        db.query(CampaignMember)
        .filter(
            CampaignMember.user_id == current_user.id,
            CampaignMember.status == "invited",
        )
        .all()
    )
    if not invited:
        return []
    campaign_ids = {m.campaign_id for m in invited}
    # Archived campaigns drop out of the invite banner: the invite can't be
    # meaningfully acted on while the campaign is frozen, and it reappears
    # (still pending) if the owner unarchives.
    campaigns = {
        c.id: c
        for c in db.query(Campaign)
        .filter(Campaign.id.in_(campaign_ids), Campaign.is_archived.is_(False))
        .all()
    }
    owner_ids = {c.owner_id for c in campaigns.values()}
    owners = {u.id: u for u in db.query(User).filter(User.id.in_(owner_ids)).all()}
    result = []
    for m in invited:
        c = campaigns.get(m.campaign_id)
        if not c:
            continue
        owner = owners.get(c.owner_id)
        result.append(
            {
                "campaign_id": c.id,
                "name": c.name,
                "description": c.description,
                "owner_display_name": (owner.display_name or owner.username)
                if owner
                else "",
            }
        )
    return result


def create_campaign(
    data: CampaignCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role == "guest":
        raise HTTPException(403, "Guests cannot create campaigns")
    if data.is_gm_campaign and not is_gm_or_admin(current_user):
        raise HTTPException(403, "Only GMs and admins can create GM-run campaigns")

    if not user_has_campaign_access(db, current_user.id):
        raise HTTPException(403, "Your campaign access has been disabled")
    campaign = Campaign(
        name=data.name.strip(),
        description=data.description,
        owner_id=current_user.id,
        is_gm_campaign=data.is_gm_campaign,
        gm_title=data.gm_title.strip() if data.gm_title else "Game Master",
        parent_campaign_id=data.parent_campaign_id,
        system_id=data.system_id,
        # A linked library system takes precedence over a free-text name.
        system_name=(data.system_name.strip() or None)
        if data.system_name and not data.system_id
        else None,
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)

    # Only link the resources explicitly chosen in the create wizard. Deduplicate
    # by (type, id) and skip unknown resource types.
    if data.resources:
        seen = set()
        order = 0
        for r in data.resources:
            if r.resource_type not in ("book", "map", "token", "audio", "file"):
                continue
            key = (r.resource_type, r.resource_id)
            if key in seen:
                continue
            seen.add(key)
            visibility = r.visibility if r.visibility in ("public", "private", "gm") else "gm"
            res = CampaignResource(
                campaign_id=campaign.id,
                resource_type=r.resource_type,
                resource_id=r.resource_id,
                visibility=visibility,
                sort_order=order,
            )
            order += 1
            db.add(res)
            db.flush()
            if visibility == "private" and r.shared_user_ids:
                for uid in set(r.shared_user_ids):
                    db.add(CampaignResourceShare(resource_id=res.id, user_id=uid))
        db.commit()

    return serialize_campaign(campaign, [], db)


def get_campaign(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")

    # Record that this campaign was opened, for "recently accessed" sorting.
    # Use a targeted UPDATE so the ORM onupdate doesn't also bump updated_at
    # (which would needlessly bust the banner image cache on every open).
    db.query(Campaign).filter_by(id=c.id).update(
        {"last_accessed_at": datetime.datetime.utcnow()}
    )
    db.commit()

    members = build_members(c, db)

    # Only expose resources this member is allowed to see. Leaking gm-only or
    # unshared-private rows here would hand out resource_ids that become
    # download handles on the by-id media/file routes.
    is_owner = c.owner_id == current_user.id
    all_resources = db.query(CampaignResource).filter_by(campaign_id=campaign_id).all()
    share_map = {}
    for s in (
        db.query(CampaignResourceShare)
        .filter(CampaignResourceShare.resource_id.in_([r.id for r in all_resources] or [""]))
        .all()
    ):
        share_map.setdefault(s.resource_id, set()).add(s.user_id)

    resources = [
        {
            "id": r.id,
            "resource_type": r.resource_type,
            "resource_id": r.resource_id,
            "visibility": r.visibility,
            "category_id": r.category_id,
        }
        for r in all_resources
        if can_see_resource(r, is_owner, current_user.id, share_map)
    ]

    result = serialize_campaign(c, members, db)
    result["resources"] = resources
    return result


def update_campaign(
    campaign_id: str,
    data: CampaignUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)

    if data.name is not None:
        c.name = data.name.strip()
    if data.description is not None:
        c.description = data.description
    if data.gm_title is not None:
        c.gm_title = data.gm_title.strip()
    if data.system_id is not None:
        c.system_id = data.system_id or None
        if c.system_id:
            c.system_name = None  # a library system replaces any free-text name
    if data.system_name is not None:
        c.system_name = data.system_name.strip() or None
        if c.system_name:
            c.system_id = None  # free-text name replaces any linked system
    if data.parent_campaign_id is not None:
        c.parent_campaign_id = data.parent_campaign_id or None

    db.commit()
    db.refresh(c)
    # Return the full member list so the client's merge doesn't blank out
    # the roster after an edit.
    return serialize_campaign(c, build_members(c, db), db)


def convert_campaign_to_group(
    campaign_id: str,
    data: CampaignConvert,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Promote a personal campaign to a GM-run (group) campaign.

    Only the owner can convert, and only if they could have created a GM campaign
    in the first place — otherwise this would be a way around that role check.
    Nothing is migrated: members, guests, and the schedule are all features a
    personal campaign simply never had, so they start empty. Everything already
    in the campaign (resources, wiki, sessions) carries over untouched.

    One-way: there is no group -> personal route, because demoting would strand
    those rows with nowhere to live.
    """
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    if not is_gm_or_admin(current_user):
        raise HTTPException(403, "Only GMs and admins can run group campaigns")
    if c.is_gm_campaign:
        raise HTTPException(409, "Campaign is already a group campaign")

    c.is_gm_campaign = True
    if data.gm_title and data.gm_title.strip():
        c.gm_title = data.gm_title.strip()
    db.commit()
    db.refresh(c)
    return serialize_campaign(c, build_members(c, db), db)


def set_campaign_archived(
    campaign_id: str,
    data: CampaignArchive,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Archive or unarchive a campaign (owner only).

    Archiving hides the campaign from everyone's list unless they ask for
    archived ones, and freezes it read-only. Deliberately does not go through
    ``assert_can_manage``: that refuses writes to archived campaigns, which would
    make unarchiving impossible. The same owner and access checks are applied
    here instead.
    """
    c = get_campaign_or_404(db, campaign_id)
    if c.owner_id != current_user.id:
        raise HTTPException(403, "Not authorised to manage this campaign")
    if not user_has_campaign_access(db, c.owner_id):
        raise HTTPException(
            403, "Campaign is locked: the GM's campaign access has been disabled"
        )

    c.is_archived = data.archived
    c.archived_at = datetime.datetime.utcnow() if data.archived else None
    db.commit()
    db.refresh(c)
    return serialize_campaign(c, build_members(c, db), db)


def delete_campaign(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    # Deleting an archived campaign is allowed — archiving is a tidying step, not
    # a lock against removal — so this skips the archived check in assert_can_manage.
    if c.owner_id != current_user.id:
        raise HTTPException(403, "Not authorised to manage this campaign")
    if not user_has_campaign_access(db, c.owner_id):
        raise HTTPException(
            403, "Campaign is locked: the GM's campaign access has been disabled"
        )
    db.delete(c)
    db.commit()


def admin_list_user_campaigns(
    user_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Return a minimal read-only view of all campaigns owned by a specific user.

    Admins can inspect (but not manage or delete) campaigns through the user page.
    Only the title, game system, and description are exposed.
    """
    from ...models import GameSystem

    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    owned = db.query(Campaign).filter_by(owner_id=user_id).all()
    system_names = {s.id: s.name for s in db.query(GameSystem).all()}
    return [
        {
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "is_gm_campaign": c.is_gm_campaign,
            "system_id": c.system_id,
            "system_name": system_names.get(c.system_id),
        }
        for c in owned
    ]
