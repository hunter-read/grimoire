"""What a request says about its client, for the session list.

Shared by every sign-in route: password, setup, guest codes and OIDC.
"""
from typing import Optional

from fastapi import Request


def client_user_agent(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    return request.headers.get("User-Agent")


def client_ip(request: Optional[Request]) -> Optional[str]:
    """Best-effort client IP for the session list, read the same way as for
    rate limiting: X-Forwarded-For only from a trusted proxy (backend/security.py)."""
    if request is None:
        return None
    from ..security import client_ip as resolved_client_ip

    return resolved_client_ip(request)
