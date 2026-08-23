"""Per-user access grants — admin CRUD (issue #258).

Grants let an admin hand one GM access to a restricted system or book without
lowering the restriction for everyone else: "Priya runs the Ravenloft campaign,
give her that whole shelf". They are the fine-grained escape hatch that makes a
locked-down library workable.

Only GMs may hold grants. Admins already see everything, so a grant would be a
no-op, and players and guests are exactly who the restrictions exist to exclude
— granting one past a restriction would make the level meaningless. The rule is
enforced here on the write path and again in ``access_control`` on every read,
so a row inserted by hand still cannot widen a player's access.
"""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_admin
from ...config import get_db
from ...models import Book, GameSystem, User, UserAccessGrant
from ...models.access import RESTRICTED_LEVELS, SCOPE_BOOK, SCOPE_SYSTEM, normalize
from ...services import access_control
from ._schemas import AccessGrantCreate


def _scope_name(db: Session, scope_type: str, scope_id: str) -> str:
    """Display name for a grant's target, or "" when the row is gone.

    Grants deliberately carry no foreign key on ``scope_id`` (it addresses two
    tables), so a deleted book or system leaves a harmless orphan. Returning ""
    lets the UI show and remove one rather than hiding it.
    """
    if scope_type == SCOPE_SYSTEM:
        row = db.query(GameSystem).filter_by(id=scope_id).first()
        return row.name if row else ""
    row = db.query(Book).filter_by(id=scope_id).first()
    return row.title if row else ""


def _serialize(db: Session, grant: UserAccessGrant) -> dict:
    return {
        "id": grant.id,
        "user_id": grant.user_id,
        "scope_type": grant.scope_type,
        "scope_id": grant.scope_id,
        "scope_name": _scope_name(db, grant.scope_type, grant.scope_id),
        "level": normalize(grant.level),
    }


def list_access_grants(
    user_id: str,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Every grant held by one user."""
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    grants = (
        db.query(UserAccessGrant)
        .filter_by(user_id=user_id)
        .order_by(UserAccessGrant.scope_type, UserAccessGrant.scope_id)
        .all()
    )
    return [_serialize(db, g) for g in grants]


def create_access_grant(
    user_id: str,
    data: AccessGrantCreate,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Grant one user access to a restricted system or book.

    Re-granting an existing scope updates its level rather than erroring, so the
    UI's level picker is a plain PUT-like write and cannot trip the unique
    constraint.
    """
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    if not access_control.can_receive_grants(user.role):
        raise HTTPException(
            400,
            "Only GMs can hold access grants — admins already have full access, "
            "and players cannot be granted past a restriction",
        )
    if data.scope_type not in (SCOPE_SYSTEM, SCOPE_BOOK):
        raise HTTPException(400, "scope_type must be 'system' or 'book'")
    if data.level not in RESTRICTED_LEVELS:
        raise HTTPException(400, "level must be 'gm' or 'admin'")

    # The target must exist: a grant naming nothing is a typo, and silently
    # storing it would leave the admin believing they had granted something.
    if data.scope_type == SCOPE_SYSTEM:
        exists = db.query(GameSystem).filter_by(id=data.scope_id).first()
    else:
        exists = db.query(Book).filter_by(id=data.scope_id).first()
    if not exists:
        raise HTTPException(404, f"No such {data.scope_type}")

    grant = (
        db.query(UserAccessGrant)
        .filter_by(user_id=user_id, scope_type=data.scope_type, scope_id=data.scope_id)
        .first()
    )
    if grant is None:
        grant = UserAccessGrant(
            user_id=user_id,
            scope_type=data.scope_type,
            scope_id=data.scope_id,
            level=data.level,
        )
        db.add(grant)
    else:
        grant.level = data.level
    db.commit()
    db.refresh(grant)
    return _serialize(db, grant)


def delete_access_grant(
    user_id: str,
    grant_id: str,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Revoke one grant."""
    grant = db.query(UserAccessGrant).filter_by(id=grant_id, user_id=user_id).first()
    if not grant:
        raise HTTPException(404, "Grant not found")
    db.delete(grant)
    db.commit()
    return None
