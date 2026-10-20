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
# The image types a portrait may be, mirroring campaign character art. Shared
# with importing, which accepts a portrait embedded in another tool's export.
from ...services.characters.importing import MAX_PORTRAIT_BYTES, PORTRAIT_TYPES
from ._helpers import editable_character_or_404, readable_character_or_404


def read_image(upload: UploadFile, what: str = "A portrait") -> tuple[bytes, str]:
    """The upload's bytes and the extension for its content type.

    Shared with a sheet's image fields, which follow the portrait's rules.
    """
    if upload.content_type is None or upload.content_type not in PORTRAIT_TYPES:
        allowed = ", ".join(sorted(PORTRAIT_TYPES))
        raise HTTPException(
            status_code=400, detail=f"{what} must be one of: {allowed}"
        )
    data = upload.file.read(MAX_PORTRAIT_BYTES + 1)
    if len(data) > MAX_PORTRAIT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"{what} may be at most {MAX_PORTRAIT_BYTES // (1024 * 1024)} MB",
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
    return data, PORTRAIT_TYPES[upload.content_type]


def remove_portrait_files(character_id: str) -> None:
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
    """Set a character's portrait. Only someone who may edit the character may."""
    character = editable_character_or_404(db, character_id, current_user.id)
    data, ext = read_image(file)
    filename = store_portrait(character, data, ext)
    db.commit()
    # The version the character's own payload reports, so the client can show
    # the new image straight away under a URL no cache has seen.
    version = os.stat(os.path.join(CHARACTER_PORTRAIT_DIR, filename)).st_mtime_ns
    return {"portrait_path": filename, "portrait_version": version}


def store_portrait(character: Character, data: bytes, extension: str) -> str:
    """Write already-verified image bytes as a character's portrait.

    The caller commits. Replacing drops the old file first: a character has
    one portrait, and leaving the previous extension behind would orphan it.
    The framing goes too: a focus point chosen for one picture means nothing
    on the next.
    """
    remove_portrait_files(character.id)
    character.portrait_crop = None
    filename = f"{character.id}{extension}"
    with open(os.path.join(CHARACTER_PORTRAIT_DIR, filename), "wb") as handle:
        handle.write(data)
    character.portrait_path = filename
    return filename


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
    character = editable_character_or_404(db, character_id, current_user.id)
    remove_portrait_files(character_id)
    character.portrait_path = None
    character.portrait_crop = None
    db.commit()
    return {"deleted": True, "id": character_id}
