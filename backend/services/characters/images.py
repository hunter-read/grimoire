"""The files behind a character's `image` fields.

An image field's value in the sheet's data is a file name, never the picture:
the bytes live in ``CHARACTER_IMAGE_DIR/<character id>/``, so a sheet's JSON
stays small and a backup can carry the pictures as files. The rules are the
portrait's - the same types, the same size cap, the same "store a name, not a
path" - because a coat of arms is the same kind of thing as a portrait.

Each upload gets a fresh random name (``<field>-<token><ext>``). That is what
lets a replaced picture show straight away: the name is in the image's URL, so
a new picture is a URL no cache has seen.

The directory is the source of truth for cleanup, not the data: replacing a
field's picture removes every file the field ever wrote, so a write that lost a
race with an edit cannot leave a file behind for good.
"""
import base64
import os
import secrets
import shutil
from typing import Any, Iterable, Optional

from sqlalchemy import event
from sqlalchemy.orm import Session

from ...config import CHARACTER_IMAGE_DIR, CHARACTER_PORTRAIT_DIR
from .importing import PORTRAIT_TYPES, decode_portrait
from .schema import IMAGE_VALUE_RE, image_fields

__all__ = [
    "character_image_dir",
    "image_path",
    "store_field_image",
    "remove_field_image",
    "remove_character_images",
    "remove_character_files",
    "remove_files_after_commit",
    "prune_images",
    "export_images",
    "import_images",
    "encode_data_url",
]

#: Extension → content type, for writing a picture back out as a data URL.
_TYPE_FOR_EXTENSION = {extension: content_type for content_type, extension in PORTRAIT_TYPES.items()}


def character_image_dir(character_id: str) -> str:
    return os.path.join(CHARACTER_IMAGE_DIR, character_id)


def image_path(character_id: str, value: Any) -> Optional[str]:
    """The file an image field's value names, or None if there is no such file.

    The value is checked against the shape this module writes before it goes
    anywhere near the filesystem, so a hand-edited row naming ``../../x`` reads
    as no picture.
    """
    if not isinstance(value, str) or not IMAGE_VALUE_RE.match(value):
        return None
    path = os.path.join(character_image_dir(character_id), value)
    return path if os.path.isfile(path) else None


def _field_files(character_id: str, field: str) -> list[str]:
    directory = character_image_dir(character_id)
    try:
        names = os.listdir(directory)
    except OSError:
        return []
    # Field names never contain a hyphen, so "a-" cannot match field "a_b".
    prefix = f"{field}-"
    return [os.path.join(directory, name) for name in names if name.startswith(prefix)]


def _remove_files(paths: list[str]) -> None:
    for path in paths:
        try:
            os.remove(path)
        except OSError:
            pass


def store_field_image(character: Any, field: str, data: bytes, extension: str) -> str:
    """Write already-verified image bytes as one field's picture.

    Sets the field in the character's data; the caller commits. Every file the
    field held before goes first: a field holds one picture.
    """
    _remove_files(_field_files(character.id, field))
    directory = character_image_dir(character.id)
    os.makedirs(directory, exist_ok=True)
    filename = f"{field}-{secrets.token_hex(8)}{extension}"
    with open(os.path.join(directory, filename), "wb") as handle:
        handle.write(data)
    stored = dict(character.data if isinstance(character.data, dict) else {})
    stored[field] = filename
    # Reassigned rather than mutated: SQLAlchemy does not see an in-place edit
    # to a JSON column.
    character.data = stored
    return filename


def remove_field_image(character: Any, field: str) -> None:
    """Clear one field's picture, file and value. The caller commits."""
    _remove_files(_field_files(character.id, field))
    stored = dict(character.data if isinstance(character.data, dict) else {})
    if field in stored:
        stored.pop(field)
        character.data = stored


def remove_character_images(character_id: str) -> None:
    """Remove every picture a character's fields hold."""
    shutil.rmtree(character_image_dir(character_id), ignore_errors=True)


def remove_character_files(character_id: str) -> None:
    """Remove a character's portrait and every picture its fields hold."""
    for extension in set(PORTRAIT_TYPES.values()):
        try:
            os.remove(os.path.join(CHARACTER_PORTRAIT_DIR, f"{character_id}{extension}"))
        except OSError:
            pass
    remove_character_images(character_id)


def remove_files_after_commit(db: Session, character_ids: Iterable[str]) -> None:
    """Remove these characters' files once ``db`` commits, and never otherwise.

    For deletes that go through raw SQL rather than the character routes - a
    user's account being removed takes their characters with it. The caller
    commits later, and a delete that rolls back must not have cost anyone their
    pictures, so the files wait for the commit.
    """
    ids = [character_id for character_id in character_ids if character_id]
    if not ids:
        return
    settled = False

    def _committed(session: Session) -> None:
        nonlocal settled
        if settled:
            return
        settled = True
        for character_id in ids:
            remove_character_files(character_id)

    def _rolled_back(session: Session) -> None:
        nonlocal settled
        settled = True

    event.listen(db, "after_commit", _committed, once=True)
    event.listen(db, "after_rollback", _rolled_back, once=True)


def prune_images(character: Any, document: dict) -> bool:
    """Drop pictures the character's sheet no longer has a field for.

    Run when a sheet is updated: a field that was an image and is now gone, or
    is now something else, would otherwise keep its file forever. A value is
    only dropped when it is one this module wrote for that field, so a text
    field that happens to be named like a file is left alone. Returns whether
    the character's data changed; the caller commits.
    """
    keep = image_fields(document)
    stored = dict(character.data if isinstance(character.data, dict) else {})
    changed = False
    for name, value in list(stored.items()):
        if name in keep or not isinstance(value, str):
            continue
        if IMAGE_VALUE_RE.match(value) and value.startswith(f"{name}-"):
            stored.pop(name)
            changed = True
    if changed:
        character.data = stored

    wanted = {stored.get(name) for name in keep}
    directory = character_image_dir(character.id)
    try:
        names = os.listdir(directory)
    except OSError:
        return changed
    _remove_files([os.path.join(directory, name) for name in names if name not in wanted])
    return changed


def encode_data_url(path: str) -> Optional[str]:
    """A picture on disk as a ``data:`` URL, for a self-contained export."""
    content_type = _TYPE_FOR_EXTENSION.get(os.path.splitext(path)[1].lower())
    if not content_type:
        return None
    try:
        with open(path, "rb") as handle:
            encoded = base64.b64encode(handle.read()).decode("ascii")
    except OSError:
        return None
    return f"data:{content_type};base64,{encoded}"


def export_images(character: Any) -> dict[str, str]:
    """Every image field's picture, keyed by field, as data URLs.

    Read from the stored values rather than the sheet, so a party member
    exporting a character whose sheet they do not have installed still gets
    its pictures.
    """
    data = character.data if isinstance(character.data, dict) else {}
    images: dict[str, str] = {}
    for name, value in sorted(data.items()):
        if not isinstance(value, str) or not value.startswith(f"{name}-"):
            continue
        path = image_path(character.id, value)
        encoded = encode_data_url(path) if path else None
        if encoded:
            images[name] = encoded
    return images


def import_images(character: Any, document: dict, images: Any) -> int:
    """Store pictures from an export (or an importer) onto a character.

    Only fields the sheet declares as images are read, and each value must be a
    ``data:image/...`` URL that decodes as a real picture within the portrait's
    size cap - a URL to fetch is ignored, as it is for a portrait. Returns how
    many were stored; the caller commits.
    """
    if not isinstance(images, dict):
        return 0
    stored = 0
    for name in sorted(image_fields(document)):
        decoded = decode_portrait(images.get(name))
        if decoded:
            store_field_image(character, name, *decoded)
            stored += 1
    return stored
