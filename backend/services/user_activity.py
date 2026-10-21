"""When each account last signed in and was last active (issue #576).

Both timestamps live on the ``users`` row and are shown on the admin users
list. Neither helper commits: each is called just before a commit the caller
makes anyway (opening a session, rotating a refresh token, stamping an API
key), so recording activity never costs a write of its own.

"Active" is only as fine-grained as the moments the server actually sees the
account: access tokens are validated without touching the database (see
backend/sessions.py), so a signed-in browser shows up once per refresh -
every ``ACCESS_TOKEN_EXPIRE_MINUTES`` - rather than on every page it opens.
"""
import datetime
import logging
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..log_context import set_log_user
from ..models import User

logger = logging.getLogger("grimoire.activity")

# The most often ``last_active_at`` is rewritten for one account, so a busy API
# integration does not turn every request into a write.
ACTIVITY_THROTTLE = datetime.timedelta(minutes=5)


def _utcnow() -> datetime.datetime:
    """Naive UTC, matching the DateTime columns elsewhere in the schema."""
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


def record_login(db: Session, user_id: str, now: Optional[datetime.datetime] = None) -> None:
    """Stamp a sign-in: it is also the account's latest activity."""
    now = now or _utcnow()
    db.query(User).filter(User.id == user_id).update(
        {User.last_login_at: now, User.last_active_at: now}, synchronize_session=False
    )


def record_activity(db: Session, user_id: str, now: Optional[datetime.datetime] = None) -> None:
    """Move ``last_active_at`` to now, unless it moved within the throttle window."""
    now = now or _utcnow()
    db.query(User).filter(
        User.id == user_id,
        or_(User.last_active_at.is_(None), User.last_active_at <= now - ACTIVITY_THROTTLE),
    ).update({User.last_active_at: now}, synchronize_session=False)


def note_sign_in(username: str, origin: str) -> None:
    """Log a sign-in, attributed to the account that signed in."""
    set_log_user(username)
    logger.info("Signed in (%s)", origin)
