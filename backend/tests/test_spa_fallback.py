"""The SPA catch-all serves index.html for app routes, but not for /.well-known.

Clients probe /.well-known/* for discovery documents and parse the answer as
JSON. An MCP client that got a 401 from /mcp looked for OAuth metadata at
/.well-known/oauth-protected-resource, got index.html, and failed with
"JSON Parse error: Unrecognized token '<'" instead of a clear "not found".
"""
import pytest

from backend import main


@pytest.fixture
def frontend(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<!doctype html><title>app</title>")
    (tmp_path / ".well-known").mkdir()
    (tmp_path / ".well-known" / "security.txt").write_text("Contact: mailto:x@example.com\n")
    monkeypatch.setattr(main, "FRONTEND_DIR", str(tmp_path))
    return tmp_path


@pytest.mark.parametrize(
    "path",
    [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-authorization-server",
        "/.well-known/openid-configuration",
        "/.well-known",
        "/.well-known/",
    ],
)
def test_a_missing_well_known_document_is_a_json_404(client, frontend, path):
    resp = client.get(path)
    assert resp.status_code == 404, resp.text
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json() == {"detail": "Not Found"}


def test_a_well_known_file_that_exists_is_still_served(client, frontend):
    resp = client.get("/.well-known/security.txt")
    assert resp.status_code == 200
    assert resp.text.startswith("Contact:")


@pytest.mark.parametrize("path", ["/library", "/books/123", "/well-known", "/a/.well-known/x"])
def test_app_routes_still_get_the_spa(client, frontend, path):
    resp = client.get(path)
    assert resp.status_code == 200
    assert resp.text.startswith("<!doctype html>")
