"""Keeping a Grimoire Codex DB collection in step with this library.

Grimoire Codex DB lets a signed-in person mark the books and systems they own,
then filter by owned and not owned. With ``codex_sync_collection`` on, Grimoire
keeps those marks for the account that owns ``GRIMOIRE_CODEX_DB_API_TOKEN``:
linking a book or system to a Grimoire Codex DB record marks it, and unlinking
takes the mark back. ``sync_all`` replaces every mark Grimoire made with what
is linked now, which also catches books deleted from the library.

The marks carry the source ``grimoire``, so none of this touches marks the
person made on the site. It is off by default, and only runs when someone
links, unlinks or syncs, never in the background. A failed call is logged and
never fails the change that caused it: the next sync puts it right.
"""
import logging
from typing import Any, Iterable, Literal, Mapping, Union

from sqlalchemy.orm import Session

from ..config import release_connection
from ..models import Book, GameSystem
from . import client
from .client import CodexError
from .settings import CodexSettings, load

log = logging.getLogger(__name__)

EntityType = Literal["book", "system"]


def _model(entity_type: EntityType) -> Union[type[Book], type[GameSystem]]:
    return Book if entity_type == "book" else GameSystem


def links_before(db: Session, entity_type: EntityType, ids: Iterable[str]) -> dict[str, str | None]:
    """The ``codex_id`` of each of ``ids`` now, to compare with after a change."""
    wanted = list(ids)
    if not wanted:
        return {}
    model = _model(entity_type)
    rows = db.query(model.id, model.codex_id).filter(model.id.in_(wanted)).all()
    return {row_id: codex_id for row_id, codex_id in rows}


def _held(db: Session, entity_type: EntityType, codex_ids: set[str]) -> set[str]:
    """Which of ``codex_ids`` a local record (a book whose file is still here) is still linked to."""
    model = _model(entity_type)
    query = db.query(model.codex_id).filter(model.codex_id.in_(codex_ids))
    if entity_type == "book":
        query = query.filter(Book.is_missing.isnot(True))
    return {codex_id for (codex_id,) in query.distinct() if codex_id}


def _send(s: CodexSettings, entity_type: EntityType, marked: set[str], unmarked: set[str]) -> None:
    """Make the calls; a failure is logged, and an unreachable server stops the rest."""
    calls = [(client.collection_mark, cid) for cid in sorted(marked)]
    calls += [(client.collection_unmark, cid) for cid in sorted(unmarked)]
    for call, codex_id in calls:
        try:
            call(s, entity_type, codex_id)
        except CodexError as exc:
            log.warning("Grimoire Codex DB collection update for %s %s failed: %s", entity_type, codex_id, exc)
            if exc.status is None:
                return


def push_link_changes(db: Session, entity_type: EntityType, before: Mapping[str, str | None]) -> None:
    """Mark the records ``before``'s rows are now linked to, and unmark the ones they left.

    Call after the commit, with ``before`` from ``links_before``. A record another
    local book or system is still linked to stays marked. Does nothing unless
    Grimoire Codex DB is configured and collection sync is on.
    """
    if not before:
        return
    s = load(db)
    if not (s.enabled and s.sync_collection):
        return
    after = links_before(db, entity_type, before)
    marked: set[str] = set()
    unmarked: set[str] = set()
    for row_id, old in before.items():
        new = after.get(row_id)
        if new == old:
            continue
        if new:
            marked.add(new)
        if old:
            unmarked.add(old)
    unmarked -= marked
    if unmarked:
        unmarked -= _held(db, entity_type, unmarked)
    if not (marked or unmarked):
        return
    # Grimoire Codex DB can take seconds to answer (issue #701).
    release_connection(db)
    _send(s, entity_type, marked, unmarked)


def linked_ids(db: Session, entity_type: EntityType) -> list[str]:
    """Every Grimoire Codex DB record a local book (whose file is still here) or system is linked to."""
    model = _model(entity_type)
    query = db.query(model.codex_id).filter(model.codex_id.isnot(None), model.codex_id != "")
    if entity_type == "book":
        query = query.filter(Book.is_missing.isnot(True))
    return sorted({codex_id for (codex_id,) in query.distinct() if codex_id})


def sync_all(db: Session, s: CodexSettings) -> dict[str, Any]:
    """Replace every mark Grimoire made with exactly what is linked now.

    Returns how many records were sent and Grimoire Codex DB's answer. Raises
    ``CodexError`` when the call fails.
    """
    books = linked_ids(db, "book")
    systems = linked_ids(db, "system")
    # Grimoire Codex DB can take seconds to answer (issue #701).
    release_connection(db)
    result = client.collection_sync(s, books, systems)
    unknown = result.get("unknown") if isinstance(result, dict) else None
    unknown = unknown if isinstance(unknown, dict) else {}
    return {
        "sent": {"books": len(books), "systems": len(systems)},
        "books": int(result.get("books") or 0),
        "systems": int(result.get("systems") or 0),
        "unknown": {
            "books": [str(i) for i in unknown.get("books") or []],
            "systems": [str(i) for i in unknown.get("systems") or []],
        },
    }
