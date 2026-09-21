"""Ruleset endpoints.

A ruleset is a named set of catalog content that belongs either to a campaign —
everyone at that table reads it, the GM edits it — or to the server, which is
what core rules want to be.

Reading runs through ``rulesets.readable_filter`` and every write through
``rulesets.can_edit``, so the access model lives in one place rather than being
re-derived per endpoint.
"""
import logging
from typing import Optional

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Campaign, ContentEntry, ContentPack, Ruleset, RulesetEntry
from ...services import characters as svc
from ...services.characters import rulesets as rs
from ..content._helpers import user_schema_document
from ._schemas import (
    EntryCreate,
    EntryUpdate,
    ForkRequest,
    ImportRequest,
    RulesetCreate,
    RulesetUpdate,
)

logger = logging.getLogger("grimoire.rulesets")


def _is_admin(user: CurrentUser) -> bool:
    return user.role == "admin"


def _campaign_names(db: Session, rulesets: list[Ruleset]) -> dict:
    ids = {row.campaign_id for row in rulesets if row.campaign_id}
    if not ids:
        return {}
    return {
        row[0]: row[1]
        for row in db.query(Campaign.id, Campaign.name).filter(Campaign.id.in_(ids)).all()
    }


def _serialize(
    ruleset: Ruleset,
    *,
    editable: bool,
    entry_count: int = 0,
    campaign_name: str = "",
) -> dict:
    return {
        "id": ruleset.id,
        "schema_id": ruleset.schema_id,
        "name": ruleset.name,
        "description": ruleset.description or "",
        "version": ruleset.version or "",
        "license": ruleset.license or "",
        "license_url": ruleset.license_url or "",
        "attribution": ruleset.attribution or "",
        "source_pack_id": ruleset.source_pack_id,
        "campaign_id": ruleset.campaign_id,
        "campaign_name": campaign_name,
        "editable": editable,
        "entry_count": entry_count,
        "created_at": ruleset.created_at.isoformat() if ruleset.created_at else None,
        "updated_at": ruleset.updated_at.isoformat() if ruleset.updated_at else None,
    }


def list_rulesets(
    schema_id: Optional[str] = None,
    campaign_id: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every ruleset this user can read: the server's, plus their tables'."""
    query = db.query(Ruleset).filter(rs.readable_filter(db, current_user.id))
    if schema_id:
        query = query.filter(Ruleset.schema_id == schema_id)
    if campaign_id:
        query = query.filter(Ruleset.campaign_id == campaign_id)

    rows = query.order_by(Ruleset.name).all()
    names = _campaign_names(db, rows)
    admin = _is_admin(current_user)

    counts: dict[str, int] = {}
    for (ruleset_id,) in (
        db.query(RulesetEntry.ruleset_id)
        .filter(RulesetEntry.ruleset_id.in_([row.id for row in rows] or [""]))
        .all()
    ):
        counts[ruleset_id] = counts.get(ruleset_id, 0) + 1

    return {
        "rulesets": [
            _serialize(
                row,
                editable=rs.can_edit(db, row, current_user.id, is_admin=admin),
                entry_count=counts.get(row.id, 0),
                campaign_name=names.get(row.campaign_id or "", ""),
            )
            for row in rows
        ]
    }


def create_ruleset(
    data: RulesetCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a ruleset to a campaign, or to the server if you are an admin."""
    try:
        rs.assert_can_create(
            db, current_user.id, data.campaign_id, is_admin=_is_admin(current_user)
        )
    except rs.RulesetError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    if not data.name.strip():
        raise HTTPException(status_code=400, detail="A ruleset needs a name")

    # Licensed content must credit its source, the same rule filesystem packs
    # and community sheets follow.
    if data.license and not data.attribution:
        raise HTTPException(
            status_code=400,
            detail="A ruleset with a licence must carry the credit Grimoire displays",
        )

    ruleset = Ruleset(
        campaign_id=data.campaign_id,
        schema_id=data.schema_id,
        name=data.name.strip()[:200],
        description=data.description,
        license=data.license[:200],
        license_url=data.license_url,
        attribution=data.attribution,
        created_by_id=current_user.id,
    )
    db.add(ruleset)
    db.commit()
    db.refresh(ruleset)
    return _serialize(ruleset, editable=True)


def _readable_or_404(db: Session, ruleset_id: str, user_id: str) -> Ruleset:
    ruleset = (
        db.query(Ruleset)
        .filter(Ruleset.id == ruleset_id)
        .filter(rs.readable_filter(db, user_id))
        .first()
    )
    if not ruleset:
        raise HTTPException(status_code=404, detail="Ruleset not found")
    return ruleset


def _editable_or_404(db: Session, ruleset_id: str, user: CurrentUser) -> Ruleset:
    """A ruleset this user may change.

    404 rather than 403 for one they cannot even read: whether a given ruleset
    exists is not something a stranger needs to learn. A readable one they may
    not edit answers 403, which is the honest answer — they know it is there.
    """
    ruleset = db.query(Ruleset).filter_by(id=ruleset_id).first()
    if not ruleset:
        raise HTTPException(status_code=404, detail="Ruleset not found")
    if not rs.can_edit(db, ruleset, user.id, is_admin=_is_admin(user)):
        readable = (
            db.query(Ruleset)
            .filter(Ruleset.id == ruleset_id)
            .filter(rs.readable_filter(db, user.id))
            .first()
        )
        if not readable:
            raise HTTPException(status_code=404, detail="Ruleset not found")
        raise HTTPException(
            status_code=403, detail="Only the owner of this ruleset can change it"
        )
    return ruleset


def get_ruleset(
    ruleset_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ruleset = _readable_or_404(db, ruleset_id, current_user.id)
    count = db.query(RulesetEntry).filter_by(ruleset_id=ruleset.id).count()
    names = _campaign_names(db, [ruleset])
    return _serialize(
        ruleset,
        editable=rs.can_edit(db, ruleset, current_user.id, is_admin=_is_admin(current_user)),
        entry_count=count,
        campaign_name=names.get(ruleset.campaign_id or "", ""),
    )


def update_ruleset(
    ruleset_id: str,
    data: RulesetUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ruleset = _editable_or_404(db, ruleset_id, current_user)
    for field in ("name", "description", "license", "license_url", "attribution"):
        value = getattr(data, field)
        if value is not None:
            setattr(ruleset, field, value)
    db.commit()
    db.refresh(ruleset)
    return _serialize(ruleset, editable=True)


def delete_ruleset(
    ruleset_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a ruleset and its entries.

    Characters referencing them are left alone: a reference is soft, so the
    sheet marks the entry missing rather than losing the row.
    """
    ruleset = _editable_or_404(db, ruleset_id, current_user)
    db.delete(ruleset)
    db.commit()
    return {"deleted": True, "id": ruleset_id}


# --- entries -------------------------------------------------------------


def _entry_payload(entry: RulesetEntry, *, editable: bool, detail: bool = False) -> dict:
    payload = {
        "id": entry.id,
        "ruleset_id": entry.ruleset_id,
        "content_type": entry.content_type,
        "entry_id": entry.entry_id,
        "name": entry.name,
        "forked_from": entry.forked_from,
        "editable": editable,
    }
    if detail:
        payload["data"] = entry.data if isinstance(entry.data, dict) else {}
    return payload


def list_entries(
    ruleset_id: str,
    content_type: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ruleset = _readable_or_404(db, ruleset_id, current_user.id)
    editable = rs.can_edit(db, ruleset, current_user.id, is_admin=_is_admin(current_user))

    query = db.query(RulesetEntry).filter_by(ruleset_id=ruleset.id)
    if content_type:
        query = query.filter(RulesetEntry.content_type == content_type)
    rows = query.order_by(RulesetEntry.content_type, RulesetEntry.name).all()
    return {"entries": [_entry_payload(row, editable=editable) for row in rows]}


def create_entry(
    ruleset_id: str,
    data: EntryCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ruleset = _editable_or_404(db, ruleset_id, current_user)
    document = user_schema_document(db, current_user.id, ruleset.schema_id)
    if document is None:
        raise HTTPException(
            status_code=400,
            detail="You do not have that system's sheet installed, so its content "
            "cannot be checked",
        )

    try:
        cleaned = rs.validate_entry(document, data.content_type, data.data)
    except (rs.RulesetError, svc.SchemaError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    identity = (
        (document.get("content_types") or {})
        .get(data.content_type, {})
        .get("identity_field", "name")
    )
    entry_id = (data.entry_id or "").strip() or rs.slugify(str(cleaned.get(identity, "")))

    if (
        db.query(RulesetEntry.id)
        .filter_by(
            ruleset_id=ruleset.id, content_type=data.content_type, entry_id=entry_id
        )
        .first()
    ):
        raise HTTPException(
            status_code=409,
            detail=f"This ruleset already has a {data.content_type} called {entry_id!r}",
        )

    entry = RulesetEntry(
        ruleset_id=ruleset.id,
        schema_id=ruleset.schema_id,
        content_type=data.content_type,
        entry_id=entry_id,
        name=str(cleaned.get(identity) or entry_id)[:500],
        data=cleaned,
        forked_from=data.forked_from,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _entry_payload(entry, editable=True, detail=True)


def get_entry(
    ruleset_id: str,
    entry_row_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ruleset = _readable_or_404(db, ruleset_id, current_user.id)
    entry = (
        db.query(RulesetEntry).filter_by(id=entry_row_id, ruleset_id=ruleset.id).first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    editable = rs.can_edit(db, ruleset, current_user.id, is_admin=_is_admin(current_user))
    return _entry_payload(entry, editable=editable, detail=True)


def update_entry(
    ruleset_id: str,
    entry_row_id: str,
    data: EntryUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ruleset = _editable_or_404(db, ruleset_id, current_user)
    entry = (
        db.query(RulesetEntry).filter_by(id=entry_row_id, ruleset_id=ruleset.id).first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    if data.data is not None:
        document = user_schema_document(db, current_user.id, ruleset.schema_id)
        if document is None:
            raise HTTPException(
                status_code=400, detail="You do not have that system's sheet installed"
            )
        try:
            cleaned = rs.validate_entry(document, entry.content_type, data.data)
        except (rs.RulesetError, svc.SchemaError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        identity = (
            (document.get("content_types") or {})
            .get(entry.content_type, {})
            .get("identity_field", "name")
        )
        entry.data = cleaned
        entry.name = str(cleaned.get(identity) or entry.entry_id)[:500]

    db.commit()
    db.refresh(entry)
    return _entry_payload(entry, editable=True, detail=True)


def delete_entry(
    ruleset_id: str,
    entry_row_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ruleset = _editable_or_404(db, ruleset_id, current_user)
    entry = (
        db.query(RulesetEntry).filter_by(id=entry_row_id, ruleset_id=ruleset.id).first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    db.commit()
    return {"deleted": True, "id": entry_row_id}


def fork_entry(
    ruleset_id: str,
    data: ForkRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Copy a catalogue entry into this ruleset so it can be edited.

    Pack content is read-only and server-wide, so changing a spell means taking
    a copy that belongs to a table you run.
    """
    ruleset = _editable_or_404(db, ruleset_id, current_user)
    document = user_schema_document(db, current_user.id, ruleset.schema_id)
    if document is None:
        raise HTTPException(
            status_code=400, detail="You do not have that system's sheet installed"
        )

    source_data, label = _find_source(db, current_user.id, ruleset.schema_id, data)
    if source_data is None:
        raise HTTPException(status_code=404, detail="Entry not found")

    identity = (
        (document.get("content_types") or {})
        .get(data.content_type, {})
        .get("identity_field", "name")
    )
    forked = dict(source_data)
    forked[identity] = f"{forked.get(identity) or data.entry_id} (copy)"

    try:
        cleaned = rs.validate_entry(document, data.content_type, forked)
    except (rs.RulesetError, svc.SchemaError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    entry_id = rs.unique_entry_id(db, ruleset.id, data.content_type, data.entry_id)
    entry = RulesetEntry(
        ruleset_id=ruleset.id,
        schema_id=ruleset.schema_id,
        content_type=data.content_type,
        entry_id=entry_id,
        name=str(cleaned.get(identity) or entry_id)[:500],
        data=cleaned,
        forked_from=label,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _entry_payload(entry, editable=True, detail=True)


def _find_source(db: Session, user_id: str, schema_id: str, data: ForkRequest) -> tuple:
    query = db.query(ContentEntry).filter_by(
        schema_id=schema_id, content_type=data.content_type, entry_id=data.entry_id
    )
    if data.source:
        query = query.filter_by(source=data.source)
    found = query.first()
    if found:
        return (
            found.data if isinstance(found.data, dict) else {},
            f"{found.source}:{found.entry_id}",
        )

    shared = (
        db.query(RulesetEntry)
        .join(Ruleset, Ruleset.id == RulesetEntry.ruleset_id)
        .filter(RulesetEntry.schema_id == schema_id)
        .filter(RulesetEntry.content_type == data.content_type)
        .filter(RulesetEntry.entry_id == data.entry_id)
        .filter(rs.readable_filter(db, user_id))
        .first()
    )
    if shared:
        return (
            shared.data if isinstance(shared.data, dict) else {},
            f"ruleset:{shared.entry_id}",
        )
    return None, ""


# --- import / export -----------------------------------------------------


def list_installable_packs(
    schema_id: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Filesystem content packs that can be copied into a ruleset.

    This is how the 5.5e SRD reaches a table: an admin installs the pack once,
    and any GM imports it into their campaign's ruleset in a click.
    """
    query = db.query(ContentPack)
    if schema_id:
        query = query.filter(ContentPack.schema_id == schema_id)
    packs = query.order_by(ContentPack.name).all()
    return {
        "packs": [
            {
                "pack_id": pack.pack_id,
                "schema_id": pack.schema_id,
                "name": pack.name,
                "description": pack.description or "",
                "version": pack.version or "",
                "license": pack.license or "",
                "license_url": pack.license_url or "",
                "attribution": pack.attribution or "",
                "entry_count": pack.entry_count or 0,
            }
            for pack in packs
        ]
    }


def import_into_ruleset(
    ruleset_id: str,
    data: ImportRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add entries to a ruleset, from an installed pack or a pasted document."""
    ruleset = _editable_or_404(db, ruleset_id, current_user)
    document = user_schema_document(db, current_user.id, ruleset.schema_id)

    if data.pack_id:
        pack = db.query(ContentPack).filter_by(pack_id=data.pack_id).first()
        if not pack:
            raise HTTPException(status_code=404, detail="That content pack is not installed")
        if pack.schema_id != ruleset.schema_id:
            raise HTTPException(
                status_code=400,
                detail=f"That pack is for {pack.schema_id}, not {ruleset.schema_id}",
            )
        grouped: dict = {}
        for row in db.query(ContentEntry).filter_by(pack_id=pack.id).all():
            grouped.setdefault(row.content_type, []).append(
                {"_id": row.entry_id, **(row.data if isinstance(row.data, dict) else {})}
            )
        # The pack's credit travels with its content, so a ruleset built from
        # the SRD still displays the SRD's attribution.
        if pack.attribution and not ruleset.attribution:
            ruleset.license = pack.license or ruleset.license
            ruleset.license_url = pack.license_url or ruleset.license_url
            ruleset.attribution = pack.attribution
            ruleset.source_pack_id = pack.pack_id
    else:
        payload = data.document or {}
        grouped = payload.get("entries") if isinstance(payload, dict) else None
        if grouped is None:
            raise HTTPException(
                status_code=400, detail="Provide either a pack_id or a document to import"
            )
        if isinstance(payload, dict) and payload.get("attribution") and not ruleset.attribution:
            ruleset.license = str(payload.get("license") or "")[:200]
            ruleset.license_url = str(payload.get("license_url") or "")
            ruleset.attribution = str(payload.get("attribution") or "")

    try:
        result = rs.import_entries(
            db, ruleset, grouped, document=document, conflict=data.conflict
        )
    except rs.RulesetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    db.commit()
    return result


def export_ruleset(
    ruleset_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Export a ruleset as a portable document."""
    ruleset = _readable_or_404(db, ruleset_id, current_user.id)
    entries = (
        db.query(RulesetEntry)
        .filter_by(ruleset_id=ruleset.id)
        .order_by(RulesetEntry.content_type, RulesetEntry.name)
        .all()
    )
    return rs.export_ruleset(ruleset, entries)
