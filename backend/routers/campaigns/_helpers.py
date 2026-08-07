"""Shared helpers and schedule computation for the campaigns package."""

import datetime
import re
from typing import Optional, List

from fastapi import HTTPException
from sqlalchemy import text

from ...models import Campaign, CampaignMember, User
from ...auth import CurrentUser


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
)

# Nullable FKs that are *attribution*, not ownership: the content lives inside
# someone else's campaign and must outlive the user, so these are nulled rather
# than cascaded. Read paths already tolerate a missing author.
_USER_ATTRIBUTION_COLUMNS = (
    ("wiki_pages", "created_by_id"),
    ("campaign_files", "uploaded_by_id"),
)


def purge_user_data(db, user_id: str) -> None:
    """Remove everything that would dangle if ``user_id`` were deleted.

    Deletes the user's owned campaigns and their personal rows, and clears
    attribution on content that survives them. Every FK referencing ``users.id``
    must be handled here or the subsequent ``DELETE FROM users`` fails against
    SQLite's foreign_keys=ON. Does not delete the User itself, and does not commit.
    """
    for campaign in db.query(Campaign).filter_by(owner_id=user_id).all():
        db.delete(campaign)
    for table in _USER_SCOPED_TABLES:
        db.execute(text(f"DELETE FROM {table} WHERE user_id = :uid"), {"uid": user_id})
    for table, column in _USER_ATTRIBUTION_COLUMNS:
        db.execute(
            text(f"UPDATE {table} SET {column} = NULL WHERE {column} = :uid"),
            {"uid": user_id},
        )


def delete_guest_user(db, user_id: str) -> None:
    """Delete a guest User and everything scoped to it.

    Guests are single-campaign accounts, so once their CampaignMember is removed
    there's nothing left for them — leaving the User (and its session notes /
    availability, which aren't FK-cascaded off the user) behind would orphan a
    login-less account. Only ever deletes genuine guest accounts.

    The caller is responsible for deleting the CampaignMember; this cleans up the
    backing User and its per-user contributions. Does not commit.
    """
    user = db.query(User).filter_by(id=user_id).first()
    if not user or not user.is_guest:
        return
    purge_user_data(db, user_id)
    db.delete(user)


# A GM-only secret span in a wiki body: ||text the players must never see||.
# Non-greedy so adjacent spans on one line don't merge; DOTALL so a secret may
# wrap multiple lines.
_GM_SECRET_RE = re.compile(r"\|\|.*?\|\|", re.DOTALL)


def strip_gm_secrets(body: str) -> str:
    """Remove every ||...|| GM-only span (markers and enclosed text) from a body.

    This is what a non-owner receives: the hidden text is gone without a trace —
    no placeholder, no marker — so a player never learns a secret exists or where
    it sits, whether in the rendered page, the raw editor body, or a search
    snippet. An unterminated trailing ``||`` (no closing pair) is left as-is.

    A non-owner edits this stripped body; on save ``merge_gm_secrets`` re-weaves
    the stored secrets back in by matching the surrounding text. See
    [[merge_gm_secrets]].
    """
    return _GM_SECRET_RE.sub("", body or "")


def _secret_positions(stored: str):
    """Return [(secret_text, offset_in_stripped)] for each ||...|| in ``stored``.

    ``offset_in_stripped`` is where the secret sat within
    ``strip_gm_secrets(stored)`` — the boundary in the visible text the player last
    saw. It is the secret's start minus the length of all secrets before it (those
    chars aren't in the stripped text). Adjacent secrets legitimately share one
    boundary; both are re-inserted there in document order.
    """
    out = []
    removed = 0  # total chars of earlier secrets, absent from the stripped text
    for m in _GM_SECRET_RE.finditer(stored):
        out.append((m.group(0), m.start() - removed))
        removed += m.end() - m.start()
    return out


def merge_gm_secrets(stored_body: str, new_body: str) -> str:
    """Re-weave the stored body's ||...|| GM secrets into a non-owner's saved edit.

    A non-owner never receives the secrets: they edit ``strip_gm_secrets(stored)``,
    a body with no marker or trace of the hidden text. So ``new_body`` has none,
    and storing it verbatim would delete every secret. This restores them by
    position:

    * ``old_visible`` — the exact stripped text the player was shown — is aligned
      against ``new_body`` (a character diff). Each secret sat at a known boundary
      in ``old_visible``; that boundary is mapped forward through the diff to the
      corresponding spot in ``new_body``, and the secret is re-inserted there.
    * This holds the secret in place when the player edits the text above and/or
      below it — the secret does not drift past later paragraphs.
    * If the text on *both* sides of a secret's boundary was rewritten (the anchor
      is gone), the secret is appended at the end so it is preserved, never lost.

    ``new_body`` is returned unchanged when the stored body had no secrets.
    """
    from difflib import SequenceMatcher

    stored = stored_body or ""
    positioned = _secret_positions(stored)
    if not positioned:
        return new_body

    new = new_body if new_body is not None else ""
    old_visible = strip_gm_secrets(stored)

    # Map each offset in old_visible to an offset in new via the diff's matching
    # blocks. A boundary that falls inside an unchanged run maps exactly; one that
    # falls in a replaced/deleted region has no stable image → treat as lost.
    sm = SequenceMatcher(None, old_visible, new, autojunk=False)
    blocks = sm.get_matching_blocks()  # includes the terminating (len, len, 0)

    def map_offset(old_off):
        for b in blocks:
            if b.a <= old_off <= b.a + b.size:
                return b.b + (old_off - b.a)
        return None

    # Insert secrets from last to first so earlier insertions don't shift the
    # offsets of later ones. Ties (adjacent secrets at one boundary) are broken by
    # document index so their original order is preserved after insertion.
    indexed = [(off, i, secret) for i, (secret, off) in enumerate(positioned)]
    result = new
    orphans = []
    for old_off, i, secret in sorted(indexed, reverse=True):
        pos = map_offset(old_off)
        if pos is None:
            orphans.append((i, secret))
        else:
            result = result[:pos] + secret + result[pos:]

    if orphans:
        # Restore document order for the appended, position-lost secrets.
        orphans.sort()
        sep = "" if not result or result.endswith("\n") else "\n"
        result = result + sep + "\n".join(s for _, s in orphans)
    return result


def is_gm_or_admin(user: CurrentUser) -> bool:
    return user.role in ("admin", "gm")


def user_has_campaign_access(db, user_id: str) -> bool:
    """Whether a user may create/join/manage campaigns. NULL/missing → enabled."""
    u = db.query(User).filter_by(id=user_id).first()
    if u is None:
        return False
    return u.campaign_access is None or bool(u.campaign_access)


def get_campaign_or_404(db, campaign_id: str) -> Campaign:
    c = db.query(Campaign).filter_by(id=campaign_id).first()
    if not c:
        raise HTTPException(404, "Campaign not found")
    return c


def assert_not_archived(campaign: Campaign) -> None:
    """Refuse writes to an archived campaign.

    Archiving freezes a campaign read-only for everyone, owner included — it is
    the "this game is finished" state, so its notes and wiki stay exactly as they
    were left. Every write handler calls this; reads deliberately do not, so an
    archived campaign remains fully browsable. Unarchiving lifts the freeze, so
    this is never a dead end.

    Called explicitly at each write site rather than folded into
    ``get_campaign_or_404`` (which read paths share) and separately from
    ``assert_can_manage`` (which member-level writes like player notes and
    availability bypass entirely).
    """
    if campaign.is_archived:
        raise HTTPException(409, "Campaign is archived: unarchive it to make changes")


def assert_can_manage(campaign: Campaign, user: CurrentUser, db):
    """Only the owner can manage a campaign, and only while their campaign access
    is enabled. A disabled owner locks the campaign read-only for everyone.

    Archived campaigns are frozen for the owner too — see [[assert_not_archived]],
    which write handlers call alongside this.
    """
    if campaign.owner_id != user.id:
        raise HTTPException(403, "Not authorised to manage this campaign")
    if not user_has_campaign_access(db, campaign.owner_id):
        raise HTTPException(
            403, "Campaign is locked: the GM's campaign access has been disabled"
        )
    assert_not_archived(campaign)


def is_member(db, campaign_id: str, user_id: str) -> bool:
    return (
        db.query(CampaignMember)
        .filter_by(campaign_id=campaign_id, user_id=user_id, status="accepted")
        .first()
        is not None
    )


def can_view(campaign: Campaign, user: CurrentUser, db) -> bool:
    """Owner or accepted members can view the full campaign."""
    if campaign.owner_id == user.id:
        return True
    return is_member(db, campaign.id, user.id)


def can_see_resource(r, is_owner: bool, user_id: str, share_map) -> bool:
    """Per-resource visibility check for a campaign member.

    public → any member; private → only users in the resource's share set;
    gm → owner only. `share_map` maps resource.id → set(user_id) of its shares.
    """
    if is_owner:
        return True
    if r.visibility == "public":
        return True
    if r.visibility == "private":
        return user_id in share_map.get(r.id, set())
    return False  # gm


def user_can_access_resource(db, user_id: str, resource_type: str, resource_id: str) -> bool:
    """Whether a user may access a library/media resource through a campaign share.

    True when the resource is linked (as a CampaignResource of the given type/id)
    into any campaign the user owns or is an accepted member of, AND the resource's
    visibility permits this user to see it (public → any member; private → only the
    users it's shared with; gm → owner only). Mirrors the per-resource visibility
    rule enforced by the resource-listing endpoint (`_can_see_resource`).

    This is the campaign-scoped gate for guests (and any share-limited user) on
    the file/page/download routes, which serve content by bare resource id.
    """
    from ...models import CampaignResource, CampaignResourceShare

    links = (
        db.query(CampaignResource)
        .filter_by(resource_type=resource_type, resource_id=resource_id)
        .all()
    )
    if not links:
        return False

    for r in links:
        campaign = db.query(Campaign).filter_by(id=r.campaign_id).first()
        if not campaign:
            continue
        is_owner = campaign.owner_id == user_id
        if not is_owner and not is_member(db, campaign.id, user_id):
            continue
        if is_owner or r.visibility == "public":
            return True
        if r.visibility == "private":
            shared = (
                db.query(CampaignResourceShare)
                .filter_by(resource_id=r.id, user_id=user_id)
                .first()
            )
            if shared is not None:
                return True
        # visibility == "gm": only the owner (handled above) may see it.
    return False


def build_members(c: Campaign, db) -> list:
    """Full member list for a campaign: the GM owner row first, then players."""
    from ...models import User

    rows = db.query(CampaignMember).filter_by(campaign_id=c.id).all()
    all_users = {u.id: u for u in db.query(User).all()}
    owner = all_users.get(c.owner_id)
    def _access(u) -> bool:
        return u is None or u.campaign_access is None or bool(u.campaign_access)

    members = []
    if owner:
        members.append(
            {
                "user_id": c.owner_id,
                "username": owner.username,
                "display_name": owner.display_name,
                "status": "accepted",
                "character_name": c.gm_title,
                "is_owner": True,
                "campaign_access": _access(owner),
            }
        )
    members += [
        {
            "id": m.id,
            "user_id": m.user_id,
            "username": all_users[m.user_id].username if m.user_id in all_users else "",
            "display_name": all_users[m.user_id].display_name if m.user_id in all_users else None,
            "status": m.status,
            "character_name": m.character_name,
            "is_owner": False,
            "is_guest": bool(m.is_guest),
            "guest_code": m.guest_code if m.is_guest else None,
            "campaign_access": _access(all_users.get(m.user_id)),
            "has_art": bool(m.character_art_path),
            "has_sheet": bool(m.character_sheet_path),
            "character_sheet_filename": m.character_sheet_filename,
            "character_sheet_url": m.character_sheet_url,
        }
        for m in rows
    ]
    return members


def serialize_campaign(c: Campaign, members: list, db) -> dict:
    from ...models import GameSystem, User, CampaignSchedule

    owner = db.query(User).filter_by(id=c.owner_id).first()
    owner_display = owner.display_name or owner.username if owner else ""
    owner_has_access = owner is None or owner.campaign_access is None or bool(owner.campaign_access)
    schedule = db.query(CampaignSchedule).filter_by(campaign_id=c.id).first()

    # Human-readable system name: the linked game system's name when set, else
    # the free-text system_name. Lets the UI pin the campaign's system without a
    # separate systems lookup.
    system_display = c.system_name or ""
    if c.system_id:
        sys_obj = db.query(GameSystem).filter_by(id=c.system_id).first()
        if sys_obj:
            system_display = sys_obj.name

    # Next upcoming scheduled session date (YYYY-MM-DD), if an enabled schedule exists.
    next_session = None
    if schedule and schedule.enabled and schedule.definition:
        upcoming = compute_next_sessions(schedule.definition, n=1)
        next_session = upcoming[0] if upcoming else None

    return {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "owner_id": c.owner_id,
        "owner_display_name": owner_display,
        "is_gm_campaign": c.is_gm_campaign,
        "gm_title": c.gm_title,
        "parent_campaign_id": c.parent_campaign_id,
        "system_id": c.system_id,
        "system_name": c.system_name,
        "system_display_name": system_display,
        "has_schedule": schedule is not None,
        "next_session": next_session,
        "has_banner": bool(c.banner_path),
        "resource_group_order": c.resource_group_order or [],
        "is_archived": bool(c.is_archived),
        "archived_at": c.archived_at.isoformat() if c.archived_at else None,
        # True when the campaign is read-only for everyone (players and owner keep
        # view access, lose all writes) — either because the owner's campaign
        # access is disabled or because the campaign is archived. The UI hides
        # every edit affordance off this one flag, so both causes must set it;
        # `is_archived` / `owner_has_campaign_access` say which applies.
        "locked": not owner_has_access or bool(c.is_archived),
        "owner_has_campaign_access": owner_has_access,
        "members": members,
        "created_at": c.created_at.isoformat(),
        "updated_at": c.updated_at.isoformat(),
        "last_accessed_at": c.last_accessed_at.isoformat() if c.last_accessed_at else None,
    }


def extract_snippet(content: str, query: str, window: int = 120) -> str:
    """Return a ~window-char excerpt centred on the first match of query."""
    idx = content.lower().find(query.lower())
    if idx == -1:
        return content[:window] + ("…" if len(content) > window else "")
    start = max(0, idx - window // 2)
    end = min(len(content), idx + len(query) + window // 2)
    snippet = content[start:end]
    if start > 0:
        snippet = "…" + snippet
    if end < len(content):
        snippet += "…"
    return snippet


def compute_next_sessions(definition: dict, n: int = 10) -> List[str]:
    """Return the next n session dates (YYYY-MM-DD) from today based on schedule."""
    frequency = definition.get("frequency", "weekly")
    # Offset by one day so sessions don't disappear for users west of UTC before midnight.
    today = datetime.date.today() - datetime.timedelta(days=1)

    if frequency == "custom":
        custom_dates = definition.get("custom_dates", [])
        future = sorted(d for d in custom_dates if d >= today.isoformat())
        return future[:n]

    days = definition.get("days", [])
    if not days:
        return []

    results: List[str] = []

    if frequency == "monthly":
        weekday = days[0]
        monthly_week = definition.get("monthly_week", 1)
        year, month = today.year, today.month
        for _ in range(24):
            if len(results) >= n:
                break
            d = nth_weekday_of_month(year, month, weekday, monthly_week)
            if d and d >= today:
                results.append(d.isoformat())
            month += 1
            if month > 12:
                month = 1
                year += 1
        return results

    reference = definition.get("biweekly_reference")
    if frequency == "biweekly" and reference:
        try:
            ref_date = datetime.date.fromisoformat(reference)
            ref_monday = ref_date - datetime.timedelta(days=ref_date.weekday())
        except ValueError:
            ref_monday = today - datetime.timedelta(days=today.weekday())
    else:
        ref_monday = None

    candidate = today
    max_search = 365 * 2
    searched = 0
    while len(results) < n and searched < max_search:
        searched += 1
        candidate += datetime.timedelta(days=1)
        if candidate.weekday() not in days:
            continue
        if frequency == "biweekly" and ref_monday:
            week_monday = candidate - datetime.timedelta(days=candidate.weekday())
            delta_weeks = (week_monday - ref_monday).days // 7
            if delta_weeks % 2 != 0:
                continue
        results.append(candidate.isoformat())

    return results


def nth_weekday_of_month(year: int, month: int, weekday: int, n: int) -> Optional[datetime.date]:
    """Return the nth occurrence (1-based, -1=last) of weekday (0=Mon) in year/month."""
    first_day = datetime.date(year, month, 1)
    first_wd = first_day.weekday()
    diff = (weekday - first_wd) % 7
    first_occurrence = first_day + datetime.timedelta(days=diff)
    if n == -1:
        last = first_occurrence
        while (last + datetime.timedelta(weeks=1)).month == month:
            last += datetime.timedelta(weeks=1)
        return last
    occurrence = first_occurrence + datetime.timedelta(weeks=n - 1)
    if occurrence.month != month:
        return None
    return occurrence
