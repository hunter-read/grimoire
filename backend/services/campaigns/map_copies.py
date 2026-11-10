"""Keep a campaign's copy of a map that is leaving the library (issue #578).

A campaign can lean on a library map in three ways: link it as a resource,
build a map page on it, or embed it in a note as ``[[map:<id>]]``. Moves and
renames keep the map's id, so none of those break when the file moves. A delete
does, and by the time the scan notices a file deleted *outside* the app the
bytes are already gone.

So when the app itself is about to drop a map - a delete, a soft "remove from
the index", a folder going with everything in it - every campaign that uses the
map gets the file copied into its own uploads first, as a ``CampaignFile``:

* its map pages are pointed at the copy, and keep their pins;
* ``[[map:<id>]]`` embeds in its notes become ``[[image:<file id>]]``;
* the map's resource link is swapped for a file resource with the same
  visibility, share list and category.

A copy is bounded by the same campaign upload settings an upload is (**Settings
→ App**: uploads off, the per-file cap and the per-campaign total). A copy the
settings refuse, a map that is not an image, or a file already gone from disk
falls back to the placeholder a map page shows for a missing map: the pins
stay, waiting for *Replace map*. :func:`plan_map_copies` answers in advance
which campaigns get which outcome, so the delete dialog can say so.

Copying is disk I/O inside a database transaction, which a rollback cannot
undo. Each copy is recorded on the session and removed again if the session
rolls back, so a delete that fails leaves no stray files behind.
"""

import os
import re
import shutil
import uuid
from dataclasses import dataclass, field
from typing import Iterable, Optional

from sqlalchemy import event
from sqlalchemy.orm import Session

from ...config import CAMPAIGN_UPLOAD_DIR, logger
from ...models import (
    Campaign,
    CampaignFile,
    CampaignResource,
    CampaignResourceShare,
    GenericMap,
    WikiPage,
)
from ...services.app_settings import get_raw

# Where campaign uploads live (``routers/campaigns/uploads.py`` serves them).
FILES_DIR = os.path.join(CAMPAIGN_UPLOAD_DIR, "files")

# Maps a map page or an image embed can show as they are.
_IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}

# A `[[map:<id>]]` embed, with an optional `|label` (and a `:page`, for symmetry
# with book embeds). Group 1 is the id.
_MAP_EMBED_RE = re.compile(r"\[\[\s*map:\s*([A-Za-z0-9_-]+)\s*(?::[^\]|]*)?(?:\|[^\]]*)?\]\]", re.I)

_CHUNK = 400
_INFO_KEY = "campaign_map_copies"
_LISTENING = "campaign_map_copies_listening"

# Outcomes, as the delete dialog reports them.
COPY = "copy"
UPLOADS_DISABLED = "uploads_disabled"
TOO_LARGE = "too_large"
NOT_IMAGE = "not_image"
FILE_MISSING = "file_missing"


def upload_limits(db: Session) -> tuple[bool, int, int]:
    """``(disabled, max_file_bytes, max_total_bytes)``; 0 bytes means unlimited."""
    raw = get_raw(db)
    disabled = raw.get("campaign_uploads_disabled") == "true"
    max_file = int(raw.get("campaign_upload_max_file_mb") or 0) * 1024 * 1024
    max_total = int(raw.get("campaign_upload_max_total_mb") or 0) * 1024 * 1024
    return disabled, max_file, max_total


@dataclass
class _Use:
    """How one campaign uses one map."""

    resource: Optional[CampaignResource] = None
    map_pages: list[WikiPage] = field(default_factory=list)
    embed_pages: list[WikiPage] = field(default_factory=list)


@dataclass
class PlannedCopy:
    campaign_id: str
    campaign_name: str
    map_id: str
    map_name: str
    outcome: str
    size: int = 0


def _chunks(ids: list[str]) -> Iterable[list[str]]:
    for i in range(0, len(ids), _CHUNK):
        yield ids[i : i + _CHUNK]


def _uses(db: Session, map_ids: list[str]) -> dict[tuple[str, str], _Use]:
    """``{(campaign_id, map_id): _Use}`` for every campaign using these maps."""
    wanted = set(map_ids)
    uses: dict[tuple[str, str], _Use] = {}
    for chunk in _chunks(map_ids):
        for res in (
            db.query(CampaignResource)
            .filter(CampaignResource.resource_type == "map", CampaignResource.resource_id.in_(chunk))
            .all()
        ):
            uses.setdefault((res.campaign_id, res.resource_id), _Use()).resource = res
        for page in db.query(WikiPage).filter(WikiPage.map_id.in_(chunk)).all():
            uses.setdefault((page.campaign_id, page.map_id or ""), _Use()).map_pages.append(page)
    # One pass over the pages that embed any map at all, rather than a LIKE per
    # map: a folder of a thousand maps would otherwise scan the wiki a thousand
    # times.
    for page in db.query(WikiPage).filter(WikiPage.body.like("%[[map:%")).all():
        for map_id in {m.group(1) for m in _MAP_EMBED_RE.finditer(page.body or "")} & wanted:
            uses.setdefault((page.campaign_id, map_id), _Use()).embed_pages.append(page)
    return uses


def _plan(
    db: Session, maps: list[GenericMap], uses: dict[tuple[str, str], _Use]
) -> list[PlannedCopy]:
    by_id = {m.id: m for m in maps}
    disabled, max_file, max_total = upload_limits(db)
    campaign_ids = sorted({cid for cid, _ in uses})
    names = {
        c.id: c.name for c in db.query(Campaign).filter(Campaign.id.in_(campaign_ids)).all()
    } if campaign_ids else {}
    # Running totals, so two maps copied into one campaign count against its cap
    # together.
    used: dict[str, int] = {}
    plan = []
    for campaign_id, map_id in sorted(uses):
        m = by_id[map_id]
        ext = os.path.splitext(m.filename or m.filepath or "")[1].lower()
        size = 0
        if ext not in _IMAGE_MIME:
            outcome = NOT_IMAGE
        elif not os.path.isfile(m.filepath):
            outcome = FILE_MISSING
        elif disabled:
            outcome = UPLOADS_DISABLED
        else:
            size = os.path.getsize(m.filepath)
            if campaign_id not in used:
                used[campaign_id] = sum(
                    f.size_bytes or 0
                    for f in db.query(CampaignFile).filter_by(campaign_id=campaign_id).all()
                )
            if (max_file and size > max_file) or (max_total and used[campaign_id] + size > max_total):
                outcome = TOO_LARGE
            else:
                outcome = COPY
                used[campaign_id] += size
        plan.append(
            PlannedCopy(
                campaign_id=campaign_id,
                campaign_name=names.get(campaign_id, ""),
                map_id=map_id,
                map_name=m.filename or "",
                outcome=outcome,
                size=size,
            )
        )
    return plan


def plan_map_copies(db: Session, maps: list[GenericMap]) -> list[PlannedCopy]:
    """What deleting ``maps`` would do to each campaign using them. Read-only."""
    if not maps:
        return []
    return _plan(db, maps, _uses(db, [m.id for m in maps]))


def _discard_on_rollback(db: Session) -> None:
    if db.info.get(_LISTENING):
        return
    db.info[_LISTENING] = True

    @event.listens_for(db, "after_commit")
    def _kept(session: Session) -> None:
        session.info.pop(_INFO_KEY, None)

    @event.listens_for(db, "after_rollback")
    def _discard(session: Session) -> None:
        for path in session.info.pop(_INFO_KEY, []):
            try:
                os.remove(path)
            except OSError:
                pass


def _rewrite_embeds(body: str, map_id: str, file_id: str) -> str:
    return _MAP_EMBED_RE.sub(
        lambda m: f"[[image:{file_id}]]" if m.group(1) == map_id else m.group(0), body
    )


def _copy_into(db: Session, m: GenericMap, item: PlannedCopy, use: _Use) -> str:
    """Copy ``m`` into one campaign and repoint what used it. Returns the path."""
    ext = os.path.splitext(m.filename or m.filepath)[1].lower()
    stored = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(FILES_DIR, stored)
    os.makedirs(FILES_DIR, exist_ok=True)
    shutil.copyfile(m.filepath, dest)
    db.info.setdefault(_INFO_KEY, []).append(dest)
    _discard_on_rollback(db)

    cf = CampaignFile(
        campaign_id=item.campaign_id,
        stored_path=stored,
        filename=os.path.basename(m.filename or stored),
        mime_type=_IMAGE_MIME[ext],
        size_bytes=item.size,
        is_image=True,
    )
    db.add(cf)
    db.flush()

    # The file takes the map's place among the campaign's resources, seen by
    # exactly who saw the map. A map that was only embedded or on a map page had
    # no link: its copy is the GM's, like any upload, and a map page still shows
    # it to whoever can read that page.
    old = use.resource
    res = CampaignResource(
        campaign_id=item.campaign_id,
        resource_type="file",
        resource_id=cf.id,
        visibility=old.visibility if old is not None else "gm",
        category_id=old.category_id if old is not None else None,
        sort_order=old.sort_order if old is not None else 0,
    )
    db.add(res)
    db.flush()
    if old is not None:
        for share in old.shares:
            db.add(CampaignResourceShare(resource_id=res.id, user_id=share.user_id))
        db.delete(old)

    for page in use.map_pages:
        page.map_id = None
        page.map_file_id = cf.id
    for page in use.embed_pages:
        page.body = _rewrite_embeds(page.body or "", m.id, cf.id)
    return dest


def keep_campaign_copies(db: Session, maps: list[GenericMap]) -> list[PlannedCopy]:
    """Copy ``maps`` into every campaign using them, as far as the settings allow.

    Call while the files are still on disk and before the maps' references are
    purged. Does not commit. A campaign whose copy is refused keeps pointing at
    the map, so its pages show the missing-map placeholder once it is gone.
    Returns the plan it carried out.
    """
    if not maps:
        return []
    by_id = {m.id: m for m in maps}
    uses = _uses(db, list(by_id))
    plan = _plan(db, maps, uses)
    for item in plan:
        if item.outcome != COPY:
            continue
        try:
            _copy_into(db, by_id[item.map_id], item, uses[(item.campaign_id, item.map_id)])
        except OSError as e:
            # A copy is a courtesy: the delete the user asked for goes ahead,
            # and the campaign is left with the placeholder.
            logger.warning(
                "Could not keep a copy of map %s for campaign %s: %s",
                item.map_id,
                item.campaign_id,
                e,
            )
            item.outcome = FILE_MISSING
            continue
        logger.info(
            "Kept a copy of map %s (%s) for campaign %s", item.map_id, item.map_name, item.campaign_id
        )
    db.flush()
    return plan
