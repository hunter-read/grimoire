"""Serialization helpers for game systems and their books (issue #202).

Centralizes the field lists so ``list_systems``, ``get_system``, and any future
endpoint emit the same shape.
"""
from typing import Any

from ...models import Book, GameSystem
from .covers import has_cover_file


def serialize_book(book: Book, tags: list[str] | None = None) -> dict[str, Any]:
    """Serialize a Book to the API shape used by the system detail view.

    ``tags`` are the book's shared tags (display strings) — pass them in from a
    batch ``tag_service`` lookup so serialization stays a pure, per-row mapping.
    """
    return {
        "id": book.id,
        "title": book.title,
        "filename": book.filename,
        "category": book.category,
        "description": book.description,
        "page_count": book.page_count,
        "file_size": book.file_size,
        "mime_type": book.mime_type,
        "authors": book.authors or [],
        "artists": book.artists or [],
        "genres": book.genres or [],
        "publisher": book.publisher,
        "publisher_url": book.publisher_url,
        "urls": book.urls or [],
        "isbn": book.isbn or "",
        "version": book.version or "",
        "language": book.language or "",
        "license": book.license or "",
        "year": book.year,
        "month": book.month,
        "day": book.day,
        "indexed": book.indexed,
        "index_failed": book.index_failed,
        "index_error": book.index_error,
        "ocr_indexed": book.index_error == "ocr",
        "ocr_dpi": book.ocr_dpi,
        "has_thumbnail": book.has_thumbnail,
        "tags": tags if tags is not None else [],
        "is_explicit": bool(book.is_explicit),
        # Raw column, not the resolved level: NULL ("inherit") must survive the
        # round trip so the editor can tell it from an explicit "open".
        "access_level": book.access_level,
        "is_missing": bool(book.is_missing),
        "relative_path": book.relative_path,
    }


def serialize_system_summary(
    system: GameSystem,
    book_count: int,
    total_page_count: int,
    cover_book_id: str | None,
    tags: list[str] | None = None,
    child_count: int = 0,
) -> dict[str, Any]:
    """Serialize a GameSystem for the systems list (no book payload).

    ``tags`` are the system's shared tags (display strings) from a batch lookup.
    ``child_count`` is the number of systems nested inside this one when it is a
    container folder (issues #261/#262); zero for ordinary systems.
    """
    return {
        "id": system.id,
        "name": system.name,
        "slug": system.slug,
        "description": system.description,
        "publishers": system.publishers or [],
        "character_builder_url": system.character_builder_url,
        "character_builder_urls": system.character_builder_urls or [],
        "urls": system.urls or [],
        "tags": tags if tags is not None else [],
        "genre": system.genre,
        "genres": system.genres or [],
        "dice_materials": system.dice_materials or [],
        "system_family": system.system_family or "",
        "parent_system": system.parent_system or "",
        "edition": system.edition or "",
        "license": system.license or "",
        "year": system.year,
        "book_count": book_count,
        "total_page_count": total_page_count,
        "cover_image": system.cover_image,
        "cover_book_id": cover_book_id,
        # Whether GET /systems/{id}/cover will serve something — folder art or an
        # upload. Lets the client pick a cover source without a speculative 404.
        "has_cover": has_cover_file(system),
        "is_explicit": bool(system.is_explicit),
        "access_level": system.access_level or "",
        "is_system_agnostic": bool(system.is_system_agnostic),
        "is_one_page": bool(system.is_one_page),
        # System containers (issues #261, #262).
        "container_kind": system.container_kind or "",
        "parent_id": system.parent_id,
        # The container's name and one-page flag, so a child can offer "back to
        # <container>" without a second request to resolve the id. The flag is
        # needed because one-page collections are stored under a raw folder slug
        # and the client prettifies those for display.
        "parent_name": system.parent.name if system.parent_id and system.parent else "",
        "parent_is_one_page": bool(
            system.parent.is_one_page if system.parent_id and system.parent else False
        ),
        "name_is_custom": bool(system.name_is_custom),
        "child_count": child_count,
        # Index of the category dir in this system's book paths: 2 normally, one
        # deeper per enclosing container. Containers nest, so the client can't
        # derive this from ``parent_id`` alone (issue #357) — it has only the
        # immediate parent, not the chain.
        "category_depth": _category_depth(system),
    }


def _category_depth(system: GameSystem) -> int:
    """``2 + <number of enclosing containers>`` — see ``category_depth`` above.

    Walks ``parent`` rather than querying, since the caller already has the row
    loaded. Guards against a cycle the schema does not prevent.
    """
    depth = 2
    seen: set[str] = {system.id}
    current = system.parent if system.parent_id else None
    while current is not None and current.id not in seen:
        seen.add(current.id)
        depth += 1
        current = current.parent if current.parent_id else None
    return depth
