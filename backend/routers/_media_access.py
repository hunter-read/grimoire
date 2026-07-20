"""Shared authorization gate for by-id media content routes.

Maps, tokens, and audio each expose `/{id}`, `/{id}/file`, and thumbnail/artwork
routes that serve content by bare id. Library *browsing* is blocked for guests
(`require_not_guest` on the list routes), but these by-id routes stay open so a
resource shared into a guest's campaign still renders. That means each handler
must authorise the caller itself, exactly as the book content routes do.

This mirrors `backend.routers.books._helpers._assert_book_access`, generalised
across media types via the resource-type dispatch in `user_can_access_resource`.
"""
from fastapi import HTTPException


def assert_media_access(db, user, resource_type: str, resource_id: str, *, is_explicit: bool = False) -> None:
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
        from .campaigns._helpers import user_can_access_resource

        if not user_can_access_resource(db, user.id, resource_type, resource_id):
            raise HTTPException(403, "This item is not shared with you")
        return

    if is_explicit and not _allow_explicit(db, user.id):
        raise HTTPException(403, "Explicit content is disabled for your account")


def _allow_explicit(db, user_id: str) -> bool:
    from ..models import User

    u = db.query(User).filter_by(id=user_id).first()
    return bool(u.allow_explicit) if u and u.allow_explicit is not None else True
