"""Shared helpers for the campaigns package."""

import re
from typing import NamedTuple, Optional

from fastapi import HTTPException

from ...models import Campaign, CampaignMember, GameSystem, User
from ...auth import CurrentUser
from ...services.campaigns.access import is_member
from ...services.campaigns.schedule import compute_next_sessions
from ...services.systems import browsable_system_ids, system_browsable
from ...text.wikilinks import FENCE_RE


# A GM-only secret span in a wiki body: ||text the players must never see||.
# Non-greedy so adjacent spans on one line don't merge; DOTALL so a secret may
# wrap multiple lines. A ``|`` right after a backslash is a literal pipe, as in
# markdown, so neither marker may follow one: ``\||`` is never a marker. That
# is the form ``escape_player_pipes`` leaves a player's pipes in, and the wiki
# renderer (WikiMarkdown.tsx) reads markers the same way.
_GM_SECRET_RE = re.compile(r"(?<!\\)\|\|.*?(?<!\\)\|\|", re.DOTALL)


def _blank(text: str, spans: list[tuple[int, int]]) -> str:
    """``text`` with each span overwritten by NULs - same length, so offsets hold."""
    out, last = [], 0
    for start, end in sorted(spans):
        out.append(text[last:start])
        out.append("\0" * (end - start))
        last = end
    out.append(text[last:])
    return "".join(out)


def _secret_spans(body: str) -> list[tuple[int, int]]:
    """The ``(start, end)`` of every ||...|| GM-only span in ``body``, in order.

    Markers pair within one stretch of text first: prose with prose, and inside
    a fenced code block only with each other. A ``||`` that is part of the code -
    an ER diagram's cardinality, ``a || b`` - then has no partner in its fence
    and stays literal, instead of pairing with the next marker in the prose
    after it. A prose secret may still wrap whole fences; those go with it.

    Markers left without a partner then pair with each other, left to right,
    wherever they sit. Where a fence starts or ends decides which stretch a
    marker is in, so a secret written around a fence's opening or closing line
    - or one a later fence line above it re-cuts - has its two markers in
    different stretches. Pairing the leftovers hides it anyway. A single
    leftover stays literal, which is what keeps one ER ``||`` drawn.
    """
    fences = [m.span() for m in FENCE_RE.finditer(body)]
    spans = [m.span() for m in _GM_SECRET_RE.finditer(_blank(body, fences))]
    prose = list(spans)
    for start, end in fences:
        # A prose span starts and ends in prose, so it holds a fence whole or
        # not at all.
        if any(s <= start and end <= e for s, e in prose):
            continue
        spans.extend(m.span() for m in _GM_SECRET_RE.finditer(body, start, end))
    # Every leftover marker is outside the spans so far, so a span this finds
    # holds any of those it reaches whole.
    spans.extend(m.span() for m in _GM_SECRET_RE.finditer(_blank(body, spans)))
    merged: list[tuple[int, int]] = []
    for start, end in sorted(spans):
        if merged and start < merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def strip_gm_secrets(body: str) -> str:
    """Remove every ||...|| GM-only span (markers and enclosed text) from a body.

    This is what a non-owner receives: the hidden text is gone without a trace —
    no placeholder, no marker — so a player never learns a secret exists or where
    it sits, whether in the rendered page, the raw editor body, or a search
    snippet. An unterminated trailing ``||`` (no closing pair) is left as-is.
    Markers pair within a code fence or within the prose around it first, and
    the ones left over then pair with each other (see ``_secret_spans``).

    A non-owner edits this stripped body; on save ``merge_gm_secrets`` re-weaves
    the stored secrets back in by matching the surrounding text. See
    [[merge_gm_secrets]].
    """
    src = body or ""
    out, last = [], 0
    for start, end in _secret_spans(src):
        out.append(src[last:start])
        last = end
    out.append(src[last:])
    return "".join(out)


def escape_player_pipes(body: str) -> str:
    """Neutralise ``||`` a player typed, so it is stored as literal text.

    Secrets are a GM tool and the editor only offers the button to the GM, but
    nothing stops a player typing the characters. Left alone, that text would be
    stored as a real secret span and then stripped from its own author's view on
    the next read — they would write a sentence, save, and watch it vanish with
    no explanation.

    So a player's pipes are escaped rather than honoured or rejected: each ``|``
    in a run of two or more becomes ``\\|``, which markdown renders as a literal
    ``|`` and which ``_GM_SECRET_RE`` no longer matches. What they typed is what
    they see. Runs are matched rather than exact pairs so ``||||`` can't survive
    as a pair once alternate characters are escaped.

    Only ever applied to a non-GM's submission — see ``update_page``. A pipe
    right after a backslash is left alone, so a player re-saving their own page
    doesn't accumulate backslashes. That leaves ``\\||`` as typed, which is safe
    only because ``_GM_SECRET_RE`` never takes a ``||`` after a backslash as a
    marker: every ``||`` this returns has one in front of it.
    """
    if not body:
        return body

    def esc(m: re.Match) -> str:
        return "".join(ch if ch == "\\" else f"\\{ch}" for ch in m.group(0))

    # A run of 2+ pipes, ignoring any that are already backslash-escaped: the
    # negative lookbehind keeps a re-save idempotent.
    return re.sub(r"(?<!\\)\|(?:\\?\|)+", esc, body)


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
    for start, end in _secret_spans(stored):
        out.append((stored[start:end], start - removed))
        removed += end - start
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
    * If the merged body no longer reads as the same secrets - the player's code
      fences now cut across one - a 400 is raised rather than storing it.

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

    # The secrets go back whole, but the fences around them are the player's
    # now, and a fence line decides which markers pair. If the edit has re-cut
    # them - a code block opened above a secret that holds one, say - the GM's
    # text would no longer read as secret, so the save is refused instead.
    secrets = sorted(secret for secret, _ in positioned)
    if sorted(result[s:e] for s, e in _secret_spans(result)) != secrets:
        raise HTTPException(
            400,
            "This edit leaves a code block open or closes one early. Check that "
            "every ``` or ~~~ line has its match, then save again.",
        )
    return result


def is_gm_or_admin(user: CurrentUser) -> bool:
    return user.role in ("admin", "gm")


def user_has_campaign_access(db, user_id: str) -> bool:
    """Whether a user may create/join/manage campaigns. NULL/missing → enabled."""
    u = db.query(User).filter_by(id=user_id).first()
    if u is None:
        return False
    return u.campaign_access is None or bool(u.campaign_access)


def require_known_users(db, user_ids) -> set[str]:
    """The distinct ids in ``user_ids``, refusing any that names no user.

    A share row for a user who doesn't exist breaks the foreign key at commit;
    this answers 400 first, so nothing of the request is kept.
    """
    wanted = {uid for uid in (user_ids or [])}
    if not wanted:
        return wanted
    found = {uid for (uid,) in db.query(User.id).filter(User.id.in_(wanted))}
    if wanted - found:
        raise HTTPException(400, "Can't share with a user who doesn't exist")
    return wanted


def get_campaign_or_404(db, campaign_id: str) -> Campaign:
    c = db.query(Campaign).filter_by(id=campaign_id).first()
    if not c:
        raise HTTPException(404, "Campaign not found")
    return c


def check_parent_campaign(
    db, parent_id: Optional[str], owner_id: str, campaign_id: Optional[str] = None
) -> Optional[str]:
    """The parent campaign id to store, or None for none.

    A campaign can only sit under another campaign of its owner's - ``owner_id``
    is the campaign's owner, not whoever is editing it; any other id reads as
    missing (404), so ids cannot be probed. A campaign is not its own parent
    (400).
    """
    if not parent_id:
        return None
    if parent_id == campaign_id:
        raise HTTPException(400, "A campaign cannot be its own parent")
    parent = db.query(Campaign).filter_by(id=parent_id).first()
    if parent is None or parent.owner_id != owner_id:
        raise HTTPException(404, "Parent campaign not found")
    return parent.id


def assert_not_archived(campaign: Campaign) -> None:
    """Refuse writes to an archived campaign.

    Archiving freezes a campaign read-only for everyone, owner included — it is
    the "this game is finished" state, so its notes and wiki stay exactly as they
    were left. Every write under ``/campaigns/{campaign_id}/`` is refused by
    ``require_writable_campaign`` (``_writable.py``); reads are not, so an
    archived campaign remains fully browsable. Unarchiving lifts the freeze, so
    this is never a dead end.
    """
    if campaign.is_archived:
        raise HTTPException(409, "Campaign is archived: unarchive it to make changes")


def assert_not_locked(campaign: Campaign, db) -> None:
    """Refuse writes to a campaign that is read-only for everyone: its owner's
    campaign access is disabled, or it is archived (the ``locked`` flag).

    The campaigns router applies this to every write through
    ``require_writable_campaign``; handlers call it directly only where that
    check is skipped (see ``writable_while``) or the campaign is not in the path.
    """
    if not user_has_campaign_access(db, campaign.owner_id):
        raise HTTPException(
            403, "Campaign is locked: the GM's campaign access has been disabled"
        )
    assert_not_archived(campaign)


def assert_can_manage(campaign: Campaign, user: CurrentUser, db):
    """Only the owner can manage a campaign, and only while their campaign access
    is enabled. A disabled owner locks the campaign read-only for everyone.

    Archived campaigns are frozen for the owner too — see [[assert_not_archived]],
    which write handlers call alongside this.
    """
    if campaign.owner_id != user.id:
        raise HTTPException(403, "Not authorised to manage this campaign")
    assert_not_locked(campaign, db)


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


def clamp_visibility_for_access(db, resource_type: str, resource_id: str, visibility: str) -> str:
    """Force a restricted book's campaign share down to GM-only (issue #258).

    A restricted book may be linked into a campaign — the GM running the
    adventure needs it — but never at a visibility that would show it to the
    campaign's players, since that is precisely who it is being withheld from.
    Anything other than ``gm`` is clamped rather than rejected, so linking one is
    a silent, correct downgrade instead of an error the GM has to decode.

    Only books carry access levels, so every other resource type passes through.
    """
    if resource_type != "book" or visibility == "gm":
        return visibility
    from ...models import Book
    from ...models.access import LEVEL_OPEN
    from ...services import access_control

    book = db.query(Book).filter_by(id=resource_id).first()
    if book is None:
        return visibility
    if access_control.resolve_level(db, book) == LEVEL_OPEN:
        return visibility
    return "gm"


def can_link_resource(
    db, user: CurrentUser, campaign_id: str, resource_type: str, resource_id: str
) -> bool:
    """Whether ``user`` may link this item into the campaign.

    A book must be one the user can read themselves, and a campaign file must
    belong to this campaign. Other library media is open to every non-guest.
    """
    if resource_type == "book":
        from ...models import Book
        from ...services.books.access import can_read_book

        book = db.query(Book).filter_by(id=resource_id).first()
        return book is not None and can_read_book(db, book, user)
    if resource_type == "file":
        from ...models import CampaignFile

        return (
            db.query(CampaignFile).filter_by(id=resource_id, campaign_id=campaign_id).first()
            is not None
        )
    return True


def readable_book_ids(db, user: CurrentUser, resources) -> set[str]:
    """The ids of the linked books among ``resources`` that ``user`` can read.

    A book stays linked when its access level changes later, so each viewer's
    resource list is narrowed to the books they can open.
    """
    from ...models import Book
    from ...services.books.access import can_read_book

    ids = {r.resource_id for r in resources if r.resource_type == "book"}
    if not ids:
        return set()
    books = db.query(Book).filter(Book.id.in_(ids)).all()
    return {b.id for b in books if can_read_book(db, b, user)}


def build_members(c: Campaign, db) -> list:
    """Full member list for a campaign: the GM owner row first, then players."""
    from ...models import User

    rows = db.query(CampaignMember).filter_by(campaign_id=c.id).all()
    # Only the people in this campaign, never the whole users table.
    wanted = {c.owner_id, *(m.user_id for m in rows)}
    all_users = {u.id: u for u in db.query(User).filter(User.id.in_(wanted)).all()}
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
            # A token is a separate picture from the art, so it gets its own
            # flag rather than being inferred from `has_art`.
            "has_token": bool(m.character_token_path),
            "has_sheet": bool(m.character_sheet_path),
            "character_sheet_filename": m.character_sheet_filename,
            "character_sheet_url": m.character_sheet_url,
        }
        for m in rows
    ]
    return members


def members_for(c: Campaign, user: CurrentUser, db) -> list:
    """``build_members`` as ``user`` may see it.

    A guest's code is their login: only the GM who hands codes out sees them,
    from a signed-in session - never another member or guest (issue #519), and
    never through an API key.
    """
    members = build_members(c, db)
    if c.owner_id != user.id or user.is_api_key:
        for m in members:
            if m.get("guest_code"):
                m["guest_code"] = None
    return members


def member_summaries(db, campaigns: list[Campaign]) -> dict[str, list[dict]]:
    """The members the campaign list shows, for every campaign in it at once.

    Two queries however many campaigns are listed (issue #707), and only the
    users who are members are loaded.
    """
    from ...models import User

    out: dict[str, list[dict]] = {c.id: [] for c in campaigns}
    if not out:
        return out
    rows = db.query(CampaignMember).filter(CampaignMember.campaign_id.in_(out)).all()
    user_ids = {m.user_id for m in rows}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    for m in rows:
        user = users.get(m.user_id)
        out[m.campaign_id].append(
            {
                "user_id": m.user_id,
                "username": user.username if user else "",
                "display_name": user.display_name if user else None,
                "status": m.status,
                "character_name": m.character_name,
            }
        )
    return out


class CampaignLookups(NamedTuple):
    """What ``serialize_campaign`` reads besides the campaign, keyed by id."""

    owners: dict
    schedules: dict
    # Only the linked systems the viewer may see: see visible_campaign_system.
    systems: dict


def campaign_lookups(db, campaigns: list[Campaign], viewer) -> CampaignLookups:
    """Owners, schedules and visible systems for ``campaigns``, a few queries in all.

    Shared by a whole list so serializing it costs the same however long it is
    (issue #707).
    """
    from ...models import User, CampaignSchedule

    owner_ids = {c.owner_id for c in campaigns}
    owners = {u.id: u for u in db.query(User).filter(User.id.in_(owner_ids)).all()} if owner_ids else {}
    campaign_ids = [c.id for c in campaigns]
    schedules = (
        {
            s.campaign_id: s
            for s in db.query(CampaignSchedule)
            .filter(CampaignSchedule.campaign_id.in_(campaign_ids))
            .all()
        }
        if campaign_ids
        else {}
    )
    systems = {}
    system_ids = {c.system_id for c in campaigns if c.system_id}
    if system_ids:
        linked = db.query(GameSystem).filter(GameSystem.id.in_(system_ids)).all()
        visible = browsable_system_ids(db, linked, viewer)
        systems = {s.id: s for s in linked if s.id in visible}
    return CampaignLookups(owners, schedules, systems)


def visible_campaign_system(db, c: Campaign, viewer) -> Optional[GameSystem]:
    """The game system ``c`` is linked to, if ``viewer`` may see it.

    A GM can link a system their players cannot see - one restricted to GMs, or
    explicit for a player who has that off. Players in the campaign then get
    the campaign as if it had no system linked, rather than the name of a
    system the library hides from them.
    """
    if not c.system_id:
        return None
    system = db.query(GameSystem).filter_by(id=c.system_id).first()
    if system is None or not system_browsable(db, system, viewer):
        return None
    return system


def serialize_campaign(
    c: Campaign, members: list, db, viewer, lookups: Optional[CampaignLookups] = None
) -> dict:
    """The campaign as ``viewer`` sees it.

    A list passes ``lookups`` from ``campaign_lookups`` over all its campaigns;
    a single campaign looks its own up.
    """
    if lookups is None:
        lookups = campaign_lookups(db, [c], viewer)
    owner = lookups.owners.get(c.owner_id)
    owner_display = owner.display_name or owner.username if owner else ""
    owner_has_access = owner is None or owner.campaign_access is None or bool(owner.campaign_access)
    schedule = lookups.schedules.get(c.id)

    # Human-readable system name: the linked game system's name when set, else
    # the free-text system_name. Lets the UI pin the campaign's system without a
    # separate systems lookup. A linked system the viewer cannot see is left
    # out, id and all.
    system = lookups.systems.get(c.system_id) if c.system_id else None
    system_display = system.name if system else (c.system_name or "")

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
        "system_id": system.id if system else None,
        "system_name": c.system_name,
        "system_display_name": system_display,
        "has_schedule": schedule is not None,
        "next_session": next_session,
        "has_banner": bool(c.banner_path),
        # Vertical focal point of the banner in the hero, 0-100 (issue #286).
        "banner_focus_y": 50 if c.banner_focus_y is None else int(c.banner_focus_y),
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
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
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

