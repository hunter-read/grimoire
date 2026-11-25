"""Whether a guest account still has a live invite.

Shared by everything that lets a guest in without a fresh sign-in: refreshing
a session, and the calendar feed URL a guest minted while signed in.
"""

from sqlalchemy.orm import Session

from ..auth import GUEST_SCOPE_WARGAME
from ..models import CampaignMember, User
from .app_settings import get_raw, guest_access_effective


def guest_still_invited(db: Session, user: User) -> bool:
    """Whether guest access is on and ``user`` still holds an accepted guest invite.

    A league guest's invite is the code on their account, which outlives the
    league: they keep reaching their own armies.
    """
    if not guest_access_effective(get_raw(db)):
        return False
    if user.guest_scope == GUEST_SCOPE_WARGAME:
        return bool(user.is_guest and user.guest_code_hash)
    member = (
        db.query(CampaignMember)
        .filter_by(user_id=user.id, is_guest=True, status="accepted")
        .first()
    )
    return member is not None
