"""Response models for the token frame endpoints."""
from typing import Optional

from pydantic import BaseModel


class FrameVariantOut(BaseModel):
    """One other version of a frame — a black-and-white cut, a recolour, an errata pass.

    Deliberately the same ``id``/``name`` shape as a frame itself: a version is a
    real frame file the editor composites exactly like any other, so the picker
    hands it to the same image URL builder rather than taking a second path.
    """

    id: str
    name: str
    group: str = ""
    format: str = ""
    token_id: Optional[str] = None
    # The closed variant vocabulary and the user's free-text label, which the
    # picker renders together ("Black and white · v2") through the same rule the
    # book and map version pickers use.
    variant_kind: str = ""
    variant_label: str = ""


class FrameOut(BaseModel):
    """One user-supplied frame image discovered under a ``.frames-container`` directory."""

    id: str
    name: str
    group: str = ""
    format: str
    # The ``Token`` row for the same file, when the indexer has reached it.
    # Frames are ordinary library images, so a frame is favourited by starring
    # its token — this is the join that lets the picker surface favourites
    # without a second favourite type keyed to the opaque frame id. ``None`` for
    # a frame dropped in since the last scan, which simply cannot be favourited
    # yet; the picker treats that as "not favourited" rather than an error.
    token_id: Optional[str] = None
    # Frames marked as versions of one another collapse to a single entry, so
    # the gallery shows one tile per frame rather than the same ring several
    # times; the other cuts stay reachable here. Always present, empty when the
    # frame has none, so the picker never branches on a missing key.
    variants: list[FrameVariantOut] = []


class FrameListResponse(BaseModel):
    frames: list[FrameOut]
