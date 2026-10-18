"""Creating and managing share links, and the permission surfaces (issue #541)."""
from backend import config, token_vault
from backend.config import SessionLocal
from backend.models import ShareLink, User
from backend.tests.conftest import make_map, make_token
from backend.tests.share_link_helpers import (
    create,
    png,
    set_override,
    set_role_default,
)

# The share-link fixtures (shared_map, and the autouse fixture that puts the
# session users' permissions back) live in a plugin, not in conftest, so they
# only run for these tests.
pytest_plugins = ["backend.tests.share_link_helpers"]


class TestCreate:
    def test_gm_creates_a_link(self, client, gm_headers, shared_map):
        r = create(client, gm_headers, "map", shared_map.id, label="Session 4")
        assert r.status_code == 200, r.text
        link = r.json()
        assert link["state"] == "active"
        assert link["label"] == "Session 4"
        assert link["resource_name"] == "Old Tavern"
        assert "/share/" in link["url"]
        # The direct URL ends in the served file's name and extension.
        assert link["file_url"].endswith("/old-tavern.png")
        assert link["has_password"] is False
        assert link["expires_at"] is None

    def test_expiry_and_password(self, client, gm_headers, shared_map):
        link = create(
            client, gm_headers, "map", shared_map.id, expires_in_days=7, password="hunter2"
        ).json()
        assert link["expires_at"] is not None
        assert link["has_password"] is True

    def test_short_password_rejected(self, client, gm_headers, shared_map):
        assert create(client, gm_headers, "map", shared_map.id, password="abc").status_code == 422

    def test_player_refused_by_default(self, client, player_headers, shared_map):
        r = create(client, player_headers, "map", shared_map.id)
        assert r.status_code == 403

    def test_player_allowed_once_the_role_is(self, client, player_headers, shared_map):
        set_role_default("player", True)
        assert create(client, player_headers, "map", shared_map.id).status_code == 200

    def test_override_allows_one_player(self, client, player_headers, player_id, shared_map):
        set_override(player_id, True)
        assert create(client, player_headers, "map", shared_map.id).status_code == 200

    def test_override_denies_one_gm(self, client, gm_headers, gm_id, shared_map):
        set_override(gm_id, False)
        assert create(client, gm_headers, "map", shared_map.id).status_code == 403

    def test_cannot_share_what_you_cannot_read(self, client, gm_headers, gm_id, tmp_path):
        token = make_token(filepath=png(tmp_path / "t.png"), filename="t.png", is_explicit=True)
        db = SessionLocal()
        db.query(User).filter_by(id=gm_id).update({"allow_explicit": False})
        db.commit()
        db.close()
        assert create(client, gm_headers, "token", token.id).status_code == 403

    def test_unknown_item_is_404(self, client, gm_headers):
        assert create(client, gm_headers, "map", "nope").status_code == 404

    def test_missing_file_is_404(self, client, gm_headers):
        m = make_map(filepath="/nonexistent/x.png")
        assert create(client, gm_headers, "map", m.id).status_code == 404

    def test_unsupported_type_is_422(self, client, gm_headers):
        assert create(client, gm_headers, "campaign", "x").status_code == 422

    def test_refused_when_instance_switch_is_off(self, client, gm_headers, shared_map, monkeypatch):
        monkeypatch.setattr(config, "SHARE_LINKS_ENABLED", False)
        r = create(client, gm_headers, "map", shared_map.id)
        assert r.status_code == 403
        assert "turned off" in r.json()["detail"]


class TestManage:
    def test_lists_my_links_with_filters(self, client, gm_headers, shared_map, tmp_path):
        other = make_map(filepath=png(tmp_path / "o.png"), filename="o.png")
        create(client, gm_headers, "map", shared_map.id)
        create(client, gm_headers, "map", other.id)
        mine = client.get(
            "/api/share-links",
            params={"resource_type": "map", "resource_id": shared_map.id},
            headers=gm_headers,
        ).json()
        assert {link["resource_id"] for link in mine} == {shared_map.id}

    def test_others_do_not_see_or_touch_my_links(
        self, client, gm_headers, player_headers, player_id, shared_map
    ):
        link = create(client, gm_headers, "map", shared_map.id).json()
        set_override(player_id, True)
        listed = client.get("/api/share-links", headers=player_headers).json()
        assert link["id"] not in {item["id"] for item in listed}
        assert (
            client.post(f"/api/share-links/{link['id']}/revoke", headers=player_headers).status_code
            == 404
        )
        assert client.delete(f"/api/share-links/{link['id']}", headers=player_headers).status_code == 404

    def test_update_label_expiry_and_password(self, client, gm_headers, shared_map):
        link = create(client, gm_headers, "map", shared_map.id, expires_in_days=1).json()
        r = client.patch(
            f"/api/share-links/{link['id']}",
            json={"label": " Renamed ", "expires_in_days": None, "password": "s3cret!"},
            headers=gm_headers,
        )
        body = r.json()
        assert body["label"] == "Renamed"
        assert body["expires_at"] is None
        assert body["has_password"] is True
        cleared = client.patch(
            f"/api/share-links/{link['id']}", json={"password": ""}, headers=gm_headers
        ).json()
        assert cleared["has_password"] is False

    def test_update_rejects_a_short_password(self, client, gm_headers, shared_map):
        link = create(client, gm_headers, "map", shared_map.id).json()
        r = client.patch(f"/api/share-links/{link['id']}", json={"password": "ab"}, headers=gm_headers)
        assert r.status_code == 422

    def test_update_leaves_unsent_fields(self, client, gm_headers, shared_map):
        link = create(client, gm_headers, "map", shared_map.id, label="Keep", expires_in_days=3).json()
        body = client.patch(
            f"/api/share-links/{link['id']}", json={"password": "abcd"}, headers=gm_headers
        ).json()
        assert body["label"] == "Keep"
        assert body["expires_at"] == link["expires_at"]

    def test_revoke_keeps_the_link_listed(self, client, gm_headers, shared_map):
        link = create(client, gm_headers, "map", shared_map.id).json()
        revoked = client.post(f"/api/share-links/{link['id']}/revoke", headers=gm_headers).json()
        assert revoked["state"] == "revoked"
        assert revoked["revoked_at"] is not None
        # Revoking twice is harmless and keeps the first time.
        again = client.post(f"/api/share-links/{link['id']}/revoke", headers=gm_headers).json()
        assert again["revoked_at"] == revoked["revoked_at"]
        # A revoked link cannot be edited back to life.
        r = client.patch(f"/api/share-links/{link['id']}", json={"label": "x"}, headers=gm_headers)
        assert r.status_code == 400

    def test_delete(self, client, gm_headers, shared_map):
        link = create(client, gm_headers, "map", shared_map.id).json()
        assert client.delete(f"/api/share-links/{link['id']}", headers=gm_headers).json() == {
            "status": "deleted"
        }
        db = SessionLocal()
        assert db.query(ShareLink).filter_by(id=link["id"]).first() is None
        db.close()

    def test_user_without_permission_can_still_list_and_revoke(
        self, client, gm_headers, gm_id, shared_map
    ):
        link = create(client, gm_headers, "map", shared_map.id).json()
        set_override(gm_id, False)
        listed = {item["id"]: item for item in client.get("/api/share-links", headers=gm_headers).json()}
        # Suspended, not deleted - it comes back if the permission does.
        assert listed[link["id"]]["state"] == "suspended"
        r = client.post(f"/api/share-links/{link['id']}/revoke", headers=gm_headers)
        assert r.status_code == 200


class TestAdmin:
    def test_admin_lists_a_users_links_and_revokes_them(
        self, client, admin_headers, gm_headers, gm_id, shared_map
    ):
        link = create(client, gm_headers, "map", shared_map.id).json()
        listed = client.get(f"/api/share-links/users/{gm_id}", headers=admin_headers).json()
        mine = next(item for item in listed if item["id"] == link["id"])
        assert mine["user_id"] == gm_id
        assert mine["username"]
        revoked = client.post(f"/api/share-links/{link['id']}/revoke", headers=admin_headers).json()
        assert revoked["state"] == "revoked"
        assert revoked["user_id"] == gm_id

    def test_admin_lists_everything(self, client, admin_headers, gm_headers, shared_map):
        link = create(client, gm_headers, "map", shared_map.id).json()
        listed = client.get("/api/share-links/all", headers=admin_headers).json()
        assert link["id"] in {item["id"] for item in listed}

    def test_admin_listings_are_admin_only(self, client, gm_headers, gm_id):
        assert client.get("/api/share-links/all", headers=gm_headers).status_code == 403
        assert client.get(f"/api/share-links/users/{gm_id}", headers=gm_headers).status_code == 403

    def test_deleting_a_user_deletes_their_links(self, client, admin_headers, tmp_path):
        r = client.post(
            "/api/users",
            json={"username": "sharer-to-delete", "password": "password123", "role": "gm"},
            headers=admin_headers,
        )
        uid = r.json()["id"]
        db = SessionLocal()
        m = make_map(filepath=png(tmp_path / "d.png"), filename="d.png")
        db.add(
            ShareLink(
                token_hash=token_vault.lookup_hash("tok-delete-me"),
                token_sealed=token_vault.seal("tok-delete-me"),
                user_id=uid,
                resource_type="map",
                resource_id=m.id,
            )
        )
        db.commit()
        db.close()
        assert client.delete(f"/api/users/{uid}", headers=admin_headers).status_code == 204
        db = SessionLocal()
        assert db.query(ShareLink).filter_by(user_id=uid).first() is None
        db.close()


class TestPermissionSurfaces:
    def test_permission_endpoint(self, client, gm_headers, player_headers, player_id):
        gm = client.get("/api/share-links/permission", headers=gm_headers).json()
        assert gm == {
            "enabled": True,
            "allowed": True,
            "source": "role",
            "override": "role",
            "role_allows": True,
        }
        set_override(player_id, True)
        player = client.get("/api/share-links/permission", headers=player_headers).json()
        assert player["allowed"] is True
        assert player["source"] == "user"

    def test_auth_me_reports_it(self, client, gm_headers, player_headers):
        assert client.get("/api/auth/me", headers=gm_headers).json()["share_links_allowed"] is True
        assert client.get("/api/auth/me", headers=player_headers).json()["share_links_allowed"] is False

    def test_users_api_shows_and_sets_the_override(self, client, admin_headers, gm_id, player_id):
        users = {u["id"]: u for u in client.get("/api/users", headers=admin_headers).json()}
        # A GM with no override of their own: allowed, and it says so by role.
        assert users[gm_id]["share_links"] == "role"
        assert users[gm_id]["share_links_allowed"] is True
        assert users[gm_id]["share_links_source"] == "role"
        r = client.patch(f"/api/users/{player_id}", json={"share_links": "allow"}, headers=admin_headers)
        body = r.json()
        assert body["share_links"] == "allow"
        assert body["share_links_allowed"] is True
        assert body["share_links_source"] == "user"
        back = client.patch(
            f"/api/users/{player_id}", json={"share_links": "role"}, headers=admin_headers
        ).json()
        assert back["share_links_allowed"] is False

    def test_users_api_rejects_a_bad_override(self, client, admin_headers, player_id):
        r = client.patch(f"/api/users/{player_id}", json={"share_links": "maybe"}, headers=admin_headers)
        assert r.status_code == 422

    def test_create_user_with_an_override(self, client, admin_headers):
        r = client.post(
            "/api/users",
            json={
                "username": "sharing-player",
                "password": "password123",
                "role": "player",
                "share_links": "allow",
            },
            headers=admin_headers,
        )
        assert r.json()["share_links_allowed"] is True

    def test_settings_role_defaults(self, client, admin_headers):
        settings = client.get("/api/settings", headers=admin_headers).json()
        assert settings["share_links_enabled"] is True
        assert settings["share_links_role_gm"] is True
        assert settings["share_links_role_player"] is False
        updated = client.patch(
            "/api/settings",
            json={"share_links_role_player": True, "share_links_role_gm": False},
            headers=admin_headers,
        ).json()
        assert updated["share_links_role_player"] is True
        assert updated["share_links_role_gm"] is False

    def test_ui_settings_expose_the_switch(self, client, player_headers, monkeypatch):
        assert client.get("/api/settings/ui", headers=player_headers).json()["share_links_enabled"] is True
        monkeypatch.setattr(config, "SHARE_LINKS_ENABLED", False)
        assert client.get("/api/settings/ui", headers=player_headers).json()["share_links_enabled"] is False


class TestTokenAtRest:
    """The link's token is never stored as itself (issue #583)."""

    def _row(self, link_id):
        db = SessionLocal()
        try:
            row = db.query(ShareLink).filter_by(id=link_id).one()
            return row.token_hash, row.token_sealed
        finally:
            db.close()

    def test_the_database_holds_no_usable_token(self, client, gm_headers, shared_map):
        link = create(client, gm_headers, "map", shared_map.id).json()
        token = link["url"].rsplit("/", 1)[1]
        token_hash, sealed = self._row(link["id"])
        assert token not in (token_hash, sealed)
        assert token not in sealed
        # The link works by its real token...
        assert client.get(f"/api/share/{token}/meta").status_code == 200
        # ...and a value lifted from the database does not.
        for stolen in (token_hash, sealed):
            assert client.get(f"/api/share/{stolen}/meta").status_code == 404
            assert client.get(f"/api/share/{stolen}").status_code == 404

    def test_the_owner_can_still_copy_it(self, client, gm_headers, shared_map):
        link = create(client, gm_headers, "map", shared_map.id).json()
        listed = client.get("/api/share-links", headers=gm_headers).json()
        again = next(item for item in listed if item["id"] == link["id"])
        assert again["url"] == link["url"]
        assert again["file_url"] == link["file_url"]

    def test_a_changed_secret_key_reads_as_lost(self, client, gm_headers, shared_map, monkeypatch):
        link = create(client, gm_headers, "map", shared_map.id).json()
        token = link["url"].rsplit("/", 1)[1]
        # The key tokens are sealed under, not the session one, so the GM stays
        # signed in - as after restoring links sealed under an earlier SECRET_KEY.
        monkeypatch.setattr(token_vault, "_secret", lambda: "a-different-secret")
        listed = client.get("/api/share-links", headers=gm_headers).json()
        lost = next(item for item in listed if item["id"] == link["id"])
        assert lost["state"] == "lost"
        assert lost["url"] is None and lost["file_url"] is None
        assert client.get(f"/api/share/{token}/meta").status_code == 404

    def test_a_revoked_link_stays_revoked_when_lost(
        self, client, gm_headers, shared_map, monkeypatch
    ):
        link = create(client, gm_headers, "map", shared_map.id).json()
        revoke = client.post(f"/api/share-links/{link['id']}/revoke", headers=gm_headers)
        assert revoke.status_code == 200, revoke.text
        # The key tokens are sealed under, not the session one, so the GM stays
        # signed in - as after restoring links sealed under an earlier SECRET_KEY.
        monkeypatch.setattr(token_vault, "_secret", lambda: "a-different-secret")
        listed = client.get("/api/share-links", headers=gm_headers).json()
        assert next(i for i in listed if i["id"] == link["id"])["state"] == "revoked"

    def test_the_unlock_cookie_is_scoped_to_the_real_token(
        self, client, gm_headers, shared_map
    ):
        link = create(client, gm_headers, "map", shared_map.id, password="hunter22").json()
        token = link["url"].rsplit("/", 1)[1]
        r = client.post(f"/api/share/{token}/unlock", json={"password": "hunter22"})
        assert r.status_code == 200
        assert f"Path=/api/share/{token}" in r.headers["set-cookie"]
