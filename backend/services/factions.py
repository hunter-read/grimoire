"""Reading wargame factions for the API.

Factions come from the armory's folders (``indexer/factions.py``). A book links
to its innermost faction; the parents are implied by the faction tree. These
helpers batch the lookups so a page of books costs one query, not one per row.
"""
from collections import defaultdict
from typing import Any, Iterable

from sqlalchemy.orm import Session

from ..models import Faction, book_factions


def faction_ref(faction: Faction) -> dict[str, Any]:
    """The shape a faction takes on a book: enough to label and filter by it."""
    return {"id": faction.id, "name": faction.name, "parent_id": faction.parent_id}


def factions_for_books(db: Session, book_ids: Iterable[str]) -> dict[str, list[dict[str, Any]]]:
    """``{book_id: [faction ref, ...]}`` for the given books, sorted by name.

    Books with no faction are absent from the result.
    """
    ids = list({i for i in book_ids if i})
    if not ids:
        return {}
    rows = (
        db.query(book_factions.c.book_id, Faction)
        .join(Faction, Faction.id == book_factions.c.faction_id)
        .filter(book_factions.c.book_id.in_(ids))
        .all()
    )
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for book_id, faction in rows:
        result[book_id].append(faction_ref(faction))
    for refs in result.values():
        refs.sort(key=lambda f: f["name"].lower())
    return dict(result)


def system_factions(db: Session, system_id: str) -> list[dict[str, Any]]:
    """Every faction of one system, flat, with each one's book count.

    Sorted so parents come before their children and siblings by name; the
    client nests them through ``parent_id``. ``book_count`` counts the books
    linked to the faction itself, not its sub-factions.
    """
    factions = db.query(Faction).filter_by(game_system_id=system_id).all()
    if not factions:
        return []
    counts: dict[str, int] = defaultdict(int)
    for (faction_id,) in db.query(book_factions.c.faction_id).filter(
        book_factions.c.faction_id.in_([f.id for f in factions])
    ):
        counts[faction_id] += 1
    by_parent: dict[Any, list[Faction]] = defaultdict(list)
    for faction in factions:
        by_parent[faction.parent_id].append(faction)

    ordered: list[dict[str, Any]] = []

    # The parent key is a foreign key, so every faction is reached from the top.
    def visit(parent_id: Any, depth: int) -> None:
        for faction in sorted(by_parent.get(parent_id, []), key=lambda f: f.name.lower()):
            ordered.append(
                {**faction_ref(faction), "depth": depth, "book_count": counts[faction.id]}
            )
            visit(faction.id, depth + 1)

    visit(None, 0)
    return ordered
