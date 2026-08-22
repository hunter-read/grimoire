"""Guards for the OpenAPI response schemas.

Every JSON endpoint declares a `response_model` (or a `responses=` model), so the
generated spec describes real types instead of `{}`. These tests keep that true:
a new route that forgets one fails here rather than silently shipping an untyped
schema to API clients.
"""
from fastapi.routing import APIRoute

from backend.main import app

# Routes that legitimately have no JSON body schema: raw file/image/archive
# streams, redirects, and the SPA catch-all. Adding to this list is a deliberate
# choice — a route only belongs here if it does NOT return a JSON object.
UNTYPED_BY_DESIGN = {
    "/api/audio/{audio_id}/artwork",
    # Serves the cover image file itself, like the system cover route below.
    "/api/audio/{audio_id}/cover",
    "/api/audio/{audio_id}/file",
    "/api/auth/openid/callback",
    "/api/auth/openid/login",
    # Streams the backup .zip itself, not JSON.
    "/api/backups/{backup_id}/download",
    "/api/books/{book_id}/file",
    "/api/books/{book_id}/page/{page_num}",
    "/api/books/{book_id}/thumbnail",
    "/api/campaigns/{campaign_id}/banner",
    "/api/campaigns/{campaign_id}/files/{file_id}",
    "/api/campaigns/{campaign_id}/members/{member_id}/art",
    "/api/campaigns/{campaign_id}/members/{member_id}/sheet",
    "/api/campaigns/{campaign_id}/wiki/export",
    "/api/campaigns/{campaign_id}/wiki/templates/{template_id}/export",
    "/api/downloads/archive",
    "/api/maps/{map_id}/file",
    "/api/maps/{map_id}/page/{page_num}",
    "/api/maps/{map_id}/thumbnail",
    "/api/systems/{system_id}/cover",
    "/api/tokens/{token_id}/file",
    "/api/tokens/{token_id}/thumbnail",
    "/{full_path}",
}


def _json_response_schemas():
    """Yield (route_key, schema) for every JSON response in the generated spec."""
    spec = app.openapi()
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            if not isinstance(op, dict):
                continue
            for code, resp in (op.get("responses") or {}).items():
                content = resp.get("content", {}).get("application/json", {})
                if "schema" in content:
                    yield f"{method.upper()} {path} {code}", path, content["schema"]


def test_json_routes_declare_a_response_schema():
    """No JSON endpoint may emit an empty `{}` schema."""
    untyped = [
        key
        for key, path, schema in _json_response_schemas()
        if schema == {} and path not in UNTYPED_BY_DESIGN
    ]
    assert not untyped, (
        "these routes emit an empty OpenAPI schema — add a `response_model=` "
        "(or add them to UNTYPED_BY_DESIGN if they don't return JSON):\n"
        + "\n".join(untyped)
    )


def test_no_response_model_is_an_empty_shell():
    """A model with no fields would filter the whole body away at runtime."""
    hollow = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or route.response_model is None:
            continue
        model = route.response_model
        fields = getattr(model, "model_fields", None)
        if fields is not None and not fields:
            hollow.append(f"{sorted(route.methods)} {route.path} -> {model!r}")
    assert not hollow, "response models declaring no fields:\n" + "\n".join(hollow)


def test_untyped_by_design_list_has_no_stale_entries():
    """Keep the allowlist honest: every entry must still be a real route."""
    live_paths = {path for _, path, _ in _json_response_schemas()}
    stale = sorted(p for p in UNTYPED_BY_DESIGN if p not in live_paths)
    assert not stale, (
        "UNTYPED_BY_DESIGN lists paths that no longer exist (or now have a "
        "schema) — remove them:\n" + "\n".join(stale)
    )


def test_bulk_update_does_not_advertise_a_tags_key():
    """`/bulk` and `/bulk/tags` return different shapes.

    `run_bulk_update` returns only {updated, errors}; only `run_bulk_add_tags`
    adds `tags`. A shared model with an Optional `tags` field would materialise
    an explicit `tags: null` on the plain `/bulk` routes — a key those endpoints
    never sent. Guard both directions.
    """
    spec = app.openapi()
    schemas = spec["components"]["schemas"]
    for path, ops in spec["paths"].items():
        post = ops.get("post")
        if not post:
            continue
        content = post["responses"].get("200", {}).get("content", {})
        ref = content.get("application/json", {}).get("schema", {}).get("$ref")
        if not ref:
            continue
        props = schemas.get(ref.rsplit("/", 1)[-1], {}).get("properties", {})
        if path.endswith("/bulk"):
            assert "tags" not in props, f"{path} must not advertise a `tags` key"
        elif path.endswith("/bulk/tags"):
            assert "tags" in props, f"{path} must advertise its `tags` key"
