"""Merging duplicate copies into one (issue #589).

Before this, resolving a duplicate was three requests - copy metadata, delete
the other copy, decide about its file - and the delete *purged* everything that
pointed at the dropped copy. A player's bookmarks and a campaign's handout link
went with it, which is why choosing the keeper meant choosing the copy with the
most references rather than the better file.

A merge does it in one transaction: metadata fills in, every reference moves to
the keeper (deduplicated), variant families re-home, and only then are the
merged records deleted. A dry run runs the same code and rolls back, so what it
reports is exactly what the real merge would do rather than a second
implementation's estimate of it.
"""
from pathlib import Path
from typing import Any, Optional, Sequence, Union

from sqlalchemy.orm import Session

from ...config import logger
from ...models import Book
from ...models.collections import COLLECTIONS
from ...models.users import Bookmark
from .. import tag_service, variants
from ..library_fs.constants import LibraryFSError
from ..library_fs.deletes import assert_records_deletable, delete_records
from ..library_fs.references import reference_counts
from ..library_fs.rehome import REFERENCE_KINDS, rehome_references
from .scoring import has_value, suggest_keeper

# Copies merged by one request. A merge is per item, so this is a ceiling on
# copies of one thing - generous for duplicates, small enough that a mistaken
# selection cannot collapse a whole shelf into one record.
MAX_MERGE = 20

FieldsMode = Union[str, Sequence[str]]


class MergeError(Exception):
    """A merge the request asked for that cannot be carried out.

    ``code`` maps to an HTTP status in the router: ``not_found`` (404),
    ``invalid`` (400), ``conflict`` or ``read_only`` (409).
    """

    def __init__(self, message: str, code: str = "invalid") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def _load(db: Session, model: Any, record_id: str) -> Any:
    record = db.query(model).filter_by(id=record_id).first()
    if record is None:
        raise MergeError(f"Item {record_id} was not found.", code="not_found")
    return record


def _describe(db: Session, model: Any, record: Any) -> dict:
    """What the merge dialog shows for one copy, read before anything moves."""
    created = getattr(record, "created_at", None)
    return {
        "id": record.id,
        "title": getattr(record, "title", None),
        "filename": record.filename,
        "relative_path": record.relative_path,
        "file_size": record.file_size or 0,
        "page_count": getattr(record, "page_count", None),
        "is_missing": bool(getattr(record, "is_missing", False)),
        "has_thumbnail": bool(getattr(record, "has_thumbnail", False)),
        "created_at": created.isoformat() if created else None,
        "variant_parent_id": record.variant_parent_id,
        "variant_count": len(variants.variants_of(db, model, record.id)),
        "reference_counts": reference_counts(db, model, record.id),
    }


def _validate_fields(fields: FieldsMode, allowed: frozenset) -> Optional[list[str]]:
    """``None`` for a named mode, else the explicit field list, checked."""
    if isinstance(fields, str):
        if fields not in ("fill-empty", "none"):
            raise MergeError(
                f"Unknown fields mode '{fields}'. Use 'fill-empty', 'none', or a list of fields."
            )
        return None
    unknown = sorted(f for f in fields if f not in allowed)
    if unknown:
        raise MergeError(
            f"These fields cannot be copied: {', '.join(unknown)}. "
            f"Allowed: {', '.join(sorted(allowed))}."
        )
    return list(fields)


def _merge_fields(
    keep: Any, merged: list[Any], fields: FieldsMode, explicit: Optional[list[str]],
    allowed: frozenset,
) -> list[dict]:
    """Copy metadata onto the keeper; returns ``[{field, from_id, value}]``.

    ``fill-empty`` only ever writes a field the keeper has blank, taking the
    first merged copy (in request order) that has a value. An explicit list is
    the user's choice and overwrites. Tags are not handled here: their links are
    references and move with the rest, which is the union either way.
    """
    if fields == "none":
        return []
    names = explicit if explicit is not None else sorted(allowed)
    changes: list[dict] = []
    for field in names:
        if field == "tags":
            continue
        if explicit is None and has_value(getattr(keep, field, None)):
            continue
        source = next((m for m in merged if has_value(getattr(m, field, None))), None)
        if source is None:
            continue
        value = getattr(source, field)
        if value == getattr(keep, field, None):
            continue
        setattr(keep, field, value)
        changes.append({"field": field, "from_id": source.id, "value": value})
    return changes


def _rehome_variants(db: Session, model: Any, keep: Any, merged: list[Any]) -> tuple[int, bool]:
    """Re-home the merged copies' variants onto the keeper.

    Returns ``(reparented, keeper_promoted)``. The keeper becomes a main version
    when it was itself a variant of a merged copy - the family's head is going
    away and the keeper inherits it, as deleting with ``reparent_to`` does.
    """
    merged_ids = {m.id for m in merged}
    promoted = False
    if keep.variant_parent_id in merged_ids:
        keep.variant_parent_id = None
        promoted = True

    orphans = [
        child
        for m in merged
        for child in variants.variants_of(db, model, m.id)
        if child.id not in merged_ids and child.id != keep.id
    ]
    if orphans and keep.variant_parent_id:
        # Filing them under a variant would make a third level, which every
        # other path refuses too. Silently filing them under the keeper's own
        # main version instead would change a family the user did not open.
        raise MergeError(
            "The copy being kept is itself a version of another item, and the "
            "copies being merged have versions of their own. Keep the main "
            "version instead, or unlink the keeper first.",
            code="conflict",
        )
    for child in orphans:
        child.variant_parent_id = keep.id
    return len(orphans), promoted


def _bookmark_warnings(db: Session, keep: Any, merged: list[Any]) -> list[dict]:
    """Bookmarks are page numbers: flag those moving onto a different printing."""
    keep_pages = getattr(keep, "page_count", 0) or 0
    out: list[dict] = []
    for m in merged:
        pages = getattr(m, "page_count", 0) or 0
        if not pages or not keep_pages or pages == keep_pages:
            continue
        marks = db.query(Bookmark).filter_by(book_id=m.id)
        count = marks.count()
        if not count:
            continue
        out.append(
            {
                "code": "page_mismatch",
                "id": m.id,
                "count": count,
                "pages": pages,
                "keep_pages": keep_pages,
                "out_of_range": marks.filter(Bookmark.page_number > keep_pages).count(),
            }
        )
    return out


def merge(
    db: Session,
    resource_type: str,
    keep_id: Optional[str],
    merge_ids: Sequence[str],
    *,
    fields: FieldsMode = "fill-empty",
    delete_files: bool = False,
    dry_run: bool = False,
) -> dict:
    """Merge ``merge_ids`` into ``keep_id``, or report what that would do.

    A dry run may omit ``keep_id``: the suggested keeper is chosen from
    ``merge_ids`` and the rest are merged into it, so a dialog can open on the
    recommendation in one round trip. A real merge always names its keeper - an
    irreversible operation should not depend on a ranking the user never saw.

    Commits on success and rolls back on a dry run or any error; the caller
    does not manage the transaction.
    """
    spec = COLLECTIONS.get(resource_type)
    if spec is None:
        raise MergeError(f"Unknown resource type '{resource_type}'.")
    model = spec.model
    allowed = spec.mergeable_fields

    ids = list(merge_ids)
    if len(set(ids)) != len(ids):
        raise MergeError("An item is listed more than once.")
    if keep_id is None:
        if not dry_run:
            raise MergeError("Choose which copy to keep.")
        if len(ids) < 2:
            raise MergeError("Merging needs at least two copies.")
        keep_id = suggest_keeper([_load(db, model, i) for i in ids], allowed) or ids[0]
        ids = [i for i in ids if i != keep_id]
    if not ids:
        raise MergeError("Merging needs at least two copies.")
    if keep_id in ids:
        raise MergeError("The copy being kept cannot also be merged away.")
    if len(ids) > MAX_MERGE:
        raise MergeError(f"At most {MAX_MERGE} copies can be merged at once.")
    explicit = _validate_fields(fields, allowed)

    try:
        keep = _load(db, model, keep_id)
        merged = [_load(db, model, i) for i in ids]
        everyone = [keep, *merged]
        items = [_describe(db, model, r) for r in everyone]
        suggested = suggest_keeper(everyone, allowed)

        warnings: list[dict] = []
        if getattr(keep, "is_missing", False):
            warnings.append({"code": "keep_missing", "id": keep.id})
        if model is Book:
            warnings.extend(_bookmark_warnings(db, keep, merged))

        files = [
            {
                "id": m.id,
                "path": m.relative_path,
                "delete": delete_files and Path(m.filepath).exists(),
                "file_deleted": False,
                "error": None,
            }
            for m in merged
        ]
        if delete_files:
            try:
                assert_records_deletable(merged)
            except LibraryFSError as exc:
                if not dry_run:
                    raise MergeError(exc.message, code="read_only") from exc
                warnings.append({"code": "read_only"})

        tags_before = tag_service.display_tags_for_resource(db, resource_type, keep.id)
        reparented, promoted = _rehome_variants(db, model, keep, merged)
        changes = _merge_fields(keep, merged, fields, explicit, allowed)

        references = {kind: {"moved": 0, "deduplicated": 0} for kind in REFERENCE_KINDS}
        for m in merged:
            for kind, tally in rehome_references(db, model, m.id, keep.id).items():
                references[kind]["moved"] += tally["moved"]
                references[kind]["deduplicated"] += tally["deduplicated"]

        known = {t.lower() for t in tags_before}
        tags_added = [
            t
            for t in tag_service.display_tags_for_resource(db, resource_type, keep.id)
            if t.lower() not in known
        ]

        report = {
            "resource_type": resource_type,
            "keep_id": keep.id,
            "merge_ids": ids,
            "suggested_keep_id": suggested,
            "dry_run": dry_run,
            "items": items,
            "fields": changes,
            "tags_added": tags_added,
            "references": references,
            "variants_reparented": reparented,
            "keeper_promoted": promoted,
            "files": files,
            "warnings": warnings,
        }

        if dry_run:
            db.rollback()
            return report

        outcomes = {
            r["id"]: r for r in delete_records(db, model, merged, delete_files=delete_files)
        }
        db.commit()
    except Exception:
        db.rollback()
        raise

    for entry in files:
        outcome = outcomes.get(entry["id"], {})
        entry["file_deleted"] = bool(outcome.get("file_deleted"))
        entry["error"] = outcome.get("error")
    logger.info(
        "Merged %d %s cop%s into %s (%d reference(s) moved, files deleted: %s)",
        len(ids),
        resource_type,
        "y" if len(ids) == 1 else "ies",
        keep_id,
        sum(t["moved"] for t in references.values()),
        delete_files,
    )
    return report
