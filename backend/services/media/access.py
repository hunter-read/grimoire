"""Shared authorization gate for by-id media content routes.

Maps, tokens, and audio each expose `/{id}`, `/{id}/file`, and thumbnail/artwork
routes that serve content by bare id. Library *browsing* is blocked for guests
(`require_not_guest` on the list routes), but these by-id routes stay open so a
resource shared into a guest's campaign still renders. That means each handler
must authorise the caller itself, exactly as the book content routes do.

This mirrors `services.books.access.assert_book_access`, generalised
across media types via the resource-type dispatch in `user_can_access_resource`.
"""
from typing import Any, Callable, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session


def assert_media_access(db: Session, user: Any, resource_type: str, resource_id: str, *, is_explicit: bool = False) -> None:
    """Authorise a user to read a specific media item's content.

      * Guests may only read an item shared into a campaign they belong to (via a
        CampaignResource whose visibility permits them). NSFW isn't filtered for
        guests — an item deliberately shared into their campaign is allowed
        regardless, since a guest has no explicit-content preference of its own.
      * Non-guests keep library-wide read access, but an item flagged explicit is
        denied when the user has disabled explicit content (allow_explicit=false).

    `resource_type` is the CampaignResource type: "map", "token", or "audio".
    Raises HTTPException(403) when access is not permitted.
    """
    if getattr(user, "role", None) == "guest":
        from ..campaigns.access import user_can_access_resource

        if not user_can_access_resource(db, user.id, resource_type, resource_id):
            raise HTTPException(403, "This item is not shared with you")
        return

    if is_explicit and not allow_explicit(db, user.id):
        raise HTTPException(403, "Explicit content is disabled for your account")


def guest_visible_variants(
    db: Any,
    user: Any,
    resource_type: str,
    current_id: str,
    siblings: list[Any],
    can_read: Optional[Callable[[Any], bool]] = None,
) -> list[Any]:
    """Trim a variant family to the members the user may read (issue #519).

    A detail response lists the whole family for the version picker, and each
    entry carries a filename. A guest is only entitled to the variants shared
    into their campaign, so the rest are dropped rather than handing out names
    and ids of files they cannot open. The requested record itself always stays
    (its own access was checked before this runs).

    `can_read` overrides the per-sibling check and applies to every role; books
    pass one that also applies the access level, which holds for everyone. By
    default it is the campaign-share check, and non-guests get the family
    unchanged.
    """
    if can_read is not None:
        return [s for s in siblings if s.id == current_id or can_read(s)]
    if getattr(user, "role", None) != "guest":
        return siblings
    from ..campaigns.access import user_can_access_resource

    def shared(record: Any) -> bool:
        return user_can_access_resource(db, user.id, resource_type, record.id)

    return [s for s in siblings if s.id == current_id or shared(s)]


def allow_explicit(db: Session, user_id: str) -> bool:
    """Whether the user lets explicit content through; unset counts as yes."""
    from ...models import User

    u = db.query(User).filter_by(id=user_id).first()
    return bool(u.allow_explicit) if u and u.allow_explicit is not None else True
