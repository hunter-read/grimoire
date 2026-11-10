"""Reading a wargame book's category and factions from its folders.

A wargame system files books by army as much as by kind of book. The
documented layout keeps the armies in a ``Factions/`` folder, but the other
ways players lay it out are understood too::

    <System>/Factions/Necrons/Codex - Necrons.pdf   the documented layout
    <System>/Factions/Space Marines/Blood Angels/   ...with a sub-faction
    <System>/Codexes/Necrons/Codex - Necrons.pdf    any army-book folder name
    <System>/Necrons/Codex - Necrons.pdf            armies straight in the system
    <System>/Missions/Pariah Nexus.pdf              no faction at all

Reading down from the system root, a folder whose name is a wargame category
word ("Missions", "Rules Updates", "Codexes") sets the category; any other
folder is a faction, and folders nested under a faction are its sub-factions.
Under an army-book folder ("Codexes", "Factions") the folders below are
factions too - that is the category-first layout. Once a category other than
army-book is reached, the folders below it are plain subfolders: "Campaigns/
Pariah Nexus" is a campaign, not an army.

A book whose folders leave the category open (a faction folder holding books
directly, or one under an army-book folder like ``Factions/``) takes it from
its filename - "Codex Supplement - Blood Angels" is a supplement - and
otherwise defaults to army-book.

Names will sometimes read the wrong way: "Imperial Armour" is not an army. A
``.faction`` or ``.category`` marker file in the folder settles it.
"""
import logging
import os
from typing import Optional

from sqlalchemy.orm import Session

from ..models import Army, Book, Faction, GameSystem, book_factions
from .categories import match_wargame_category, slugify
from .constants import ARMY_BOOK, CATEGORY_MARKER, FACTION_MARKER

logger = logging.getLogger("grimoire.indexer")


def place_wargame_book(
    relative_path: str, system_depth: int, library_path: str
) -> tuple[str, list[str]]:
    """``(category, faction chain)`` for one wargame book.

    ``relative_path`` is library-relative; ``system_depth`` is the index of the
    first folder under the book's system: 2 for ``armory/<System>/...``, one more
    for each container around the system. The chain
    lists faction folder names outermost first - ``["Space Marines", "Blood
    Angels"]`` - and is empty for a book outside any faction.
    """
    category, chain, _ = read_wargame_placement(relative_path, system_depth, library_path)
    return category, chain


def read_wargame_placement(
    relative_path: str, system_depth: int, library_path: str
) -> tuple[str, list[str], int]:
    """:func:`place_wargame_book`, plus where the innermost faction folder is.

    The third value counts the folders under the system root down to and
    including the innermost faction folder - 0 for a book outside any faction.
    Moving a book to a new category keeps it under that folder, so its
    factions survive the move.
    """
    parts = relative_path.replace("\\", "/").split("/")
    folders = parts[system_depth:-1]
    filename = parts[-1]

    category: Optional[str] = None
    chain: list[str] = []
    faction_end = 0
    # Whether the next unmarked, non-category folder is a faction. True at the
    # system root and under factions or an army-book folder; false once a
    # folder has filed the book under some other kind of book.
    factions_open = True
    for index, name in enumerate(folders):
        folder = os.path.join(library_path, *parts[: system_depth + index + 1])
        kind = folder_kind(folder, name)
        if kind == "faction" and factions_open:
            chain.append(name)
            faction_end = index + 1
            continue
        if kind == "category":
            matched = match_wargame_category(name)
            # A category folder whose name matches no word (one marked with
            # ``.category``) stands as a custom category, as in role-playing
            # systems.
            category = matched or slugify(name)
            factions_open = category == ARMY_BOOK
            continue
        # A non-category folder where no faction can start: an ordinary
        # subfolder ("Campaigns/Pariah Nexus"). It decides nothing.
        factions_open = False

    if category in (None, ARMY_BOOK):
        # An army-book folder ("Factions", "Codexes") says the books below are
        # armies' books, not which kind: the filename can still say more.
        category = match_wargame_category(os.path.splitext(filename)[0]) or category
    if category is None:
        category = ARMY_BOOK if chain else "core"
    return category, chain, faction_end


def folder_kind(folder: str, name: str) -> str:
    """``"faction"`` or ``"category"`` for one folder in a wargame system."""
    if os.path.exists(os.path.join(folder, FACTION_MARKER)):
        return "faction"
    if os.path.exists(os.path.join(folder, CATEGORY_MARKER)):
        return "category"
    return "category" if match_wargame_category(name) else "faction"


def link_folder_factions(
    session: Session, book: Book, system: GameSystem, chain: list[str]
) -> Optional[Faction]:
    """Link ``book`` to the faction its folders name, creating factions as needed.

    Each folder in the chain becomes a faction of ``system`` under the one
    before it. The book links to the innermost only; its parents are implied.
    Additive: links set some other way are left alone. Returns the innermost
    faction, or None for an empty chain. The caller commits.
    """
    parent: Optional[Faction] = None
    slug_path = ""
    for name in chain:
        slug = slugify(name) or "faction"
        slug_path = f"{slug_path}--{slug}" if slug_path else slug
        faction = (
            session.query(Faction)
            .filter_by(game_system_id=system.id, slug=slug_path)
            .first()
        )
        if faction is None:
            faction = Faction(
                game_system_id=system.id,
                name=name,
                slug=slug_path,
                parent_id=parent.id if parent else None,
            )
            session.add(faction)
            session.flush()
            logger.info(f"Found a new faction: {name} in {system.name}")
        parent = faction
    if parent is not None and parent not in book.factions:
        book.factions.append(parent)
    return parent


def prune_empty_factions(session: Session) -> int:
    """Delete the factions left with nothing in them, returning how many went.

    A faction is kept while a book, or an army, sits in it or in one of its
    sub-factions: deleting it would clear that army's faction, so a folder
    emptied for a moment never costs a player theirs. Run after a scan, once
    moves have re-linked books to the factions their new folders name. A
    missing book keeps its links, so its faction stays until the book goes.
    The caller commits.
    """
    factions = dict(session.query(Faction.id, Faction.parent_id).all())
    if not factions:
        return 0
    used = {row[0] for row in session.query(book_factions.c.faction_id).distinct()}
    used |= {
        row[0]
        for row in session.query(Army.faction_id).filter(Army.faction_id.isnot(None)).distinct()
    }
    keep: set[str] = set()
    for faction_id in used:
        node: Optional[str] = faction_id
        while node is not None and node not in keep and node in factions:
            keep.add(node)
            node = factions[node]
    empty = [faction_id for faction_id in factions if faction_id not in keep]
    if empty:
        session.query(Faction).filter(Faction.id.in_(empty)).delete(synchronize_session=False)
        logger.info(f"Removed {len(empty)} empty faction(s)")
    return len(empty)
