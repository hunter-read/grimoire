"""Handing a character to another player (issue #726).

A GM often prepares characters for their players: pregens for a one-shot, a
replacement mid-campaign, a sheet set up for someone less at home with the
builder. They can create it in the campaign, but until now it stayed theirs.
Transferring moves the row itself, so nothing tied to it - its pictures, its
place in the campaign - is lost the way an export and re-import would lose it.
"""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Character, CharacterSchema
from . import _helpers as helpers
from ._schemas import CharacterTransfer
from .core import _schema_for, _serialize_character, _validated_document


def transfer_character(
    character_id: str,
    data: CharacterTransfer,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Give a character to a player at the table its owner runs.

    Only the owner may, and only when they are the GM of the character's
    campaign; the recipient must have joined it. The sheet stays where it is
    played, and the GM keeps edit access - they prepared it, and are likely
    still adjusting it - which the new owner can switch off like any other GM.
    """
    row = db.query(Character).filter_by(id=character_id, user_id=current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Character not found")

    candidates = {
        person["user_id"] for person in helpers.transfer_candidates(db, row, current_user.id)
    }
    if data.user_id not in candidates:
        # One answer for every way this can fail - no campaign, a campaign
        # someone else runs, a user who is not at the table - so the endpoint
        # cannot be used to find out who belongs to which campaign.
        raise HTTPException(
            status_code=400,
            detail="You can only give a character to a player in a campaign you run",
        )

    recipient_id = data.user_id
    owner_schema = _schema_for(db, current_user.id, row.schema_ref)
    their_schema = _schema_for(db, recipient_id, row.schema_ref)
    if owner_schema and not their_schema:
        # Sheets are per user, so without this the character would open as
        # raw values for its new owner. A copy that is already theirs is kept:
        # it may be newer, and replacing it would change their other sheets.
        their_schema = CharacterSchema(
            user_id=recipient_id,
            schema_id=owner_schema.schema_id,
            name=owner_schema.name,
            system=owner_schema.system,
            description=owner_schema.description,
            version=owner_schema.version,
            document=owner_schema.document,
            source_id=owner_schema.source_id,
            source_url=owner_schema.source_url,
            source_version=owner_schema.source_version,
        )
        db.add(their_schema)
        db.flush()

    if their_schema:
        # Entries from the GM's own rulesets would stop resolving once the
        # character is not theirs. Copy just those into a personal ruleset
        # for the player - anything the player can already read is left be.
        document = _validated_document(their_schema)
        helpers.import_embedded_entries(
            db,
            {
                "name": row.name or "Transferred character",
                "entries": helpers.embedded_entries(db, row, document),
            },
            owner_id=recipient_id,
            schema_id=row.schema_ref,
            document=document,
            description="Copied with a character a GM gave you.",
        )

    row.user_id = recipient_id
    row.gm_can_edit = True
    db.commit()
    db.refresh(row)
    # Shown to the GM as it now stands for them: a party member's sheet they
    # may still edit.
    return _serialize_character(
        row,
        _schema_for(db, current_user.id, row.schema_ref),
        detail=True,
        db=db,
        viewer_id=current_user.id,
    )
