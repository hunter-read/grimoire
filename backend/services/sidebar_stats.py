"""Which library stats the sidebar shows, and in what order.

A layout is an ordered list of up to ``MAX_SIDEBAR_STATS`` stat ids, each a field
of the ``/api/stats`` response. The admin's layout (the ``sidebar_stats`` app
setting) is everyone's default; a user may save their own (``users.sidebar_stats``)
and clear it to go back to the default.

Before layouts existed the sidebar was driven by nine ``show_stat_*`` flags with
a fixed order. Those flags still read and write: until an admin saves a layout,
the default is built from them in their old order, and each flag reads as
whether its stat is in the default layout.
"""
import json
from typing import Optional

#: Every stat a layout may name, in the order the picker lists them.
#: ``armory_books`` is left out: it is ``wargame_books`` under its older name.
STAT_IDS: tuple[str, ...] = (
    "game_systems",
    "ttrpg_systems",
    "wargame_systems",
    "books",
    "ttrpg_books",
    "wargame_books",
    "total_pages",
    "ttrpg_pages",
    "wargame_pages",
    "indexed_books",
    "maps",
    "tokens",
    "audio",
    "models",
    "book_variants",
    "map_variants",
    "token_variants",
    "model_variants",
    "audio_variants",
    "total_size_mb",
    "ttrpg_size_mb",
    "wargame_size_mb",
    "maps_size_mb",
    "tokens_size_mb",
    "models_size_mb",
    "audio_size_mb",
    "library_size_mb",
)

MAX_SIDEBAR_STATS = 10

#: The flags the sidebar used before layouts, in the order it drew them.
LEGACY_FLAGS: dict[str, str] = {
    "show_stat_systems": "game_systems",
    "show_stat_books": "books",
    "show_stat_pages": "total_pages",
    "show_stat_maps": "maps",
    "show_stat_tokens": "tokens",
    "show_stat_audio": "audio",
    "show_stat_models": "models",
    "show_stat_size": "total_size_mb",
    "show_stat_library_size": "library_size_mb",
}

#: The app setting holding the admin's layout, as a JSON array. "" = not saved.
SETTING_KEY = "sidebar_stats"


class LayoutError(ValueError):
    """A layout naming an unknown stat, one twice, or more than the maximum."""


def validate(layout: object) -> list[str]:
    """Return ``layout`` as a clean list of stat ids, or raise ``LayoutError``."""
    if not isinstance(layout, list):
        raise LayoutError("A stats layout must be a list of stat names")
    unknown = [item for item in layout if not isinstance(item, str) or item not in STAT_IDS]
    if unknown:
        raise LayoutError(f"Unknown stat: {', '.join(map(str, unknown))}")
    if len(set(layout)) != len(layout):
        raise LayoutError("A stats layout names the same stat twice")
    if len(layout) > MAX_SIDEBAR_STATS:
        raise LayoutError(f"The sidebar shows at most {MAX_SIDEBAR_STATS} stats")
    return list(layout)


def _stored(value: Optional[str]) -> Optional[list[str]]:
    """The saved layout, or None when none is saved or it no longer validates."""
    if not value:
        return None
    try:
        return validate(json.loads(value))
    except (ValueError, TypeError):
        return None


def default_layout(raw: dict) -> list[str]:
    """The admin's layout: saved, or built from the legacy flags."""
    saved = _stored(raw.get(SETTING_KEY))
    if saved is not None:
        return saved
    return [stat for flag, stat in LEGACY_FLAGS.items() if raw.get(flag) == "true"]


def user_layout(stored: object) -> Optional[list[str]]:
    """A user's own layout, or None to follow the default.

    A layout saved by a newer release may name a stat this one does not know;
    it is dropped rather than failing the whole layout.
    """
    if not isinstance(stored, list):
        return None
    known = [item for item in stored if isinstance(item, str) and item in STAT_IDS]
    return list(dict.fromkeys(known))[:MAX_SIDEBAR_STATS]


def legacy_flags(layout: list[str]) -> dict[str, bool]:
    """Each ``show_stat_*`` flag, read as whether its stat is in ``layout``."""
    return {flag: stat in layout for flag, stat in LEGACY_FLAGS.items()}


def with_flag(layout: list[str], flag: str, shown: bool) -> list[str]:
    """``layout`` with one legacy flag's stat added at the end or removed."""
    stat = LEGACY_FLAGS[flag]
    if not shown:
        return [item for item in layout if item != stat]
    if stat in layout:
        return list(layout)
    return validate([*layout, stat])
