"""Resolve the *effective* route for a request or the app's route table.

FastAPI 0.120+ mounts included routers by reference instead of copying every
route into the parent. That is most of the per-worker memory the upgrade saves,
but it changes what code that inspects routes sees:

* ``app.routes`` holds router wrappers, not a flat list of ``APIRoute``.
* ``request.scope["route"]`` is the route as declared on its module router. Its
  ``tags`` and ``dependant`` lack anything inherited from the routers it was
  included into - notably the ``/api`` router's ``get_current_user`` guard.

API-key authorization reads tags, guards and ``openapi_extra`` off the route, so
it must see the merged view. FastAPI exposes that publicly through
``iter_route_contexts``; this module builds a lookup from it once per app and
answers per request by finding the context that actually matches the request.

Everything here fails closed: a request whose route cannot be resolved returns
None, and callers treat None as "API keys may not use this endpoint".
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from starlette.routing import Match

# Requires FastAPI with by-reference includes (pinned in requirements.txt). An
# older FastAPI fails at import here rather than silently mis-resolving routes.
from fastapi.routing import iter_route_contexts as _iter_route_contexts

_TABLE_ATTR = "_grimoire_route_table"


def effective_routes(routes: Iterable[Any]) -> list[Any]:
    """Every endpoint in ``routes`` as it is actually served (merged with parents)."""
    return list(_iter_route_contexts(list(routes)))


def endpoint_routes(routes: Iterable[Any]) -> list[Any]:
    """The served FastAPI endpoints in ``routes`` (static mounts etc. excluded).

    Use this, not ``isinstance(route, APIRoute)`` over ``app.routes``: on current
    FastAPI that filter matches nothing, and a check written that way passes
    vacuously.
    """
    from fastapi.routing import APIRoute

    return [r for r in effective_routes(routes) if isinstance(_original(r), APIRoute)]


def _original(route: Any) -> Any:
    return getattr(route, "original_route", route)


def _build_table(app: Any) -> dict[int, list[Any]]:
    """Effective contexts grouped by the identity of their declared route, cached on the app.

    A router included in more than one place yields several contexts for the
    same declared route, which is why each key holds a list. The finished table
    is swapped in with a single attribute write, so concurrent requests see
    either the old table or the new one, never a half-built or missing one.
    """
    table: dict[int, list[Any]] = {}
    for ctx in effective_routes(app.routes):
        table.setdefault(id(_original(ctx)), []).append(ctx)
    setattr(app.state, _TABLE_ATTR, table)
    return table


def _table(app: Any) -> dict[int, list[Any]]:
    table = getattr(app.state, _TABLE_ATTR, None)
    return table if table is not None else _build_table(app)


def request_route(request: Any) -> Optional[Any]:
    """The effective route serving ``request``, or None if it can't be resolved."""
    declared = request.scope.get("route")
    if declared is None:
        return None
    candidates = _table(request.app).get(id(declared))
    if candidates is None:
        # Routers mounted after the table was built (tests, late includes):
        # rebuild once, then fail closed if the route is still unknown.
        candidates = _build_table(request.app).get(id(declared), [])
    if len(candidates) == 1:
        return candidates[0]
    # Same declared route mounted under several prefixes: pick the one whose
    # effective path regex matches this request. Ambiguity or no match -> None.
    full = [c for c in candidates if _matches(c, request.scope)]
    return full[0] if len(full) == 1 else None


def _matches(ctx: Any, scope: dict) -> bool:
    try:
        match, _ = ctx.matches({**scope, "route": None})
    except Exception:
        return False
    return match == Match.FULL

