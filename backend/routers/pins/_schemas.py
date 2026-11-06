"""Pydantic schemas for the pins API."""
from pydantic import BaseModel, field_validator

# The browse views a pin can belong to. ``systems`` pins a game system by id;
# the media galleries pin a folder by its collection-relative path.
VALID_COLLECTIONS = {"systems", "maps", "tokens", "audio", "models"}


class PinIn(BaseModel):
    collection: str
    target: str

    @field_validator("collection")
    @classmethod
    def valid_collection(cls, v: str) -> str:
        if v not in VALID_COLLECTIONS:
            raise ValueError(f"collection must be one of: {', '.join(sorted(VALID_COLLECTIONS))}")
        return v

    @field_validator("target")
    @classmethod
    def target_not_blank(cls, v: str) -> str:
        # Folder paths are compared as the gallery spells them: slash-separated,
        # no leading or trailing slash.
        v = v.strip().strip("/")
        if not v:
            raise ValueError("target must not be blank")
        if len(v) > 1000:
            raise ValueError("target must be at most 1000 characters")
        return v


class PinOut(BaseModel):
    id: str
    collection: str
    target: str


class PinsResponse(BaseModel):
    pins: list[PinOut]
