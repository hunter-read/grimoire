"""Shared helpers for bookmark endpoints."""
from ...models import Bookmark


def _serialize(b: Bookmark) -> dict:
    return {
        "id": b.id,
        "book_id": b.book_id,
        "page_number": b.page_number,
        "label": b.label,
        "notes": b.notes or "",
        "selected_text": b.selected_text,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }
