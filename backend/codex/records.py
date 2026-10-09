"""Mapping between Grimoire records and the Codex API's Grimoire-shaped payloads.

Codex speaks Grimoire's field names on its ``/grimoire`` endpoints, so the
mapping here is mostly selection: which local fields to send, which incoming
fields a local record can take, and what to tell ``/match`` about a file.
"""
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..addons.manifest import MAPPABLE_BOOK_FIELDS, MAPPABLE_SYSTEM_FIELDS
from ..models import Book, GameSystem
from ..services import tag_service
from .settings import CodexSettings

# Fields a Grimoire record sends to Codex. Category, page count and explicitness
# are facts about the local file Codex can use; access levels, paths and cover
# choices are local decisions and never leave the instance.
BOOK_SUBMIT_FIELDS = (
    "title",
    "description",
    "category",
    "authors",
    "artists",
    "publisher",
    "publisher_url",
    "urls",
    "genres",
    "isbn",
    "product_code",
    "version",
    "language",
    "license",
    "year",
    "month",
    "day",
    "page_count",
    "tags",
    "is_explicit",
)
SYSTEM_SUBMIT_FIELDS = (
    "name",
    "description",
    "publishers",
    "urls",
    "character_builder_urls",
    "genres",
    "dice_materials",
    "system_family",
    "parent_system",
    "edition",
    "license",
    "year",
    "tags",
    "is_explicit",
    "is_system_agnostic",
    "is_one_page",
)


def _clip(value: Optional[str], limit: int) -> str:
    return (value or "").strip()[:limit]


def _strings(values: Any, limit: int = 20) -> list[str]:
    return [str(v).strip()[:255] for v in (values or []) if str(v).strip()][:limit]


def book_signals(
    db: Session,
    book: Book,
    settings: CodexSettings,
    query: str = "",
) -> dict[str, Any]:
    """What ``POST /match`` needs to identify ``book``.

    A typed ``query`` that differs from the title means the automatic match was
    wrong, so only the query (and the system, as a tie-breaker) is sent: the
    identifiers that produced the wrong answer would just produce it again.
    """
    system = db.get(GameSystem, book.game_system_id) if book.game_system_id else None
    systems = [system.name] if system else []
    manual = bool(query.strip()) and query.strip() != (book.title or "").strip()
    if manual:
        return {"title": _clip(query, 500), "systems": systems, "limit": 10}
    year = book.year if book.year and 1900 <= book.year <= 2100 else None
    signals: dict[str, Any] = {
        "title": _clip(book.title, 500),
        "filename": _clip(book.filename, 500),
        "isbn": _clip(book.isbn, 20),
        "product_code": _clip(book.product_code, 100),
        "authors": _strings(book.authors),
        "publisher": _clip(book.publisher, 255),
        "systems": systems,
        "year": year,
        "page_count": book.page_count if book.page_count and book.page_count > 0 else None,
        "limit": 10,
    }
    if settings.send_hashes and book.content_hash:
        signals["hashes"] = [{"algo": "sha256", "hash": book.content_hash.lower()}]
    return signals


def candidate_label(card: dict[str, Any], reasons: Optional[list[str]] = None) -> str:
    """One line for a search result: title, systems and year, then why it matched."""
    title = str(card.get("title") or card.get("name") or "")
    systems = " + ".join(s.get("name", "") for s in card.get("systems") or [] if s.get("name"))
    parts = [p for p in (title, systems, str(card.get("year") or "")) if p]
    label = " · ".join(parts)
    if reasons:
        label += f" ({', '.join(reasons[:3])})"
    return label


def incoming_fields(target: str, exported: dict[str, Any]) -> dict[str, Any]:
    """The fields of a Codex export a local record can take, plus the link itself."""
    allowed = MAPPABLE_BOOK_FIELDS if target == "book" else MAPPABLE_SYSTEM_FIELDS
    fields = {f: exported[f] for f in allowed if f in exported}
    if exported.get("codex_id"):
        fields["codex_id"] = exported["codex_id"]
    return fields


def submit_payload(
    db: Session,
    resource: Any,
    target: str,
    settings: CodexSettings,
    fields: Optional[list[str]] = None,
    note: str = "",
) -> dict[str, Any]:
    """The body for ``POST /grimoire/books`` or ``/grimoire/systems``.

    Linked records send an update of just ``fields`` (all of them by default);
    unlinked ones create a new Codex record. A book's system must be linked
    first, because Codex needs to know which system the book belongs to.
    """
    allowed = BOOK_SUBMIT_FIELDS if target == "book" else SYSTEM_SUBMIT_FIELDS
    chosen = [f for f in (fields or allowed) if f in allowed]
    if not chosen:
        raise ValueError("Choose at least one field to send")
    resource_type = "book" if target == "book" else "system"
    record: dict[str, Any] = {}
    for field in chosen:
        if field == "tags":
            record["tags"] = tag_service.display_tags_for_resource(db, resource_type, resource.id)
        else:
            record[field] = getattr(resource, field, None)
    payload: dict[str, Any] = {"record": record, "note": note.strip()[:2000]}
    if resource.codex_id:
        payload["codex_id"] = resource.codex_id
        payload["fields"] = chosen
    if target == "book":
        # Only a new record names its system. A Codex book can belong to several
        # systems and Grimoire knows one, so an update must not overwrite the list.
        if not resource.codex_id:
            system = db.get(GameSystem, resource.game_system_id) if resource.game_system_id else None
            if system is None or not system.codex_id:
                raise ValueError("Link this book's game system to Grimoire Codex first")
            payload["systems"] = [system.codex_id]
        if settings.send_hashes and resource.content_hash:
            payload["fingerprints"] = [
                {"algo": "sha256", "hash": resource.content_hash.lower(), "size": resource.file_size or None}
            ]
    return payload
