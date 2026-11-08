"""Where a wargame book moves when its category is edited.

The armory's counterpart to :func:`.placement.category_folder_for`. A wargame
book's folders name its factions as well as its category
(``indexer/factions.py``), so a book cannot simply move to the system's folder
for its new category: ``Factions/Necrons/Codex.pdf`` moved to ``Supplements/``
would stop being a Necrons book. It moves to a category folder *under its
innermost faction* instead - ``Factions/Necrons/Supplements/`` - and an army
book, the default for a faction's own books, moves into the faction folder
itself. A book outside any faction uses the category's folder under its
system, as a role-playing book does.

Every candidate is checked by reading it back with the scanner's own walk
(``read_wargame_placement``) before the book goes there. Only a folder that
reads as the new category *and* the same factions is used. Anything else
leaves the file where it is, because the next rescan would undo a move to it
anyway.
"""
from pathlib import Path
from typing import Callable, Optional

from sqlalchemy.orm import Session

from ...config import logger
from ...indexer.categories import match_wargame_category, slugify
from ...indexer.constants import ARMY_BOOK, CATEGORY_MARKER
from ...indexer.factions import folder_kind, read_wargame_placement
from .paths import library_root, to_relative
from .placement import _system_depth_for, is_category_name

# The folder to create for a wargame category that has none yet. Each name
# reads back as its category in the wargame vocabulary (WARGAME_CATEGORY_MAP),
# and army books go in "Factions", the documented layout.
WARGAME_CATEGORY_FOLDER_NAMES = {
    ARMY_BOOK: "Factions",
    "core": "Core",
    "supplement": "Supplements",
    "campaign": "Campaigns",
    "mission-pack": "Missions",
    "errata": "Rules Updates",
    "unit-reference": "Unit References",
    "painting-guide": "Painting Guides",
    "lore": "Lore",
    "magazine": "Magazines",
    "starter-set": "Starter Sets",
}


def wargame_category_folder_for(db: Session, book_path: Path, category: str) -> Optional[Path]:
    """The folder a wargame book should move to for ``category``, creating it if needed.

    Returns the book's own folder when it already reads as ``category``, and
    None when no folder under its faction would keep both the category and the
    factions - the caller then leaves the file alone.
    """
    if not is_category_name(category):
        return None
    rel = to_relative(book_path)
    parts = rel.split("/")
    if len(parts) < 3:
        return None
    # Where the category folders start: index 2 for armory/<System>/, one more
    # per container around the system - the scanner's ``system_depth``.
    depth = _system_depth_for(db, parts)
    if len(parts) <= depth:
        return None

    current, chain, faction_end = _read(rel, depth)
    if current == category:
        return book_path.parent

    def fits(folder: Path) -> bool:
        got, got_chain, _ = _read(to_relative(folder / book_path.name), depth)
        return got == category and got_chain == chain

    # Under the innermost faction, or the system root for a book outside one.
    anchor = library_root().joinpath(*parts[: depth + faction_end])
    if category == ARMY_BOOK and chain:
        # A faction's army books sit in the faction folder itself. One whose
        # filename names another kind of book ("Codex Supplement - ...") reads
        # as that in any army-book folder too - under one, the filename has the
        # last word - so there is nowhere else in the faction to put it.
        return anchor if fits(anchor) else None

    existing = _category_folder_in(anchor, category)
    if existing is not None:
        return existing if fits(existing) else None
    return _create_category_folder(anchor, category, fits)


def _read(rel: str, system_depth: int) -> tuple[str, list[str], int]:
    return read_wargame_placement(rel, system_depth, str(library_root()))


def _category_folder_in(anchor: Path, category: str) -> Optional[Path]:
    """A folder directly in ``anchor`` that files books under ``category``.

    Matched on what the folder reads as, not on its name, so a book joins the
    "Codexes" or "Mission Packs" folder already there rather than starting a
    second shelf beside it.
    """
    try:
        children = sorted(anchor.iterdir(), key=lambda c: c.name.lower())
    except OSError as e:
        logger.warning("Could not read %s while resolving a category folder: %s", anchor, e)
        return None
    for child in children:
        if not child.is_dir() or child.name.startswith("."):
            continue
        if wargame_folder_category(child) == category:
            return child
    return None


def wargame_folder_category(folder: Path) -> Optional[str]:
    """The wargame category a folder files books under, or None for a faction.

    A folder marked ``.category`` whose name is no category word stands as a
    custom category, as the scanner reads it.
    """
    if folder_kind(str(folder), folder.name) != "category":
        return None
    return match_wargame_category(folder.name) or slugify(folder.name)


def _create_category_folder(
    anchor: Path, category: str, fits: Callable[[Path], bool]
) -> Optional[Path]:
    """Create the folder for ``category`` in ``anchor``, or None when it would not fit.

    A custom category's folder name matches no category word, and would read as
    a faction, so it gets a ``.category`` marker. A folder that still does not
    read back right is removed again rather than left behind.
    """
    name = WARGAME_CATEGORY_FOLDER_NAMES.get(category) or category.replace("-", " ").title()
    target = anchor / name
    if target.exists():
        # Something of that name is already there and is not this category's
        # folder - a faction, or a file. Not a place to file the book.
        return None
    try:
        target.mkdir()
    except OSError as e:
        logger.warning("Could not create category folder %s: %s", target, e)
        return None
    marker = target / CATEGORY_MARKER
    try:
        if match_wargame_category(name) != category:
            marker.touch()
    except OSError as e:
        logger.warning("Could not mark %s as a category folder: %s", target, e)
    if fits(target):
        return target
    _discard(target, marker)
    return None


def _discard(target: Path, marker: Path) -> None:
    """Remove a category folder created for a book that will not go there."""
    try:
        marker.unlink(missing_ok=True)
        target.rmdir()
    except OSError as e:
        logger.warning("Could not remove unused category folder %s: %s", target, e)
