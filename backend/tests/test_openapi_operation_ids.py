"""The live OpenAPI schema's operationIds (issue #709).

A route registered for GET and HEAD together put two operations under one
operationId, which breaks client generators and Swagger UI's "try it out", and
picked that id's method suffix by set order, so it could change between
restarts. HEAD now has a twin route left out of the schema.
"""
import warnings

from fastapi.openapi.utils import get_openapi

from backend.main import app

# Every route that answers HEAD for a client that probes before fetching.
GET_AND_HEAD = [
    "/api/share/{token}",
    "/api/share/{token}/{filename}",
    "/api/campaigns/calendar/{token}/all.ics",
    "/api/campaigns/calendar/{token}/{campaign_id}.ics",
]


def _fresh_schema() -> dict:
    # app.openapi() caches; building it again is what surfaces the warnings.
    return get_openapi(title=app.title, version=app.version, routes=app.routes)


def test_operation_ids_are_unique():
    ids = [
        op["operationId"]
        for ops in app.openapi()["paths"].values()
        for op in ops.values()
        if isinstance(op, dict) and "operationId" in op
    ]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    assert duplicates == []


def test_building_the_schema_warns_about_nothing():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        _fresh_schema()
    assert [str(w.message) for w in caught if "Operation ID" in str(w.message)] == []


def test_get_and_head_routes_document_only_get():
    paths = app.openapi()["paths"]
    for path in GET_AND_HEAD:
        assert set(paths[path]) == {"get"}, path
        assert paths[path]["get"]["operationId"].endswith("_get"), path


def test_get_and_head_routes_still_answer_head(client):
    for path in GET_AND_HEAD:
        url = path.replace("{token}", "bogus").replace("{filename}", "x.png")
        url = url.replace("{campaign_id}", "nope")
        # A dead token is a 404 either way; a missing HEAD route would be 405.
        assert client.head(url).status_code == 404, url
