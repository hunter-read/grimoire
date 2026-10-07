"""Shared helpers for the character endpoints: access, export, import."""
from typing import Any, Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import Campaign, CampaignMember, Character, ContentEntry, Ruleset, RulesetEntry
from ...services import characters as svc
from ...services.characters import rulesets as rs

#: The file format a character exports as.
EXPORT_SCHEMA = "grimoire://character/v1"

MAX_IMPORT_BYTES = 8 * 1024 * 1024

#: Where a character stands in their story. "active" is the default; the others
#: keep a sheet around once the character is no longer the one being played.
CHARACTER_STATUSES = ("active", "retired", "dead")


def character_status(value: Any) -> str:
    """A status from the closed set; anything else reads as "active"."""
    return value if value in CHARACTER_STATUSES else "active"


def readable_filter(db: Session, user_id: str):
    """Characters this user may read: their own, plus their parties' sheets.

    Reading a party member's sheet is the point of scoping a character to a
    campaign — a GM should be able to see what their players are playing.
    Writing stays with the owner, checked separately, because the sheet belongs
    to the person who wrote it.
    """
    campaigns = rs.campaign_ids_for(db, user_id)
    arms = [Character.user_id == user_id]
    if campaigns:
        arms.append(Character.campaign_id.in_(campaigns))
    return or_(*arms)


def readable_character_or_404(db: Session, character_id: str, user_id: str) -> Character:
    row = (
        db.query(Character)
        .filter(Character.id == character_id)
        .filter(readable_filter(db, user_id))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Character not found")
    return row


def assert_in_campaign(db: Session, user_id: str, campaign_id: Optional[str]) -> None:
    """A character may only be placed in a campaign its owner is at the table
    for — one they own (a GM campaign or a personal one) or have joined."""
    if not campaign_id:
        return
    campaign = db.query(Campaign).filter_by(id=campaign_id).first()
    if campaign and campaign.owner_id == user_id:
        return
    member = (
        db.query(CampaignMember)
        .filter_by(campaign_id=campaign_id, user_id=user_id, status="accepted")
        .first()
    )
    if not campaign or not member:
        raise HTTPException(status_code=403, detail="You are not in that campaign")


def campaign_names(db: Session, campaign_ids: Iterable[Any]) -> dict[str, str]:
    """Campaign id → name, for labelling characters without a query each."""
    wanted = {cid for cid in campaign_ids if cid}
    if not wanted:
        return {}
    rows = db.query(Campaign.id, Campaign.name).filter(Campaign.id.in_(wanted)).all()
    return {row[0]: row[1] for row in rows}


# --- export / import -----------------------------------------------------


def export_character(
    db: Session, character: Character, document: dict, *, schema_document: Optional[dict]
) -> dict:
    """Bundle a character into a self-contained file.

    Every reference is **denormalised**: the entry's full data is embedded
    alongside the id. That is the portability guarantee — a character shared
    with someone whose instance has neither the pack nor the ruleset still
    opens and still reads correctly. Importing prefers whatever the receiving
    instance has installed and falls back to the embedded copy, so the file is
    a floor rather than a ceiling.

    The schema travels too, for the same reason: a sheet is unreadable without
    the document that describes it.
    """
    data = character.data if isinstance(character.data, dict) else {}
    entry_ids = referenced_ids(document, data)

    embedded: dict[str, Any] = {}
    if entry_ids:
        for row in (
            db.query(ContentEntry)
            .filter(ContentEntry.schema_id == character.schema_ref)
            .filter(ContentEntry.entry_id.in_(entry_ids))
            .all()
        ):
            embedded[row.entry_id] = {
                "content_type": row.content_type,
                "source": row.source,
                "name": row.name,
                "data": row.data if isinstance(row.data, dict) else {},
            }
        for row in (
            db.query(RulesetEntry)
            .join(Ruleset, Ruleset.id == RulesetEntry.ruleset_id)
            .filter(RulesetEntry.schema_id == character.schema_ref)
            .filter(RulesetEntry.entry_id.in_(entry_ids))
            .filter(rs.readable_filter(db, character.user_id))
            .all()
        ):
            embedded.setdefault(
                row.entry_id,
                {
                    "content_type": row.content_type,
                    "source": "ruleset",
                    "name": row.name,
                    "data": row.data if isinstance(row.data, dict) else {},
                },
            )

    return {
        "$schema": EXPORT_SCHEMA,
        "name": character.name or "",
        "status": character_status(character.status),
        "schema_id": character.schema_ref,
        "schema": schema_document or {},
        "data": data,
        "entries": embedded,
    }


def referenced_ids(document: dict, data: dict) -> set:
    """Every catalog entry id a character's references point at."""
    fields = (document or {}).get("fields") or {}
    wanted: set = set()
    for name, definition in fields.items():
        if not isinstance(definition, dict):
            continue
        if definition.get("type") not in ("content_ref", "content_list"):
            continue
        value = data.get(name)
        items = value if isinstance(value, list) else [value]
        for item in items:
            if isinstance(item, dict) and not item.get("_inline"):
                entry_id = item.get("_ref")
                if isinstance(entry_id, str) and entry_id:
                    wanted.add(entry_id)
    return wanted


def import_embedded_entries(
    db: Session,
    payload: dict,
    *,
    owner_id: str,
    schema_id: str,
    document: Optional[dict],
) -> int:
    """Recreate an exported file's embedded entries in a ruleset.

    Only entries this instance does not already have: an import should adopt
    local content where it exists — that is how an erratum reaches an imported
    character — and fall back to the embedded copy only for what is genuinely
    missing.

    The recreated entries go into a **personal** ruleset named after the
    import, which only the importer reads. Anywhere wider would publish the
    file's content to people who never asked for it - and a server ruleset is
    otherwise the admin's alone to create.
    """
    embedded = payload.get("entries")
    if not isinstance(embedded, dict) or not embedded:
        return 0

    created = 0
    # Created lazily, so an import that needs no entries adds no ruleset.
    target: Optional[Ruleset] = None
    for entry_id, entry in embedded.items():
        if not isinstance(entry, dict):
            continue
        content_type = entry.get("content_type") or ""
        if not content_type:
            continue

        # Already in the catalog, or already theirs: leave it alone.
        if (
            db.query(ContentEntry.id)
            .filter_by(schema_id=schema_id, content_type=content_type, entry_id=entry_id)
            .first()
        ):
            continue
        if (
            db.query(RulesetEntry.id)
            .join(Ruleset, Ruleset.id == RulesetEntry.ruleset_id)
            .filter(RulesetEntry.schema_id == schema_id)
            .filter(RulesetEntry.content_type == content_type)
            .filter(RulesetEntry.entry_id == entry_id)
            .filter(rs.readable_filter(db, owner_id))
            .first()
        ):
            continue

        data = entry.get("data") if isinstance(entry.get("data"), dict) else {}
        try:
            cleaned = (
                rs.validate_entry(document, content_type, data) if document else dict(data)
            )
        except (rs.RulesetError, svc.SchemaError):
            # An entry that does not fit this instance's schema is skipped
            # rather than failing the whole import: the character still opens,
            # and the reference simply reads as missing.
            continue

        if target is None:
            target = Ruleset(
                owner_id=owner_id,
                schema_id=schema_id,
                name=str(payload.get("name") or "Imported content")[:200],
                description="Recreated from an imported character.",
                created_by_id=owner_id,
            )
            db.add(target)
            db.flush()

        db.add(
            RulesetEntry(
                ruleset_id=target.id,
                schema_id=schema_id,
                content_type=content_type,
                entry_id=entry_id,
                name=str(entry.get("name") or entry_id)[:500],
                data=cleaned,
            )
        )
        created += 1
    return created
