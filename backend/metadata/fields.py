"""Building the neutral field dict a serializer renders.

One place that knows how to read a ``Book``, so the three formats do not each
grow their own opinion about where tags live or how a missing year is spelled.
"""
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models import Book
from ..services import tag_service


def _list(value: Any) -> list[str]:
    """A JSON column's list of strings, trimmed and emptied of blanks.

    These columns default to ``list`` but hold whatever earlier versions and
    imports put there, so a scalar or ``None`` has to survive the trip.
    """
    if not value:
        return []
    if not isinstance(value, list):
        value = [value]
    return [s for v in value if (s := str(v).strip())]


def _links(value: Any) -> list[dict]:
    """The ``[{"label", "url"}]`` link-list shape, dropping entries with no URL."""
    if not isinstance(value, list):
        return []
    out = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        url = str(entry.get("url", "")).strip()
        if url:
            out.append({"label": str(entry.get("label", "")).strip(), "url": url})
    return out


def book_fields(
    db: Session, book: Book, cover_filename: Optional[str] = None
) -> dict[str, Any]:
    """The exportable metadata for one book.

    Tags come from the shared-tag tables rather than a column (issue #235), so
    they need the service rather than a ``getattr``. ``cover_filename`` is the
    bare name of a cover written alongside, and is omitted when no cover exists.
    """
    fields: dict[str, Any] = {
        "title": (book.title or "").strip(),
        "description": (book.description or "").strip(),
        "authors": _list(book.authors),
        "artists": _list(book.artists),
        "publisher": (book.publisher or "").strip(),
        "genres": _list(book.genres),
        "isbn": (book.isbn or "").strip(),
        "version": (book.version or "").strip(),
        "language": (book.language or "").strip(),
        "license": (book.license or "").strip(),
        "year": book.year,
        "month": book.month,
        "day": book.day,
        "category": (book.category or "").strip(),
        "urls": _links(book.urls),
        "tags": tag_service.display_tags_for_resource(db, "book", book.id),
    }

    # The legacy single-URL column predates ``urls``; surface it only when the
    # list form has nothing, so an exported sidecar never shows a stale URL the
    # UI has already replaced.
    publisher_url = (book.publisher_url or "").strip()
    if publisher_url and not fields["urls"]:
        fields["publisher_url"] = publisher_url

    if cover_filename:
        fields["cover_filename"] = cover_filename
    return fields
