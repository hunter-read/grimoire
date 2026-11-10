"""Reading wargame factions for the API.

Factions come from the armory's folders (``indexer/factions.py``). A book links
to its innermost faction; the parents are implied by the faction tree. These
helpers batch the lookups so a page of books costs one query, not one per row.

A faction is a folder, so its name is only given to someone who can see a book
filed under it: one whose books are all kept from the reader is left out.
"""
from collections import defaultdict
from typing import Any, Iterable

from sqlalchemy.orm import Session

from ..models import Book, Faction, book_factions
from . import access_control


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


def _visible_tree(
    db: Session, system_id: str, user: Any
) -> tuple[list[Faction], dict[str, int], set[str]]:
    """``(factions, counts, hidden)`` for one system as ``user`` sees it.

    ``counts`` is each faction's own visible books; ``hidden`` the factions
    that hold books, themselves or through a sub-faction, none of them visible.
    A faction with no books at all hides nothing, so it is not hidden.
    """
    factions = db.query(Faction).filter_by(game_system_id=system_id).all()
    if not factions:
        return [], {}, set()
    links = db.query(book_factions.c.faction_id, book_factions.c.book_id).filter(
        book_factions.c.faction_id.in_([f.id for f in factions])
    ).all()
    if access_control.sees_everything(user):
        visible = {book_id for _, book_id in links}
    else:
        visible = {
            row[0]
            for row in access_control.visible_books(
                db, db.query(Book.id).filter(Book.id.in_({b for _, b in links})), user
            )
        }
    counts: dict[str, int] = defaultdict(int)
    held: dict[str, int] = defaultdict(int)
    for faction_id, book_id in links:
        held[faction_id] += 1
        if book_id in visible:
            counts[faction_id] += 1
    parents = {f.id: f.parent_id for f in factions}
    # Roll each faction's books up its ancestors.
    total: dict[str, int] = defaultdict(int)
    seen: dict[str, int] = defaultdict(int)
    for faction in factions:
        node: Any = faction.id
        while node is not None:
            total[node] += held[faction.id]
            seen[node] += counts[faction.id]
            node = parents.get(node)
    hidden = {f.id for f in factions if total[f.id] and not seen[f.id]}
    return factions, counts, hidden


def hidden_faction_ids(db: Session, system_id: str, user: Any) -> set[str]:
    """The factions of one system ``user`` is not told about; see :func:`_visible_tree`."""
    return _visible_tree(db, system_id, user)[2]


def system_factions(db: Session, system_id: str, user: Any) -> list[dict[str, Any]]:
    """Every faction of one system ``user`` may know of, flat, with its book count.

    Sorted so parents come before their children and siblings by name; the
    client nests them through ``parent_id``. ``book_count`` counts the visible
    books linked to the faction itself, not its sub-factions.
    """
    factions, counts, hidden = _visible_tree(db, system_id, user)
    by_parent: dict[Any, list[Faction]] = defaultdict(list)
    for faction in factions:
        if faction.id not in hidden:
            by_parent[faction.parent_id].append(faction)

    ordered: list[dict[str, Any]] = []

    # The parent key is a foreign key, so every faction is reached from the top,
    # but for a hidden one's: they go unlisted with it.
    def visit(parent_id: Any, depth: int) -> None:
        for faction in sorted(by_parent.get(parent_id, []), key=lambda f: f.name.lower()):
            ordered.append(
                {**faction_ref(faction), "depth": depth, "book_count": counts.get(faction.id, 0)}
            )
            visit(faction.id, depth + 1)

    visit(None, 0)
    return ordered
