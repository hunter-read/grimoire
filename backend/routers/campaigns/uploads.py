"""Upload, serve, and delete handlers for campaign banners, character art, and sheets.

Files live on disk under DATA_PATH/campaign_uploads/{banners,art,sheets}/. Banners are
keyed by campaign id; character art and sheets are keyed by the CampaignMember id so a
player who belongs to several campaigns gets a distinct file per membership.
"""

import io
import os
import uuid

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile

from ...auth import CurrentUser, get_current_user
from ...config import CAMPAIGN_UPLOAD_DIR, SessionLocal, logger
from ...file_cache import cached_file_response
from ...models import Campaign, CampaignMember
from ._helpers import assert_can_manage, can_view, get_campaign_or_404

# Allowed image types for banners and character art.
_IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
# Character sheets may be a PDF or an image.
_SHEET_TYPES = {**_IMAGE_TYPES, "application/pdf": ".pdf"}

_MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB
_MAX_SHEET_BYTES = 15 * 1024 * 1024  # 15 MB

_BANNER_DIR = os.path.join(CAMPAIGN_UPLOAD_DIR, "banners")
_ART_DIR = os.path.join(CAMPAIGN_UPLOAD_DIR, "art")
_SHEET_DIR = os.path.join(CAMPAIGN_UPLOAD_DIR, "sheets")
_FILES_DIR = os.path.join(CAMPAIGN_UPLOAD_DIR, "files")

# Hard ceiling regardless of admin settings, to bound a single read.
_MAX_FILE_BYTES = 200 * 1024 * 1024  # 200 MB


def _validate_image(data: bytes) -> None:
    """Verify the bytes really decode as an image (reject disguised files)."""
    from PIL import Image

    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception:
        raise HTTPException(400, "File is not a valid image")


def _read_upload(upload: UploadFile, allowed: dict, max_bytes: int) -> bytes:
    if upload.content_type not in allowed:
        raise HTTPException(400, f"Unsupported file type: {upload.content_type}")
    data = upload.file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(413, "File is too large")
    if not data:
        raise HTTPException(400, "Empty file")
    return data


def _remove_existing(directory: str, stem: str) -> None:
    """Delete any prior file for this stem regardless of stored extension."""
    if not os.path.isdir(directory):
        return
    for name in os.listdir(directory):
        if name.rsplit(".", 1)[0] == stem:
            try:
                os.remove(os.path.join(directory, name))
            except OSError as e:
                # Best-effort cleanup of a prior upload; a stale file left behind
                # is not fatal but is logged for visibility.
                logger.warning("Failed to remove prior upload %s: %s", name, e)


def _get_member_or_404(db, campaign_id: str, member_id: str) -> CampaignMember:
    member = (
        db.query(CampaignMember).filter_by(id=member_id, campaign_id=campaign_id).first()
    )
    if not member:
        raise HTTPException(404, "Member not found")
    return member


def _assert_can_edit_member(campaign: Campaign, member: CampaignMember, user: CurrentUser) -> None:
    """The member themselves or the campaign owner may edit a member's art/sheet."""
    if member.user_id != user.id and campaign.owner_id != user.id:
        raise HTTPException(403, "Not authorised to edit this member")


# --- Banner -----------------------------------------------------------------


def upload_banner(
    campaign_id: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user, db)
        data = _read_upload(file, _IMAGE_TYPES, _MAX_IMAGE_BYTES)
        _validate_image(data)

        ext = _IMAGE_TYPES[file.content_type]
        _remove_existing(_BANNER_DIR, campaign_id)
        filename = f"{campaign_id}{ext}"
        with open(os.path.join(_BANNER_DIR, filename), "wb") as f:
            f.write(data)

        c.banner_path = filename
        db.commit()
        return {"banner_path": filename}
    finally:
        db.close()


def get_banner(
    campaign_id: str, request: Request, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        if not can_view(c, current_user, db):
            raise HTTPException(403, "Not a member of this campaign")
        if not c.banner_path:
            raise HTTPException(404, "No banner")
        path = os.path.join(_BANNER_DIR, c.banner_path)
        if not os.path.isfile(path):
            raise HTTPException(404, "No banner")
        return cached_file_response(request, path)
    finally:
        db.close()


def delete_banner(campaign_id: str, current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user, db)
        _remove_existing(_BANNER_DIR, campaign_id)
        c.banner_path = None
        db.commit()
    finally:
        db.close()


# --- Character art ----------------------------------------------------------


def upload_member_art(
    campaign_id: str,
    member_id: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        member = _get_member_or_404(db, campaign_id, member_id)
        _assert_can_edit_member(c, member, current_user)
        data = _read_upload(file, _IMAGE_TYPES, _MAX_IMAGE_BYTES)
        _validate_image(data)

        ext = _IMAGE_TYPES[file.content_type]
        _remove_existing(_ART_DIR, member_id)
        filename = f"{member_id}{ext}"
        with open(os.path.join(_ART_DIR, filename), "wb") as f:
            f.write(data)

        member.character_art_path = filename
        db.commit()
        return {"character_art_path": filename}
    finally:
        db.close()


def get_member_art(
    campaign_id: str,
    member_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        if not can_view(c, current_user, db):
            raise HTTPException(403, "Not a member of this campaign")
        member = _get_member_or_404(db, campaign_id, member_id)
        if not member.character_art_path:
            raise HTTPException(404, "No art")
        path = os.path.join(_ART_DIR, member.character_art_path)
        if not os.path.isfile(path):
            raise HTTPException(404, "No art")
        return cached_file_response(request, path)
    finally:
        db.close()


def delete_member_art(
    campaign_id: str, member_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        member = _get_member_or_404(db, campaign_id, member_id)
        _assert_can_edit_member(c, member, current_user)
        _remove_existing(_ART_DIR, member_id)
        member.character_art_path = None
        db.commit()
    finally:
        db.close()


# --- Character sheet --------------------------------------------------------


def upload_member_sheet(
    campaign_id: str,
    member_id: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        member = _get_member_or_404(db, campaign_id, member_id)
        _assert_can_edit_member(c, member, current_user)
        data = _read_upload(file, _SHEET_TYPES, _MAX_SHEET_BYTES)
        if file.content_type in _IMAGE_TYPES:
            _validate_image(data)

        ext = _SHEET_TYPES[file.content_type]
        _remove_existing(_SHEET_DIR, member_id)
        filename = f"{member_id}{ext}"
        with open(os.path.join(_SHEET_DIR, filename), "wb") as f:
            f.write(data)

        member.character_sheet_path = filename
        member.character_sheet_filename = os.path.basename(file.filename or f"sheet{ext}")
        member.character_sheet_url = None  # an uploaded sheet replaces any URL
        db.commit()
        return {
            "character_sheet_path": filename,
            "character_sheet_filename": member.character_sheet_filename,
        }
    finally:
        db.close()


def get_member_sheet(
    campaign_id: str,
    member_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        if not can_view(c, current_user, db):
            raise HTTPException(403, "Not a member of this campaign")
        member = _get_member_or_404(db, campaign_id, member_id)
        if not member.character_sheet_path:
            raise HTTPException(404, "No sheet")
        path = os.path.join(_SHEET_DIR, member.character_sheet_path)
        if not os.path.isfile(path):
            raise HTTPException(404, "No sheet")
        return cached_file_response(
            request,
            path,
            filename=member.character_sheet_filename or member.character_sheet_path,
        )
    finally:
        db.close()


def delete_member_sheet(
    campaign_id: str, member_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        member = _get_member_or_404(db, campaign_id, member_id)
        _assert_can_edit_member(c, member, current_user)
        _remove_existing(_SHEET_DIR, member_id)
        member.character_sheet_path = None
        member.character_sheet_filename = None
        db.commit()
    finally:
        db.close()


# --- Campaign file uploads (linked as resource_type='file') -----------------


def _upload_limits(db):
    """Return (disabled, max_file_bytes, max_total_bytes); 0 bytes = unlimited."""
    from ..settings._helpers import _get_raw

    raw = _get_raw(db)
    disabled = raw.get("campaign_uploads_disabled") == "true"
    max_file = int(raw.get("campaign_upload_max_file_mb") or 0) * 1024 * 1024
    max_total = int(raw.get("campaign_upload_max_total_mb") or 0) * 1024 * 1024
    return disabled, max_file, max_total


def upload_campaign_file(
    campaign_id: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """GM uploads a file that becomes a linked 'file' resource. Admins bypass limits."""
    from ...models import CampaignFile, CampaignResource

    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user, db)

        is_admin = current_user.role == "admin"
        disabled, max_file, max_total = _upload_limits(db)
        if disabled and not is_admin:
            raise HTTPException(403, "Campaign file uploads are disabled by the administrator")

        data = file.file.read(_MAX_FILE_BYTES + 1)
        if not data:
            raise HTTPException(400, "Empty file")
        if len(data) > _MAX_FILE_BYTES:
            raise HTTPException(413, "File is too large")
        if not is_admin and max_file and len(data) > max_file:
            raise HTTPException(413, "File exceeds the per-file size limit")

        if not is_admin and max_total:
            used = sum(
                f.size_bytes or 0
                for f in db.query(CampaignFile).filter_by(campaign_id=campaign_id).all()
            )
            if used + len(data) > max_total:
                raise HTTPException(413, "Campaign upload storage limit reached")

        ext = os.path.splitext(file.filename or "")[1][:16]
        stored = f"{uuid.uuid4().hex}{ext}"
        with open(os.path.join(_FILES_DIR, stored), "wb") as f:
            f.write(data)

        cf = CampaignFile(
            campaign_id=campaign_id,
            stored_path=stored,
            filename=os.path.basename(file.filename or stored),
            mime_type=file.content_type or "application/octet-stream",
            size_bytes=len(data),
            is_image=(file.content_type in _IMAGE_TYPES),
            uploaded_by_id=current_user.id,
        )
        db.add(cf)
        db.flush()

        # Link it as a resource so it shows alongside books/maps/tokens.
        max_order = db.query(CampaignResource).filter_by(campaign_id=campaign_id).count()
        res = CampaignResource(
            campaign_id=campaign_id,
            resource_type="file",
            resource_id=cf.id,
            visibility="gm",
            sort_order=max_order,
        )
        db.add(res)
        db.commit()
        db.refresh(res)
        return {
            "id": res.id,
            "resource_type": "file",
            "resource_id": cf.id,
            "name": cf.filename,
            "is_image": cf.is_image,
            "visibility": res.visibility,
            "category_id": res.category_id,
            "sort_order": res.sort_order,
        }
    finally:
        db.close()


def upload_campaign_image(
    campaign_id: str,
    file: UploadFile = File(...),
    category_id: str = Form(""),
    new_category_name: str = Form(""),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Upload an image to embed in a wiki note.

    The image becomes a campaign file resource (resource_type='file', is_image=True)
    so it also appears under linked resources. The GM may file it under an existing
    resource category (`category_id`) or create a new one (`new_category_name`).
    """
    from ...models import CampaignCategory, CampaignFile, CampaignResource

    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user, db)

        is_admin = current_user.role == "admin"
        disabled, max_file, _max_total = _upload_limits(db)
        if disabled and not is_admin:
            raise HTTPException(403, "Campaign file uploads are disabled by the administrator")

        data = _read_upload(file, _IMAGE_TYPES, _MAX_IMAGE_BYTES)
        _validate_image(data)
        if not is_admin and max_file and len(data) > max_file:
            raise HTTPException(413, "File exceeds the per-file size limit")

        # Resolve the category: an existing resource category, or create a new one.
        resolved_category_id = None
        new_name = (new_category_name or "").strip()
        if new_name:
            max_order = (
                db.query(CampaignCategory)
                .filter_by(campaign_id=campaign_id, kind="resource")
                .count()
            )
            cat = CampaignCategory(
                campaign_id=campaign_id,
                kind="resource",
                name=new_name,
                sort_order=max_order,
            )
            db.add(cat)
            db.flush()
            resolved_category_id = cat.id
        elif category_id:
            cat = (
                db.query(CampaignCategory)
                .filter_by(id=category_id, campaign_id=campaign_id, kind="resource")
                .first()
            )
            if not cat:
                raise HTTPException(400, "Invalid category")
            resolved_category_id = cat.id

        ext = _IMAGE_TYPES[file.content_type]
        stored = f"{uuid.uuid4().hex}{ext}"
        with open(os.path.join(_FILES_DIR, stored), "wb") as f:
            f.write(data)

        cf = CampaignFile(
            campaign_id=campaign_id,
            stored_path=stored,
            filename=os.path.basename(file.filename or stored),
            mime_type=file.content_type,
            size_bytes=len(data),
            is_image=True,
            uploaded_by_id=current_user.id,
        )
        db.add(cf)
        db.flush()

        max_order = db.query(CampaignResource).filter_by(campaign_id=campaign_id).count()
        res = CampaignResource(
            campaign_id=campaign_id,
            resource_type="file",
            resource_id=cf.id,
            visibility="gm",
            category_id=resolved_category_id,
            sort_order=max_order,
        )
        db.add(res)
        db.commit()
        db.refresh(res)
        return {
            "id": res.id,
            "resource_type": "file",
            "resource_id": cf.id,
            "name": cf.filename,
            "is_image": True,
            "visibility": res.visibility,
            "category_id": res.category_id,
            "sort_order": res.sort_order,
        }
    finally:
        db.close()


def get_campaign_file(
    campaign_id: str,
    file_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    from ...models import CampaignFile, CampaignResource, CampaignResourceShare

    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        if not can_view(c, current_user, db):
            raise HTTPException(403, "Not a member of this campaign")
        cf = db.query(CampaignFile).filter_by(id=file_id, campaign_id=campaign_id).first()
        if not cf:
            raise HTTPException(404, "File not found")

        # Honour the linking resource's visibility for non-owners.
        if c.owner_id != current_user.id:
            res = (
                db.query(CampaignResource)
                .filter_by(campaign_id=campaign_id, resource_type="file", resource_id=file_id)
                .first()
            )
            if not res or res.visibility == "gm":
                raise HTTPException(403, "Not authorised")
            if res.visibility == "private":
                shared = (
                    db.query(CampaignResourceShare)
                    .filter_by(resource_id=res.id, user_id=current_user.id)
                    .first()
                )
                if not shared:
                    raise HTTPException(403, "Not authorised")

        path = os.path.join(_FILES_DIR, cf.stored_path)
        if not os.path.isfile(path):
            raise HTTPException(404, "File not found")
        return cached_file_response(
            request, path, filename=cf.filename, media_type=cf.mime_type
        )
    finally:
        db.close()
