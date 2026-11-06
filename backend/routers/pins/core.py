"""Pin endpoints: the folders and game systems a user keeps one click away.

A pin belongs to one user and one browse view. Pinning is idempotent - pinning
something already pinned returns the existing pin - so a double click or a
retried request never errors or duplicates.
"""
from typing import Any, Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Pin
from ._schemas import VALID_COLLECTIONS, PinIn

#: Pins per view. The strip is for a handful of places a user returns to; this
#: only stops a runaway client from growing the table without bound.
MAX_PINS_PER_COLLECTION = 100


def _serialize(pin: Pin) -> dict[str, Any]:
    return {"id": pin.id, "collection": pin.collection, "target": pin.target}


def list_pins(
    collection: Optional[str] = Query(None, description="Only this view's pins."),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The current user's pins, oldest first, optionally for one view."""
    q = db.query(Pin).filter_by(user_id=user.id)
    if collection is not None:
        if collection not in VALID_COLLECTIONS:
            raise HTTPException(400, "Invalid collection")
        q = q.filter_by(collection=collection)
    rows = q.order_by(Pin.created_at, Pin.id).all()
    return {"pins": [_serialize(p) for p in rows]}


def add_pin(
    body: PinIn,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pin a folder or system; returns the existing pin if it is already pinned."""
    existing = (
        db.query(Pin)
        .filter_by(user_id=user.id, collection=body.collection, target=body.target)
        .first()
    )
    if existing:
        return _serialize(existing)
    count = db.query(Pin).filter_by(user_id=user.id, collection=body.collection).count()
    if count >= MAX_PINS_PER_COLLECTION:
        raise HTTPException(
            400, f"A view can hold at most {MAX_PINS_PER_COLLECTION} pins - unpin one first"
        )
    pin = Pin(user_id=user.id, collection=body.collection, target=body.target)
    db.add(pin)
    db.commit()
    return _serialize(pin)


def remove_pin(
    pin_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Unpin. Another user's pin is a 404, the same as one that does not exist."""
    pin = db.query(Pin).filter_by(id=pin_id, user_id=user.id).first()
    if not pin:
        raise HTTPException(404, "Pin not found")
    db.delete(pin)
    db.commit()
