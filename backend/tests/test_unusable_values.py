"""Values a handler cannot use answer with a 4xx, never a server error.

Each case here is a value of the wrong type or past a limit, in a request body,
an uploaded file, a stored setting or an identity provider's claims.
"""
import json
import uuid

import pytest

from backend.config import SessionLocal
from backend.models import User
from backend.tests.conftest import make_map


# --- Character sheets ---------------------------------------------------------


def _sheet(**overrides):
    document = {
        "id": f"bad-{uuid.uuid4().hex[:8]}",
        "name": "Bad",
        "fields": {"hp": {"type": "number"}},
    }
    document.update(overrides)
    return document


@pytest.mark.parametrize(
    "document",
    [
        _sheet(fields={"hp": {"type": []}}),
        _sheet(fields={"hp": {"type": {}}}),
        _sheet(fields={"gear": {"type": "list", "columns": [{"key": "item", "type": {}}]}}),
        _sheet(fields={"gear": {"type": "list", "columns": [{"key": "item", "type": []}]}}),
        _sheet(content_types={"spell": {"identity_field": [], "fields": {"name": {"type": "text"}}}}),
        _sheet(
            content_types={
                "spell": {"fields": {"name": {"type": "text"}}, "search_fields": [["name"]]}
            }
        ),
    ],
    ids=["field-type-list", "field-type-object", "column-type-object", "column-type-list",
         "identity-field-list", "search-field-list"],
)
def test_a_sheet_naming_a_type_with_a_list_is_a_400(client, player_headers, document):
    resp = client.post("/api/characters/schemas", json={"document": document}, headers=player_headers)
    assert resp.status_code == 400, resp.text


# --- Army rosters -------------------------------------------------------------


@pytest.mark.parametrize("encoding", ["klingon", "rot13"])
def test_a_roster_in_an_unknown_encoding_is_a_400(client, player_headers, encoding):
    xml = f'<?xml version="1.0" encoding="{encoding}"?><roster name="x"/>'.encode()
    resp = client.post(
        "/api/armies/import",
        files={"file": ("x.ros", xml, "application/octet-stream")},
        headers=player_headers,
    )
    assert resp.status_code == 400, resp.text


# --- Universal VTT maps -------------------------------------------------------


@pytest.mark.parametrize(
    "resolution,expected",
    [
        ({"pixels_per_grid": "abc", "map_size": {"x": 10, "y": 8}}, None),
        ({"pixels_per_grid": float("nan"), "map_size": {"x": float("nan"), "y": 8}}, None),
        ({"pixels_per_grid": 1e308, "map_size": {"x": 1e308, "y": [8]}}, None),
        ({"pixels_per_grid": 0.2, "map_size": {"x": 10, "y": 8}}, None),
        ({"pixels_per_grid": "70", "map_size": {"x": 10, "y": 8}}, 70),
        ({"pixels_per_grid": 70.4, "map_size": {"x": 10, "y": 8}}, 70),
    ],
    ids=["text", "nan", "huge", "below-one", "number-as-text", "fraction"],
)
def test_a_uvtt_grid_that_is_not_a_number_reads_as_none(
    client, admin_headers, tmp_path, resolution, expected
):
    path = tmp_path / "odd.uvtt"
    # allow_nan: the file is someone else's JSON, which may hold a NaN literal.
    path.write_text(json.dumps({"format": "x", "resolution": resolution}, allow_nan=True))
    m = make_map(filename="odd.uvtt", filepath=str(path), relative_path=f"Maps/{uuid.uuid4().hex}.uvtt")
    resp = client.get(f"/api/maps/{m.id}/vtt/data", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["pixels_per_grid"] == expected
    assert body["format"] is None
    if expected:
        assert (body["grid_width"], body["grid_height"]) == (10, 8)
    else:
        assert body["grid_width"] in (None, 10)


# --- Library uploads ----------------------------------------------------------


@pytest.fixture
def library_dir():
    import os
    import shutil

    from backend.config import LIBRARY_PATH

    rel = f"books/Unusable-{uuid.uuid4().hex[:8]}/core"
    os.makedirs(os.path.join(LIBRARY_PATH, rel))
    yield rel
    shutil.rmtree(os.path.join(LIBRARY_PATH, rel.split("/core")[0]), ignore_errors=True)


@pytest.mark.parametrize("on_conflict", ["replace", "rename", "skip"])
def test_an_upload_name_past_the_limit_is_a_400_however_conflicts_go(
    client, admin_headers, library_dir, on_conflict
):
    resp = client.post(
        "/api/files/upload",
        headers=admin_headers,
        data={"destination": library_dir, "on_conflict": on_conflict},
        files={"file": ("x" * 300 + ".pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert resp.status_code == 400, resp.text


# --- OpenID Connect -----------------------------------------------------------

BAD_ISSUERS = ["http://[::1", "http://" + "a" * 70 + ".example.com"]


@pytest.mark.parametrize("issuer", BAD_ISSUERS, ids=["unclosed-ipv6", "long-label"])
def test_discovering_an_unusable_issuer_url_is_a_400(client, admin_headers, issuer):
    resp = client.post(
        "/api/auth/openid/discover", json={"issuer_url": issuer}, headers=admin_headers
    )
    assert resp.status_code == 400, resp.text


@pytest.mark.parametrize("issuer", BAD_ISSUERS, ids=["unclosed-ipv6", "long-label"])
def test_signing_in_with_an_unusable_saved_issuer_is_a_redirect(client, admin_headers, issuer):
    from backend.routers.oidc import _helpers

    _helpers._discovery_cache.clear()
    assert client.patch(
        "/api/settings",
        headers=admin_headers,
        json={
            "oidc_enabled": True,
            "oidc_issuer_url": issuer,
            "oidc_client_id": "grimoire",
            "oidc_client_secret": "secret",
        },
    ).status_code == 200
    try:
        resp = client.get("/api/auth/openid/login", follow_redirects=False)
        assert resp.status_code == 302, resp.text
        assert "error=" in resp.headers["location"]
    finally:
        client.patch(
            "/api/settings",
            headers=admin_headers,
            json={
                "oidc_enabled": False,
                "oidc_issuer_url": "",
                "oidc_client_id": "",
                "oidc_client_secret": "__CLEAR__",
            },
        )
        _helpers._discovery_cache.clear()


def _eff(**overrides):
    eff = {
        "oidc_match_by": "none",
        "oidc_groups_claim": "",
        "oidc_permissions_claim": "",
        "oidc_auto_register": True,
    }
    eff.update(overrides)
    return eff


@pytest.mark.parametrize(
    "claims,username,email",
    [
        ({"email": ["a@example.com"], "name": 7, "nickname": {"x": 1}}, None, None),
        ({"email": 5, "nickname": ["n"], "name": "Plain Name"}, "Plain Name", None),
        ({"email": {"a": 1}, "name": "x" * 5000, "nickname": "short"}, "short", None),
        ({"email": "Real@Example.com", "name": "x" * 5000}, "real", "real@example.com"),
        ({"preferred_username": ["admin"], "name": "x" * 5000}, None, None),
    ],
    ids=["all-wrong-types", "name-used", "long-name-skipped", "email-local-part", "list-login-name"],
)
def test_claims_that_are_not_text_are_ignored(client, admin_setup, claims, username, email):
    from backend.routers.oidc._helpers import _resolve_user

    sub = f"sub-{uuid.uuid4().hex}"
    db = SessionLocal()
    try:
        user = _resolve_user(db, {"sub": sub, **claims}, _eff())
        db.commit()
        assert user.username == (username or f"oidc-{sub[:8]}")
        assert user.email == email
        db.delete(user)
        db.commit()
    finally:
        db.close()


def test_a_list_claim_does_not_match_an_account(client, admin_headers):
    from backend.routers.oidc._helpers import _resolve_user

    made = client.post(
        "/api/users",
        headers=admin_headers,
        json={"username": "claim_list_user", "password": "password123-long", "email": "list@example.com"},
    ).json()
    db = SessionLocal()
    try:
        for match_by, claims in (
            ("email", {"email": ["list@example.com"]}),
            ("username", {"preferred_username": ["claim_list_user"]}),
        ):
            sub = f"sub-{uuid.uuid4().hex}"
            user = _resolve_user(db, {"sub": sub, **claims}, _eff(oidc_match_by=match_by))
            db.commit()
            assert user.id != made["id"]
            db.delete(user)
            db.commit()
        assert db.get(User, made["id"]).oidc_subject is None
    finally:
        db.close()
        client.delete(f"/api/users/{made['id']}", headers=admin_headers)


def test_a_taken_long_username_still_fits_with_its_suffix(client, admin_setup):
    from backend.routers.oidc._helpers import _resolve_user
    from backend.usernames import USERNAME_MAX_LENGTH

    name = "n" * USERNAME_MAX_LENGTH
    db = SessionLocal()
    try:
        first = _resolve_user(db, {"sub": f"sub-{uuid.uuid4().hex}", "name": name}, _eff())
        db.commit()
        second = _resolve_user(db, {"sub": "second-sub-xyz", "name": name}, _eff())
        db.commit()
        assert first.username == name
        assert len(second.username) == USERNAME_MAX_LENGTH
        assert second.username.endswith("-second")
        db.delete(first)
        db.delete(second)
        db.commit()
    finally:
        db.close()
