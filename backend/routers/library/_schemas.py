"""Request/response schemas for the library router."""
from typing import Literal, Optional

from pydantic import BaseModel


class RescanRequest(BaseModel):
    """Body for POST /rescan.

    scope restricts the rescan to a subtree relative to the library root, e.g.
    "books/D&D 5e/adventure" or "maps/Forests".  Omitted = whole library.
    metadata_mode controls sidecar metadata re-application on already-indexed books.
    """

    scope: Optional[str] = None
    metadata_mode: Literal["new", "missing", "replace"] = "new"
