"""What the SPA catch-all answers for a path no other route takes.

Most such paths are app routes (``/library``, ``/maps/12``) and get index.html
so React Router can draw them. Paths under a server-side prefix never are:
whoever calls them parses the answer as JSON, and index.html makes them fail
with a parse error ("Unrecognized token '<'") instead of a clear not-found.
Those get a JSON 404, or a 405 when another route takes the path under a
different method.
"""
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.routing import Match

CATCH_ALL_PATH = "/{full_path:path}"

# First path segments that belong to the server, never to a SPA route.
#   api, mcp, opds - the REST API, MCP and OPDS. mcp and opds are only
#     registered when MCP_ENABLED / OPDS_ENABLED are on.
#   .well-known - discovery documents. MCP clients probe them for OAuth
#     metadata after a 401 from /mcp.
#   authorize, token, register, revoke - the OAuth endpoints. Served at the
#     root when MCP_OAUTH_ENABLED is on (backend/mcp_oauth); otherwise MCP
#     clients still fall back to them (2025-03-26 spec) once both metadata
#     probes 404.
RESERVED_SEGMENTS = frozenset(
    {"api", "mcp", "opds", ".well-known", "authorize", "token", "register", "revoke"}
)

# What the catch-alls answer outside the reserved prefixes.
SPA_METHODS = ("GET", "HEAD")


def is_reserved(full_path: str) -> bool:
    """Whether ``full_path`` is under a reserved prefix.

    Read the way a browser or proxy may hand the path over: extra leading
    slashes (``//api/x``) are dropped and case is ignored (``/API/x``), so
    neither one turns a server path into an app route.
    """
    return full_path.lstrip("/").split("/", 1)[0].casefold() in RESERVED_SEGMENTS


def not_found() -> JSONResponse:
    return JSONResponse({"detail": "Not Found"}, status_code=404)


def method_not_allowed(methods: "set[str] | tuple[str, ...]") -> JSONResponse:
    return JSONResponse(
        {"detail": "Method Not Allowed"},
        status_code=405,
        headers={"Allow": ", ".join(sorted(methods))},
    )


_PROBE_METHODS = ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")


def routed_methods(request: Request) -> set[str]:
    """Methods some other route answers at this request's path.

    The catch-alls take every path, so Starlette picks them over a route that
    matches only the path, and the 405 that route would have given is lost.
    Asking the routes again under each method gets it back. (FastAPI nests
    included routers rather than flattening them, and a nested router doesn't
    say which methods it takes, so each method is tried in turn.) Only runs on
    a catch-all miss.
    """
    routes = [r for r in request.app.router.routes if getattr(r, "path", None) != CATCH_ALL_PATH]
    methods: set[str] = set()
    for method in _PROBE_METHODS:
        scope = {**request.scope, "method": method}
        if any(route.matches(scope)[0] is Match.FULL for route in routes):
            methods.add(method)
    return methods


def not_routed(request: Request, full_path: str) -> JSONResponse:
    """The answer for a request no route or file takes, other than index.html.

    405 when another route takes the path under other methods. Otherwise 404
    under a reserved prefix, and 405 elsewhere (the SPA itself only answers
    GET and HEAD).
    """
    methods = routed_methods(request)
    if methods:
        return method_not_allowed(methods)
    if is_reserved(full_path):
        return not_found()
    return method_not_allowed(SPA_METHODS)
