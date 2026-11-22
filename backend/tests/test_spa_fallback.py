"""The SPA catch-all serves index.html for app routes, but not for server paths.

Clients probe /.well-known/* for discovery documents and parse the answer as
JSON. An MCP client that got a 401 from /mcp looked for OAuth metadata at
/.well-known/oauth-protected-resource, got index.html, and failed with
"JSON Parse error: Unrecognized token '<'" instead of a clear "not found".
The same went for an unknown /api/* route, /mcp and /opds with those features
off, and the /authorize, /token and /register endpoints an MCP client falls
back to once the metadata probes 404.

MCP_ENABLED and OPDS_ENABLED are off in tests, so /mcp and /opds have no routes.
"""
import pytest

from backend import main, spa_fallback

JSON_404 = {"detail": "Not Found"}


@pytest.fixture
def frontend(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<!doctype html><title>app</title>")
    (tmp_path / ".well-known").mkdir()
    (tmp_path / ".well-known" / "security.txt").write_text("Contact: mailto:x@example.com\n")
    monkeypatch.setattr(main, "FRONTEND_DIR", str(tmp_path))
    return tmp_path


def assert_json_404(resp):
    assert resp.status_code == 404, resp.text
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json() == JSON_404


RESERVED_PATHS = [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
    "/.well-known",
    "/.well-known/",
    "/api",
    "/api/",
    "/api/no-such-route",
    "/api/books/1/no-such-action",
    "/mcp",
    "/opds",
    "/opds/catalog",
    "/authorize",
    "/authorize?response_type=code&client_id=x",
    "/token",
    "/register",
    "/revoke",
]


@pytest.mark.parametrize("path", RESERVED_PATHS)
def test_a_missing_server_path_is_a_json_404(client, frontend, path):
    assert_json_404(client.get(path))


@pytest.mark.parametrize(
    "path", ["/API/x", "/Api", "//api/x", "///api/books", "/MCP", "//mcp", "/.Well-Known/x", "/TOKEN"]
)
def test_a_server_path_in_another_case_or_with_extra_slashes_is_a_json_404(client, frontend, path):
    # The full URL, so the client cannot read "//api" as a host name.
    assert_json_404(client.get(f"http://testserver{path}"))


def test_an_app_route_that_only_starts_like_a_server_path_is_the_app(client, frontend):
    for path in ("/apiary", "/Library", "//library"):
        resp = client.get(f"http://testserver{path}")
        assert resp.status_code == 200, path
        assert resp.text.startswith("<!doctype html>")


@pytest.mark.parametrize("path", RESERVED_PATHS)
def test_head_on_a_missing_server_path_is_a_404(client, frontend, path):
    resp = client.head(path)
    assert resp.status_code == 404
    assert resp.headers["content-type"].startswith("application/json")


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
@pytest.mark.parametrize(
    "path", ["/token", "/register", "/.well-known/oauth-protected-resource", "/api/nope", "/mcp"]
)
def test_other_methods_on_a_missing_server_path_are_a_json_404(client, frontend, method, path):
    assert_json_404(client.request(method, path))


def test_a_well_known_file_that_exists_is_still_served(client, frontend):
    resp = client.get("/.well-known/security.txt")
    assert resp.status_code == 200
    assert resp.text.startswith("Contact:")
    head = client.head("/.well-known/security.txt")
    assert head.status_code == 200
    assert head.content == b""


@pytest.mark.parametrize(
    "path",
    [
        "/library",
        "/books/123",
        "/well-known",
        "/a/.well-known/x",
        "/tokens",
        "/tokens/editor",
        "/apis",
        "/a/api/x",
    ],
)
def test_app_routes_still_get_the_spa(client, frontend, path):
    resp = client.get(path)
    assert resp.status_code == 200
    assert resp.text.startswith("<!doctype html>")
    head = client.head(path)
    assert head.status_code == 200
    assert head.headers["content-type"].startswith("text/html")
    assert head.content == b""


def test_get_on_an_api_route_that_only_takes_post_is_a_405(client, frontend):
    # Used to fall through to index.html with a 200.
    resp = client.get("/api/auth/login")
    assert resp.status_code == 405
    assert resp.headers["allow"] == "POST"
    assert resp.json() == {"detail": "Method Not Allowed"}


def test_head_and_post_on_a_get_only_route_keep_their_405(client, frontend):
    for method in ("HEAD", "POST"):
        resp = client.request(method, "/api/health")
        assert resp.status_code == 405, method
        assert resp.headers["allow"] == "GET"


@pytest.fixture
def post_only_route(client):
    """A route outside the reserved prefixes, added before the catch-alls.

    Added to the app ``client`` calls, not ``main.app``: a test module that
    reloads ``backend.main`` (``test_opds.py`` does) replaces ``main.app`` with
    an app the session client never sees (issue #931).
    """
    app = client.app
    routes = app.router.routes

    def endpoint():
        return {"ok": True}

    app.add_api_route("/spa-test-post-only", endpoint, methods=["POST"])
    route = routes.pop()
    routes.insert(0, route)
    yield "/spa-test-post-only"
    routes.remove(route)


def test_head_on_a_route_outside_the_reserved_prefixes_keeps_its_405(
    client, frontend, post_only_route
):
    for method in ("HEAD", "PUT"):
        resp = client.request(method, post_only_route)
        assert resp.status_code == 405, method
        assert resp.headers["allow"] == "POST"
    assert client.post(post_only_route).json() == {"ok": True}


def test_post_to_an_app_route_is_a_405(client, frontend):
    resp = client.post("/library")
    assert resp.status_code == 405
    assert resp.headers["allow"] == "GET, HEAD"


def test_a_nul_byte_is_a_json_404(client, frontend):
    assert_json_404(client.get("/a%00b"))


def test_the_catch_all_is_listed_once_in_the_openapi_schema():
    # The non-GET catch-all stays out of the schema, so schema.d.ts is unchanged.
    assert list(main.app.openapi()["paths"]["/{full_path}"]) == ["get"]


@pytest.mark.parametrize(
    "full_path, reserved",
    [
        ("api", True),
        ("api/x", True),
        (".well-known/x", True),
        ("token", True),
        ("tokens", False),
        ("", False),
        ("library/api", False),
    ],
)
def test_is_reserved(full_path, reserved):
    assert spa_fallback.is_reserved(full_path) is reserved
