"""Saved-filter CRUD endpoints.

Per-user named sort/filter presets, scoped to a library area
(systems/books/maps/tokens/audio). At most one preset per (user, scope) is the
default — the view the user lands on. Setting a preset default clears the flag
on any sibling in the same scope so the "one default per scope" invariant holds.
"""
from typing import Any, Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import SavedFilter
from ._schemas import VALID_SCOPES, SavedFilterCreate, SavedFilterUpdate


def _serialize(f: SavedFilter) -> dict[str, Any]:
    return {
        "id": f.id,
        "scope": f.scope,
        "name": f.name,
        "state": f.state or {},
        "is_default": bool(f.is_default),
    }


def _clear_other_defaults(db: Session, user_id: str, scope: str, keep_id: str) -> None:
    """Unset is_default on every other preset in this (user, scope)."""
    others = (
        db.query(SavedFilter)
        .filter(
            SavedFilter.user_id == user_id,
            SavedFilter.scope == scope,
            SavedFilter.is_default == True,  # noqa: E712
            SavedFilter.id != keep_id,
        )
        .all()
    )
    for o in others:
        o.is_default = False


def list_saved_filters(
    scope: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List the current user's saved filters, optionally limited to one scope."""
    q = db.query(SavedFilter).filter_by(user_id=user.id)
    if scope is not None:
        if scope not in VALID_SCOPES:
            raise HTTPException(400, "Invalid scope")
        q = q.filter_by(scope=scope)
    rows = q.order_by(SavedFilter.scope, SavedFilter.name).all()
    return {"filters": [_serialize(f) for f in rows]}


def create_saved_filter(
    body: SavedFilterCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a preset. Re-saving an existing (scope, name) overwrites its state."""
    existing = (
        db.query(SavedFilter)
        .filter_by(user_id=user.id, scope=body.scope, name=body.name.strip())
        .first()
    )
    if existing:
        existing.state = body.state
        if body.is_default:
            existing.is_default = True
            _clear_other_defaults(db, user.id, body.scope, existing.id)
        db.commit()
        return _serialize(existing)

    f = SavedFilter(
        user_id=user.id,
        scope=body.scope,
        name=body.name.strip(),
        state=body.state,
        is_default=body.is_default,
    )
    db.add(f)
    db.flush()
    if body.is_default:
        _clear_other_defaults(db, user.id, body.scope, f.id)
    db.commit()
    return _serialize(f)


def update_saved_filter(
    filter_id: str,
    body: SavedFilterUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rename a preset, replace its state, and/or set it as the scope default."""
    f = db.query(SavedFilter).filter_by(id=filter_id, user_id=user.id).first()
    if not f:
        raise HTTPException(404, "Saved filter not found")
    if body.name is not None:
        f.name = body.name.strip()
    if body.state is not None:
        f.state = body.state
    if body.is_default is not None:
        f.is_default = body.is_default
        if body.is_default:
            _clear_other_defaults(db, user.id, f.scope, f.id)
    db.commit()
    return _serialize(f)


def delete_saved_filter(
    filter_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete one of the current user's saved filters."""
    f = db.query(SavedFilter).filter_by(id=filter_id, user_id=user.id).first()
    if not f:
        raise HTTPException(404, "Saved filter not found")
    db.delete(f)
    db.commit()
    return {"status": "ok"}
