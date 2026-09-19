"""Character portraits: upload, serve, delete.

Follows the campaign character-art path — the same image types, the same size
cap, the same "store a filename, not a path" rule — because a portrait is the
same kind of thing and should behave the same way. Portraits live in their own
directory rather than under a campaign's uploads, since a character may have no
campaign.
"""
import io
import os

from fastapi import Depends, File, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import CHARACTER_PORTRAIT_DIR, get_db
from ...file_cache import cached_file_response
from ...models import Character
from ._helpers import readable_character_or_404

#: The image types a portrait may be, mirroring campaign character art.
PORTRAIT_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_PORTRAIT_BYTES = 5 * 1024 * 1024


def _owned_or_404(db: Session, character_id: str, user_id: str) -> Character:
    row = db.query(Character).filter_by(id=character_id, user_id=user_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Character not found")
    return row


def _read_image(upload: UploadFile) -> bytes:
    if upload.content_type not in PORTRAIT_TYPES:
        allowed = ", ".join(sorted(PORTRAIT_TYPES))
        raise HTTPException(
            status_code=400, detail=f"A portrait must be one of: {allowed}"
        )
    data = upload.file.read(MAX_PORTRAIT_BYTES + 1)
    if len(data) > MAX_PORTRAIT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"A portrait may be at most {MAX_PORTRAIT_BYTES // (1024 * 1024)} MB",
        )
    if not data:
        raise HTTPException(status_code=400, detail="That file is empty")

    # Verify the bytes really decode as an image, so a renamed executable
    # cannot be stored and served back as one.
    from PIL import Image

    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="That file is not an image") from exc
    return data


def _remove_existing(character_id: str) -> None:
    for extension in set(PORTRAIT_TYPES.values()):
        candidate = os.path.join(CHARACTER_PORTRAIT_DIR, f"{character_id}{extension}")
        if os.path.isfile(candidate):
            os.remove(candidate)


def upload_portrait(
    character_id: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set a character's portrait. Only the character's owner may."""
    character = _owned_or_404(db, character_id, current_user.id)
    data = _read_image(file)

    # Replacing drops the old file first: a character has one portrait, and
    # leaving the previous extension behind would orphan it on disk.
    _remove_existing(character_id)
    filename = f"{character_id}{PORTRAIT_TYPES[file.content_type]}"
    with open(os.path.join(CHARACTER_PORTRAIT_DIR, filename), "wb") as handle:
        handle.write(data)

    character.portrait_path = filename
    db.commit()
    return {"portrait_path": filename}


def get_portrait(
    character_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Serve a portrait to anyone who may read the character."""
    character = readable_character_or_404(db, character_id, current_user.id)
    if not character.portrait_path:
        raise HTTPException(status_code=404, detail="No portrait")
    path = os.path.join(CHARACTER_PORTRAIT_DIR, character.portrait_path)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="No portrait")
    return cached_file_response(request, path)


def delete_portrait(
    character_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove a character's portrait."""
    character = _owned_or_404(db, character_id, current_user.id)
    _remove_existing(character_id)
    character.portrait_path = None
    db.commit()
    return {"deleted": True, "id": character_id}
