"""Grimoire Codex as a built-in metadata source (issue #35).

Plugs into the same list-sources / search / fetch flow as community add-ons
(``routers/_metadata_lookup.py``), under the reserved source id
``grimoire-codex``. Unlike an add-on it ships with Grimoire and needs no
install; an admin can turn it off in settings.
"""
import re
from typing import Any, Optional, Union

from sqlalchemy.orm import Session

from ..models import Book, GameSystem
from . import client
from .records import book_signals, candidate_label, incoming_fields
from .settings import CodexSettings

SOURCE_ID = "grimoire-codex"

_ID = r"[A-Za-z0-9_-]{4,40}"
# A pasted Codex link (https://db.grimoirecodex.org/books/abc123) or a bare id.
_LINK = re.compile(rf"/(books|systems)/({_ID})(?:[/?#]|$)")
_BARE = re.compile(rf"^{_ID}$")


def source(settings: CodexSettings) -> dict[str, Any]:
    """The entry ``list_sources`` shows for Codex."""
    return {
        "id": SOURCE_ID,
        "name": "Grimoire Codex",
        "description": "The community TTRPG catalogue. Applying a result also links this record to it.",
        "homepage": settings.url,
        "attribution": "Grimoire Codex contributors",
        "supports_paste": True,
    }


def _entity(target: str) -> str:
    return "book" if target == "book" else "system"


def search(
    db: Session,
    settings: CodexSettings,
    target: str,
    query: str,
    resource: Optional[Union[Book, GameSystem]],
) -> list[dict[str, Any]]:
    """Ranked candidates in the shape the metadata dialog shows.

    Books go through ``/match``, which weighs every signal the library has
    (ISBN, hash, authors, page count…); systems are a plain name search.
    """
    if target == "book" and isinstance(resource, Book):
        result = client.match_book(settings, book_signals(db, resource, settings, query))
        return [
            {
                "identity": c["book"]["id"],
                "label": candidate_label(c["book"], c.get("reasons")),
                "score": float(c.get("confidence", 0)),
                "url": f"{settings.url}/books/{c['book']['id']}",
            }
            for c in result.get("candidates", [])
        ]
    name = query.strip() or (getattr(resource, "name", "") if resource is not None else "")
    hits = client.search(settings, name, "system")
    return [
        {
            "identity": h["id"],
            "label": " · ".join(p for p in (h.get("name", ""), h.get("detail", "")) if p),
            # Codex returns search hits best first without a score; keep that order.
            "score": round(1 - i / max(len(hits), 1), 2),
            "url": f"{settings.url}/systems/{h['id']}",
        }
        for i, h in enumerate(hits)
    ]


def resolve_paste(target: str, pasted: str) -> str:
    """The Codex id in a pasted link or bare id, or ``ValueError``."""
    text = pasted.strip()
    found = _LINK.search(text)
    if found:
        if found.group(1) != ("books" if target == "book" else "systems"):
            raise ValueError(f"That link is not a Grimoire Codex {_entity(target)}")
        return found.group(2)
    if _BARE.match(text):
        return text
    raise ValueError("Paste a Grimoire Codex link or record id")


def fetch(settings: CodexSettings, target: str, identity: str) -> dict[str, Any]:
    """One record's fields for the diff, with the link to apply."""
    exported = client.export(settings, _entity(target), identity)
    return {
        "url": str(exported.get("codex_url") or f"{settings.url}/{_entity(target)}s/{identity}"),
        "attribution": "Grimoire Codex contributors",
        "fields": incoming_fields(target, exported),
        "identity": str(exported.get("codex_id") or identity),
    }
