"""Game types: whether a system or book is a role-playing game or a wargame.

Role-playing books live in the library's ``books/`` collection; wargame books
live beside it in ``armory/``, with the same ``<System>/<Category>/<Book>``
shape plus the factions wargames file their armies under::

    library/
    ├── books/<System>/<Category>/...                  <- ttrpg
    ├── armory/<System>/<Edition?>/Factions/<Faction>/ <- wargame
    └── maps/  tokens/  audio/  models/                (both)

Systems and books carry a ``game_type`` naming which, set by the scan from the
folder they sit in. The names match GrimoireCodexDB's ``game_type`` so
metadata round-trips.

This module imports nothing from the app, so models, services, routers and the
indexer can all use it without a cycle.
"""
from typing import Optional

GAME_TYPE_TTRPG = "ttrpg"
GAME_TYPE_WARGAME = "wargame"

GAME_TYPES = (GAME_TYPE_TTRPG, GAME_TYPE_WARGAME)

#: The armory's collection name: the section in stats and scan scopes, and the
#: folder stored paths start with (``armory/<System>/...``).
ARMORY_SECTION = "armory"

#: Folder spellings accepted for the armory, matched case-insensitively. Both,
#: because much of the hobby is British.
ARMORY_FOLDER_NAMES = ("armory", "armoury")


def is_armory_path(relative_path: Optional[str]) -> bool:
    """Whether a library-relative path (or a rescan scope) is in the armory."""
    head = (relative_path or "").replace("\\", "/").lstrip("/").split("/", 1)[0]
    return head.lower() in ARMORY_FOLDER_NAMES


def game_type_for_path(relative_path: Optional[str]) -> str:
    """The game type of the collection a library-relative path sits in."""
    return GAME_TYPE_WARGAME if is_armory_path(relative_path) else GAME_TYPE_TTRPG
