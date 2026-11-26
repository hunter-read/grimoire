"""The campaign owner's own VTT token.

A member's token lives on their membership (``uploads.upload_member_token``).
The owner has no membership - their row in the member list is synthetic - so
theirs lives on the campaign. That is what gives a player running a personal
campaign a token for their character without storing it over the character
sheet's portrait.

Only the owner sets it, and anyone who can see the campaign can fetch it, the
same split as a member's token. The archived freeze applies to writes.
"""
import os

from typing import Optional

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...file_cache import cached_file_response
from ...models import Campaign
from ...services.campaigns.token_recipes import clear_recipe, read_recipe, store_recipe
from ...services.campaigns.upload_quota import assert_token_upload_allowed
from ._helpers import assert_not_archived, can_view, get_campaign_or_404
from .uploads import (
    _IMAGE_TYPES,
    _MAX_IMAGE_BYTES,
    _TOKEN_DIR,
    _read_upload,
    _remove_existing,
    _validate_image,
)


def _stem(c: Campaign) -> str:
    # Prefixed so it can never share a stem with a membership's token, which is
    # named for the member id in the same directory.
    return f"owner-{c.id}"


def _owned_campaign_or_403(db: Session, campaign_id: str, user: CurrentUser) -> Campaign:
    c = get_campaign_or_404(db, campaign_id)
    if c.owner_id != user.id:
        raise HTTPException(403, "Only the campaign owner may set their token")
    assert_not_archived(c)
    return c


def upload_owner_token(
    campaign_id: str,
    file: UploadFile = File(...),
    recipe: Optional[str] = Form(None),
    source: Optional[UploadFile] = File(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set the owner's token, with the token editor's ``recipe`` when it sends
    one (see ``services/campaigns/token_recipes``). The source art it keeps is
    bound by the campaign upload limits (admins exempt)."""
    c = _owned_campaign_or_403(db, campaign_id, current_user)
    data, ext = _read_upload(file, _IMAGE_TYPES, _MAX_IMAGE_BYTES)
    _validate_image(data)
    pending = read_recipe(_stem(c), recipe, source)
    if current_user.role != "admin":
        assert_token_upload_allowed(db, c.id, pending)
    c.owner_token_recipe = store_recipe(pending)

    os.makedirs(_TOKEN_DIR, exist_ok=True)
    _remove_existing(_TOKEN_DIR, _stem(c))
    filename = f"{_stem(c)}{ext}"
    with open(os.path.join(_TOKEN_DIR, filename), "wb") as f:
        f.write(data)

    c.owner_token_path = filename
    db.commit()
    return {"owner_token_path": filename}


def get_owner_token(
    campaign_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")
    if not c.owner_token_path:
        raise HTTPException(404, "No token")
    path = os.path.join(_TOKEN_DIR, os.path.basename(c.owner_token_path))
    if not os.path.isfile(path):
        raise HTTPException(404, "No token")
    return cached_file_response(request, path)


def delete_owner_token(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = _owned_campaign_or_403(db, campaign_id, current_user)
    _remove_existing(_TOKEN_DIR, _stem(c))
    clear_recipe(_stem(c))
    c.owner_token_path = None
    c.owner_token_recipe = None
    db.commit()
