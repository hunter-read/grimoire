"""Homebrew endpoints.

Homebrew is content a user wrote: the same shape as pack content, owned by an
account, and visible to others only as far as the owner chose. Every read runs
through ``homebrew.visible_filter`` and every write checks ownership, so the
visibility model lives in one place rather than being re-derived per endpoint.

Sharing grants *reading*. Only the owner edits or deletes, whatever the entry's
visibility — a campaign-shared subclass is the GM's to change.
"""
import logging
from typing import Optional

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import (
    HOMEBREW_VISIBILITY,
    CampaignMember,
    Character,
    ContentEntry,
    HomebrewEntry,
    User,
)
from ...services import characters as svc
from ...services.characters import homebrew as hb
from ..content._helpers import user_schema_document
from ._schemas import (
    HomebrewCreate,
    HomebrewForkRequest,
    HomebrewImportRequest,
    HomebrewShare,
    HomebrewUpdate,
)

logger = logging.getLogger("grimoire.homebrew")


def _owner_names(db: Session, entries: list[HomebrewEntry]) -> dict:
    """Display names for the owners of a set of entries, in one query."""
    owner_ids = {entry.owner_id for entry in entries}
    if not owner_ids:
        return {}
    rows = db.query(User.id, User.display_name, User.username).filter(
        User.id.in_(owner_ids)
    ).all()
    return {row[0]: (row[1] or row[2] or "") for row in rows}


def _used_by(db: Session, user_id: str, entry: HomebrewEntry) -> int:
    """How many of this user's characters reference an entry.

    Counted against the caller's own characters only: the point is to warn the
    person deleting it what *they* would break, and counting other people's
    sheets would leak that they exist.
    """
    characters = (
        db.query(Character)
        .filter_by(user_id=user_id, schema_ref=entry.schema_id)
        .all()
    )
    return sum(1 for row in characters if _references(row.data, entry.entry_id))


def _references(data, entry_id: str) -> bool:
    if not isinstance(data, dict):
        return False
    for value in data.values():
        items = value if isinstance(value, list) else [value]
        for item in items:
            if isinstance(item, dict) and item.get("_ref") == entry_id:
                return True
    return False


def _serialize(
    entry: HomebrewEntry,
    user_id: str,
    *,
    detail: bool = False,
    owner_names: Optional[dict] = None,
    used_by: int = 0,
) -> dict:
    payload = {
        "id": entry.id,
        "schema_id": entry.schema_id,
        "content_type": entry.content_type,
        "entry_id": entry.entry_id,
        "name": entry.name,
        "visibility": entry.visibility,
        "campaign_id": entry.campaign_id,
        "forked_from": entry.forked_from,
        "owned": entry.owner_id == user_id,
        "owner_name": (owner_names or {}).get(entry.owner_id, ""),
        "used_by": used_by,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
    }
    if detail:
        payload["data"] = entry.data if isinstance(entry.data, dict) else {}
    return payload


def list_homebrew(
    schema_id: Optional[str] = None,
    content_type: Optional[str] = None,
    mine_only: bool = False,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every homebrew entry this user can see."""
    query = db.query(HomebrewEntry).filter(hb.visible_filter(db, current_user.id))
    if mine_only:
        query = query.filter(HomebrewEntry.owner_id == current_user.id)
    if schema_id:
        query = query.filter(HomebrewEntry.schema_id == schema_id)
    if content_type:
        query = query.filter(HomebrewEntry.content_type == content_type)

    entries = query.order_by(HomebrewEntry.name).all()
    names = _owner_names(db, entries)
    return {
        "entries": [
            _serialize(
                entry,
                current_user.id,
                owner_names=names,
                used_by=_used_by(db, current_user.id, entry),
            )
            for entry in entries
        ]
    }


def get_homebrew(
    entry_row_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One homebrew entry, if this user may see it."""
    entry = (
        db.query(HomebrewEntry)
        .filter(HomebrewEntry.id == entry_row_id)
        .filter(hb.visible_filter(db, current_user.id))
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Homebrew entry not found")
    return _serialize(
        entry,
        current_user.id,
        detail=True,
        owner_names=_owner_names(db, [entry]),
        used_by=_used_by(db, current_user.id, entry),
    )


def create_homebrew(
    data: HomebrewCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Write a new homebrew entry against a content type the schema declares."""
    document = user_schema_document(db, current_user.id, data.schema_id)
    if document is None:
        raise HTTPException(status_code=400, detail="That schema is not installed")

    try:
        cleaned = hb.validate_entry(document, data.content_type, data.data)
    except (hb.HomebrewError, svc.SchemaError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    identity = (
        (document.get("content_types") or {})
        .get(data.content_type, {})
        .get("identity_field", "name")
    )
    entry_id = (data.entry_id or "").strip() or hb.slugify(cleaned.get(identity, ""))

    existing = (
        db.query(HomebrewEntry)
        .filter_by(
            owner_id=current_user.id,
            schema_id=data.schema_id,
            content_type=data.content_type,
            entry_id=entry_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"You already have a {data.content_type} with the id {entry_id!r}",
        )

    visibility, campaign_id = _resolve_visibility(
        db, current_user.id, data.visibility, data.campaign_id
    )

    entry = HomebrewEntry(
        owner_id=current_user.id,
        schema_id=data.schema_id,
        content_type=data.content_type,
        entry_id=entry_id,
        name=str(cleaned.get(identity) or entry_id)[:500],
        data=cleaned,
        visibility=visibility,
        campaign_id=campaign_id,
        forked_from=data.forked_from,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _serialize(entry, current_user.id, detail=True)


def update_homebrew(
    entry_row_id: str,
    data: HomebrewUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Edit an entry. Only the owner may, whatever its visibility."""
    entry = _owned_or_404(db, entry_row_id, current_user.id)

    if data.data is not None:
        document = user_schema_document(db, current_user.id, entry.schema_id)
        if document is None:
            raise HTTPException(status_code=400, detail="That schema is not installed")
        try:
            cleaned = hb.validate_entry(document, entry.content_type, data.data)
        except (hb.HomebrewError, svc.SchemaError) as exc:
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
    return _serialize(entry, current_user.id, detail=True)


def share_homebrew(
    entry_row_id: str,
    data: HomebrewShare,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change who can see an entry."""
    entry = _owned_or_404(db, entry_row_id, current_user.id)
    visibility, campaign_id = _resolve_visibility(
        db, current_user.id, data.visibility, data.campaign_id
    )
    entry.visibility = visibility
    # The campaign is remembered even when visibility drops back to private, so
    # re-sharing does not mean re-choosing.
    if campaign_id:
        entry.campaign_id = campaign_id
    db.commit()
    db.refresh(entry)
    return _serialize(entry, current_user.id, detail=True)


def delete_homebrew(
    entry_row_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete an entry.

    Characters referencing it are left alone: a reference is soft, so the sheet
    shows the entry as missing rather than losing the row. That is the same
    behaviour as uninstalling a pack, and it means a delete can never destroy
    someone's character.
    """
    entry = _owned_or_404(db, entry_row_id, current_user.id)
    db.delete(entry)
    db.commit()
    return {"deleted": True, "id": entry_row_id}


def fork_entry(
    data: HomebrewForkRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Copy a catalog or homebrew entry into this user's own homebrew.

    Forking is how pack content gets edited: the pack itself is read-only and
    server-wide, so changing a spell means taking a copy you own.
    """
    document = user_schema_document(db, current_user.id, data.schema_id)
    if document is None:
        raise HTTPException(status_code=400, detail="That schema is not installed")

    source_data, source_label = _find_source(db, current_user.id, data)
    if source_data is None:
        raise HTTPException(status_code=404, detail="Entry not found")

    identity = (
        (document.get("content_types") or {})
        .get(data.content_type, {})
        .get("identity_field", "name")
    )
    forked = dict(source_data)
    original = str(forked.get(identity) or data.entry_id)
    forked[identity] = f"{original} (copy)"

    # A fork of something already forked gets a fresh id rather than colliding.
    entry_id = hb.unique_entry_id(
        db, current_user.id, data.schema_id, data.content_type, data.entry_id
    )

    try:
        cleaned = hb.validate_entry(document, data.content_type, forked)
    except (hb.HomebrewError, svc.SchemaError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    entry = HomebrewEntry(
        owner_id=current_user.id,
        schema_id=data.schema_id,
        content_type=data.content_type,
        entry_id=entry_id,
        name=str(cleaned.get(identity) or entry_id)[:500],
        data=cleaned,
        visibility="private",
        forked_from=source_label,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _serialize(entry, current_user.id, detail=True)


def export_homebrew(
    schema_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Export this user's homebrew for one system as a portable pack."""
    entries = (
        db.query(HomebrewEntry)
        .filter_by(owner_id=current_user.id, schema_id=schema_id)
        .order_by(HomebrewEntry.content_type, HomebrewEntry.name)
        .all()
    )
    user = db.query(User).filter_by(id=current_user.id).first()
    author = (user.display_name or user.username) if user else ""
    try:
        return hb.export_pack(
            entries, pack_name=f"{author}'s homebrew".strip(), author=author
        )
    except hb.HomebrewError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def import_homebrew(
    data: HomebrewImportRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Import a homebrew pack into this user's own entries."""
    schema_id = (data.pack or {}).get("schema_id")
    document = (
        user_schema_document(db, current_user.id, schema_id) if schema_id else None
    )
    try:
        result = hb.import_pack(
            db,
            data.pack,
            owner_id=current_user.id,
            document=document,
            conflict=data.conflict,
        )
    except hb.HomebrewError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    return result


# --- helpers -------------------------------------------------------------


def _owned_or_404(db: Session, entry_row_id: str, user_id: str) -> HomebrewEntry:
    """Fetch an entry the caller owns, or 404.

    Deliberately 404 rather than 403 for an entry someone else owns: whether a
    given id exists is not something a stranger needs to learn.
    """
    entry = db.query(HomebrewEntry).filter_by(id=entry_row_id).first()
    if not entry or not hb.can_edit(entry, user_id):
        raise HTTPException(status_code=404, detail="Homebrew entry not found")
    return entry


def _resolve_visibility(
    db: Session, user_id: str, visibility: str, campaign_id: Optional[str]
) -> tuple:
    if visibility not in HOMEBREW_VISIBILITY:
        allowed = ", ".join(HOMEBREW_VISIBILITY)
        raise HTTPException(
            status_code=400,
            detail=f"Unknown visibility {visibility!r} (expected one of: {allowed})",
        )
    if visibility != "campaign":
        return visibility, campaign_id

    if not campaign_id:
        raise HTTPException(
            status_code=400, detail="Sharing to a campaign needs a campaign_id"
        )
    member = (
        db.query(CampaignMember)
        .filter_by(campaign_id=campaign_id, user_id=user_id)
        .first()
    )
    if not member:
        # Sharing into a campaign you are not in would publish to strangers.
        raise HTTPException(status_code=403, detail="You are not in that campaign")
    return visibility, campaign_id


def _find_source(db: Session, user_id: str, data: HomebrewForkRequest) -> tuple:
    """The entry a fork copies, from the catalog or from visible homebrew."""
    query = db.query(ContentEntry).filter_by(
        schema_id=data.schema_id,
        content_type=data.content_type,
        entry_id=data.entry_id,
    )
    if data.source:
        query = query.filter_by(source=data.source)
    found = query.first()
    if found:
        return (found.data if isinstance(found.data, dict) else {},
                f"{found.source}:{found.entry_id}")

    shared = (
        db.query(HomebrewEntry)
        .filter_by(
            schema_id=data.schema_id,
            content_type=data.content_type,
            entry_id=data.entry_id,
        )
        .filter(hb.visible_filter(db, user_id))
        .first()
    )
    if shared:
        return (shared.data if isinstance(shared.data, dict) else {},
                f"homebrew:{shared.entry_id}")
    return None, ""
