"""What happens to a user's campaign data when the account is merged or removed,
and the guest invite codes that sign guests in to a campaign.

Shared by the campaigns, users and auth routers.
"""
import secrets
import string
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from ... import token_vault
from ...models import Campaign, CampaignMember, Character, Ruleset, User
from ...sessions import delete_user_sessions, revoke_user_sessions
from ..characters.images import remove_files_after_commit

# Tables holding rows that belong to a single user and die with them. Kept as a
# constant (never user input) so the f-string interpolation below is injection-safe.
_USER_SCOPED_TABLES = (
    "campaign_members",
    "player_session_notes",
    "session_availability",
    "bookmarks",
    "favorites",
    "saved_filters",
    "wiki_page_shares",
    "campaign_resource_shares",
    # Wiki pages a member hid from their own sidebar.
    "wiki_page_hidden",
    # The character builder: a user's characters and the sheets they installed.
    "characters",
    "character_schemas",
    # Personal settings: saved audio sets, installed themes and importers.
    "audio_sets",
    "user_themes",
    "user_importers",
)


# Rows deleted with their user but never *moved* to another one. Access grants
# (issue #258) authorise one specific person to reach restricted content, and
# API keys and share links are credentials issued to that person, so folding
# them into a merge target would silently widen the target's access — the
# opposite of what they are for. A merge deletes the source's rows instead
# (``reassign_user_data``). Guests normally hold none of these, but an account
# still flagged a guest may, so the merge must not rely on that.
_USER_DELETE_ONLY_TABLES = ("user_access_grants", "api_keys", "share_links")


# Nullable FKs that are *attribution*, not ownership: the content lives inside
# someone else's campaign and must outlive the user, so these are nulled rather
# than cascaded. Read paths already tolerate a missing author.
_USER_ATTRIBUTION_COLUMNS = (
    ("wiki_pages", "created_by_id"),
    ("campaign_files", "uploaded_by_id"),
    # A campaign or server ruleset serves a table, not its author. A personal
    # one is owned through `owner_id` instead, handled below.
    ("rulesets", "created_by_id"),
    # A wiki template serves whoever uses it, not only who made it.
    ("wiki_templates", "created_by_id"),
)


# Per-user rows that are unique within a scope, so moving them between users can
# collide with a row the target already owns. Each entry is the table and the
# column(s) that scope the uniqueness alongside user_id.
_USER_SCOPED_UNIQUE = (
    ("campaign_members", "campaign_id"),
    ("wiki_page_shares", "page_id"),
    ("wiki_page_hidden", "page_id"),
    ("campaign_resource_shares", "resource_id"),
    # One installed copy of each sheet per user; the target's copy wins.
    ("character_schemas", "schema_id"),
    # Likewise one copy of each theme or importer, and one set per kind and name.
    ("user_themes", "theme_id"),
    ("user_importers", "importer_id"),
    ("audio_sets", "kind, name"),
    # One favourite per item, one saved filter per view and name, one
    # availability answer per session date, one note per session.
    ("favorites", "item_type, item_id"),
    ("saved_filters", "scope, name"),
    ("session_availability", "campaign_id, session_date"),
    ("player_session_notes", "session_id"),
)


def reassign_user_data(db: Session, source_id: str, target_id: str) -> int:
    """Move every row owned by ``source_id`` over to ``target_id``.

    Used when merging duplicate accounts: the source's memberships, notes, and
    personal rows survive under the target instead of being deleted. Rows that
    would violate a per-scope uniqueness constraint (the target is already in
    that campaign, already has that share) are dropped rather than moved — the
    target's own row wins.

    Rows in ``_USER_DELETE_ONLY_TABLES`` (grants and credentials) are deleted
    rather than moved, so the source account can then be deleted.

    Returns the number of campaign memberships moved. Does not commit.
    """
    for table, scope in _USER_SCOPED_UNIQUE:
        # Drop the source rows that would collide with an existing target row.
        db.execute(
            text(
                f"DELETE FROM {table} WHERE user_id = :src AND ({scope}) IN "
                f"(SELECT {scope} FROM {table} WHERE user_id = :tgt)"
            ),
            {"src": source_id, "tgt": target_id},
        )
    # Each view has at most one default filter. Nothing in the schema enforces
    # that, so a moved default would quietly give the target two.
    db.execute(
        text(
            "UPDATE saved_filters SET is_default = 0 WHERE user_id = :src AND is_default "
            "AND scope IN (SELECT scope FROM saved_filters "
            "WHERE user_id = :tgt AND is_default)"
        ),
        {"src": source_id, "tgt": target_id},
    )

    moved = db.execute(
        text("SELECT COUNT(*) FROM campaign_members WHERE user_id = :src"),
        {"src": source_id},
    ).scalar_one()

    for table in _USER_SCOPED_TABLES:
        db.execute(
            text(f"UPDATE {table} SET user_id = :tgt WHERE user_id = :src"),
            {"src": source_id, "tgt": target_id},
        )
    for table, column in _USER_ATTRIBUTION_COLUMNS:
        db.execute(
            text(f"UPDATE {table} SET {column} = :tgt WHERE {column} = :src"),
            {"src": source_id, "tgt": target_id},
        )
    # Campaigns the source owns move too, so a guest promoted mid-merge keeps them.
    for campaign in db.query(Campaign).filter_by(owner_id=source_id).all():
        campaign.owner_id = target_id
    # So do personal rulesets: an imported character's content lives in one.
    db.execute(
        text("UPDATE rulesets SET owner_id = :tgt WHERE owner_id = :src"),
        {"src": source_id, "tgt": target_id},
    )
    for table in _USER_DELETE_ONLY_TABLES:
        db.execute(text(f"DELETE FROM {table} WHERE user_id = :src"), {"src": source_id})
    return int(moved)


def detach_campaign_characters(db: Session, campaign_ids: List[str]) -> None:
    """Unlink the characters played in campaigns that are about to be deleted.

    A character outlives the game it was played in, so it goes back to being
    its player's own rather than pointing at a campaign that no longer exists.
    Edit access was given to that campaign's GM, so it is turned off, exactly as
    when the player moves the character to another campaign. The database's
    ``ON DELETE SET NULL`` would clear the link alone, but not the flag.
    Does not commit.
    """
    if not campaign_ids:
        return
    db.query(Character).filter(Character.campaign_id.in_(campaign_ids)).update(
        {Character.campaign_id: None, Character.gm_can_edit: False},
        synchronize_session=False,
    )


def purge_user_data(db: Session, user_id: str) -> None:
    """Remove everything that would dangle if ``user_id`` were deleted.

    Deletes the user's owned campaigns and their personal rows, and clears
    attribution on content that survives them. Every FK referencing ``users.id``
    must be handled here or the subsequent ``DELETE FROM users`` fails against
    SQLite's foreign_keys=ON. Does not delete the User itself, and does not commit.
    Their characters' portraits and pictures are removed once the caller commits.
    """
    remove_files_after_commit(
        db, [row[0] for row in db.query(Character.id).filter_by(user_id=user_id).all()]
    )
    owned = db.query(Campaign).filter_by(owner_id=user_id).all()
    # Guests merged into one of these campaigns and others keep the others; one
    # whose working code lived here gets a fresh one rather than keeping a code
    # this campaign's owner knew. A guest left with no campaign is kept, as
    # before, for an admin to remove from the guest list.
    owned_members = (
        db.query(CampaignMember)
        .filter(
            CampaignMember.campaign_id.in_([c.id for c in owned]),
            CampaignMember.is_guest.is_(True),
            CampaignMember.user_id != user_id,
        )
        .all()
        if owned
        else []
    )
    owned_guests = [(m.user_id, m.guest_code) for m in owned_members]
    detach_campaign_characters(db, [c.id for c in owned])
    for campaign in owned:
        db.delete(campaign)
    if owned_guests:
        db.flush()
        for guest_id, code in owned_guests:
            release_guest_membership(db, guest_id, code, delete_when_empty=False)
    # Personal rulesets reach nobody else, so they go with their owner (and
    # their entries with them).
    for ruleset in db.query(Ruleset).filter_by(owner_id=user_id).all():
        db.delete(ruleset)
    # Flushed now: nothing relates a ruleset to its owner in the ORM, so left
    # pending these could be ordered after the user's own DELETE and fail it.
    db.flush()
    for table in (*_USER_SCOPED_TABLES, *_USER_DELETE_ONLY_TABLES):
        db.execute(text(f"DELETE FROM {table} WHERE user_id = :uid"), {"uid": user_id})
    for table, column in _USER_ATTRIBUTION_COLUMNS:
        db.execute(
            text(f"UPDATE {table} SET {column} = NULL WHERE {column} = :uid"),
            {"uid": user_id},
        )


def delete_guest_user(db: Session, user_id: str) -> None:
    """Delete a guest User and everything scoped to it.

    Only ever deletes genuine guest accounts. Callers removing a guest from one
    campaign go through ``release_guest_membership`` instead, which only gets
    here once the guest has no campaign left - a merged guest can be in several.
    Does not commit.
    """
    user = db.query(User).filter_by(id=user_id).first()
    if not user or not user.is_guest:
        return
    # Sessions carry an FK to users.id, so they go before the user row does —
    # and removing a guest must end whatever session their code minted.
    delete_user_sessions(db, user_id)
    purge_user_data(db, user_id)
    db.delete(user)


_CODE_ALPHABET = string.ascii_uppercase + string.digits


_CODE_LENGTH = 10


def guest_member_by_code(db: Session, code: str) -> Optional[CampaignMember]:
    """The guest membership ``code`` signs in to, matched on its lookup hash."""
    return (
        db.query(CampaignMember)
        .filter_by(guest_code_hash=token_vault.lookup_hash(code))
        .first()
    )


def generate_guest_code(db: Session) -> str:
    """Return a unique 10-char A–Z0–9 code, retrying on the rare collision."""
    for _ in range(20):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))
        if not guest_member_by_code(db, code):
            return code
    raise HTTPException(500, "Could not allocate a unique guest code")


def release_guest_membership(
    db: Session,
    user_id: str,
    guest_code: Optional[str],
    *,
    by_guest: bool = False,
    delete_when_empty: bool = True,
) -> None:
    """Finish taking a guest out of one campaign, once that membership is gone.

    A guest invited to a single campaign has nothing left once its membership is
    removed, so the backing account goes too (``delete_guest_user``) - leaving it
    would orphan a login-less account. ``delete_when_empty=False`` keeps it, for
    the account-deletion path that has always left such guests for an admin.
    A guest an admin merged across several campaigns is different: its other
    memberships, and the characters and notes it keeps there, belong to other
    tables, possibly other GMs'. Those stay, and the account loses only this
    campaign, exactly as a regular member would.

    ``guest_code`` is the code the removed membership carried. A merged guest
    has one working code, on whichever membership it was first invited through.
    If that is the one going, a membership that remains takes over signing in:
    the same code when the guest left on their own (``by_guest``), and a fresh
    one otherwise - the GM who removed them, or deleted the campaign, knows the
    old code and must not keep signing in as the guest to reach the campaigns
    they are still in. The other campaign's GM can share the new code. A fresh
    code also ends the guest's sessions, as regenerating one does: a session
    opened with the old code would otherwise outlive it. A guest who left on
    their own keeps theirs.

    The caller deletes the membership row first. Does not commit.
    """
    user = db.query(User).filter_by(id=user_id).first()
    if not user or not user.is_guest:
        return
    remaining = (
        db.query(CampaignMember)
        .filter_by(user_id=user_id)
        .order_by(CampaignMember.created_at, CampaignMember.id)
        .all()
    )
    if not remaining:
        if delete_when_empty:
            delete_guest_user(db, user_id)
        return
    if guest_code and not any(m.guest_code for m in remaining):
        holder = next(
            (m for m in remaining if m.is_guest and m.status == "accepted"), None
        )
        if holder is not None:
            if by_guest:
                holder.guest_code = guest_code
            else:
                holder.guest_code = generate_guest_code(db)
                revoke_user_sessions(db, user_id)
