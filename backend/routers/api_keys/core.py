"""API key management endpoints (issue #489).

Admins always may hold keys; anyone else once an admin (or the OIDC permissions
claim) enables them for that user. Guests never may, and with API_KEYS_ENABLED
off nobody may - the router refuses every request. A user manages only their
own keys; an admin may also list and revoke anyone's. Nobody can read a key
back, and no one can mint a secret for a key that isn't theirs.
"""
from fastapi import Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from ... import api_keys
from ...auth import CurrentUser
from ...config import get_db
from ...models import ApiKey
from ._helpers import (
    issue_secret,
    load_user,
    require_key_user,
    require_session_user,
    serialize,
    usernames,
    validate_expiry,
    validate_permissions,
)
from ._schemas import ApiKeyCreate, ApiKeyUpdate


def _own_or_404(db: Session, key_id: str, user: CurrentUser) -> ApiKey:
    # Someone else's key is a 404, not a 403, so ids can't be probed.
    row = db.query(ApiKey).filter_by(id=key_id, user_id=user.id).first()
    if row is None:
        raise HTTPException(404, "API key not found")
    return row


def list_api_keys(
    all_users: bool = Query(
        False, alias="all", description="Admins only: every user's keys, not just your own"
    ),
    current_user: CurrentUser = Depends(require_session_user),
    db: Session = Depends(get_db),
):
    q = db.query(ApiKey)
    if all_users:
        if current_user.role != "admin":
            raise HTTPException(403, "Admin access required")
    else:
        if not api_keys.user_keys_allowed(load_user(db, current_user)):
            raise HTTPException(403, "API keys are not enabled for your account")
        q = q.filter_by(user_id=current_user.id)
    rows = q.order_by(ApiKey.created_at.desc()).all()
    names = usernames(db, rows)
    return [serialize(r, names.get(r.user_id)) for r in rows]


def list_permissions(
    request: Request,
    current_user: CurrentUser = Depends(require_key_user),
):
    levels = api_keys.available_levels(request.app.routes, current_user.role)
    return [
        {
            "id": perm,
            "tags": list(spec.tags),
            "description": spec.description,
            "group": spec.group,
            "levels": levels[perm],
        }
        for perm, spec in api_keys.PERMISSIONS.items()
        if perm in levels
    ]


def create_api_key(
    data: ApiKeyCreate,
    request: Request,
    current_user: CurrentUser = Depends(require_key_user),
    db: Session = Depends(get_db),
):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    row = ApiKey(
        user_id=current_user.id,
        name=name,
        permissions=validate_permissions(
            data.permissions, request.app.routes, current_user.role
        ),
        expires_at=validate_expiry(data.expires_at),
    )
    key = issue_secret(row)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"api_key": serialize(row, current_user.username), "key": key}


def update_api_key(
    key_id: str,
    data: ApiKeyUpdate,
    request: Request,
    current_user: CurrentUser = Depends(require_key_user),
    db: Session = Depends(get_db),
):
    row = _own_or_404(db, key_id, current_user)
    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(400, "Name is required")
        row.name = name
    if data.permissions is not None:
        row.permissions = validate_permissions(
            data.permissions, request.app.routes, current_user.role
        )
    # Distinguish "set to never" (explicit null) from "leave alone" (omitted).
    if "expires_at" in data.model_fields_set:
        row.expires_at = validate_expiry(data.expires_at)
    db.commit()
    db.refresh(row)
    return serialize(row, current_user.username)


def regenerate_api_key(
    key_id: str,
    current_user: CurrentUser = Depends(require_key_user),
    db: Session = Depends(get_db),
):
    """New secret, same name and permissions; the old secret stops working now."""
    row = _own_or_404(db, key_id, current_user)
    key = issue_secret(row)
    db.commit()
    db.refresh(row)
    return {"api_key": serialize(row, current_user.username), "key": key}


def delete_api_key(
    key_id: str,
    current_user: CurrentUser = Depends(require_session_user),
    db: Session = Depends(get_db),
):
    """Revoke a key. Admins may revoke anyone's, including a key whose owner has
    since lost access to keys."""
    if current_user.role == "admin":
        row = db.query(ApiKey).filter_by(id=key_id).first()
        if row is None:
            raise HTTPException(404, "API key not found")
    else:
        if not api_keys.user_keys_allowed(load_user(db, current_user)):
            raise HTTPException(403, "API keys are not enabled for your account")
        row = _own_or_404(db, key_id, current_user)
    db.delete(row)
    db.commit()
    return Response(status_code=204)
