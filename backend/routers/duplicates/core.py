"""Duplicate-resolution endpoint handlers — admin-only, never automatic.

Nothing here runs on its own. Every deletion, link, and metadata copy is one
explicit request the user made about one group they looked at, which is the
central promise of issue #304: these are irreplaceable purchased files and a
false positive is unrecoverable.
"""
from typing import Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_admin
from ...config import get_db, logger
from ...services import tag_service, variants
from ...services.library_fs.constants import LibraryFSError
from ...services.library_fs.deletes import delete_record
from ...services.library_fs.references import reference_counts
from ...services.variants import VariantError
from ._helpers import (
    COMPARE_FIELDS,
    MERGEABLE_FIELDS,
    get_or_404,
    http_error,
    is_empty,
    resolve_model,
    system_name,
)
from ._schemas import (
    DeleteItemRequest,
    LinkRequest,
    MergeMetadataRequest,
    PromoteRequest,
    UnlinkRequest,
)


def link_variants(
    data: LinkRequest,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """File one or more items under a parent as its variants.

    Skip-and-continue per child, matching the bulk-update contract: one bad id in
    a batch of five should not cost the user the other four links.
    """
    model = resolve_model(data.resource_type)
    linked: list[str] = []
    errors: list[dict] = []
    seen: set[str] = set()

    for child in data.children:
        if child.id in seen:
            errors.append({"id": child.id, "detail": "Listed more than once."})
            continue
        seen.add(child.id)
        try:
            variants.link(
                db,
                model,
                data.parent_id,
                child.id,
                child.kind,
                child.label,
                resource_type=data.resource_type,
            )
            linked.append(child.id)
        except VariantError as exc:
            errors.append({"id": child.id, "detail": exc.message})

    if linked:
        db.commit()
        logger.info(
            "Linked %d %s variant(s) under %s", len(linked), data.resource_type, data.parent_id
        )
    else:
        db.rollback()
    return {"parent_id": data.parent_id, "linked": linked, "errors": errors}


def promote_variant(
    data: PromoteRequest,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Make a different copy the main version of an existing family.

    Unlike :func:`link_variants` this is one indivisible change rather than a
    per-child batch: the old parent and all of its children move together, and a
    partial application would leave a family split across two parents.
    """
    model = resolve_model(data.resource_type)
    try:
        moved = variants.promote(
            db,
            model,
            data.new_parent_id,
            data.old_parent_id,
            data.kind,
            data.label,
            resource_type=data.resource_type,
        )
    except VariantError as exc:
        db.rollback()
        raise http_error(exc) from exc
    db.commit()
    logger.info(
        "Promoted %s to main version over %s (%d moved)",
        data.new_parent_id,
        data.old_parent_id,
        moved,
    )
    return {"new_parent_id": data.new_parent_id, "moved": moved}


def unlink_variants(
    data: UnlinkRequest,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Promote variants back to standalone entries."""
    model = resolve_model(data.resource_type)
    if data.parent_id:
        # Collect the ids before unlinking: afterwards these rows no longer point
        # at the parent, so there is nothing left to query them by.
        freed = [c.id for c in variants.variants_of(db, model, data.parent_id)]
        variants.unlink_children(db, model, data.parent_id)
        if freed:
            db.commit()
            logger.info("Unlinked %d variant(s) from %s", len(freed), data.parent_id)
        return {"unlinked": freed}
    unlinked = variants.unlink(db, model, data.ids)
    if unlinked:
        db.commit()
        logger.info("Unlinked %d variant(s)", len(unlinked))
    return {"unlinked": unlinked}


def compare_items_mergeable(resource_type: str) -> list[str]:
    """The fields a compare view may offer to copy, in a stable order."""
    return sorted(MERGEABLE_FIELDS.get(resource_type, frozenset()))


def merge_metadata(
    data: MergeMetadataRequest,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Copy chosen metadata fields from one record onto another.

    Keeping the file with the worse metadata should not be a punishment (issue
    #304), so the good record's title, authors, and tags can move across before
    the other copy is deleted.
    """
    model = resolve_model(data.resource_type)
    allowed = MERGEABLE_FIELDS[data.resource_type]
    unknown = [f for f in data.fields if f not in allowed]
    if unknown:
        raise HTTPException(
            400,
            f"These fields cannot be copied: {', '.join(sorted(unknown))}. "
            f"Allowed: {', '.join(sorted(allowed))}.",
        )
    if data.source_id == data.target_id:
        raise HTTPException(400, "Source and target are the same item.")

    source = get_or_404(db, model, data.source_id)
    target = get_or_404(db, model, data.target_id)

    updated: list[str] = []
    skipped: list[str] = []
    for field in data.fields:
        if field == "tags":
            source_tags = tag_service.display_tags_for_resource(
                db, data.resource_type, source.id
            )
            if not source_tags:
                skipped.append(field)
                continue
            target_tags = tag_service.display_tags_for_resource(
                db, data.resource_type, target.id
            )
            # Tags are always additive: a merge should never remove a tag the
            # user put on the copy they are keeping.
            merged = tag_service.dedupe_tags([*target_tags, *source_tags])
            if merged == target_tags:
                skipped.append(field)
                continue
            tag_service.set_resource_tags(db, data.resource_type, target.id, merged)
            updated.append(field)
            continue

        value = getattr(source, field, None)
        if is_empty(value):
            skipped.append(field)
            continue
        if not data.overwrite and not is_empty(getattr(target, field, None)):
            skipped.append(field)
            continue
        setattr(target, field, value)
        updated.append(field)

    if updated:
        db.commit()
        logger.info(
            "Merged %s from %s onto %s: %s",
            data.resource_type,
            source.id,
            target.id,
            ", ".join(updated),
        )
    return {"updated": updated, "skipped": skipped}


def delete_item(
    resource_type: str,
    item_id: str,
    data: Optional[DeleteItemRequest] = None,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Delete one record — the duplicate the user chose to drop.

    Refuses to silently orphan a family: an item with variants must say what
    becomes of them, because a variant left pointing at a deleted parent would
    vanish from every view while its file sat on disk forever.
    """
    model = resolve_model(resource_type)
    payload = data or DeleteItemRequest()
    record = get_or_404(db, model, item_id)

    children = variants.variants_of(db, model, item_id)
    reparented = 0
    if children:
        if payload.reparent_to is None:
            raise HTTPException(
                409,
                f"This item has {len(children)} variant(s). Choose which one "
                f"replaces it, or unlink them first.",
            )
        try:
            reparented = variants.reparent_children(db, model, item_id, payload.reparent_to)
        except VariantError as exc:
            raise http_error(exc) from exc
        db.flush()

    try:
        result = delete_record(db, model, record, delete_file=payload.delete_file)
    except LibraryFSError as exc:
        raise HTTPException(409 if exc.code == "read_only" else 400, exc.message) from exc

    result["reparented"] = reparented
    return result


def compare_items(
    resource_type: str = Query(...),
    ids: list[str] = Query(...),
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Everything needed to render two (to four) copies side by side.

    Page images come from the existing per-item routes, which already work for a
    variant, so this returns only what the client cannot compute for itself: the
    metadata diff, the reference counts that decide which copy is worth keeping,
    and how far a synced page-flip can run.
    """
    model = resolve_model(resource_type)
    if not 2 <= len(ids) <= 4:
        raise HTTPException(400, "Compare needs between two and four items.")

    records = [get_or_404(db, model, item_id) for item_id in ids]

    items = []
    for record in records:
        parent, siblings = variants.family_for(db, model, record)
        created = getattr(record, "created_at", None)
        # Only when the record is a variant of something else. `family_for`
        # returns the record itself for a parent (and for a dangling link), and
        # naming an item as its own main version would offer the user a
        # redirect back to the page they are already on.
        main = None
        if parent is not record:
            main = {
                "id": parent.id,
                "filename": parent.filename,
                "relative_path": parent.relative_path,
                "title": getattr(parent, "title", None),
                "variant_count": len(siblings),
            }
        items.append(
            {
                "id": record.id,
                "filename": record.filename,
                "relative_path": record.relative_path,
                "file_size": record.file_size or 0,
                "content_hash": record.content_hash,
                "has_thumbnail": bool(getattr(record, "has_thumbnail", False)),
                "is_missing": bool(getattr(record, "is_missing", False)),
                "created_at": created.isoformat() if created else None,
                "title": getattr(record, "title", None),
                "page_count": getattr(record, "page_count", None),
                "mime_type": getattr(record, "mime_type", None),
                "game_system_id": getattr(record, "game_system_id", None),
                "game_system_name": system_name(db, record),
                "description": getattr(record, "description", None),
                "tags": tag_service.display_tags_for_resource(db, resource_type, record.id),
                "reference_counts": reference_counts(db, model, record.id),
                "variant_parent_id": record.variant_parent_id,
                "variant_kind": record.variant_kind or "",
                "variants": [variants.serialize_variant(v) for v in siblings],
                "variant_main": main,
            }
        )

    differences = []
    for field in COMPARE_FIELDS[resource_type]:
        values = [getattr(r, field, None) for r in records]
        differences.append(
            {
                "field": field,
                "values": [None if v is None else str(v) for v in values],
                "same": len(set(map(str, values))) == 1,
            }
        )

    page_counts = [getattr(r, "page_count", 0) or 0 for r in records]
    # The advisory pick: most pages, then biggest file, then oldest row. The user
    # always chooses — this only pre-selects a radio button.
    suggested = max(
        records,
        key=lambda r: (
            getattr(r, "page_count", 0) or 0,
            r.file_size or 0,
            -(getattr(r, "created_at", None).timestamp() if getattr(r, "created_at", None) else 0),
        ),
    )

    return {
        "resource_type": resource_type,
        "items": items,
        "differences": differences,
        # Sent with the comparison so the copy-metadata picker can be built
        # without a second round trip, and can never offer a field the merge
        # endpoint would reject.
        "mergeable_fields": compare_items_mergeable(resource_type),
        "page_count_min": min(page_counts) if page_counts else 0,
        "suggested_parent_id": suggested.id,
    }
