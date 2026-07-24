"""Character sheet source handlers: duplicate a blank form-fillable sheet from
the library or a campaign file, and list what's available to duplicate.

These complement the upload/download/delete handlers in `uploads.py`. A member's
sheet lives at DATA_PATH/campaign_uploads/sheets/{member_id}.{ext}. In-app
editing is done client-side (pdf.js fills the form and re-uploads the copy), so
the backend only needs to serve the file and manage these blank-sheet sources.
"""

import os
import shutil

from fastapi import Body, Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Book, CampaignFile
from ._helpers import can_view, get_campaign_or_404
from .uploads import (
    _FILES_DIR,
    _MAX_SHEET_BYTES,
    _SHEET_DIR,
    _assert_can_edit_member,
    _get_member_or_404,
    _remove_existing,
)


def duplicate_member_sheet(
    campaign_id: str,
    member_id: str,
    source_type: str = Body(...),
    source_id: str = Body(...),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Copy a blank library book or campaign file PDF into the member's sheet slot."""
    c = get_campaign_or_404(db, campaign_id)
    member = _get_member_or_404(db, campaign_id, member_id)
    _assert_can_edit_member(c, member, current_user)

    if source_type == "book":
        book = db.query(Book).filter_by(id=source_id).first()
        if not book:
            raise HTTPException(404, "Book not found")
        src_path = book.filepath
        src_name = book.filename or os.path.basename(book.relative_path)
    elif source_type == "file":
        cf = db.query(CampaignFile).filter_by(id=source_id, campaign_id=campaign_id).first()
        if not cf:
            raise HTTPException(404, "File not found")
        src_path = os.path.join(_FILES_DIR, cf.stored_path)
        src_name = cf.filename
    else:
        raise HTTPException(400, "Invalid source type")

    if not src_name.lower().endswith(".pdf"):
        raise HTTPException(400, "Source is not a PDF")
    if not os.path.isfile(src_path):
        raise HTTPException(404, "Source file not found")
    if os.path.getsize(src_path) > _MAX_SHEET_BYTES:
        raise HTTPException(413, "Source file is too large")

    _remove_existing(_SHEET_DIR, member_id)
    filename = f"{member_id}.pdf"
    shutil.copyfile(src_path, os.path.join(_SHEET_DIR, filename))

    member.character_sheet_path = filename
    member.character_sheet_filename = src_name
    member.character_sheet_url = None
    db.commit()
    return {
        "character_sheet_path": filename,
        "character_sheet_filename": src_name,
    }


def list_sheet_sources(
    campaign_id: str, current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List blank sheets a member can duplicate: library character-sheet books +
    campaign PDF files."""
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")

    q = db.query(Book).filter(Book.category == "character-sheet")
    if c.system_id:
        q = q.filter(Book.game_system_id == c.system_id)
    books = [
        {"id": b.id, "name": b.title or os.path.basename(b.relative_path)}
        for b in q.order_by(Book.title).all()
        if b.relative_path.lower().endswith(".pdf")
    ]

    files = [
        {"id": f.id, "name": f.filename}
        for f in db.query(CampaignFile)
        .filter_by(campaign_id=campaign_id)
        .order_by(CampaignFile.filename)
        .all()
        if (f.mime_type or "").lower() == "application/pdf"
        or f.filename.lower().endswith(".pdf")
    ]

    return {"books": books, "files": files}
