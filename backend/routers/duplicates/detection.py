"""Detection endpoints: running the scan and reviewing what it found."""
from typing import Optional

from fastapi import BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_admin
from ...config import get_db, logger
from ...models.duplicates import DuplicateGroup
from ...services import duplicates
from ...services.library_fs.references import reference_counts_for
from ._helpers import resolve_model, system_names
from ._schemas import DismissRequest, ScanRequest


def get_scan_status(
    _: CurrentUser = Depends(require_admin),
):
    """Progress of the duplicate scan, for the settings panel to poll."""
    return duplicates.get_status()


def start_scan(
    data: Optional[ScanRequest] = None,
    background_tasks: BackgroundTasks = None,  # type: ignore[assignment]
    _: CurrentUser = Depends(require_admin),
):
    """Kick off a detection pass in the background.

    Refuses while a library scan is running: detection reads a snapshot of the
    library, and comparing rows the scanner is actively rewriting produces groups
    that are wrong by the time they are displayed.
    """
    from ..library import _helpers as _lib

    if _lib._get_status()["running"]:
        raise HTTPException(
            status_code=409,
            detail="A library scan is already running; retry after it completes.",
        )
    if duplicates.get_status().get("running"):
        return {"status": "already_running"}

    types = list(data.resource_types) if data and data.resource_types else None
    accuracy = data.accuracy if data else "medium"
    background_tasks.add_task(duplicates.run_detection_sync, types, accuracy)
    logger.info("Duplicate scan requested (types=%s, accuracy=%s)", types or "all", accuracy)
    return {"status": "scan_started"}


def cancel_scan(
    _: CurrentUser = Depends(require_admin),
):
    if not duplicates.get_status().get("running"):
        return {"status": "not_running"}
    duplicates.request_stop()
    return {"status": "stop_requested"}


def list_groups(
    resource_type: Optional[str] = None,
    min_confidence: float = 0.0,
    limit: int = Query(50, le=200),
    offset: int = 0,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Candidate groups from the most recent completed scan.

    Groups whose members have since been deleted or already resolved into a
    variant family are filtered out here rather than deleted from the table: a
    read should not mutate, and the next scan clears them anyway.
    """
    query = db.query(DuplicateGroup)
    if resource_type:
        query = query.filter_by(resource_type=resource_type)
    if min_confidence:
        query = query.filter(DuplicateGroup.confidence >= min_confidence)
    query = query.order_by(DuplicateGroup.confidence.desc(), DuplicateGroup.id)

    # Hydrated a slice at a time rather than all at once. Building every group
    # in the table only to return a page of them meant a page load cost work
    # proportional to the whole library: a 200-group page issued over two
    # thousand queries and took noticeably long to come back.
    #
    # The scan does not know which groups are still open - members get deleted
    # or resolved into a variant family between scans - and that filtering can
    # only happen after the members are loaded. So SQL LIMIT alone would return
    # short pages; instead this walks the ordered rows in blocks, keeping the
    # survivors, until the requested page is full.
    out: list[dict] = []
    wanted = offset + limit
    seen = 0
    block = max(wanted, 1)
    while len(out) < wanted:
        rows = query.offset(seen).limit(block).all()
        if not rows:
            break
        seen += len(rows)
        out.extend(_hydrate(db, rows))

    page = out[offset : offset + limit]
    # The id of the run these groups came from. Read from the first surviving
    # group rather than a separate query - every row of a completed scan carries
    # the same scan_id.
    scan_id = out[0]["scan_id"] if out else None
    for group in page:
        group.pop("scan_id", None)

    # Page-scoped: the number of open groups walked to fill this page, not a
    # count of the whole table. Whether a group is still open depends on member
    # rows the scan does not join to, so an exact table-wide total would mean
    # hydrating every group on every request - which is the cost this endpoint
    # exists to avoid. Callers that need "is there more" should ask for the next
    # page; a short one means the end.
    return {"scan_id": scan_id, "total": len(out), "groups": page}


def _hydrate(db: Session, rows: list) -> list[dict]:
    """Turn scan rows into review payloads, batching every lookup they need.

    Grouped by resource type so the member records, their game system names, and
    their reference counts are each fetched once for the whole block instead of
    once per member.
    """
    by_type: dict[str, list] = {}
    for row in rows:
        by_type.setdefault(row.resource_type, []).append(row)

    built: dict[str, dict] = {}
    for rtype, type_rows in by_type.items():
        model = resolve_model(rtype)
        ids = {mid for row in type_rows for mid in (row.member_ids or [])}
        records = {
            r.id: r for r in db.query(model).filter(model.id.in_(list(ids))).all()
        }
        systems = system_names(db, records.values())
        counts = reference_counts_for(db, model, list(records))

        for row in type_rows:
            present = {
                mid: records[mid] for mid in (row.member_ids or []) if mid in records
            }
            # A member that vanished, or a family the user has already collapsed,
            # is no longer an open question.
            if len(present) < 2:
                continue
            if sum(1 for r in present.values() if r.variant_parent_id is None) < 2:
                continue

            kinds = row.suggested_kinds or {}
            members = []
            for member_id, record in present.items():
                hint = kinds.get(member_id) or {}
                members.append(
                    {
                        "id": record.id,
                        "filename": record.filename,
                        "relative_path": record.relative_path,
                        "file_size": record.file_size or 0,
                        "title": getattr(record, "title", None),
                        "page_count": getattr(record, "page_count", None),
                        "has_thumbnail": bool(getattr(record, "has_thumbnail", False)),
                        "is_missing": bool(getattr(record, "is_missing", False)),
                        "game_system_name": systems.get(record.id),
                        "content_hash": record.content_hash,
                        "suggested_kind": hint.get("kind", "other"),
                        "suggested_label": hint.get("label", ""),
                        "reference_counts": counts.get(record.id, {}),
                    }
                )
            built[row.id] = {
                "id": row.id,
                "scan_id": row.scan_id,
                "resource_type": row.resource_type,
                "confidence": row.confidence or 0.0,
                "reasons": row.reasons or [],
                "reason_text": duplicates.describe(row.reasons or []),
                "suggested_parent_id": row.suggested_parent_id,
                "members": members,
                # Only edges whose endpoints both survived the filtering above,
                # so the client never renders a pair against a vanished member.
                "edges": [
                    e
                    for e in (row.edges or [])
                    if e.get("a") in present and e.get("b") in present
                ],
            }
    # Grouping by type above loses the confidence ordering the query applied, so
    # the block is re-emitted in the order it arrived.
    return [built[row.id] for row in rows if row.id in built]


def dismiss_group(
    data: DismissRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Record that a group is not a set of duplicates.

    Remembered pair-wise, so the judgement still applies when a later scan finds
    a third copy - see services/duplicates/dismissals.py.
    """
    row = duplicates.dismiss(
        db,
        data.resource_type,
        data.member_ids,
        dismissed_by=current_user.id,
        note=data.note,
    )
    # Drop the rejected relationship from the current results too, so it goes
    # away immediately instead of lingering until the next scan.
    #
    # Edge-level rather than group-level: the old whole-group subset test only
    # fired when the dismissed set covered the entire group, so rejecting one
    # pair inside a four-member cluster deleted nothing and the pair came
    # straight back on screen. Removing the edge also stops the transitive
    # rejoin — with D-A gone, A can no longer be pulled back beside D through
    # D-B-A.
    rejected = duplicates.expand_pairs(data.member_ids)
    for group in (
        db.query(DuplicateGroup).filter_by(resource_type=data.resource_type).all()
    ):
        kept = [
            e
            for e in (group.edges or [])
            if frozenset((e.get("a"), e.get("b"))) not in rejected
        ]
        if len(kept) == len(group.edges or []):
            continue
        if not kept:
            db.delete(group)
            continue
        # Surviving edges may no longer describe one connected cluster, but the
        # group row is only a container for review: the pairs are what the user
        # acts on, so trimming the edge list and the members it still mentions
        # is enough.
        group.edges = kept
        still = {e["a"] for e in kept} | {e["b"] for e in kept}
        group.member_ids = [m for m in (group.member_ids or []) if m in still]
        if len(group.member_ids) < 2:
            db.delete(group)
    db.commit()
    logger.info("Dismissed duplicate group %s (%s)", row.group_key[:12], data.resource_type)
    return {
        "id": row.id,
        "resource_type": row.resource_type,
        "member_ids": row.member_ids or [],
        "note": row.note or "",
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "member_names": [],
    }


def list_dismissals(
    resource_type: Optional[str] = None,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Groups the user has marked as not-duplicates, so they can be undone."""
    rows = duplicates.list_dismissals(db, resource_type)
    out = []
    for row in rows:
        model = resolve_model(row.resource_type)
        names = [
            r.filename
            for r in db.query(model).filter(model.id.in_(list(row.member_ids or []))).all()
        ]
        out.append(
            {
                "id": row.id,
                "resource_type": row.resource_type,
                "member_ids": row.member_ids or [],
                "note": row.note or "",
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "member_names": names,
            }
        )
    return {"dismissals": out}


def undismiss_group(
    dismissal_id: str,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Forget a dismissal so the group can surface on the next scan."""
    if not duplicates.undismiss(db, dismissal_id):
        raise HTTPException(404, "Dismissal not found")
    db.commit()
    return {"status": "removed"}
