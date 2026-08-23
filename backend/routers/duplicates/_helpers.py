"""Shared internals for the duplicates router."""
from typing import Any, Iterable, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...models import Audio, Book, GameSystem, GenericMap, Token
from ...services.variants import VariantError

# Request ``resource_type`` → model. Taking the model from this table is what
# structurally prevents cross-collection links: there is no code path that hands
# two different models to the same link call.
MODELS: dict[str, Any] = {
    "book": Book,
    "map": GenericMap,
    "token": Token,
    "audio": Audio,
}

# VariantError codes → HTTP status, mirroring routers/files/core.py.
_STATUS = {
    "not_found": 404,
    "conflict": 409,
    "invalid": 400,
}

# What "copy metadata across" is allowed to touch, per collection.
#
# Everything identifying the *file* is excluded by design: id, filepath,
# filename, relative_path, content_hash, file_mtime, file_size, and the variant
# columns themselves. Copying any of those would either corrupt the row's link
# to its file or bypass the guards in services/variants.py. `game_system_id` is
# excluded too — a book's system comes from where it sits on disk, and rewriting
# it here would contradict the next rescan.
MERGEABLE_FIELDS: dict[str, frozenset] = {
    "book": frozenset(
        {
            "title",
            "description",
            "authors",
            "artists",
            "publisher",
            "publisher_url",
            "urls",
            "genres",
            "isbn",
            "version",
            "language",
            "license",
            "year",
            "month",
            "day",
            "category",
            "is_explicit",
            "tags",
        }
    ),
    "map": frozenset({"description", "map_type", "grid_size", "tags"}),
    "token": frozenset({"description", "is_explicit", "tags"}),
    "audio": frozenset({"description", "title", "artist", "album", "tags"}),
}

# Fields shown side by side in the compare view, per collection.
COMPARE_FIELDS: dict[str, tuple] = {
    "book": (
        "title",
        "category",
        "page_count",
        "file_size",
        "mime_type",
        "publisher",
        "version",
        "language",
        "year",
        "isbn",
        "content_hash",
    ),
    "map": ("map_type", "grid_size", "file_size", "description"),
    "token": ("file_size", "description", "is_explicit"),
    "audio": ("title", "artist", "album", "duration", "file_size"),
}


def resolve_model(resource_type: str) -> Any:
    model = MODELS.get(resource_type)
    if model is None:
        raise HTTPException(400, f"Unknown resource type '{resource_type}'")
    return model


def http_error(exc: VariantError) -> HTTPException:
    """Turn a service-layer refusal into the right status code."""
    return HTTPException(_STATUS.get(exc.code, 400), exc.message)


def get_or_404(db: Session, model: Any, item_id: str) -> Any:
    record = db.query(model).filter_by(id=item_id).first()
    if record is None:
        raise HTTPException(404, "Item not found")
    return record


def system_name(db: Session, record: Any) -> Optional[str]:
    """The game system's name for a book, or None for media and unfiled books."""
    system_id = getattr(record, "game_system_id", None)
    if not system_id:
        return None
    system = db.query(GameSystem).filter_by(id=system_id).first()
    return system.name if system else None


def is_empty(value: Any) -> bool:
    """Whether a target field counts as unset, for a non-overwriting merge."""
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, dict)):
        return len(value) == 0
    return False


def system_names(db: Session, records: Iterable[Any]) -> dict[str, Optional[str]]:
    """:func:`system_name` for many records at once, keyed by record id.

    One query for the whole set rather than one per record: the review page asks
    this for every member of every group it shows, and the same handful of
    systems answers nearly all of them.
    """
    records = list(records)
    system_ids = {
        sid for r in records if (sid := getattr(r, "game_system_id", None))
    }
    names: dict[str, str] = {}
    if system_ids:
        names = {
            s.id: s.name
            for s in db.query(GameSystem).filter(GameSystem.id.in_(list(system_ids))).all()
        }
    return {
        r.id: names.get(getattr(r, "game_system_id", None) or "") for r in records
    }
