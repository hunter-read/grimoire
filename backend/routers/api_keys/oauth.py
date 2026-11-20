"""Consent for MCP OAuth sign-in (issue #906): what the consent page calls.

``/authorize`` sends the user's browser to the SPA's consent page with a
request id. Signed in as usual, the page asks here what is being requested,
then approves or denies it. Both answers carry the address to send the browser
to next - the client's redirect address, with a code or an error - and the page
goes there itself, as the site's ``form-action 'self'`` policy would stop a
form from redirecting to another site.

Only a signed-in session can approve: never an API key (the "oauth" tag is in
``api_keys.EXCLUDED_TAGS``, and :func:`require_session_user` refuses one
anyway), never a guest, and only a user allowed to hold keys - a grant is an
API key row. The access granted is chosen here, read-only by default, and can't
exceed what the user's role offers.
"""
from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ... import api_keys
from ...auth import CurrentUser
from ...config import get_db
from ...mcp_oauth import oauth_active
from ...models import OAuthClient
from ._helpers import load_user, require_session_user, validate_permissions
from ._schemas import OAuthApproveIn as ApproveIn

# What an approval grants unless the user picks otherwise: Read on everything
# their role can read, and nothing more.
DEFAULT_PERMISSIONS = {api_keys.ALL_PERMISSIONS: api_keys.LEVEL_READ}


def require_oauth_active(request: Request) -> None:
    """404 unless this server serves OAuth sign-in (MCP_OAUTH_ENABLED)."""
    if not oauth_active(request):
        raise HTTPException(404, "OAuth sign-in is not enabled on this server")


def _pending_or_404(db: Session, request_id: str) -> Any:
    from ...mcp_oauth import codes

    row = codes.pending(db, request_id)
    if row is None:
        raise HTTPException(404, "This sign-in request has expired or was already answered")
    return row


def get_request(
    request_id: str,
    current_user: CurrentUser = Depends(require_session_user),
    db: Session = Depends(get_db),
):
    """What a client is asking for, for the consent page to show."""
    from ...mcp_oauth import clients

    row = _pending_or_404(db, request_id)
    client = db.query(OAuthClient).filter_by(client_id=row.client_id).first()
    info: dict[str, Any] = dict(client.info) if client else {}
    return {
        "client_name": (client.client_name if client else None) or "Unnamed app",
        # The one thing a lookalike client can't fake: where the browser goes
        # once the user approves. The page shows it prominently.
        "redirect_host": clients.redirect_host(info, row.params.get("redirect_uri")),
        "redirect_uri": row.params.get("redirect_uri"),
        "may_approve": api_keys.user_keys_allowed(load_user(db, current_user)),
        "default_permissions": DEFAULT_PERMISSIONS,
    }


def approve_request(
    request_id: str,
    data: ApproveIn,
    request: Request,
    current_user: CurrentUser = Depends(require_session_user),
    db: Session = Depends(get_db),
):
    """Approve: the browser goes back to the client with a code."""
    from mcp.server.auth.provider import construct_redirect_uri

    from ...mcp_oauth import codes

    if not api_keys.user_keys_allowed(load_user(db, current_user)):
        raise HTTPException(403, "API keys are not enabled for your account")
    row = _pending_or_404(db, request_id)
    permissions = (
        DEFAULT_PERMISSIONS
        if data.permissions is None
        else validate_permissions(data.permissions, request.app.routes, current_user.role)
    )
    params = dict(row.params)
    code = codes.approve(db, request_id, current_user.id, permissions)
    if code is None:
        raise HTTPException(404, "This sign-in request has expired or was already answered")
    return {
        "redirect_to": construct_redirect_uri(
            params["redirect_uri"], code=code, state=params.get("state")
        )
    }


def deny_request(
    request_id: str,
    current_user: CurrentUser = Depends(require_session_user),
    db: Session = Depends(get_db),
):
    """Deny: the browser goes back to the client with ``access_denied``."""
    from mcp.server.auth.provider import construct_redirect_uri

    from ...mcp_oauth import codes

    params = codes.deny(db, request_id)
    if params is None:
        raise HTTPException(404, "This sign-in request has expired or was already answered")
    return {
        "redirect_to": construct_redirect_uri(
            params["redirect_uri"],
            error="access_denied",
            error_description="The user declined",
            state=params.get("state"),
        )
    }
