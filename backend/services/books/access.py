"""Who may read a book's content, and who may change its access level.

Every route that serves a book by id (pages, tiles, files, text, exports, share
links, image sources) goes through ``assert_book_access``; the books and systems
edit routes go through ``pop_access_level``.
"""
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...models import Book
from .. import access_control
from ..campaigns.access import user_can_access_resource
from ..media.access import allow_explicit

# Accepted ``access_level`` values on the wire. "inherit" is the API spelling of
# a NULL column (no book-level opinion); "" is an explicit "open" that overrides
# a restricted system. See backend.models.access.
ACCESS_INHERIT = "inherit"


def enforce_campaign_visibility(db: Session, book: Book) -> int:
    """Force every campaign share of a restricted book down to GM-only visibility.

    A book shared into a campaign as "public" is visible to that campaign's
    players, which would defeat the restriction the admin just applied — the
    campaign is exactly where the spoilers are. Rather than refusing the change
    and making the admin hunt down each campaign first, the shares are demoted
    to ``gm`` so the GM keeps their reference and the players lose it.

    Returns how many share rows were changed, for the caller's response. Does not
    commit — it runs inside the caller's transaction so the level change and the
    demotion land together or not at all.
    """
    from ...models import CampaignResource
    from ...models.access import LEVEL_OPEN, normalize

    if normalize(access_control.resolve_level(db, book)) == LEVEL_OPEN:
        return 0
    rows = (
        db.query(CampaignResource)
        .filter(
            CampaignResource.resource_type == "book",
            CampaignResource.resource_id == book.id,
            CampaignResource.visibility != "gm",
        )
        .all()
    )
    for row in rows:
        row.visibility = "gm"
    return len(rows)


def pop_access_level(
    payload: dict, user: Any, *, allow_inherit: bool = True
) -> tuple[bool, Optional[str]]:
    """Take ``access_level`` out of an update payload, authorising the change.

    Returns ``(present, value)`` where ``value`` is what to write to the column
    (``None`` meaning inherit). Removing the key from ``payload`` is the point:
    ``bulk_service.apply_updates`` does a blind ``setattr`` over whatever is left,
    so a field that needs authorisation or translation must never reach it.

    Two things happen here that the Pydantic schema cannot do:

      * **Admin-only.** The book/system PATCH routes are open to GMs, but access
        levels are an admin control (issue #258) — a GM who could restrict books
        could also un-restrict the ones being kept from them.
      * **The inherit sentinel.** ``"inherit"`` on the wire becomes a NULL write,
        which an ``exclude_none`` payload could not otherwise express.

    Raises HTTPException(403) when a non-admin tries to change the level.
    """
    if "access_level" not in payload:
        return False, None
    value = payload.pop("access_level")
    if getattr(user, "role", None) != "admin":
        raise HTTPException(403, "Only admins can change access levels")
    if value == ACCESS_INHERIT:
        if not allow_inherit:
            raise HTTPException(400, "access_level 'inherit' is not valid here")
        return True, None
    try:
        return True, access_control.validate_level(value, allow_inherit=allow_inherit)
    except access_control.AccessError as e:
        raise HTTPException(400, str(e))


def assert_book_access(db: Session, book: Book, user: Any) -> None:
    """Authorise a user to read a specific book's content (file, page, TOC, text).

    The by-id content routes are reachable by guests, so they can't rely on the
    library-browse guard the list route has. This enforces the same model those
    metadata reads (`get_book`) enforce, plus campaign scoping for guests:

      * The book's access level (issue #258) is checked first, for *everyone*.
        It is the one gate a campaign share cannot open: a restricted book is
        restricted no matter how it was reached, which is what makes the level
        meaningful rather than advisory. Guests are held to the player ceiling
        here — they see open books only — and then further narrowed to their
        campaign below.
      * Guests may only read a book shared into a campaign they belong to
        (via `user_can_access_resource`). NSFW isn't filtered for guests — a book
        deliberately shared into their campaign is allowed regardless, since a
        guest has no explicit-content preference of their own.
      * Non-guests keep library-wide read access, but a book flagged explicit is
        denied when the user has disabled explicit content (allow_explicit=false).

    Raises HTTPException(403) when access is not permitted.
    """
    if not access_control.can_access_book(db, access_control.load_user(db, user), book):
        # Deliberately the same wording as the campaign-share refusal below, so
        # the response cannot be used to distinguish "restricted" from "not
        # shared with you" — the title alone is the spoiler this feature exists
        # to withhold.
        raise HTTPException(403, "This book is not shared with you")

    if getattr(user, "role", None) == "guest":
        if not user_can_access_resource(db, user.id, "book", book.id):
            raise HTTPException(403, "This book is not shared with you")
        return

    if book.is_explicit and not allow_explicit(db, user.id):
        raise HTTPException(403, "Explicit content is disabled for your account")


def can_read_book(db: Session, book: Book, user: Any) -> bool:
    """`assert_book_access` as a predicate, for filtering lists of books."""
    try:
        assert_book_access(db, book, user)
    except HTTPException:
        return False
    return True
