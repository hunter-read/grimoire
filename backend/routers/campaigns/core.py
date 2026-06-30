"""Campaign CRUD, member management, and resource linking endpoint handlers."""

import datetime

from fastapi import Depends, HTTPException

from ...auth import CurrentUser, get_current_user, require_admin
from ...config import SessionLocal
from ...models import (
    Audio,
    Book,
    Campaign,
    CampaignMember,
    CampaignResource,
    GenericMap,
    Token,
    User,
)
from ._helpers import (
    assert_can_manage,
    build_members,
    can_view,
    get_campaign_or_404,
    is_gm_or_admin,
    serialize_campaign,
    user_has_campaign_access,
)
from ._schemas import (
    CampaignCreate,
    CampaignUpdate,
    InvitePayload,
    MemberStatusUpdate,
)


def list_campaigns(current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        owned = db.query(Campaign).filter_by(owner_id=current_user.id).all()

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
        member_campaigns = (
            db.query(Campaign)
            .filter(
                Campaign.id.in_(member_campaign_ids),
                Campaign.owner_id != current_user.id,
            )
            .all()
            if member_campaign_ids
            else []
        )

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
    finally:
        db.close()


def create_campaign(data: CampaignCreate, current_user: CurrentUser = Depends(get_current_user)):
    if current_user.role == "guest":
        raise HTTPException(403, "Guests cannot create campaigns")
    if data.is_gm_campaign and not is_gm_or_admin(current_user):
        raise HTTPException(403, "Only GMs and admins can create GM-run campaigns")

    db = SessionLocal()
    try:
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
            from ...models import CampaignResourceShare

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
    finally:
        db.close()


def get_campaign(campaign_id: str, current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
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

        resources = [
            {
                "id": r.id,
                "resource_type": r.resource_type,
                "resource_id": r.resource_id,
                "visibility": r.visibility,
                "category_id": r.category_id,
            }
            for r in db.query(CampaignResource).filter_by(campaign_id=campaign_id).all()
        ]

        result = serialize_campaign(c, members, db)
        result["resources"] = resources
        return result
    finally:
        db.close()


def update_campaign(
    campaign_id: str, data: CampaignUpdate, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
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
    finally:
        db.close()


def delete_campaign(campaign_id: str, current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user, db)
        db.delete(c)
        db.commit()
    finally:
        db.close()


def _resource_folder(relative_path: str) -> str:
    """Parent folder path of a media file, dropping the leading top-level dir and
    the filename — matches the frontend's MapsView.getFolderPath logic."""
    parts = (relative_path or "").replace("\\", "/").split("/")
    return "/".join(parts[1:-1])


def search_resources_global(
    q: str = "",
    resource_type: str = None,
    system_id: str = None,
    limit: int = 30,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Search across books, maps, tokens, and audio for the resource picker.

    Books match on title and can be narrowed by game system. Maps, tokens, and
    audio match on their folder path *first*, then filename, so a folder name like
    "Abyssal Fall (30x49)" surfaces every item inside it. Folder-path matches are
    ranked above filename-only matches.
    """
    if current_user.role == "guest":
        raise HTTPException(403, "Guests cannot browse the library")
    db = SessionLocal()
    try:
        results = []
        q_lower = q.lower()

        if not resource_type or resource_type == "book":
            query = db.query(Book)
            if system_id:
                query = query.filter(Book.game_system_id == system_id)
            for b in query.order_by(Book.title).limit(500).all():
                if not q or q_lower in (b.title or "").lower():
                    results.append(
                        {
                            "resource_type": "book",
                            "resource_id": b.id,
                            "name": b.title,
                            "subtitle": b.category,
                            "has_thumbnail": b.has_thumbnail,
                        }
                    )

        # Maps/tokens/audio: prefer folder-path matches, then filename matches.
        def _media_results(rtype, model):
            folder_hits, name_hits = [], []
            for item in db.query(model).order_by(model.filename).limit(1000).all():
                folder = _resource_folder(item.relative_path)
                # Audio has no thumbnail; use its artwork flag and prefer its title.
                if rtype == "audio":
                    name = item.title or item.filename
                    has_thumb = bool(item.has_artwork)
                else:
                    name = item.filename
                    has_thumb = item.has_thumbnail
                row = {
                    "resource_type": rtype,
                    "resource_id": item.id,
                    "name": name,
                    "subtitle": folder,
                    "has_thumbnail": has_thumb,
                }
                if not q:
                    name_hits.append(row)
                elif q_lower in folder.lower():
                    folder_hits.append(row)
                elif q_lower in (name or "").lower():
                    name_hits.append(row)
            return folder_hits + name_hits

        if not resource_type or resource_type == "map":
            results.extend(_media_results("map", GenericMap))

        if not resource_type or resource_type == "token":
            results.extend(_media_results("token", Token))

        if not resource_type or resource_type == "audio":
            results.extend(_media_results("audio", Audio))

        return results[:limit]
    finally:
        db.close()


def suggested_resources(system_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """Books belonging to a game system, for the create wizard's resource step.

    Core-category books are flagged `suggested` so the wizard can pre-select them;
    nothing else is suggested. Ordered with suggested (core) books first.
    """
    if current_user.role == "guest":
        raise HTTPException(403, "Guests cannot browse the library")
    db = SessionLocal()
    try:
        books = db.query(Book).filter_by(game_system_id=system_id).order_by(Book.title).all()
        out = [
            {
                "resource_type": "book",
                "resource_id": b.id,
                "name": b.title,
                "subtitle": b.category,
                "has_thumbnail": b.has_thumbnail,
                "suggested": b.category == "core",
            }
            for b in books
        ]
        out.sort(key=lambda r: (not r["suggested"], r["name"].lower()))
        return out
    finally:
        db.close()


def invite_member(
    campaign_id: str, data: InvitePayload, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user, db)
        if not c.is_gm_campaign:
            raise HTTPException(400, "Only GM campaigns support invitations")

        target = db.query(User).filter_by(id=data.user_id).first()
        if not target:
            raise HTTPException(404, "User not found")
        if not user_has_campaign_access(db, target.id):
            raise HTTPException(
                403,
                "This user's campaign access is disabled and they cannot be added to campaigns",
            )

        existing = (
            db.query(CampaignMember)
            .filter_by(campaign_id=campaign_id, user_id=data.user_id)
            .first()
        )
        if existing:
            raise HTTPException(409, "User already invited")

        member = CampaignMember(campaign_id=campaign_id, user_id=data.user_id, status="invited")
        db.add(member)
        db.commit()
        return {"user_id": data.user_id, "status": "invited"}
    finally:
        db.close()


def update_member_status(
    campaign_id: str,
    user_id: str,
    data: MemberStatusUpdate,
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        is_owner = c.owner_id == current_user.id
        if user_id != current_user.id and not is_owner:
            raise HTTPException(403, "Cannot update another member's status")

        member = (
            db.query(CampaignMember).filter_by(campaign_id=campaign_id, user_id=user_id).first()
        )
        if not member:
            raise HTTPException(404, "Member not found")

        if data.status is not None:
            if data.status not in ("accepted", "declined"):
                raise HTTPException(400, "Status must be 'accepted' or 'declined'")
            # A user whose campaign access is disabled may decline an existing
            # invitation but cannot join (accept) a campaign.
            if data.status == "accepted" and not user_has_campaign_access(db, member.user_id):
                raise HTTPException(403, "Your campaign access has been disabled")
            member.status = data.status

        if data.character_name is not None:
            if not is_owner and user_id != current_user.id:
                raise HTTPException(
                    403, "Only the GM or the member themselves can set a character name"
                )
            member.character_name = data.character_name.strip() or None

        if data.character_sheet_url is not None:
            if not is_owner and user_id != current_user.id:
                raise HTTPException(
                    403, "Only the GM or the member themselves can set a character sheet link"
                )
            url = data.character_sheet_url.strip()
            member.character_sheet_url = url or None
            if url:
                # A link replaces any uploaded sheet file.
                member.character_sheet_path = None
                member.character_sheet_filename = None

        db.commit()
        return {
            "user_id": user_id,
            "status": member.status,
            "character_name": member.character_name,
            "character_sheet_url": member.character_sheet_url,
        }
    finally:
        db.close()


def remove_member(
    campaign_id: str, user_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        if user_id != current_user.id and c.owner_id != current_user.id:
            raise HTTPException(403, "Not authorised")

        member = (
            db.query(CampaignMember).filter_by(campaign_id=campaign_id, user_id=user_id).first()
        )
        if member:
            db.delete(member)
            db.commit()
    finally:
        db.close()



def admin_list_user_campaigns(user_id: str, current_user: CurrentUser = Depends(require_admin)):
    """Return a minimal read-only view of all campaigns owned by a specific user.

    Admins can inspect (but not manage or delete) campaigns through the user page.
    Only the title, game system, and description are exposed.
    """
    db = SessionLocal()
    try:
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
    finally:
        db.close()


def eligible_members(campaign_id: str, current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user, db)

        existing = {
            m.user_id for m in db.query(CampaignMember).filter_by(campaign_id=campaign_id).all()
        }
        # Guests are not invitable here — they're created via the guest panel.
        users = (
            db.query(User)
            .filter(
                User.id != c.owner_id,
                (User.is_guest == False) | (User.is_guest.is_(None)),  # noqa: E712
            )
            .all()
        )
        return [
            {
                "id": u.id,
                "username": u.username,
                "display_name": u.display_name,
                "role": u.role,
                "already_invited": u.id in existing,
                "campaign_access": u.campaign_access is None or bool(u.campaign_access),
            }
            for u in users
        ]
    finally:
        db.close()
