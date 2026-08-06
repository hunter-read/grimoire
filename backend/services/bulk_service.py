"""Shared bulk-update machinery for the ``POST /api/<collection>/bulk`` endpoints
(issue #270).

Every bulk-editable resource (books, systems, maps, tokens, audio) applies edits
the same way: resolve the row, mirror ``tags`` into the shared-tag tables, then
``setattr`` the remaining fields. Doing that per item across N concurrent HTTP
requests is what made bulk tagging fail — concurrent ``get_or_create_tag`` calls
raced on the unique ``tags.internal`` constraint and 500'd. These endpoints take
the whole selection in **one request and one transaction**, so tag creation is
serialised and the batch either lands or doesn't.

The per-item logic lives in :func:`apply_updates` and is deliberately the same
code path the single-item PATCH handlers use, so bulk and single edits can never
drift apart.
"""
from __future__ import annotations

from typing import Any, Callable, Iterable, Optional

from sqlalchemy.orm import Session

from ..models import Audio, Book, GameSystem, GenericMap, Token
from . import tag_service

# resource_type → ORM model. Mirrors ``models.RESOURCE_TYPES``; the bulk routers
# pass their own type so an unknown one is a programming error, not user input.
_MODELS: dict[str, type] = {
    "book": Book,
    "system": GameSystem,
    "map": GenericMap,
    "token": Token,
    "audio": Audio,
}

# Cap on how many items one bulk request may carry. Large enough for "select
# all" on a realistic library, small enough that a single request can't pin a
# worker thread for an unbounded time.
MAX_BULK_ITEMS = 1000


class BulkItemError(Exception):
    """A single item in the batch could not be applied.

    Raised by a router-supplied ``validate`` hook to reject one item with a
    reason, without failing the rest of the batch.
    """


def apply_updates(
    db: Session,
    resource_type: str,
    obj: Any,
    payload: dict,
) -> None:
    """Apply one item's already-validated payload to ``obj``.

    ``tags`` are mirrored into the shared-tag tables rather than written to a
    column (issue #235), so they are applied via the service and then dropped
    from the ``setattr`` loop. Does not commit — the caller owns the transaction.
    """
    tag_service.sync_tags_from_payload(db, resource_type, obj.id, payload)
    payload.pop("tags", None)  # tags live in the shared-tag tables, not a column
    for field, value in payload.items():
        setattr(obj, field, value)


def merge_tags(existing: Iterable[str], incoming: Iterable[str]) -> list[str]:
    """Union of two tag lists, de-duplicated by internal key, order-preserving.

    Used by the "add tags to the selection" path, which is additive: tags already
    on an item are kept and the new ones appended.
    """
    return tag_service.dedupe_tags([*(existing or []), *(incoming or [])])


def run_bulk_update(
    db: Session,
    resource_type: str,
    items: list[Any],
    *,
    payload_for: Callable[[Any], dict],
    validate: Optional[Callable[[Session, Any, dict], None]] = None,
    not_found_detail: str = "Not found",
) -> dict:
    """Apply a batch of per-item updates in a single transaction.

    ``items`` are the request's per-item entries; ``payload_for`` turns one into
    the field dict to apply. Each item is resolved by ``item.id`` against the
    model for ``resource_type``.

    Items that don't resolve, or that a ``validate`` hook rejects with
    :class:`BulkItemError`, are reported in ``errors`` and skipped — one bad id
    in a large selection must not discard the rest of the user's edit. This
    mirrors the skip-and-continue behaviour of the campaign bulk-link endpoint.

    Returns ``{updated: [ids], errors: [{id, detail}]}``. Commits once at the end,
    and only if at least one item applied.
    """
    model = _MODELS[resource_type]

    ids = [item.id for item in items]
    rows = {r.id: r for r in db.query(model).filter(model.id.in_(ids or [""])).all()}

    updated: list[str] = []
    errors: list[dict] = []
    for item in items:
        obj = rows.get(item.id)
        if obj is None:
            errors.append({"id": item.id, "detail": not_found_detail})
            continue
        payload = payload_for(item)
        if validate is not None:
            try:
                validate(db, obj, payload)
            except BulkItemError as exc:
                errors.append({"id": item.id, "detail": str(exc)})
                continue
        apply_updates(db, resource_type, obj, payload)
        updated.append(item.id)

    if updated:
        db.commit()
    return {"updated": updated, "errors": errors}


def run_bulk_add_tags(
    db: Session,
    resource_type: str,
    ids: list[str],
    tags: list[str],
    *,
    not_found_detail: str = "Not found",
) -> dict:
    """Additively apply ``tags`` to every resource in ``ids``, in one transaction.

    This is the path behind the bulk action bar's tag input — the operation that
    issue #270 reported as hanging. Existing tags on each item are preserved.
    Returns ``{updated: [ids], errors: [...], tags: {id: [display tags]}}`` so the
    caller can patch local state without refetching.
    """
    model = _MODELS[resource_type]
    rows = {r.id: r for r in db.query(model).filter(model.id.in_(ids or [""])).all()}

    updated: list[str] = []
    errors: list[dict] = []
    for rid in ids:
        obj = rows.get(rid)
        if obj is None:
            errors.append({"id": rid, "detail": not_found_detail})
            continue
        existing = tag_service.display_tags_for_resource(db, resource_type, rid)
        tag_service.set_resource_tags(db, resource_type, rid, merge_tags(existing, tags))
        updated.append(rid)

    if updated:
        db.commit()
    return {
        "updated": updated,
        "errors": errors,
        "tags": tag_service.display_tags_for_resources(db, resource_type, updated),
    }
