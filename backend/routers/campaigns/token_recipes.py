"""Reopening a stored token in the token editor, and updating one filed as a resource.

A token's recipe is written with the token itself, by the upload that stores
it (``uploads.upload_member_token``, ``owner_token.upload_owner_token``,
``uploads.upload_campaign_image``). Here the editor reads it back - the
settings, and the device art it kept - and a token filed as a campaign
resource is replaced in place rather than added again as a second file.

Only someone who may change the token reads its recipe: the member themselves
or the campaign owner for a member's token, the owner for their own token and
for a campaign file. Everyone else sees the token and never the uncropped art
behind it.
"""
import os
import uuid
from typing import Literal, Optional

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...file_cache import cached_file_response
from ...models import Campaign, CampaignFile
from ...services.campaigns.token_recipes import (
    SOURCE_MEDIA_TYPES,
    TOKEN_SOURCE_DIR,
    public_recipe,
    read_recipe,
    store_recipe,
)
from ...services.campaigns.upload_files import remove_after_commit
from ...services.campaigns.upload_quota import assert_token_upload_allowed
from ._helpers import assert_can_manage, get_campaign_or_404
from .uploads import (
    _FILES_DIR,
    _IMAGE_MEDIA_TYPES,
    _IMAGE_TYPES,
    _MAX_IMAGE_BYTES,
    _get_member_or_404,
    _read_upload,
    _upload_limits,
    _validate_image,
)

RecipeKind = Literal["member", "owner", "file"]


def _recipe_for(db: Session, c: Campaign, kind: str, target_id: str, user: CurrentUser) -> dict:
    """The stored recipe, if ``user`` may change the token it belongs to; else 403/404."""
    if kind == "member":
        member = _get_member_or_404(db, c.id, target_id)
        if member.user_id != user.id and c.owner_id != user.id:
            raise HTTPException(403, "Not authorised to edit this member's token")
        recipe = member.character_token_recipe if member.character_token_path else None
    elif kind == "owner":
        if target_id != c.id:
            raise HTTPException(404, "Token not found")
        if c.owner_id != user.id:
            raise HTTPException(403, "Only the campaign owner may edit their token")
        recipe = c.owner_token_recipe if c.owner_token_path else None
    else:
        if c.owner_id != user.id:
            raise HTTPException(403, "Not authorised to manage this campaign")
        cf = db.query(CampaignFile).filter_by(id=target_id, campaign_id=c.id).first()
        if not cf:
            raise HTTPException(404, "File not found")
        recipe = cf.token_recipe
    if not recipe:
        raise HTTPException(404, "This token has no recipe to reopen")
    return recipe


def get_token_recipe(
    campaign_id: str,
    kind: RecipeKind,
    target_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The token editor's settings for a stored token, to reopen it."""
    c = get_campaign_or_404(db, campaign_id)
    return public_recipe(_recipe_for(db, c, kind, target_id, current_user))


def get_token_recipe_source(
    campaign_id: str,
    kind: RecipeKind,
    target_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The device art a recipe kept. A library source is read from the library."""
    c = get_campaign_or_404(db, campaign_id)
    source = _recipe_for(db, c, kind, target_id, current_user).get("source") or {}
    name = os.path.basename(source.get("path") or "")
    path = os.path.join(TOKEN_SOURCE_DIR, name)
    if source.get("type") != "upload" or not name or not os.path.isfile(path):
        raise HTTPException(404, "No stored source art")
    ext = os.path.splitext(name)[1].lower()
    return cached_file_response(request, path, media_type=SOURCE_MEDIA_TYPES.get(ext))


def update_token_file(
    campaign_id: str,
    file_id: str,
    file: UploadFile = File(...),
    recipe: Optional[str] = Form(None),
    source: Optional[UploadFile] = File(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace a campaign image with a new version of the token, keeping its place.

    The resource, its category, visibility and shares stay as they were; only
    the picture and its recipe change. Bound by the same upload limits as a new
    campaign image, the campaign's total counting only what the new picture and
    its source art add.
    """
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    cf = db.query(CampaignFile).filter_by(id=file_id, campaign_id=campaign_id).first()
    if not cf:
        raise HTTPException(404, "File not found")
    if not cf.is_image:
        raise HTTPException(400, "Only an image can be replaced by a token")

    is_admin = current_user.role == "admin"
    disabled, max_file, _max_total = _upload_limits(db)
    if disabled and not is_admin:
        raise HTTPException(403, "Campaign file uploads are disabled by the administrator")
    data, ext = _read_upload(file, _IMAGE_TYPES, _MAX_IMAGE_BYTES)
    _validate_image(data)
    if not is_admin and max_file and len(data) > max_file:
        raise HTTPException(413, "File exceeds the per-file size limit")
    # Only the growth counts: the old picture's bytes go with it, and so does
    # the source art it kept.
    pending = read_recipe(f"file-{cf.id}", recipe, source)
    if not is_admin:
        assert_token_upload_allowed(
            db, campaign_id, pending, adding=len(data), replacing=cf.size_bytes or 0
        )

    cf.token_recipe = store_recipe(pending)

    # A new name rather than an overwrite: the old file goes only once the row
    # points at the new one, and a changed name is also a changed cache key.
    stored = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(_FILES_DIR, stored), "wb") as f:
        f.write(data)
    remove_after_commit(db, [os.path.join(_FILES_DIR, os.path.basename(cf.stored_path))])
    cf.stored_path = stored
    cf.mime_type = _IMAGE_MEDIA_TYPES[ext]
    cf.size_bytes = len(data)
    db.commit()
    return {"id": cf.id, "token_editable": cf.token_recipe is not None}
