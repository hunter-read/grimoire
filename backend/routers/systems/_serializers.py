"""Serialization helpers for game systems and their books (issue #202).

Centralizes the field lists so ``list_systems``, ``get_system``, and any future
endpoint emit the same shape.
"""
from typing import Any

from ...models import Book, GameSystem


def serialize_book(book: Book) -> dict[str, Any]:
    """Serialize a Book to the API shape used by the system detail view."""
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
        "tags": book.tags or [],
        "is_explicit": bool(book.is_explicit),
        "is_missing": bool(book.is_missing),
        "relative_path": book.relative_path,
    }


def serialize_system_summary(
    system: GameSystem, book_count: int, total_page_count: int, cover_book_id: str | None
) -> dict[str, Any]:
    """Serialize a GameSystem for the systems list (no book payload)."""
    return {
        "id": system.id,
        "name": system.name,
        "slug": system.slug,
        "description": system.description,
        "publishers": system.publishers or [],
        "character_builder_url": system.character_builder_url,
        "character_builder_urls": system.character_builder_urls or [],
        "urls": system.urls or [],
        "tags": system.tags or [],
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
        "is_explicit": bool(system.is_explicit),
        "is_system_agnostic": bool(system.is_system_agnostic),
        "is_one_page": bool(system.is_one_page),
    }
