"""OAuth sign-in for /mcp (issue #906), behind ``MCP_OAUTH_ENABLED``.

Lets a hosted MCP client such as claude.ai connect each user to their own
account: the user signs in to Grimoire, approves the client on a consent page,
and the client gets tokens instead of a pasted API key.

The protocol is the ``mcp`` SDK's (``mcp.server.auth``): discovery documents,
``/authorize``, ``/token``, ``/register`` and ``/revoke``, PKCE and redirect
checks. Grimoire supplies the storage and the rules behind them:

- ``clients``: clients that registered themselves (dynamic registration).
- ``codes``: an authorization request, from ``/authorize`` through consent to
  the code exchange.
- ``grants``: what a user approved - an ``api_keys`` row with ``client_id``
  set - and its rotating tokens. A grant acts as its owner exactly as a key
  does, through the same owner checks (``api_keys.check_owner``).
- ``provider``: the SDK's provider interface over those three.
- ``routes``: the SDK's routes, throttled, as mounted in ``main.py``.

Everything is in the database, so any worker can answer any step.

This module itself loads nothing from the SDK: ``routers/mcp`` and the consent
API import :func:`oauth_active` whether or not sign-in is on.
"""
from typing import Any

# Set on app.state by routes.mount once the OAuth routes are served.
OAUTH_STATE = "mcp_oauth_active"


def oauth_active(request: Any) -> bool:
    """Whether this app serves OAuth sign-in, and so takes access tokens on /mcp."""
    return bool(getattr(request.app.state, OAUTH_STATE, False))
