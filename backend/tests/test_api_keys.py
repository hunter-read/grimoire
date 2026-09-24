"""Personal API keys with per-area permissions (issue #489)."""
import datetime
import uuid

import pytest
from fastapi.routing import APIRoute

from backend import api_keys
from backend.config import SessionLocal
from backend.main import app
from backend.models import ApiKey
from backend.tests.conftest import make_book, make_game_system


def _create(client, headers, permissions=None, **extra):
    resp = client.post(
        "/api/api-keys",
        json={
            "name": extra.pop("name", f"key-{uuid.uuid4().hex[:6]}"),
            "permissions": permissions or {},
            **extra,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["key"], body["api_key"]


def _k(key):
    return {"X-API-Key": key}


def _api_routes():
    return [r for r in app.routes if isinstance(r, APIRoute) and r.path.startswith("/api/")]


def _route(path, method):
    for r in _api_routes():
        if r.path == path and method in r.methods:
            return r
    raise AssertionError(f"no route {method} {path}")


def _user(client, admin_headers, role, keys=True):
    """A fresh user in ``role``, returning (id, headers)."""
    username = f"key-{role}-{uuid.uuid4().hex[:6]}"
    created = client.post(
        "/api/users",
        json={
            "username": username,
            "password": "keyuserpass1",
            "role": role,
            "api_keys_enabled": keys,
        },
        headers=admin_headers,
    )
    assert created.status_code == 201, created.text
    token = client.post(
        "/api/auth/login", json={"username": username, "password": "keyuserpass1"}
    ).json()["token"]
    client.cookies.clear()
    return created.json()["id"], {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module", autouse=True)
def _grant_keys(client, admin_headers, gm_id, player_id):
    """API keys are off per user by default; this module's GM and player hold them."""
    for user_id in (gm_id, player_id):
        resp = client.patch(
            f"/api/users/{user_id}", json={"api_keys_enabled": True}, headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
    yield
    for user_id in (gm_id, player_id):
        client.patch(
            f"/api/users/{user_id}", json={"api_keys_enabled": False}, headers=admin_headers
        )


@pytest.fixture
def keys_off(monkeypatch):
    """API_KEYS_ENABLED=false for one test."""
    from backend import config

    monkeypatch.setattr(config, "API_KEYS_ENABLED", False)


# ---------------------------------------------------------------------------
# The permission table
# ---------------------------------------------------------------------------


class TestPermissionTable:
    def test_every_router_tag_is_mapped_or_excluded(self):
        """A new router must be given a permission or explicitly excluded."""
        for route in _api_routes():
            assert route.tags, f"{route.path} has no tag, so keys can't be scoped to it"
            for tag in route.tags:
                assert tag in api_keys.TAG_PERMISSIONS or tag in api_keys.EXCLUDED_TAGS, (
                    f"Router tag {tag!r} ({route.path}) is neither mapped to an API key "
                    f"permission nor excluded - add it to PERMISSIONS or EXCLUDED_TAGS "
                    f"in backend/api_keys.py"
                )

    def test_every_permission_has_a_known_group(self):
        for perm, spec in api_keys.PERMISSIONS.items():
            assert spec.group in api_keys.GROUPS, perm

    def test_permissions_are_listed_group_by_group(self):
        """The editor shows each group's areas together, in table order."""
        groups = [spec.group for spec in api_keys.PERMISSIONS.values()]
        seen = [g for i, g in enumerate(groups) if i == 0 or g != groups[i - 1]]
        assert seen == list(api_keys.GROUPS)

    def test_no_tag_is_both_mapped_and_excluded(self):
        assert not set(api_keys.TAG_PERMISSIONS) & api_keys.EXCLUDED_TAGS

    def test_only_security_tags_are_excluded(self):
        assert api_keys.EXCLUDED_TAGS == {"auth", "api-keys"}

    def test_every_permission_covers_a_real_route(self):
        """A permission nothing maps to would show in the picker and grant nothing."""
        covered = {api_keys.route_permission(r) for r in _api_routes()}
        assert set(api_keys.PERMISSIONS) <= covered

    def test_grouped_permissions(self):
        assert api_keys.route_permission(_route("/api/tokens", "GET")) == "tokens"
        assert api_keys.route_permission(_route("/api/token-frames", "GET")) == "tokens"
        for path in ("/api/favorites", "/api/bookmarks", "/api/saved-filters", "/api/themes"):
            assert api_keys.route_permission(_route(path, "GET")) == "personal", path

    def test_stats_has_its_own_tag(self):
        route = _route("/api/stats", "GET")
        assert route.tags == ["stats"]
        assert api_keys.route_permission(route) == "stats"

    def test_cleanup_is_under_library_and_sidecars_under_maintenance(self):
        cleanup = _route("/api/maintenance/cleanup-missing", "POST")
        assert api_keys.route_permission(cleanup) == "library"
        for path, method in (
            ("/api/maintenance/sidecars/settings", "GET"),
            ("/api/maintenance/sidecars/settings", "PUT"),
            ("/api/maintenance/sidecars/export", "POST"),
        ):
            assert api_keys.route_permission(_route(path, method)) == "maintenance"

    @pytest.mark.parametrize(
        "path",
        [
            "/api/books/{book_id}/metadata-search",
            "/api/books/{book_id}/metadata-fetch",
            "/api/systems/{system_id}/metadata-search",
            "/api/systems/{system_id}/metadata-fetch",
        ],
    )
    def test_read_only_posts_count_as_read(self, path):
        assert api_keys.required_level(_route(path, "POST"), "POST") == api_keys.LEVEL_READ

    def test_other_posts_need_write(self):
        route = _route("/api/books/bulk", "POST")
        assert api_keys.required_level(route, "POST") == api_keys.LEVEL_WRITE

    @pytest.mark.parametrize(
        "path,method",
        [
            ("/api/users/me/password", "PATCH"),
            ("/api/users/me", "DELETE"),
            ("/api/users/me/opds", "GET"),
            ("/api/users/me/opds/generate", "POST"),
            ("/api/users/me/opds", "DELETE"),
            ("/api/campaigns/calendar/subscription", "GET"),
            ("/api/campaigns/calendar/subscription", "POST"),
            ("/api/campaigns/calendar/subscription", "DELETE"),
        ],
    )
    def test_credential_routes_are_marked_excluded(self, path, method):
        assert _route(path, method).openapi_extra == api_keys.EXCLUDED

    @pytest.mark.parametrize(
        "path,method",
        [
            ("/api/users/me/preferences", "PATCH"),
            ("/api/campaigns/{campaign_id}/wiki/{page_id}/hide", "POST"),
            ("/api/settings/ui", "GET"),
        ],
    )
    def test_per_user_routes_are_open(self, path, method):
        assert api_keys.route_permission(_route(path, method)) is not None

    def test_unknown_or_untagged_routes_fail_closed(self):
        class Fake:
            tags = ["brand-new"]
            openapi_extra = None

        assert api_keys.route_permission(Fake()) is None
        Fake.tags = []
        assert api_keys.route_permission(Fake()) is None
        assert api_keys.route_permission(None) is None

    def test_route_spanning_two_permissions_fails_closed(self):
        class Fake:
            tags = ["books", "maps"]
            openapi_extra = None

        assert api_keys.route_permission(Fake()) is None

    def test_route_min_role_follows_the_guards(self):
        assert api_keys.route_min_role(_route("/api/logs", "GET")) == "admin"
        assert api_keys.route_min_role(_route("/api/books/bulk", "POST")) == "gm"
        assert api_keys.route_min_role(_route("/api/books", "GET")) == "player"
        assert api_keys.route_min_role(_route("/api/stats", "GET")) == "guest"
        # Public routes are never a key's to use.
        assert api_keys.route_min_role(_route("/api/health", "GET")) is None

    def test_levels_offered_follow_the_role(self):
        player = api_keys.available_levels(app.routes, "player")
        gm = api_keys.available_levels(app.routes, "gm")
        admin = api_keys.available_levels(app.routes, "admin")
        # A player can't edit game systems, so isn't offered Read and write there.
        assert player["systems"] == ["none", "read"]
        assert gm["systems"] == ["none", "read", "write"]
        # Admin-only areas aren't offered to anyone else at all.
        for perm in ("logs", "files", "backups", "duplicates", "maintenance"):
            assert perm not in player and perm not in gm, perm
            assert perm in admin, perm
        # Read-only areas never offer write, even to an admin.
        assert admin["stats"] == ["none", "read"]
        assert admin["logs"] == ["none", "read"]
        # Personal data is everyone's own.
        assert player["personal"] == ["none", "read", "write"]

    def test_normalize_accepts_all_permissions(self):
        levels = api_keys.available_levels(app.routes, "admin")
        assert api_keys.normalize_permissions({"*": "read", "books": "write"}, levels) == {
            "*": "read",
            "books": "write",
        }
        assert api_keys.normalize_permissions({"*": "none"}, levels) == {}
        with pytest.raises(ValueError):
            api_keys.normalize_permissions({"*": "admin"}, levels)

    def test_normalize_refuses_what_the_role_cannot_use(self):
        levels = api_keys.available_levels(app.routes, "player")
        with pytest.raises(ValueError, match="role cannot use logs"):
            api_keys.normalize_permissions({"logs": "read"}, levels)
        with pytest.raises(ValueError, match="not available for systems"):
            api_keys.normalize_permissions({"systems": "write"}, levels)

    def test_normalize_drops_none_and_rejects_junk(self):
        levels = api_keys.available_levels(app.routes, "admin")
        assert api_keys.normalize_permissions({"books": "none", "maps": "read"}, levels) == {
            "maps": "read"
        }
        with pytest.raises(ValueError):
            api_keys.normalize_permissions({"auth": "read"}, levels)
        with pytest.raises(ValueError):
            api_keys.normalize_permissions({"stats": "write"}, levels)
        with pytest.raises(ValueError):
            api_keys.normalize_permissions(["books"], levels)

    def test_granted_level_takes_the_higher_of_explicit_and_all(self):
        assert api_keys.granted_level({"*": "read", "books": "write"}, "books") == "write"
        assert api_keys.granted_level({"*": "write", "books": "read"}, "books") == "write"
        assert api_keys.granted_level({"*": "read"}, "some-future-area") == "read"
        assert api_keys.granted_level({"books": "read"}, "maps") == "none"
        assert api_keys.granted_level(None, "maps") == "none"


class TestHashing:
    def test_keys_are_prefixed_and_random(self):
        a, b = api_keys.generate_key(), api_keys.generate_key()
        assert a.startswith("grim_") and b.startswith("grim_")
        assert a != b
        assert len(a) > 40

    def test_hash_is_sha256_hex(self):
        h = api_keys.hash_key("abc")
        assert h == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

    def test_only_the_hash_is_stored(self, client, admin_headers):
        key, meta = _create(client, admin_headers, {"stats": "read"})
        db = SessionLocal()
        try:
            row = db.query(ApiKey).filter_by(id=meta["id"]).one()
            assert row.key_hash == api_keys.hash_key(key)
            assert key not in (row.key_hash, row.prefix)
            assert key.startswith(row.prefix)
        finally:
            db.close()

    def test_lookup_compares_in_constant_time(self, client, admin_headers, monkeypatch):
        key, _ = _create(client, admin_headers, {"stats": "read"})
        calls = []
        real = api_keys.hmac.compare_digest

        def spy(a, b):
            calls.append((a, b))
            return real(a, b)

        monkeypatch.setattr(api_keys.hmac, "compare_digest", spy)
        assert client.get("/api/stats", headers=_k(key)).status_code == 200
        assert calls == [(api_keys.hash_key(key), api_keys.hash_key(key))]


# ---------------------------------------------------------------------------
# Managing keys
# ---------------------------------------------------------------------------


class TestManagement:
    def test_create_returns_the_key_once(self, client, admin_headers, admin_id):
        key, meta = _create(
            client, admin_headers, {"books": "read", "maps": "none"}, name=" Homepage "
        )
        assert meta["name"] == "Homepage"
        assert meta["permissions"] == {"books": "read"}
        assert meta["prefix"] == key[:12]
        assert meta["user_id"] == admin_id
        assert meta["username"] == "admin"
        assert meta["expires_at"] is None and meta["expired"] is False

        listed = client.get("/api/api-keys", headers=admin_headers).json()
        row = next(k for k in listed if k["id"] == meta["id"])
        assert "key" not in row and "key_hash" not in row
        assert key not in str(listed)

    def test_permissions_listing_follows_the_callers_role(
        self, client, admin_headers, player_headers
    ):
        admin = {
            p["id"]: p
            for p in client.get("/api/api-keys/permissions", headers=admin_headers).json()
        }
        assert admin["tokens"]["tags"] == ["tokens", "token-frames"]
        assert admin["tokens"]["group"] == "media"
        assert admin["logs"]["group"] == "admin"
        assert admin["stats"]["levels"] == ["none", "read"]
        assert admin["stats"]["description"]
        assert "logs" in admin and "auth" not in admin

        player = {
            p["id"]: p
            for p in client.get("/api/api-keys/permissions", headers=player_headers).json()
        }
        assert player["systems"]["levels"] == ["none", "read"]
        assert "logs" not in player and "files" not in player

    def test_players_hold_keys_within_their_role(self, client, player_headers, player_id):
        key, meta = _create(client, player_headers, {"books": "read", "personal": "write"})
        assert meta["user_id"] == player_id
        assert client.get("/api/books", headers=_k(key)).status_code == 200
        for bad in ({"systems": "write"}, {"logs": "read"}, {"files": "read"}):
            resp = client.post(
                "/api/api-keys", json={"name": "x", "permissions": bad}, headers=player_headers
            )
            assert resp.status_code == 400, bad

    def test_create_rejects_bad_input(self, client, admin_headers):
        bad = [
            {"name": "x", "permissions": {"auth": "read"}},
            {"name": "x", "permissions": {"books": "admin"}},
            {"name": "   ", "permissions": {}},
            {"name": "x", "permissions": {}, "expires_at": "2000-01-01T00:00:00Z"},
        ]
        for body in bad:
            resp = client.post("/api/api-keys", json=body, headers=admin_headers)
            assert resp.status_code in (400, 422), body

    def test_update(self, client, admin_headers):
        _, meta = _create(client, admin_headers, {"stats": "read"})
        future = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=30)
        resp = client.patch(
            f"/api/api-keys/{meta['id']}",
            json={
                "name": "Renamed",
                "permissions": {"books": "write"},
                "expires_at": future.isoformat(),
            },
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["name"] == "Renamed"
        assert body["permissions"] == {"books": "write"}
        assert body["expires_at"] is not None

        # Omitting expires_at leaves it; an explicit null clears it.
        body = client.patch(
            f"/api/api-keys/{meta['id']}", json={"name": "Again"}, headers=admin_headers
        ).json()
        assert body["expires_at"] is not None
        body = client.patch(
            f"/api/api-keys/{meta['id']}", json={"expires_at": None}, headers=admin_headers
        ).json()
        assert body["expires_at"] is None

        assert (
            client.patch(
                f"/api/api-keys/{meta['id']}", json={"name": " "}, headers=admin_headers
            ).status_code
            == 400
        )
        assert (
            client.patch(
                f"/api/api-keys/{meta['id']}",
                json={"permissions": {"logs": "write"}},
                headers=admin_headers,
            ).status_code
            == 400
        )

    def test_regenerate_replaces_the_secret(self, client, admin_headers):
        old, meta = _create(client, admin_headers, {"stats": "read"}, name="regen")
        resp = client.post(f"/api/api-keys/{meta['id']}/regenerate", headers=admin_headers)
        assert resp.status_code == 200
        new = resp.json()["key"]
        assert new != old
        assert resp.json()["api_key"]["name"] == "regen"
        assert resp.json()["api_key"]["permissions"] == {"stats": "read"}
        assert client.get("/api/stats", headers=_k(old)).status_code == 401
        assert client.get("/api/stats", headers=_k(new)).status_code == 200

    def test_revoke(self, client, admin_headers):
        key, meta = _create(client, admin_headers, {"stats": "read"})
        assert (
            client.delete(f"/api/api-keys/{meta['id']}", headers=admin_headers).status_code
            == 204
        )
        assert client.get("/api/stats", headers=_k(key)).status_code == 401
        assert (
            client.delete(f"/api/api-keys/{meta['id']}", headers=admin_headers).status_code
            == 404
        )
        assert (
            client.post(
                f"/api/api-keys/{meta['id']}/regenerate", headers=admin_headers
            ).status_code
            == 404
        )

    def test_users_see_and_manage_only_their_own_keys(
        self, client, gm_headers, player_headers
    ):
        _, gm_key = _create(client, gm_headers, {"books": "read"})
        mine = client.get("/api/api-keys", headers=player_headers).json()
        assert gm_key["id"] not in {k["id"] for k in mine}
        for method, path, body in (
            ("PATCH", f"/api/api-keys/{gm_key['id']}", {"name": "x"}),
            ("POST", f"/api/api-keys/{gm_key['id']}/regenerate", None),
            ("DELETE", f"/api/api-keys/{gm_key['id']}", None),
        ):
            resp = client.request(method, path, json=body, headers=player_headers)
            assert resp.status_code == 404, (method, path)

    def test_admins_list_and_revoke_everyones_keys(
        self, client, admin_headers, gm_headers, player_headers
    ):
        gm_secret, gm_key = _create(client, gm_headers, {"books": "read"})
        everyone = client.get("/api/api-keys?all=true", headers=admin_headers).json()
        row = next(k for k in everyone if k["id"] == gm_key["id"])
        assert row["username"] == "gmuser"
        # Only their own list, unless asked.
        own = client.get("/api/api-keys", headers=admin_headers).json()
        assert gm_key["id"] not in {k["id"] for k in own}
        assert client.get("/api/api-keys?all=true", headers=player_headers).status_code == 403

        # An admin can't mint a secret for someone else's key, but can revoke it.
        assert (
            client.post(
                f"/api/api-keys/{gm_key['id']}/regenerate", headers=admin_headers
            ).status_code
            == 404
        )
        assert (
            client.delete(f"/api/api-keys/{gm_key['id']}", headers=admin_headers).status_code
            == 204
        )
        assert client.get("/api/books", headers=_k(gm_secret)).status_code == 401

    def test_a_key_can_never_manage_keys(self, client, admin_headers):
        """Even a key holding every permission, and All permissions, at the top level."""
        levels = client.get("/api/api-keys/permissions", headers=admin_headers).json()
        everything = {p["id"]: p["levels"][-1] for p in levels}
        key, meta = _create(client, admin_headers, {**everything, "*": "write"})
        assert client.get("/api/api-keys", headers=_k(key)).status_code == 403
        assert (
            client.post("/api/api-keys", json={"name": "x"}, headers=_k(key)).status_code == 403
        )
        assert (
            client.post(f"/api/api-keys/{meta['id']}/regenerate", headers=_k(key)).status_code
            == 403
        )

    @pytest.mark.parametrize("role,is_key", [("guest", False), ("admin", True)])
    def test_session_guard_refuses_guests_and_keys(self, role, is_key):
        from fastapi import HTTPException

        from backend.auth import CurrentUser
        from backend.routers.api_keys._helpers import require_session_user

        principal = CurrentUser(
            id="u", username="u", role=role, api_key_id="k" if is_key else None
        )
        with pytest.raises(HTTPException) as exc:
            require_session_user(principal)
        assert exc.value.status_code == 403

    def test_keys_are_deleted_with_their_owner(self, client, admin_headers):
        user_id, headers = _user(client, admin_headers, "player")
        key, meta = _create(client, headers, {"books": "read"})
        assert client.delete(f"/api/users/{user_id}", headers=admin_headers).status_code == 204
        assert client.get("/api/books", headers=_k(key)).status_code == 401
        db = SessionLocal()
        try:
            assert db.query(ApiKey).filter_by(id=meta["id"]).first() is None
        finally:
            db.close()


class TestInstanceSwitch:
    """API_KEYS_ENABLED=false turns keys off for everyone, admins included."""

    def test_on_by_default_and_exposed_to_the_ui(self, client, player_headers):
        assert client.get("/api/settings/ui", headers=player_headers).json()["api_keys_enabled"]

    def test_off_refuses_every_key_and_endpoint(self, client, admin_headers, request):
        secret, meta = _create(client, admin_headers, {"books": "read"})
        request.getfixturevalue("keys_off")

        resp = client.get("/api/books", headers=_k(secret))
        assert resp.status_code == 403
        assert "disabled on this server" in resp.json()["detail"]
        for method, path, body in (
            ("GET", "/api/api-keys", None),
            ("GET", "/api/api-keys?all=true", None),
            ("GET", "/api/api-keys/permissions", None),
            ("POST", "/api/api-keys", {"name": "x"}),
            ("PATCH", f"/api/api-keys/{meta['id']}", {"name": "x"}),
            ("POST", f"/api/api-keys/{meta['id']}/regenerate", None),
            ("DELETE", f"/api/api-keys/{meta['id']}", None),
        ):
            resp = client.request(method, path, json=body, headers=admin_headers)
            assert resp.status_code == 403, (method, path)

        assert not client.get("/api/settings/ui", headers=admin_headers).json()[
            "api_keys_enabled"
        ]
        assert client.get("/api/auth/me", headers=admin_headers).json()[
            "api_keys_allowed"
        ] is False

    def test_settings_no_longer_carry_a_toggle(self, client, admin_headers):
        body = client.get("/api/settings", headers=admin_headers).json()
        assert "user_api_keys_enabled" not in body


class TestPerUserAccess:
    def test_off_by_default_for_new_users(self, client, admin_headers):
        user_id, headers = _user(client, admin_headers, "gm", keys=False)
        listed = client.get("/api/users", headers=admin_headers).json()
        assert next(u for u in listed if u["id"] == user_id)["api_keys_enabled"] is False
        assert client.get("/api/auth/me", headers=headers).json()["api_keys_allowed"] is False
        for method, path, body in (
            ("GET", "/api/api-keys", None),
            ("GET", "/api/api-keys/permissions", None),
            ("POST", "/api/api-keys", {"name": "x"}),
        ):
            resp = client.request(method, path, json=body, headers=headers)
            assert resp.status_code == 403, (method, path)
            assert "not enabled for your account" in resp.json()["detail"]

    def test_admins_always_may(self, client, admin_headers):
        me = client.get("/api/auth/me", headers=admin_headers).json()
        assert me["api_keys_allowed"] is True
        assert client.get("/api/api-keys", headers=admin_headers).status_code == 200

    def test_granting_and_revoking_access(self, client, admin_headers):
        user_id, headers = _user(client, admin_headers, "gm", keys=False)
        resp = client.patch(
            f"/api/users/{user_id}", json={"api_keys_enabled": True}, headers=admin_headers
        )
        assert resp.status_code == 200
        assert resp.json()["api_keys_enabled"] is True
        assert client.get("/api/auth/me", headers=headers).json()["api_keys_allowed"] is True
        secret, key = _create(client, headers, {"books": "read"})
        assert client.get("/api/books", headers=_k(secret)).status_code == 200

        # Taking access away stops the key; an admin can still see and revoke it.
        client.patch(
            f"/api/users/{user_id}", json={"api_keys_enabled": False}, headers=admin_headers
        )
        resp = client.get("/api/books", headers=_k(secret))
        assert resp.status_code == 403
        assert "not enabled for your account" in resp.json()["detail"]
        assert client.delete(f"/api/api-keys/{key['id']}", headers=headers).status_code == 403
        everyone = client.get("/api/api-keys?all=true", headers=admin_headers).json()
        assert key["id"] in {k["id"] for k in everyone}
        assert (
            client.delete(f"/api/api-keys/{key['id']}", headers=admin_headers).status_code
            == 204
        )

    def test_login_payload_says_whether_keys_are_allowed(self, client, admin_headers):
        username = f"key-login-{uuid.uuid4().hex[:6]}"
        client.post(
            "/api/users",
            json={
                "username": username,
                "password": "keyuserpass1",
                "role": "player",
                "api_keys_enabled": True,
            },
            headers=admin_headers,
        )
        body = client.post(
            "/api/auth/login", json={"username": username, "password": "keyuserpass1"}
        ).json()
        client.cookies.clear()
        assert body["user"]["api_keys_allowed"] is True

    def test_guests_never_hold_keys(self):
        class Guest:
            role = "guest"
            api_keys_enabled = True

        class Unknown:
            role = "nonsense"
            api_keys_enabled = True

        assert api_keys.user_keys_allowed(Guest()) is False
        assert api_keys.user_keys_allowed(Unknown()) is False
        assert api_keys.user_keys_allowed(None) is False


# ---------------------------------------------------------------------------
# Using keys
# ---------------------------------------------------------------------------


class TestKeyAuthentication:
    def test_unknown_key_is_401(self, client):
        resp = client.get("/api/books", headers=_k("grim_not-a-real-key"))
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid API key"

    def test_read_allows_get_and_rejects_writes(self, client, admin_headers):
        system = make_game_system()
        book = make_book(system.id)
        key, _ = _create(client, admin_headers, {"books": "read"})

        assert client.get("/api/books", headers=_k(key)).status_code == 200
        assert client.get(f"/api/books/{book.id}", headers=_k(key)).status_code == 200

        resp = client.patch(f"/api/books/{book.id}", json={"title": "x"}, headers=_k(key))
        assert resp.status_code == 403
        detail = resp.json()["detail"]
        assert "'write'" in detail and "'books'" in detail

    def test_read_allows_the_marked_read_only_posts(self, client, admin_headers):
        system = make_game_system()
        book = make_book(system.id)
        key, _ = _create(client, admin_headers, {"books": "read", "systems": "read"})
        body = {"source_id": "no-such-source", "candidate_id": "x"}
        for path in (
            f"/api/books/{book.id}/metadata-search",
            f"/api/books/{book.id}/metadata-fetch",
            f"/api/systems/{system.id}/metadata-search",
            f"/api/systems/{system.id}/metadata-fetch",
        ):
            resp = client.post(path, json=body, headers=_k(key))
            # Past the key check: whatever the handler makes of an unknown
            # source, it is not an auth refusal.
            assert resp.status_code not in (401, 403), (path, resp.text)

    def test_read_and_write_allows_every_method(self, client, admin_headers):
        system = make_game_system()
        book = make_book(system.id)
        key, _ = _create(client, admin_headers, {"books": "write", "lookups": "write"})

        resp = client.patch(f"/api/books/{book.id}", json={"title": "By key"}, headers=_k(key))
        assert resp.status_code == 200, resp.text
        assert client.get(f"/api/books/{book.id}", headers=_k(key)).json()["title"] == "By key"

        genre = client.post(
            "/api/genres", json={"name": f"g-{uuid.uuid4().hex[:6]}"}, headers=_k(key)
        )
        assert genre.status_code in (200, 201), genre.text
        gid = genre.json()["id"]
        assert client.delete(f"/api/genres/{gid}", headers=_k(key)).status_code in (200, 204)

    def test_no_access_is_rejected(self, client, admin_headers):
        key, _ = _create(client, admin_headers, {"books": "read"})
        resp = client.get("/api/maps", headers=_k(key))
        assert resp.status_code == 403
        assert "'maps'" in resp.json()["detail"]

    @pytest.mark.parametrize(
        "method,path",
        [
            ("GET", "/api/auth/me"),
            ("GET", "/api/auth/sessions"),
            ("GET", "/api/api-keys"),
            ("POST", "/api/api-keys"),
            ("GET", "/api/users/me/opds"),
            ("PATCH", "/api/users/me/password"),
            ("GET", "/api/campaigns/calendar/subscription"),
        ],
    )
    def test_security_routes_reject_every_key(self, client, admin_headers, method, path):
        levels = client.get("/api/api-keys/permissions", headers=admin_headers).json()
        perms = {p["id"]: p["levels"][-1] for p in levels}
        key, _ = _create(client, admin_headers, {**perms, "*": "write"})
        resp = client.request(method, path, headers=_k(key))
        assert resp.status_code == 403, (path, resp.status_code)

    def test_a_key_acts_as_its_owner(self, client, player_headers):
        """Personal data is the owner's: a key reads and writes their favourites."""
        system = make_game_system()
        key, _ = _create(client, player_headers, {"personal": "write"})
        resp = client.post(
            "/api/favorites",
            json={"item_type": "system", "item_id": system.id},
            headers=_k(key),
        )
        assert resp.status_code in (200, 201), resp.text
        mine = client.get("/api/favorites", headers=player_headers).json()
        assert system.id in str(mine)

    def test_the_owners_role_still_applies(self, client, player_headers):
        """All permissions can't lift a player past what a player may do."""
        system = make_game_system()
        book = make_book(system.id)
        key, _ = _create(client, player_headers, {"*": "write"})
        assert client.get(f"/api/books/{book.id}", headers=_k(key)).status_code == 200
        resp = client.patch(f"/api/books/{book.id}", json={"title": "x"}, headers=_k(key))
        assert resp.status_code == 403
        assert client.get("/api/logs", headers=_k(key)).status_code == 403

    def test_a_demoted_owners_key_loses_the_role(self, client, admin_headers):
        system = make_game_system()
        book = make_book(system.id)
        user_id, headers = _user(client, admin_headers, "gm")
        key, _ = _create(client, headers, {"books": "write"})
        resp = client.patch(f"/api/books/{book.id}", json={"title": "gm"}, headers=_k(key))
        assert resp.status_code == 200, resp.text
        client.patch(f"/api/users/{user_id}", json={"role": "player"}, headers=admin_headers)
        resp = client.patch(f"/api/books/{book.id}", json={"title": "no"}, headers=_k(key))
        assert resp.status_code == 403

    @pytest.mark.parametrize(
        "perm,path",
        [
            ("users", "/api/users"),
            ("settings", "/api/settings"),
            ("settings", "/api/settings/ui"),
            ("addons", "/api/addons"),
            ("maintenance", "/api/maintenance/sidecars/settings"),
            ("campaigns", "/api/campaigns"),
            ("personal", "/api/themes"),
        ],
    )
    def test_areas_open_with_their_permission(self, client, admin_headers, perm, path):
        key, _ = _create(client, admin_headers, {perm: "read"})
        assert client.get(path, headers=_k(key)).status_code == 200, path
        other, _ = _create(client, admin_headers, {"stats": "read"})
        assert client.get(path, headers=_k(other)).status_code == 403, path

    def test_all_permissions_reaches_every_area(self, client, admin_headers):
        key, meta = _create(client, admin_headers, {"*": "read"})
        assert meta["permissions"] == {"*": "read"}
        for path in ("/api/stats", "/api/books", "/api/maps", "/api/users", "/api/logs"):
            assert client.get(path, headers=_k(key)).status_code == 200, path
        # Read only: writes are still refused, and the message names the area.
        resp = client.post("/api/genres", json={"name": "nope"}, headers=_k(key))
        assert resp.status_code == 403
        assert "'lookups'" in resp.json()["detail"]

    def test_all_permissions_write_allows_writes(self, client, admin_headers):
        key, _ = _create(client, admin_headers, {"*": "write"})
        genre = client.post(
            "/api/genres", json={"name": f"g-{uuid.uuid4().hex[:6]}"}, headers=_k(key)
        )
        assert genre.status_code in (200, 201), genre.text

    def test_explicit_level_can_exceed_all_permissions(self, client, admin_headers):
        key, _ = _create(client, admin_headers, {"*": "read", "lookups": "write"})
        genre = client.post(
            "/api/genres", json={"name": f"g-{uuid.uuid4().hex[:6]}"}, headers=_k(key)
        )
        assert genre.status_code in (200, 201), genre.text
        assert client.post("/api/books/bulk", json={}, headers=_k(key)).status_code == 403

    def test_revoked_and_expired_keys_are_rejected(self, client, admin_headers):
        key, meta = _create(client, admin_headers, {"stats": "read"})
        db = SessionLocal()
        try:
            row = db.query(ApiKey).filter_by(id=meta["id"]).one()
            row.expires_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
                seconds=1
            )
            db.commit()
        finally:
            db.close()
        resp = client.get("/api/stats", headers=_k(key))
        assert resp.status_code == 401
        assert "expired" in resp.json()["detail"]
        listed = client.get("/api/api-keys", headers=admin_headers).json()
        assert next(k for k in listed if k["id"] == meta["id"])["expired"] is True

    def test_unexpired_key_works(self, client, admin_headers):
        future = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=90)
        key, meta = _create(
            client, admin_headers, {"stats": "read"}, expires_at=future.isoformat()
        )
        assert meta["expired"] is False
        assert client.get("/api/stats", headers=_k(key)).status_code == 200

    def test_last_used_at_is_recorded_and_throttled(self, client, admin_headers):
        key, meta = _create(client, admin_headers, {"stats": "read"})
        assert meta["last_used_at"] is None

        def last_used():
            db = SessionLocal()
            try:
                return db.query(ApiKey).filter_by(id=meta["id"]).one().last_used_at
            finally:
                db.close()

        client.get("/api/stats", headers=_k(key))
        first = last_used()
        assert first is not None
        client.get("/api/stats", headers=_k(key))
        assert last_used() == first, "a second use within the throttle window wrote again"

        # Once the window has passed, the next use is recorded.
        db = SessionLocal()
        try:
            row = db.query(ApiKey).filter_by(id=meta["id"]).one()
            row.last_used_at = first - datetime.timedelta(minutes=5)
            db.commit()
        finally:
            db.close()
        client.get("/api/stats", headers=_k(key))
        assert last_used() > first - datetime.timedelta(minutes=5)

    def test_key_wins_over_a_session(self, client, admin_headers):
        """Presenting a key holds the request to the key's permissions."""
        key, _ = _create(client, admin_headers, {"stats": "read"})
        resp = client.get("/api/books", headers={**admin_headers, **_k(key)})
        assert resp.status_code == 403

    def test_stats_counts_as_the_owner(self, client, admin_headers, player_headers):
        admin_key, _ = _create(client, admin_headers, {"stats": "read"})
        by_key = client.get("/api/stats", headers=_k(admin_key))
        assert by_key.status_code == 200
        assert by_key.json() == client.get("/api/stats", headers=admin_headers).json()
        player_key, _ = _create(client, player_headers, {"stats": "read"})
        assert (
            client.get("/api/stats", headers=_k(player_key)).json()
            == client.get("/api/stats", headers=player_headers).json()
        )

    def test_legacy_unprefixed_key_authenticates(self, client, admin_id):
        """Keys migrated from the old stats key have no grim_ prefix."""
        legacy = f"an-old-token-urlsafe-value-{uuid.uuid4().hex}"
        db = SessionLocal()
        try:
            db.add(
                ApiKey(
                    user_id=admin_id,
                    name="Stats API key (migrated)",
                    prefix=legacy[:4],
                    key_hash=api_keys.hash_key(legacy),
                    permissions={"stats": "read"},
                )
            )
            db.commit()
        finally:
            db.close()
        assert client.get("/api/stats", headers=_k(legacy)).status_code == 200
        assert client.get("/api/books", headers=_k(legacy)).status_code == 403

    def test_cleanup_rides_the_library_permission(self, client, admin_headers):
        no, _ = _create(client, admin_headers, {"library": "read"})
        yes, _ = _create(client, admin_headers, {"library": "write"})
        assert client.post("/api/maintenance/cleanup-missing", headers=_k(no)).status_code == 403
        resp = client.post("/api/maintenance/cleanup-missing", headers=_k(yes))
        assert resp.status_code == 200, resp.text

    def test_admin_only_areas_work_for_an_admins_key(self, client, admin_headers):
        key, _ = _create(client, admin_headers, {"logs": "read", "backups": "read"})
        assert client.get("/api/logs", headers=_k(key)).status_code == 200
        assert client.get("/api/backups", headers=_k(key)).status_code == 200


# ---------------------------------------------------------------------------
# Campaigns: a key sees what its owner sees
# ---------------------------------------------------------------------------


class TestKeyInCampaigns:
    def _campaign(self, client, gm_headers):
        resp = client.post(
            "/api/campaigns",
            json={"name": f"Keyed {uuid.uuid4().hex[:6]}", "is_gm_campaign": True},
            headers=gm_headers,
        )
        assert resp.status_code in (200, 201), resp.text
        return resp.json()["id"]

    def test_lists_only_the_owners_campaigns(self, client, gm_headers, player_headers):
        cid = self._campaign(client, gm_headers)
        gm_key, _ = _create(client, gm_headers, {"campaigns": "read"})
        player_key, _ = _create(client, player_headers, {"campaigns": "read"})
        assert cid in {c["id"] for c in client.get("/api/campaigns", headers=_k(gm_key)).json()}
        listed = client.get("/api/campaigns", headers=_k(player_key)).json()
        assert cid not in {c["id"] for c in listed}
        assert client.get(f"/api/campaigns/{cid}", headers=_k(player_key)).status_code == 403

    def test_owner_key_reads_and_writes(self, client, gm_headers):
        cid = self._campaign(client, gm_headers)
        reader, _ = _create(client, gm_headers, {"campaigns": "read"})
        assert client.get(f"/api/campaigns/{cid}/wiki", headers=_k(reader)).status_code == 200
        assert (
            client.post(
                f"/api/campaigns/{cid}/wiki", json={"title": "Nope"}, headers=_k(reader)
            ).status_code
            == 403
        )

        writer, _ = _create(client, gm_headers, {"campaigns": "write"})
        resp = client.post(
            f"/api/campaigns/{cid}/wiki", json={"title": "From a key"}, headers=_k(writer)
        )
        assert resp.status_code in (200, 201), resp.text
        pages = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        assert next(p for p in pages if p["id"] == resp.json()["id"])["is_mine"] is True

    def test_created_campaign_belongs_to_the_keys_owner(self, client, gm_headers, gm_id):
        key, _ = _create(client, gm_headers, {"campaigns": "write"})
        resp = client.post(
            "/api/campaigns",
            json={"name": f"By key {uuid.uuid4().hex[:6]}", "is_gm_campaign": True},
            headers=_k(key),
        )
        assert resp.status_code in (200, 201), resp.text
        assert resp.json()["owner_id"] == gm_id
