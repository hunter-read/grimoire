"""Creating and managing share links (issue #541).

Anyone who may share can create links to what they can read; anyone - even
after losing the right to share - can list, revoke and delete their own, since
that is how they take a link down. Admins can see and revoke everyone's.
"""
import datetime
import os
from typing import Optional

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, hash_password, require_admin, require_not_guest
from ...config import get_db
from ...models import ShareLink, User
from ...services import share_links as policy
from ..share import _content, _links
from ._schemas import ShareLinkCreate, ShareLinkUpdate


def _me(db: Session, current_user: CurrentUser) -> User:
    user = db.query(User).filter_by(id=current_user.id).first()
    if user is None:
        raise HTTPException(401, "User no longer exists")
    return user


def _owned(db: Session, link_id: str, current_user: CurrentUser) -> ShareLink:
    """A link the caller may manage: their own, or anyone's for an admin. Others
    404 rather than 403, so ids cannot be probed."""
    link = db.query(ShareLink).filter_by(id=link_id).first()
    if link is None or (link.user_id != current_user.id and current_user.role != "admin"):
        raise HTTPException(404, "Share link not found")
    return link


def _newest_first(query):
    return query.order_by(ShareLink.created_at.desc()).all()


def get_share_permission(
    current_user: CurrentUser = Depends(require_not_guest),
    db: Session = Depends(get_db),
):
    status = policy.share_status(db, _me(db, current_user))
    return {"enabled": policy.links_enabled(), **status}


def list_share_links(
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    variant: Optional[str] = None,
    current_user: CurrentUser = Depends(require_not_guest),
    db: Session = Depends(get_db),
):
    query = db.query(ShareLink).filter_by(user_id=current_user.id)
    if resource_type:
        query = query.filter_by(resource_type=resource_type)
    if resource_id:
        query = query.filter_by(resource_id=resource_id)
    if variant:
        query = query.filter_by(variant=variant)
    return [_links.serialize(db, link) for link in _newest_first(query)]


def list_all_share_links(
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return [_links.serialize(db, link, with_owner=True) for link in _newest_first(db.query(ShareLink))]


def list_user_share_links(
    user_id: str,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    query = db.query(ShareLink).filter_by(user_id=user_id)
    return [_links.serialize(db, link, with_owner=True) for link in _newest_first(query)]


def create_share_link(
    data: ShareLinkCreate,
    current_user: CurrentUser = Depends(require_not_guest),
    db: Session = Depends(get_db),
):
    if not policy.links_enabled():
        raise HTTPException(403, "Share links are turned off on this server")
    if not policy.user_can_share(db, _me(db, current_user)):
        raise HTTPException(403, "You do not have permission to create share links")
    record = _content.load_record(db, data.resource_type, data.resource_id)
    if record is None:
        raise HTTPException(404, "Item not found")
    # The same check its own file route makes: you can only share what you can open.
    _content.assert_readable(db, current_user, data.resource_type, record)
    if not os.path.exists(record.filepath):
        raise HTTPException(404, "File not found on disk")

    filename = _content.served_filename(data.resource_type, record)
    options = None
    if data.variant == "otfbm":
        # Rendered now rather than on first fetch: the filename carries the
        # served extension (PNG only for a transparent map), and the cache is
        # warm for OTFBM's first request.
        if data.resource_type != "map":
            raise HTTPException(400, "Only maps can be shared as an OTFBM background")
        from ..maps.otfbm_export import otfbm_background, otfbm_filename

        plan, _raw, ext = otfbm_background(record, data.cell)
        filename = otfbm_filename(record, plan, ext)
        options = {"cell": plan["cell"]}

    link = ShareLink(
        token=policy.new_token(),
        user_id=current_user.id,
        resource_type=data.resource_type,
        resource_id=record.id,
        label=data.label.strip(),
        filename=filename,
        variant=data.variant,
        variant_options=options,
        password_hash=hash_password(data.password) if data.password else None,
        expires_at=policy.expires_at_for(data.expires_in_days),
        use_count=0,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return _links.serialize(db, link)


def update_share_link(
    link_id: str,
    data: ShareLinkUpdate,
    current_user: CurrentUser = Depends(require_not_guest),
    db: Session = Depends(get_db),
):
    link = _owned(db, link_id, current_user)
    if link.revoked_at is not None:
        raise HTTPException(400, "A revoked link cannot be changed")
    sent = data.model_fields_set
    if "label" in sent and data.label is not None:
        link.label = data.label.strip()
    if "expires_in_days" in sent:
        link.expires_at = policy.expires_at_for(data.expires_in_days)
    if "password" in sent:
        if data.password and len(data.password) < 4:
            raise HTTPException(422, "Password must be at least 4 characters")
        link.password_hash = hash_password(data.password) if data.password else None
    db.commit()
    db.refresh(link)
    return _links.serialize(db, link, with_owner=link.user_id != current_user.id)


def revoke_share_link(
    link_id: str,
    current_user: CurrentUser = Depends(require_not_guest),
    db: Session = Depends(get_db),
):
    """Stop a link working for good. Kept in the list as revoked until deleted."""
    link = _owned(db, link_id, current_user)
    if link.revoked_at is None:
        link.revoked_at = datetime.datetime.now(datetime.timezone.utc)
        link.revoked_by_id = current_user.id
        db.commit()
        db.refresh(link)
    return _links.serialize(db, link, with_owner=link.user_id != current_user.id)


def delete_share_link(
    link_id: str,
    current_user: CurrentUser = Depends(require_not_guest),
    db: Session = Depends(get_db),
):
    link = _owned(db, link_id, current_user)
    db.delete(link)
    db.commit()
    return {"status": "deleted"}
