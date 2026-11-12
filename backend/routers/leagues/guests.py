"""League guests: the organiser invites people without a full account.

Modelled on a campaign's guests (``routers/campaigns/guests.py``): a guest is a
code-only User (role "guest", no password or OIDC) made by the organiser, who
shares its 10-character code. The code signs in through the same
``POST /api/auth/guest-login`` a campaign's guests use.

A league guest belongs to the wargame side of the app for good
(``guest_scope = "wargame"``): leagues and their own armies, never campaigns or
characters. Their code is on the account rather than the membership, so it
outlives the league. Removing a guest, or deleting the league, leaves the
account with its armies - they keep signing in to reach and export them - and
an admin removes the account itself from Settings → People. Deleting the
organiser's account is the exception: the code they were shown is replaced
(``services/campaigns/user_data.py``).

The code signs in to every league the guest is in. Only an admin can put a
guest in a second league (by merging guests), and when its organiser is someone
else, neither organiser is shown the code or may change it: either could
otherwise sign in as the guest and see the other's league.
"""
import secrets
import urllib.parse
from typing import Optional

from fastapi import Depends, HTTPException, Response
from sqlalchemy.orm import Session

from ...auth import GUEST_SCOPE_WARGAME, CurrentUser, get_current_user
from ...config import BASE_URL, get_db
from ...models import Army, League, LeagueMember, User
from ...services.app_settings import get_raw, guest_access_effective
from ...services.campaigns.user_data import generate_guest_code
from ...sessions import revoke_user_sessions
from ._helpers import get_league, is_admin, leave
from ._schemas import GuestCreate


def _assert_guest_access(db: Session) -> None:
    if not guest_access_effective(get_raw(db)):
        raise HTTPException(403, "Guest access is disabled on this server")


def _guest_member(db: Session, league: League, user_id: str) -> tuple[LeagueMember, User]:
    """One of this league's guests, or a 404 - also for a member who is not a guest."""
    row = db.query(LeagueMember).filter_by(league_id=league.id, user_id=user_id, is_guest=True).first()
    user = db.query(User).filter_by(id=user_id, is_guest=True).first() if row else None
    if row is None or user is None:
        raise HTTPException(404, "Guest not found")
    return row, user


def _holds_code(db: Session, user: User, caller: CurrentUser) -> bool:
    """Whether ``caller`` may see and change ``user``'s code: an admin, or the
    organiser of every league the guest is in (see the module)."""
    if is_admin(caller):
        return True
    organisers = {
        row[0]
        for row in db.query(League.organizer_id)
        .join(LeagueMember, LeagueMember.league_id == League.id)
        .filter(LeagueMember.user_id == user.id)
        .all()
    }
    return organisers == {caller.id}


def _own_code(db: Session, user: User, caller: CurrentUser) -> None:
    if not _holds_code(db, user, caller):
        raise HTTPException(403, "This guest plays in other leagues too: an admin manages their code")


def _serialize(db: Session, row: LeagueMember, user: User, caller: CurrentUser) -> dict:
    army = db.query(Army).filter_by(id=row.army_id).first() if row.army_id else None
    return {
        "user_id": user.id,
        "nickname": user.display_name,
        "guest_code": user.guest_code if _holds_code(db, user, caller) else None,
        "army": (
            {
                "id": army.id,
                "name": army.name,
                "points": army.points or 0,
                "cost_name": army.cost_name or "pts",
            }
            if army
            else None
        ),
    }


def _share_template(league: League, nickname: str, code: str) -> dict:
    link = f"{BASE_URL}/guest?code={code}"
    greeting = f"Hi {nickname}," if nickname else "Hi,"
    message = (
        f"{greeting}\n\n"
        f'You\'ve been invited as a guest to the league "{league.name}" on Grimoire.\n\n'
        f"Open this link and you're in: {link}\n"
        f"Or go to the login page and enter your invite code: {code}\n"
    )
    subject = f'Guest invite to "{league.name}"'
    mailto = (
        "mailto:?subject=" + urllib.parse.quote(subject) + "&body=" + urllib.parse.quote(message)
    )
    return {
        "code": code,
        "link": link,
        "message": message,
        "mailto_url": mailto,
        "discord_message": message,
    }


def create_guest(
    league_id: str,
    data: GuestCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Invite a guest: a new code-only account, a member of this league."""
    _assert_guest_access(db)
    league = get_league(db, league_id, current_user, manage=True)
    nickname = (data.nickname or "").strip() or "Guest"
    user = User(
        username=f"guest_{secrets.token_hex(8)}",
        display_name=nickname[:100],
        role="guest",
        is_guest=True,
        guest_scope=GUEST_SCOPE_WARGAME,
        hashed_password=None,
        # Campaigns are the other side of the app; a league guest has none.
        campaign_access=False,
    )
    user.guest_code = generate_guest_code(db)
    db.add(user)
    db.flush()
    row = LeagueMember(league_id=league.id, user_id=user.id, is_guest=True)
    db.add(row)
    db.commit()
    return _serialize(db, row, user, current_user)


def list_guests(
    league_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The league's guests and their codes (organiser)."""
    league = get_league(db, league_id, current_user, manage=True)
    rows = db.query(LeagueMember).filter_by(league_id=league.id, is_guest=True).all()
    users = {
        u.id: u
        for u in db.query(User).filter(
            User.id.in_([r.user_id for r in rows] or [""]), User.is_guest.is_(True)
        )
    }
    out = [_serialize(db, r, users[r.user_id], current_user) for r in rows if r.user_id in users]
    return sorted(out, key=lambda g: (g["nickname"] or "").lower())


def regenerate_guest_code(
    league_id: str,
    user_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Give a guest a new code. The old one stops working, and so do its sessions."""
    _assert_guest_access(db)
    league = get_league(db, league_id, current_user, manage=True)
    row, user = _guest_member(db, league, user_id)
    _own_code(db, user, current_user)
    user.guest_code = generate_guest_code(db)
    revoke_user_sessions(db, user.id)
    db.commit()
    return _serialize(db, row, user, current_user)


def remove_guest(
    league_id: str,
    user_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Take a guest out of the league. Their account and armies stay (see the module)."""
    league = get_league(db, league_id, current_user, manage=True)
    _guest_member(db, league, user_id)
    leave(db, league.id, user_id)
    db.commit()
    return Response(status_code=204)


def guest_share_template(
    league_id: str,
    user_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ready-made invite text for a guest's code (organiser)."""
    league = get_league(db, league_id, current_user, manage=True)
    _, user = _guest_member(db, league, user_id)
    _own_code(db, user, current_user)
    nickname: Optional[str] = user.display_name
    return _share_template(league, nickname or "", user.guest_code or "")
