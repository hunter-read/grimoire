"""A sheet's image fields: upload, serve, remove.

A field declared ``"type": "image"`` holds a picture - a coat of arms, a ship -
that the sheet places like any other field. The bytes go through the portrait's
checks (``portraits.read_image``) and are stored by
``services.characters.images``; the field's value is only ever written here,
never by a sheet edit, so a client cannot point it at a file of its choosing.
"""
import re

from fastapi import Depends, File, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...file_cache import cached_file_response
from ...models import Character
from ...services.characters import images
from ...services.characters.schema import IMAGE_VALUE_RE, image_fields
from . import core
from ._helpers import editable_character_or_404, readable_character_or_404
from .portraits import read_image

_FIELD_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _require_image_field(db: Session, character: Character, field: str) -> None:
    """404 unless the character's sheet declares ``field`` as an image."""
    schema = core._schema_for(db, character.user_id, character.schema_ref)
    document = core._validated_document(schema) if schema else {}
    if not _FIELD_RE.match(field) or field not in image_fields(document):
        raise HTTPException(status_code=404, detail="This sheet has no image field by that name")


def upload_image(
    character_id: str,
    field: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set an image field's picture. Only someone who may edit the character may."""
    character = editable_character_or_404(db, character_id, current_user.id)
    _require_image_field(db, character, field)
    data, extension = read_image(file, "An image")
    filename = images.store_field_image(character, field, data, extension)
    db.commit()
    return {"field": field, "value": filename}


def get_image(
    character_id: str,
    field: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Serve an image field's picture to anyone who may read the character.

    Read from the stored value alone, not the reader's copy of the sheet: a
    party member may have a different version installed, or none.
    """
    character = readable_character_or_404(db, character_id, current_user.id)
    data = character.data if isinstance(character.data, dict) else {}
    path = images.image_path(character.id, data.get(field)) if _FIELD_RE.match(field) else None
    if not path:
        raise HTTPException(status_code=404, detail="No image")
    return cached_file_response(request, path)


def delete_image(
    character_id: str,
    field: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove an image field's picture.

    Allowed for a field the sheet no longer declares, as long as what it holds
    is a picture: the player should be able to clear one the sheet left behind.
    """
    character = editable_character_or_404(db, character_id, current_user.id)
    data = character.data if isinstance(character.data, dict) else {}
    value = data.get(field)
    left_behind = isinstance(value, str) and IMAGE_VALUE_RE.match(value) and value.startswith(
        f"{field}-"
    )
    if not left_behind:
        _require_image_field(db, character, field)
    images.remove_field_image(character, field)
    db.commit()
    return {"deleted": True, "id": character_id}
