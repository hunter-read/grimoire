"""Token editor recipes: how a stored token was made, so it can be reopened.

The token editor composes a flat PNG in the browser. On its own that PNG cannot
be changed - the art under the frame is gone - so each stored token keeps a
*recipe* beside it: the editor's settings and where its art came from. Opening
the token again restores the editor exactly, and saving writes a new PNG and a
new recipe together.

A recipe lives in a JSON column on the row that names the token -
``CampaignMember.character_token_recipe``, ``Campaign.owner_token_recipe`` or
``CampaignFile.token_recipe`` - so it goes wherever that row goes. Its art is
one of:

* ``token`` / ``map`` - a library item, referenced by id. Nothing is copied:
  the library may be read-only, and an item that has since gone leaves a recipe
  that opens with its settings but asks for new art.
* ``upload`` - art from the user's device, which exists nowhere else. It is
  kept under ``DATA_PATH/campaign_uploads/token_sources/`` as ``<stem><ext>``,
  named for the token it belongs to, and removed with it (the campaign upload
  cleanup in ``upload_files`` collects it through ``source_paths``).

Every token upload passes through ``read_recipe`` and then ``store_recipe``:
one carrying a recipe stores it, and one without clears the old one, since a
recipe describes one particular file. Between the two the caller applies the
campaign upload limits to the kept art (``upload_quota.assert_token_upload_allowed``),
so a refused upload writes nothing. The kept art counts towards the campaign's
storage total (``upload_quota.campaign_upload_bytes``).
"""

import json
import os
from dataclasses import dataclass
from typing import Any, Literal, Optional

from fastapi import HTTPException, UploadFile
from pydantic import BaseModel, Field, ValidationError

from ...config import CAMPAIGN_UPLOAD_DIR, logger
from ..upload_images import is_upload_image

TOKEN_SOURCE_DIR = os.path.join(CAMPAIGN_UPLOAD_DIR, "token_sources")

# The art types the editor accepts, by the extension each is stored under.
SOURCE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
SOURCE_MEDIA_TYPES = {ext: mime for mime, ext in SOURCE_TYPES.items()}
# Source art is the full-resolution original, so it may be far larger than the
# token made from it.
MAX_SOURCE_BYTES = 20 * 1024 * 1024


class RecipeTransform(BaseModel):
    """The art's placement under the frame, as ``useTokenTransform`` keeps it."""

    scale: float = Field(default=1, gt=0, le=100)
    # Output pixels from the centre; bounded well past any real token size.
    offsetX: float = Field(default=0, ge=-100_000, le=100_000)
    offsetY: float = Field(default=0, ge=-100_000, le=100_000)
    rotation: float = Field(default=0, ge=-360, le=360)
    flipX: bool = False
    flipY: bool = False


class RecipeSource(BaseModel):
    type: Literal["token", "map", "upload"]
    # The library item for ``token``/``map``; unused for an upload.
    id: Optional[str] = Field(default=None, max_length=36)


class TokenRecipe(BaseModel):
    """The editor's settings for one token. Only the editor reads it back."""

    size: int = Field(default=256, ge=16, le=4096)
    frame_id: Optional[str] = Field(default=None, max_length=200)
    # An icon-colour token or "#rrggbb"; empty means none. Checked again by the
    # editor before it reaches a canvas, as every colour it draws is.
    frame_color: str = Field(default="", max_length=40)
    background: str = Field(default="", max_length=40)
    transform: RecipeTransform = RecipeTransform()
    source: RecipeSource


def parse_recipe(raw: str) -> TokenRecipe:
    """The recipe a request sent as a JSON form field, or a 400."""
    try:
        recipe = TokenRecipe.model_validate(json.loads(raw))
    except (ValueError, ValidationError) as e:
        raise HTTPException(400, f"Invalid token recipe: {e}") from e
    if recipe.source.type != "upload" and not recipe.source.id:
        raise HTTPException(400, "Invalid token recipe: a library source needs an id")
    return recipe


def source_paths(recipe: Optional[dict[str, Any]]) -> list[str]:
    """The stored art a recipe holds on disk, if any."""
    name = os.path.basename(((recipe or {}).get("source") or {}).get("path") or "")
    return [os.path.join(TOKEN_SOURCE_DIR, name)] if name else []


def _remove_sources(stem: str) -> None:
    if not os.path.isdir(TOKEN_SOURCE_DIR):
        return
    for name in os.listdir(TOKEN_SOURCE_DIR):
        if name.rsplit(".", 1)[0] == stem:
            try:
                os.remove(os.path.join(TOKEN_SOURCE_DIR, name))
            except OSError as e:
                # A stale source left behind costs only disk; log it for cleanup.
                logger.warning("Failed to remove token source %s: %s", name, e)


def stored_source_bytes(stem: str) -> int:
    """The bytes of the art a token named ``stem`` keeps on disk now."""
    if not os.path.isdir(TOKEN_SOURCE_DIR):
        return 0
    total = 0
    for name in os.listdir(TOKEN_SOURCE_DIR):
        if name.rsplit(".", 1)[0] == stem:
            try:
                total += os.path.getsize(os.path.join(TOKEN_SOURCE_DIR, name))
            except OSError:
                pass
    return total


def _read_source(upload: Optional[UploadFile]) -> tuple[bytes, str]:
    if upload is None:
        raise HTTPException(400, "Invalid token recipe: an uploaded source needs its art")
    ext = SOURCE_TYPES.get(upload.content_type or "")
    if not ext:
        raise HTTPException(400, f"Unsupported source type: {upload.content_type}")
    data = upload.file.read(MAX_SOURCE_BYTES + 1)
    if len(data) > MAX_SOURCE_BYTES:
        raise HTTPException(413, "Source art is too large")
    if not data or not is_upload_image(data):
        raise HTTPException(400, "Source art is not an image")
    return data, ext


@dataclass
class PendingRecipe:
    """A token upload's recipe and source art, checked and read but not yet written.

    ``replacing`` is the size of the art the token keeps now, which storing
    this removes, so a limit check counts only ``adding - replacing``.
    """

    stem: str
    recipe: Optional[TokenRecipe]
    data: bytes
    ext: str
    replacing: int

    @property
    def adding(self) -> int:
        """The bytes of source art storing this will keep."""
        return len(self.data)


def read_recipe(stem: str, raw: Optional[str], source: Optional[UploadFile]) -> PendingRecipe:
    """Parse the recipe a token upload carries and read its art; writes nothing.

    ``stem`` names the token's stored art, unique per token (``member-<id>``,
    ``owner-<campaign id>``, ``file-<file id>``).
    """
    recipe = parse_recipe(raw) if raw else None
    data, ext = _read_source(source) if recipe and recipe.source.type == "upload" else (b"", "")
    return PendingRecipe(stem, recipe, data, ext, stored_source_bytes(stem))


def store_recipe(pending: PendingRecipe) -> Optional[dict[str, Any]]:
    """Write a read recipe's art, or clear the old one; returns the column value.

    Whatever art the token had before is removed first: either a new one
    replaces it or the token no longer has a recipe.
    """
    _remove_sources(pending.stem)
    if pending.recipe is None:
        return None
    stored = pending.recipe.model_dump()
    if pending.data:
        os.makedirs(TOKEN_SOURCE_DIR, exist_ok=True)
        name = f"{pending.stem}{pending.ext}"
        with open(os.path.join(TOKEN_SOURCE_DIR, name), "wb") as handle:
            handle.write(pending.data)
        stored["source"] = {"type": "upload", "id": None, "path": name}
    return stored


def clear_recipe(stem: str) -> None:
    """Remove a token's stored art when the token itself is removed."""
    _remove_sources(stem)


def public_recipe(recipe: dict[str, Any]) -> dict[str, Any]:
    """A recipe as the editor reads it: the stored file's name stays server-side."""
    source = dict(recipe.get("source") or {})
    source.pop("path", None)
    return {**recipe, "source": source}
