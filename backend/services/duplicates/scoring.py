"""What kind of variant this looks like, and which copy should be the parent.

Everything here is *advisory*. Detection cannot know whether two files are a
printer-friendly pair or two unrelated printings, so these rules only pre-fill
the form the user is about to confirm - issue #304 is explicit that resolution is
never automatic.
"""
import re
from typing import Any, Optional

# Filename tokens that name a variant kind. Ordered most-specific first, since
# "printer friendly single page" should read as printer-friendly rather than
# single-page. Each entry maps a regex to a kind in models.variants.VARIANT_KINDS.
_KIND_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"form[\s_-]?fillable|fillable|editable", "form-fillable"),
    (r"printer[\s_-]?friendly|print[\s_-]?ready|printable|\bprint\b", "printer-friendly"),
    (r"b\s*&\s*w|black[\s_-]?and[\s_-]?white|gr[ea]yscale|\bbw\b", "black-and-white"),
    (r"spreads?|two[\s_-]?page|facing", "spreads"),
    (r"single[\s_-]?page|one[\s_-]?page|1[\s_-]?page", "single-page"),
)

# A version marker anywhere in the name: v1, v1.0, v1.0.1, "rev 2", "2nd printing".
# `\b` is no help here: an underscore is a word character, so "Book_v1.0.1"
# has no boundary before the "v". Anchor on a real separator (or the start)
# instead, which is how these names are actually written.
_VERSION = re.compile(
    r"(?:^|[\s_.\-([])v(?:er(?:sion)?)?[\s_.\-]?(\d+(?:\.\d+)*)"
    r"|(?:^|[\s_.\-([])rev(?:ision)?[\s_.\-]?(\d+(?:\.\d+)*)",
    re.IGNORECASE,
)


def version_token(name: str) -> Optional[str]:
    """The version a filename declares, if any."""
    match = _VERSION.search(name or "")
    if not match:
        return None
    return match.group(1) or match.group(2)


def suggest_kind(record: Any, other: Any) -> tuple[str, str]:
    """Guess ``(kind, label)`` for ``record`` when paired against ``other``.

    Compared against the other member rather than read in isolation, because the
    kind is relational: the copy *without* "printer friendly" in its name is only
    the main edition relative to the one that has it.
    """
    name = f"{record.filename} {getattr(record, 'title', '') or ''}".lower()
    other_name = f"{other.filename} {getattr(other, 'title', '') or ''}".lower()

    for pattern, kind in _KIND_PATTERNS:
        mine = re.search(pattern, name) is not None
        theirs = re.search(pattern, other_name) is not None
        # Only a marker that distinguishes the two says anything useful.
        if mine and not theirs:
            return kind, ""

    # Grid markers, for maps.
    from .grid import grid_marker

    my_grid = grid_marker(record.filename)
    their_grid = grid_marker(other.filename)
    if my_grid is not None and my_grid != their_grid:
        return ("gridded" if my_grid else "gridless"), ""

    # An explicit version column beats anything parsed out of a filename.
    my_version = (getattr(record, "version", "") or "").strip()
    their_version = (getattr(other, "version", "") or "").strip()
    if my_version and my_version != their_version:
        return "version", my_version

    token = version_token(record.filename)
    if token and token != version_token(other.filename):
        return "version", f"v{token}"

    return "other", ""


def suggest_parent(records: list) -> Optional[str]:
    """Which copy to offer as the main entry.

    Most pages wins - a full edition over an excerpt - then the largest file,
    which is usually the higher-quality scan, then the oldest row, which is the
    one a user is most likely to have already tagged and read.
    """
    if not records:
        return None

    def rank(record: Any) -> tuple:
        created = getattr(record, "created_at", None)
        return (
            getattr(record, "page_count", 0) or 0,
            record.file_size or 0,
            -(created.timestamp() if created else 0),
        )

    return max(records, key=rank).id


def describe(reasons: list) -> str:
    """A short human phrase for why a group was flagged."""
    if "hash" in reasons:
        return "identical files"
    if "grid" in reasons:
        return "gridded / gridless pair"
    if "text" in reasons and "metadata" in reasons:
        return "similar title and contents"
    if "text" in reasons:
        return "similar contents"
    return "similar title"
