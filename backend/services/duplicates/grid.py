"""Telling a gridded map from its gridless twin by name (issue #304).

Battle maps almost always ship as a pair: one with a grid overlay burned in and
one without. They are not byte-identical and their text is nothing, so neither
the hash nor the FTS signal can pair them — but their filenames nearly always
differ by a single marker token, which is enough.

Filename-only by design. Detecting the pair from the pixels would mean decoding
and perceptually hashing every image in the library, and a grid overlay changes
few enough bits that the threshold separating "same map, gridded" from "two maps
from the same set" is genuinely ambiguous. A wrong pairing here costs the user a
manual unlink, so the cheap, predictable signal is the right one.
"""
import re
from typing import Optional

# Split on every separator a map pack has ever used, so markers are matched as
# whole tokens rather than substrings. Without this, "Gridiron Tavern" reads as
# a gridded map and "Bridge.png" reads as one too.
_SPLIT = re.compile(r"[\s_\-()\[\].]+")

# Order matters: every negative marker contains "grid", so they are tested first.
_NEGATIVE = ("nogrid", "no-grid", "gridless", "ungridded", "gridfree")
_POSITIVE = ("grid", "gridded", "gridded", "withgrid")


def _tokens(stem: str) -> list[str]:
    return [t for t in _SPLIT.split(stem.lower()) if t]


def grid_marker(filename: str) -> Optional[bool]:
    """True when a name says "gridded", False for "gridless", None for neither.

    Both a joined token ("nogrid") and a split pair ("no", "grid") count, since
    separators vary between packs.
    """
    stem = filename.rsplit(".", 1)[0]
    tokens = _tokens(stem)
    joined = "".join(tokens)

    for marker in _NEGATIVE:
        flat = marker.replace("-", "")
        if flat in tokens or flat in joined:
            return False
    # "no grid" split across two tokens.
    for i, token in enumerate(tokens[:-1]):
        if token in ("no", "non", "un") and tokens[i + 1].startswith("grid"):
            return False
    for marker in _POSITIVE:
        if marker in tokens:
            return True
    return None


def strip_grid_tokens(filename: str) -> str:
    """The filename with its grid markers removed, for comparing the rest.

    ``Tavern_grid.png`` and ``Tavern_nogrid.png`` both reduce to ``tavern``,
    which is what makes them recognisable as the same map.
    """
    stem = filename.rsplit(".", 1)[0]
    tokens = _tokens(stem)
    out: list[str] = []
    skip_next = False
    for i, token in enumerate(tokens):
        if skip_next:
            skip_next = False
            continue
        flat = token.replace("-", "")
        if flat in [m.replace("-", "") for m in _NEGATIVE] or token in _POSITIVE:
            continue
        if token in ("no", "non", "un") and i + 1 < len(tokens) and tokens[i + 1].startswith("grid"):
            skip_next = True
            continue
        out.append(token)
    return " ".join(out)


def is_grid_pair(a_name: str, a_size: int, b_name: str, b_size: int) -> bool:
    """Whether two maps look like the gridded/gridless cut of one image.

    Requires the names to agree once their grid markers are removed, the markers
    themselves to disagree, and the files to be within 3x of each other in size —
    a grid overlay changes the encoded size somewhat but never by an order of
    magnitude, and that bound is what keeps two unrelated maps from one pack
    (``Tavern_grid`` / ``Cellar_nogrid``) out of the result.
    """
    a_marker, b_marker = grid_marker(a_name), grid_marker(b_name)
    if a_marker is None and b_marker is None:
        return False
    if a_marker == b_marker:
        return False

    base_a, base_b = strip_grid_tokens(a_name), strip_grid_tokens(b_name)
    if not base_a or base_a != base_b:
        return False

    big, small = max(a_size or 0, b_size or 0), min(a_size or 0, b_size or 0)
    if small <= 0:
        return True
    return big <= small * 3
