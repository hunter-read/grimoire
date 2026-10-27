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
from ...models import Book, Campaign, CampaignFile
from ...services import access_control
from ...services.books.access import can_read_book
from ._helpers import can_view, get_campaign_or_404
from .uploads import (
    _FILES_DIR,
    _MAX_SHEET_BYTES,
    _SHEET_DIR,
    _assert_can_edit_member,
    _get_member_or_404,
    _remove_existing,
    can_read_campaign_file,
)


def _is_pdf_name(name: str) -> bool:
    return name.lower().endswith(".pdf")


def _sheet_books(db: Session, c: Campaign, user: CurrentUser) -> list[Book]:
    """Library character-sheet PDFs this user may copy into a sheet slot.

    Duplicating copies the whole file into a slot the member can download, so
    the source must be a book the user could already read: the access level
    applies to everyone, and a guest is further limited to books shared into
    their campaign (issue #519).
    """
    q = db.query(Book).filter(Book.category == "character-sheet")
    if c.system_id:
        q = q.filter(Book.game_system_id == c.system_id)
    q = access_control.visible_books(db, q, access_control.load_user(db, user))
    books = [b for b in q.order_by(Book.title).all() if _is_pdf_name(b.relative_path)]
    if user.role == "guest":
        books = [b for b in books if can_read_book(db, b, user)]
    return books


def _sheet_files(db: Session, c: Campaign, user: CurrentUser) -> list[CampaignFile]:
    """Campaign PDF uploads this user may copy: those whose resource they can see."""
    return [
        f
        for f in db.query(CampaignFile)
        .filter_by(campaign_id=c.id)
        .order_by(CampaignFile.filename)
        .all()
        if ((f.mime_type or "").lower() == "application/pdf" or _is_pdf_name(f.filename))
        and can_read_campaign_file(db, c, user.id, f.id)
    ]


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

    # Only what `list_sheet_sources` offers this user can be copied: anything
    # else would let a member pull an arbitrary library book or a GM-only
    # campaign file into a slot they can download.
    if source_type == "book":
        book = next((b for b in _sheet_books(db, c, current_user) if b.id == source_id), None)
        if not book:
            raise HTTPException(404, "Book not found")
        src_path = book.filepath
        src_name = book.filename or os.path.basename(book.relative_path)
    elif source_type == "file":
        cf = next((f for f in _sheet_files(db, c, current_user) if f.id == source_id), None)
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

    books = [
        {"id": b.id, "name": b.title or os.path.basename(b.relative_path)}
        for b in _sheet_books(db, c, current_user)
    ]
    files = [{"id": f.id, "name": f.filename} for f in _sheet_files(db, c, current_user)]
    return {"books": books, "files": files}
