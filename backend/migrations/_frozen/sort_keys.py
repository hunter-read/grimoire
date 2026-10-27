"""The natural sort key and folder revision 0041 backfills, as written for it.

Frozen copy of ``natural_key`` and ``folder_path_of`` from
``backend/models/browse.py``. A change to the live key needs a revision of its
own that re-keys the rows; it does not change what 0041 wrote.
"""
import re
import unicodedata
from typing import Optional

_DIGITS = re.compile(r"\d+")


def _number(match: re.Match) -> str:
    digits = match.group(0).lstrip("0") or "0"
    return f"{len(digits):03d}{digits}"


def natural_key(text: Optional[str]) -> str:
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text)
    folded = "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()
    return _DIGITS.sub(_number, folded)


def folder_path_of(relative_path: Optional[str]) -> str:
    path = (relative_path or "").replace("\\", "/")
    cut = path.rfind("/")
    return path[: cut + 1] if cut >= 0 else ""
