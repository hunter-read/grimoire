"""Default seed data for the genre and system-family lookup tables (issue #202).

Kept as plain Python data so both the Alembic migration and any future reseed
routine share one source of truth. The genre tree is loosely modeled on
DriveThruRPG's genre/subgenre taxonomy; families cover the most common design
lineages. All values are user-removable after seeding.
"""
from typing import Sequence

# Tiered genre defaults. Each entry is ``(name, [children])`` where a child may
# itself be an ``(name, [grandchildren])`` tuple, allowing arbitrary nesting.
GenreNode = tuple[str, Sequence["GenreNode"]]

DEFAULT_GENRES: Sequence[GenreNode] = (
    (
        "Fantasy",
        (
            ("High Fantasy", ()),
            ("Dark Fantasy", ()),
            ("Grimdark", ()),
            ("Sword & Sorcery", ()),
            ("Fairy Tale", ()),
        ),
    ),
    (
        "Science Fiction",
        (
            ("Cyberpunk", ()),
            ("Space Opera", ()),
            ("Post-Apocalyptic", ()),
            ("Hard SF", ()),
            ("Mecha", ()),
        ),
    ),
    (
        "Horror",
        (
            ("Cosmic Horror", ()),
            ("Survival Horror", ()),
            ("Gothic", ()),
        ),
    ),
    (
        "Historical",
        (
            ("Ancient", ()),
            ("Medieval", ()),
            ("Renaissance", ()),
            ("Modern", ()),
        ),
    ),
    ("Mystery", ()),
    ("Western", ()),
    ("Superhero", ()),
    ("Steampunk", ()),
    ("Modern / Contemporary", ()),
    ("Comedy", ()),
    ("Adventure", ()),
    ("Slice of Life", ()),
)

# System-family / engine defaults.
DEFAULT_SYSTEM_FAMILIES: Sequence[str] = (
    "Powered by the Apocalypse",
    "Forged in the Dark",
    "d20 System",
    "OSR",
    "Year Zero Engine",
    "Fate",
    "Cypher System",
    "GUMSHOE",
    "Savage Worlds",
    "Basic Roleplaying (BRP)",
    "Storyteller / Storytelling",
    "GURPS",
)

# Parent-system defaults are intentionally empty — these are highly library
# specific (users curate their own "Dungeons & Dragons", "Cyberpunk", etc.).
DEFAULT_PARENT_SYSTEMS: Sequence[str] = ()

# Common TTRPG license defaults. User-removable / extendable.
DEFAULT_LICENSES: Sequence[str] = (
    "Proprietary / All Rights Reserved",
    "OGL 1.0a",
    "ORC License",
    "Creative Commons BY 4.0",
    "Creative Commons BY-SA 4.0",
    "Creative Commons BY-NC 4.0",
    "Creative Commons CC0",
    "GPL",
    "Public Domain",
    "Custom / Other",
)

# Dice / materials defaults, grouped for the picker. Mirrors the front-end
# DICE_MATERIAL_GROUPS so a fresh DB seeds the same starting options.
DiceMaterialDefault = tuple[str, str]  # (group, name)

DEFAULT_DICE_MATERIALS: Sequence[DiceMaterialDefault] = (
    ("Dice", "D4"),
    ("Dice", "D6"),
    ("Dice", "D8"),
    ("Dice", "D10"),
    ("Dice", "D12"),
    ("Dice", "D20"),
    ("Dice", "D100"),
    ("Dice", "Custom (System specific)"),
    ("Cards", "Playing Cards"),
    ("Cards", "Tarot Cards"),
    ("Cards", "Custom Deck"),
    ("Other", "Tumbling Tower (Jenga Tower)"),
    ("Other", "Candles"),
    ("Other", "Poker Chips"),
    ("Other", "Timers"),
    ("Other", "Phone"),
)
