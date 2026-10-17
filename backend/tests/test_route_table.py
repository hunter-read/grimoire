"""Effective-route resolution used by API-key authorization (backend/route_table.py).

These pin the security-relevant behaviour independently of any particular
FastAPI version: the route a key is checked against carries the tags and guards
inherited from parent routers, a route mounted twice resolves to the mount that
served the request, and anything unresolvable comes back None (refused).
"""

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.testclient import TestClient

from backend import route_table
from backend.main import app as grimoire_app


def _guard():
    return "ok"


def _build_app():
    seen = {}

    def capture(request: Request):
        route = route_table.request_route(request)
        seen["route"] = route
        seen["tags"] = list(getattr(route, "tags", []) or []) if route else None
        seen["path"] = getattr(route, "path", None) if route else None
        return {}

    inner = APIRouter(prefix="/things")
    inner.add_api_route("/{thing_id}", capture, methods=["GET"])

    parent = APIRouter(prefix="/api", dependencies=[Depends(_guard)])
    parent.include_router(inner, tags=["things"])
    app = FastAPI()
    app.include_router(parent)
    # The same declared route mounted again under a different prefix and tag.
    app.include_router(inner, prefix="/legacy", tags=["legacy"])
    return app, seen


def _calls(dependant):
    for dep in getattr(dependant, "dependencies", None) or ():
        yield dep.call
        yield from _calls(dep)


def test_route_carries_parent_tags_and_guards():
    app, seen = _build_app()
    TestClient(app).get("/api/things/1")
    route = seen["route"]
    assert route is not None
    assert seen["tags"] == ["things"]
    assert _guard in set(_calls(route.dependant)), "parent router guard missing"


def test_route_mounted_twice_resolves_to_the_mount_that_served_it():
    app, seen = _build_app()
    client = TestClient(app)
    client.get("/legacy/things/1")
    assert seen["tags"] == ["legacy"]
    assert seen["path"] == "/legacy/things/{thing_id}"
    client.get("/api/things/1")
    assert seen["tags"] == ["things"]
    assert seen["path"] == "/api/things/{thing_id}"


def test_unresolvable_request_fails_closed():
    class _Req:
        scope: dict = {}
        app = FastAPI()

    assert route_table.request_route(_Req()) is None

    class _Unknown:
        scope = {"route": object(), "type": "http", "path": "/x", "method": "GET"}
        app = FastAPI()

    assert route_table.request_route(_Unknown()) is None


def test_late_mounted_router_is_found():
    app, seen = _build_app()
    client = TestClient(app)
    client.get("/api/things/1")  # builds the cached table

    late = APIRouter(prefix="/late", tags=["late"])

    def handler(request: Request):
        seen["late"] = route_table.request_route(request)
        return {}

    late.add_api_route("/ping", handler, methods=["GET"])
    app.include_router(late)
    client.get("/late/ping")
    assert seen["late"] is not None
    assert list(seen["late"].tags) == ["late"]


def test_every_grimoire_api_route_resolves_with_the_login_guard():
    """Each /api endpoint, as served, must include get_current_user."""
    from backend.auth import get_current_user

    routes = [
        r
        for r in route_table.endpoint_routes(grimoire_app.routes)
        if r.path.startswith("/api/") and not r.path.startswith(("/api/auth/", "/api/share/"))
    ]
    assert len(routes) >= 300
    unguarded = [r.path for r in routes if get_current_user not in set(_calls(r.dependant))]
    # Public /api routes live on their own routers outside the guarded /api one
    # (calendar feeds, health); everything else must carry the guard.
    public = {r.path for r in routes if r.path in {"/api/health"} or "/calendar/" in r.path}
    assert set(unguarded) <= public, sorted(set(unguarded) - public)
