"""API_DOCS decides who may open /api/docs, /api/redoc and /api/openapi.json."""
import subprocess
import sys



def test_signed_in_by_default(client, admin_headers):
    client.cookies.clear()
    for path in ("/api/docs", "/api/redoc", "/api/openapi.json"):
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers=admin_headers).status_code == 200, path
    assert "paths" in client.get("/api/openapi.json", headers=admin_headers).json()


def test_api_key_cannot_read_them(client, admin_headers):
    resp = client.post(
        "/api/api-keys", json={"name": "docs", "permissions": {"*": "read"}},
        headers=admin_headers,
    )
    key = resp.json()["key"]
    client.cookies.clear()
    assert client.get("/api/openapi.json", headers={"X-API-Key": key}).status_code == 403


def _probe(tmp_path, mode):
    """Each mode needs a fresh app, so it is loaded in its own interpreter.
    Returns {path: (status, is the docs or schema)} for an anonymous client."""
    import json
    import os

    probe = (
        "import json; from fastapi.testclient import TestClient; import backend.main as m; "
        "c = TestClient(m.app); out = {}\n"
        "for p in ('/api/docs', '/api/redoc', '/api/openapi.json'):\n"
        "    r = c.get(p); t = r.text\n"
        "    out[p] = [r.status_code, 'swagger-ui' in t or 'redoc' in t.lower() and '<redoc' in t"
        " or '\"openapi\"' in t]\n"
        "print(json.dumps(out))"
    )
    env = {**os.environ, "API_DOCS": mode, "DATA_PATH": str(tmp_path),
           "LIBRARY_PATH": str(tmp_path), "DISABLE_VERSION_CHECKING": "true"}
    out = subprocess.run([sys.executable, "-c", probe], env=env, capture_output=True,
                         text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_public_mode_serves_them_to_anyone(tmp_path):
    for path, (status, is_docs) in _probe(tmp_path, "public").items():
        assert status == 200 and is_docs, path


def test_off_mode_serves_none_of_them(tmp_path):
    for path, (status, is_docs) in _probe(tmp_path, "off").items():
        assert not is_docs, path


def test_unknown_value_means_signed_in(tmp_path):
    for path, (status, _) in _probe(tmp_path, "everyone").items():
        assert status == 401, path
