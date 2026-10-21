"""The one-step merge endpoints (issue #589).

Admin-only, like the rest of duplicate resolution. The work lives in
``services/duplicates/merge``; these handlers only translate its refusals into
status codes and run a batch one merge at a time.
"""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_admin
from ...config import get_db
from ...services.duplicates.merge import MergeError, merge
from ._schemas import MergeBatchRequest, MergeRequest

_STATUS = {"not_found": 404, "invalid": 400, "conflict": 409, "read_only": 409}


def merge_items(
    data: MergeRequest,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Merge copies into one, or with ``dry_run`` report exactly what that would do."""
    try:
        return merge(
            db,
            data.resource_type,
            data.keep_id,
            data.merge_ids,
            fields=data.fields,
            delete_files=data.delete_files,
            dry_run=data.dry_run,
        )
    except MergeError as exc:
        raise HTTPException(_STATUS.get(exc.code, 400), exc.message) from exc


def merge_batch(
    data: MergeBatchRequest,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Run several merges, each committed (or rolled back) on its own.

    Skip-and-continue: a group whose merge is refused is reported and the rest
    still go through. Duplicate groups never share members, so the dry-run
    reports of a batch add up to exactly what the real batch does.
    """
    results: list[dict] = []
    for entry in data.merges:
        try:
            result = merge(
                db,
                entry.resource_type,
                entry.keep_id,
                entry.merge_ids,
                fields=data.fields,
                delete_files=data.delete_files,
                dry_run=data.dry_run,
            )
            results.append({"keep_id": entry.keep_id, "ok": True, "result": result})
        except MergeError as exc:
            results.append({"keep_id": entry.keep_id, "ok": False, "detail": exc.message})
    merged = sum(1 for r in results if r["ok"])
    return {"results": results, "merged": merged, "failed": len(results) - merged}
