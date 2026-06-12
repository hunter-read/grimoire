"""Campaign CRUD, member management, and resource linking endpoint handlers."""

from fastapi import Depends, HTTPException

import datetime

from ...auth import CurrentUser, get_current_user, require_admin
from ...config import SessionLocal
from ...models import (
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
    can_view,
    get_campaign_or_404,
    is_gm_or_admin,
    serialize_campaign,
)
from ._schemas import (
    AdminDeletePayload,
    CampaignCreate,
    CampaignUpdate,
    InvitePayload,
    MemberStatusUpdate,
    ResourceAdd,
    ResourceUpdate,
)


def list_campaigns(current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        is_admin = current_user.role == "admin"

        if is_admin:
            all_campaigns = db.query(Campaign).filter(Campaign.deleted_at.is_(None)).all()
            all_users = {u.id: u for u in db.query(User).all()}

            def _members_admin(c):
                rows = db.query(CampaignMember).filter_by(campaign_id=c.id).all()
                return [
                    {
                        "user_id": m.user_id,
                        "username": all_users[m.user_id].username if m.user_id in all_users else "",
                        "display_name": all_users[m.user_id].display_name if m.user_id in all_users else None,
                        "status": m.status,
                        "character_name": m.character_name,
                    }
                    for m in rows
                ]

            result = []
            for c in all_campaigns:
                d = serialize_campaign(c, _members_admin(c), db)
                d["invitation_status"] = "owner" if c.owner_id == current_user.id else None
                result.append(d)
            return result

        owned = db.query(Campaign).filter_by(owner_id=current_user.id).filter(Campaign.deleted_at.is_(None)).all()

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
                Campaign.deleted_at.is_(None),
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
    if data.is_gm_campaign and not is_gm_or_admin(current_user):
        raise HTTPException(403, "Only GMs and admins can create GM-run campaigns")

    db = SessionLocal()
    try:
        campaign = Campaign(
            name=data.name.strip(),
            description=data.description,
            owner_id=current_user.id,
            is_gm_campaign=data.is_gm_campaign,
            gm_title=data.gm_title.strip() if data.gm_title else "Game Master",
            parent_campaign_id=data.parent_campaign_id,
            system_id=data.system_id,
        )
        db.add(campaign)
        db.commit()
        db.refresh(campaign)

        if data.system_id:
            books = db.query(Book).filter_by(game_system_id=data.system_id).all()
            SHARED_CATEGORIES = {"core", "character-sheet"}
            for book in books:
                db.add(
                    CampaignResource(
                        campaign_id=campaign.id,
                        resource_type="book",
                        resource_id=book.id,
                        shared=book.category in SHARED_CATEGORIES,
                    )
                )
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

        rows = db.query(CampaignMember).filter_by(campaign_id=c.id).all()
        all_users = {u.id: u for u in db.query(User).all()}
        owner = all_users.get(c.owner_id)
        members = []
        if owner:
            members.append(
                {
                    "user_id": c.owner_id,
                    "username": owner.username,
                    "display_name": owner.display_name,
                    "status": "accepted",
                    "character_name": c.gm_title,
                    "is_owner": True,
                }
            )
        members += [
            {
                "user_id": m.user_id,
                "username": all_users[m.user_id].username if m.user_id in all_users else "",
                "display_name": all_users[m.user_id].display_name
                if m.user_id in all_users
                else None,
                "status": m.status,
                "character_name": m.character_name,
                "is_owner": False,
            }
            for m in rows
        ]

        resources = [
            {
                "id": r.id,
                "resource_type": r.resource_type,
                "resource_id": r.resource_id,
                "shared": r.shared,
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
        assert_can_manage(c, current_user)

        if data.name is not None:
            c.name = data.name.strip()
        if data.description is not None:
            c.description = data.description
        if data.gm_title is not None:
            c.gm_title = data.gm_title.strip()
        if data.system_id is not None:
            c.system_id = data.system_id or None
        if data.parent_campaign_id is not None:
            c.parent_campaign_id = data.parent_campaign_id or None

        db.commit()
        db.refresh(c)
        return serialize_campaign(c, [], db)
    finally:
        db.close()


def delete_campaign(campaign_id: str, current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user)
        db.delete(c)
        db.commit()
    finally:
        db.close()


def search_resources_global(
    q: str = "",
    resource_type: str = None,
    limit: int = 30,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Full-text search across books, maps, and tokens for the resource picker."""
    db = SessionLocal()
    try:
        results = []
        q_lower = q.lower()

        def _match(name: str) -> bool:
            return not q or q_lower in name.lower()

        if not resource_type or resource_type == "book":
            for b in db.query(Book).order_by(Book.title).limit(500).all():
                if _match(b.title):
                    results.append(
                        {
                            "resource_type": "book",
                            "resource_id": b.id,
                            "name": b.title,
                            "subtitle": b.category,
                            "has_thumbnail": b.has_thumbnail,
                        }
                    )

        if not resource_type or resource_type == "map":
            for m in db.query(GenericMap).order_by(GenericMap.filename).limit(500).all():
                if _match(m.filename):
                    results.append(
                        {
                            "resource_type": "map",
                            "resource_id": m.id,
                            "name": m.filename,
                            "subtitle": m.map_type or "",
                            "has_thumbnail": m.has_thumbnail,
                        }
                    )

        if not resource_type or resource_type == "token":
            for t in db.query(Token).order_by(Token.filename).limit(500).all():
                if _match(t.filename):
                    results.append(
                        {
                            "resource_type": "token",
                            "resource_id": t.id,
                            "name": t.filename,
                            "subtitle": "",
                            "has_thumbnail": t.has_thumbnail,
                        }
                    )

        return results[:limit]
    finally:
        db.close()


def invite_member(
    campaign_id: str, data: InvitePayload, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user)
        if not c.is_gm_campaign:
            raise HTTPException(400, "Only GM campaigns support invitations")

        target = db.query(User).filter_by(id=data.user_id).first()
        if not target:
            raise HTTPException(404, "User not found")

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
        is_owner = c.owner_id == current_user.id or is_gm_or_admin(current_user)
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
            member.status = data.status

        if data.character_name is not None:
            if not is_owner and user_id != current_user.id:
                raise HTTPException(
                    403, "Only the GM or the member themselves can set a character name"
                )
            member.character_name = data.character_name.strip() or None

        db.commit()
        return {
            "user_id": user_id,
            "status": member.status,
            "character_name": member.character_name,
        }
    finally:
        db.close()


def remove_member(
    campaign_id: str, user_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        if (
            user_id != current_user.id
            and c.owner_id != current_user.id
            and current_user.role != "admin"
        ):
            raise HTTPException(403, "Not authorised")

        member = (
            db.query(CampaignMember).filter_by(campaign_id=campaign_id, user_id=user_id).first()
        )
        if member:
            db.delete(member)
            db.commit()
    finally:
        db.close()


def list_resources(campaign_id: str, current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        if not can_view(c, current_user, db):
            raise HTTPException(403, "Not a member of this campaign")

        is_owner = c.owner_id == current_user.id or current_user.role == "admin"
        resources = db.query(CampaignResource).filter_by(campaign_id=campaign_id).all()

        def _resource_name(rtype: str, rid: str) -> str:
            if rtype == "book":
                obj = db.query(Book).filter_by(id=rid).first()
                return obj.title if obj else rid
            if rtype == "map":
                obj = db.query(GenericMap).filter_by(id=rid).first()
                return obj.filename if obj else rid
            if rtype == "token":
                obj = db.query(Token).filter_by(id=rid).first()
                return obj.filename if obj else rid
            return rid

        return [
            {
                "id": r.id,
                "resource_type": r.resource_type,
                "resource_id": r.resource_id,
                "name": _resource_name(r.resource_type, r.resource_id),
                "shared": r.shared,
            }
            for r in resources
            if is_owner or r.shared
        ]
    finally:
        db.close()


def add_resource(
    campaign_id: str, data: ResourceAdd, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user)
        if data.resource_type not in ("book", "map", "token"):
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

        res = CampaignResource(
            campaign_id=campaign_id,
            resource_type=data.resource_type,
            resource_id=data.resource_id,
            shared=data.shared,
        )
        db.add(res)
        db.commit()
        db.refresh(res)

        def _name(rtype, rid):
            if rtype == "book":
                obj = db.query(Book).filter_by(id=rid).first()
                return obj.title if obj else rid
            if rtype == "map":
                obj = db.query(GenericMap).filter_by(id=rid).first()
                return obj.filename if obj else rid
            if rtype == "token":
                obj = db.query(Token).filter_by(id=rid).first()
                return obj.filename if obj else rid
            return rid

        return {
            "id": res.id,
            "resource_type": res.resource_type,
            "resource_id": res.resource_id,
            "name": _name(res.resource_type, res.resource_id),
            "shared": res.shared,
        }
    finally:
        db.close()


def update_resource(
    campaign_id: str,
    resource_id: str,
    data: ResourceUpdate,
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user)
        res = db.query(CampaignResource).filter_by(id=resource_id, campaign_id=campaign_id).first()
        if not res:
            raise HTTPException(404, "Resource not found")
        res.shared = data.shared
        db.commit()
        return {"id": res.id, "shared": res.shared}
    finally:
        db.close()


def remove_resource(
    campaign_id: str, resource_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user)
        res = db.query(CampaignResource).filter_by(id=resource_id, campaign_id=campaign_id).first()
        if res:
            db.delete(res)
            db.commit()
    finally:
        db.close()


def admin_list_all_campaigns(current_user: CurrentUser = Depends(require_admin)):
    """Return all non-deleted campaigns across all users."""
    db = SessionLocal()
    try:
        all_campaigns = db.query(Campaign).filter(Campaign.deleted_at.is_(None)).all()
        all_users = {u.id: u for u in db.query(User).all()}

        def _members(c):
            rows = db.query(CampaignMember).filter_by(campaign_id=c.id).all()
            return [
                {
                    "user_id": m.user_id,
                    "username": all_users[m.user_id].username if m.user_id in all_users else "",
                    "display_name": all_users[m.user_id].display_name if m.user_id in all_users else None,
                    "status": m.status,
                    "character_name": m.character_name,
                }
                for m in rows
            ]

        return [serialize_campaign(c, _members(c), db) for c in all_campaigns]
    finally:
        db.close()


def admin_list_deleted_campaigns(current_user: CurrentUser = Depends(require_admin)):
    """Return all soft-deleted campaigns."""
    db = SessionLocal()
    try:
        deleted = db.query(Campaign).filter(Campaign.deleted_at.isnot(None)).all()
        all_users = {u.id: u for u in db.query(User).all()}

        result = []
        for c in deleted:
            d = serialize_campaign(c, [], db)
            deleter = all_users.get(c.deleted_by_id)
            d["deleted_at"] = c.deleted_at.isoformat() if c.deleted_at else None
            d["deleted_by_username"] = deleter.username if deleter else None
            d["deletion_reason"] = c.deletion_reason
            result.append(d)
        return result
    finally:
        db.close()


def admin_list_user_campaigns(user_id: str, current_user: CurrentUser = Depends(require_admin)):
    """Return all non-deleted campaigns owned by a specific user."""
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            raise HTTPException(404, "User not found")
        owned = db.query(Campaign).filter_by(owner_id=user_id).filter(Campaign.deleted_at.is_(None)).all()
        return [serialize_campaign(c, [], db) for c in owned]
    finally:
        db.close()


def admin_soft_delete_campaign(
    campaign_id: str,
    data: AdminDeletePayload,
    current_user: CurrentUser = Depends(require_admin),
):
    """Admin soft-delete: marks deleted_at, records who deleted it and why."""
    reason = data.reason.strip()
    if not reason:
        raise HTTPException(400, "Deletion reason is required")
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id, allow_deleted=False)
        if c.deleted_at is not None:
            raise HTTPException(409, "Campaign is already deleted")
        c.deleted_at = datetime.datetime.utcnow()
        c.deleted_by_id = current_user.id
        c.deletion_reason = reason
        db.commit()
    finally:
        db.close()


def admin_restore_campaign(campaign_id: str, current_user: CurrentUser = Depends(require_admin)):
    """Restore a soft-deleted campaign."""
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id, allow_deleted=True)
        if c.deleted_at is None:
            raise HTTPException(409, "Campaign is not deleted")
        c.deleted_at = None
        c.deleted_by_id = None
        c.deletion_reason = None
        db.commit()
        return serialize_campaign(c, [], db)
    finally:
        db.close()


def eligible_members(campaign_id: str, current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user)

        existing = {
            m.user_id for m in db.query(CampaignMember).filter_by(campaign_id=campaign_id).all()
        }
        users = db.query(User).filter(User.id != c.owner_id).all()
        return [
            {
                "id": u.id,
                "username": u.username,
                "display_name": u.display_name,
                "role": u.role,
                "already_invited": u.id in existing,
            }
            for u in users
        ]
    finally:
        db.close()
