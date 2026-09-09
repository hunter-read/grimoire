"""Pydantic schemas for the saved audio-sets API."""
from typing import Optional

from pydantic import BaseModel, field_validator

from ...models import SET_TYPES

# Grid bounds, mirroring the frontend soundboard (SoundboardContext). Kept in
# step so a layout the UI can produce always round-trips, and one edited into
# the API by hand cannot make the board unrenderable.
MIN_COLS, MAX_COLS = 1, 8
MIN_ROWS, MAX_ROWS = 1, 15

# Hard ceiling on entries per set. A playlist or board is a scene's worth of
# audio, not a library dump, and the cap keeps one row from growing unbounded.
MAX_ENTRIES = 500


def _clean_name(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("name must not be blank")
    return v


class SetEntryIn(BaseModel):
    """One saved track/pad. ``loop`` is only meaningful for a soundboard pad."""

    audio_id: str
    loop: bool = False


class LayoutIn(BaseModel):
    cols: int = 4
    rows: int = 4

    @field_validator("cols")
    @classmethod
    def valid_cols(cls, v: int) -> int:
        if not MIN_COLS <= v <= MAX_COLS:
            raise ValueError(f"cols must be between {MIN_COLS} and {MAX_COLS}")
        return v

    @field_validator("rows")
    @classmethod
    def valid_rows(cls, v: int) -> int:
        if not MIN_ROWS <= v <= MAX_ROWS:
            raise ValueError(f"rows must be between {MIN_ROWS} and {MAX_ROWS}")
        return v


class AudioSetCreate(BaseModel):
    kind: str
    name: str
    entries: list[SetEntryIn] = []
    layout: Optional[LayoutIn] = None

    @field_validator("kind")
    @classmethod
    def valid_kind(cls, v: str) -> str:
        if v not in SET_TYPES:
            raise ValueError(f"kind must be one of: {', '.join(SET_TYPES)}")
        return v

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        return _clean_name(v)

    @field_validator("entries")
    @classmethod
    def entries_within_cap(cls, v: list[SetEntryIn]) -> list[SetEntryIn]:
        if len(v) > MAX_ENTRIES:
            raise ValueError(f"a set may hold at most {MAX_ENTRIES} entries")
        return v


class AudioSetUpdate(BaseModel):
    """Rename and/or re-save. ``kind`` is fixed once created."""

    name: Optional[str] = None
    entries: Optional[list[SetEntryIn]] = None
    layout: Optional[LayoutIn] = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _clean_name(v)

    @field_validator("entries")
    @classmethod
    def entries_within_cap(cls, v: Optional[list[SetEntryIn]]) -> Optional[list[SetEntryIn]]:
        if v is not None and len(v) > MAX_ENTRIES:
            raise ValueError(f"a set may hold at most {MAX_ENTRIES} entries")
        return v


class SetEntryOut(BaseModel):
    """A resolved entry: the saved id plus the track's current metadata.

    Titles are resolved on read rather than stored, so a title edited in the
    library shows through on every set that references it.
    """

    audio_id: str
    loop: bool
    title: str
    artist: str
    has_artwork: bool


class AudioSetOut(BaseModel):
    """One saved set, as built by `core._serialize`.

    ``entries`` lists only what the user can still play; ``missing`` counts the
    saved entries dropped because the track is gone from the library or is no
    longer shared with them. ``layout`` is null for a playlist.
    """

    id: str
    kind: str
    name: str
    entries: list[SetEntryOut]
    missing: int
    layout: Optional[dict] = None
    updated_at: Optional[str] = None


class AudioSetSummary(BaseModel):
    """A set as listed: everything but the entries, plus a count of them.

    The list view only needs a name and a size, and a user with many large sets
    should not pay for every track's metadata to render it.
    """

    id: str
    kind: str
    name: str
    count: int
    layout: Optional[dict] = None
    updated_at: Optional[str] = None


class AudioSetsResponse(BaseModel):
    sets: list[AudioSetSummary]


class StatusResponse(BaseModel):
    status: str
