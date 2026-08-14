"""Response schema for the unauthenticated /api/health probe.

Lives outside `routers/` because the endpoint is defined directly on the app in
`main.py` rather than in a router package.
"""
from typing import Optional

from pydantic import BaseModel


class HealthChecks(BaseModel):
    """Per-dependency status. `database` is always probed; `valkey` only appears
    when a Valkey/Redis cache is configured, so it is Optional."""

    database: str
    valkey: Optional[str] = None


class HealthResponse(BaseModel):
    # "ok" (HTTP 200) or "unhealthy" (HTTP 503).
    status: str
    checks: HealthChecks
