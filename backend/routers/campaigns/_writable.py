"""A locked campaign is read-only: the one check every campaign write goes through.

A campaign is locked while it is archived, or while its owner's campaign access
is disabled (see ``assert_not_locked``). Rather than leave each write handler to
remember that, the campaigns router runs :func:`require_writable_campaign` on
every request, and it refuses a POST, PUT, PATCH or DELETE under
``/campaigns/{campaign_id}/...`` while the campaign is locked.

A few writes stay open in one state or both, because they exist to get out of
it or write nothing to the campaign itself (unarchiving, leaving, hiding a page
from your own view). Those handlers are marked with :func:`writable_while`,
which names the states they may run in; the handler then applies whatever
narrower check it still needs. ``test_campaign_locked_writes.py`` walks the route
table, so a new write route is covered without anyone having to add it.

The MCP server calls handlers directly, past this dependency, so a handler it
reaches for a write (``create_page``) keeps its own ``assert_not_locked`` call.
"""

from typing import Callable, TypeVar

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Campaign
from ._helpers import assert_not_archived, can_view, user_has_campaign_access

# The two states a locked campaign can be in.
ARCHIVED = "archived"
ACCESS_DISABLED = "access-disabled"

_WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_MARKER = "campaign_writable_while"

F = TypeVar("F", bound=Callable[..., object])


def writable_while(*states: str) -> Callable[[F], F]:
    """Let a write handler run while its campaign is in any of ``states``."""

    def mark(handler: F) -> F:
        setattr(handler, _MARKER, frozenset(states))
        return handler

    return mark


def allowed_states(handler: object) -> frozenset[str]:
    """The locked states ``handler`` was marked as able to run in."""
    return getattr(handler, _MARKER, frozenset())


def require_writable_campaign(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Refuse a write to a locked campaign: 403 while the owner's campaign access
    is disabled, 409 while it is archived (the same answers as
    ``assert_not_locked``).

    Only the owner and accepted members are refused here. Anyone else gets the
    handler's own answer (404, or 403 for a campaign they are not in), so the
    lock is never what tells an outsider about a campaign.
    """
    if request.method not in _WRITE_METHODS:
        return
    campaign_id = request.path_params.get("campaign_id")
    if not campaign_id:
        return
    campaign = db.query(Campaign).filter_by(id=campaign_id).first()
    if campaign is None or not can_view(campaign, current_user, db):
        return

    allowed = allowed_states(request.scope.get("endpoint"))
    if ACCESS_DISABLED not in allowed and not user_has_campaign_access(db, campaign.owner_id):
        raise HTTPException(403, "Campaign is locked: the GM's campaign access has been disabled")
    if ARCHIVED not in allowed:
        assert_not_archived(campaign)
