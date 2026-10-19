"""Tests for the user-email field (admin endpoints + self-service)."""


# ---------------------------------------------------------------------------
# Admin: create / list / update with email
# ---------------------------------------------------------------------------


class TestAdminEmail:
    def test_create_user_with_email(self, client, admin_headers):
        resp = client.post(
            "/api/users",
            headers=admin_headers,
            json={
                "username": "email_user_a",
                "password": "password123-long",
                "email": "Foo@Example.COM",
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        # Email is normalized to lowercase
        assert body["email"] == "foo@example.com"

        # And it shows up in the list
        listing = client.get("/api/users", headers=admin_headers).json()
        match = next((u for u in listing if u["username"] == "email_user_a"), None)
        assert match is not None
        assert match["email"] == "foo@example.com"

        # Cleanup
        client.delete(f"/api/users/{body['id']}", headers=admin_headers)

    def test_create_user_without_email_is_allowed(self, client, admin_headers):
        resp = client.post(
            "/api/users",
            headers=admin_headers,
            json={"username": "email_user_b", "password": "password123-long"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["email"] is None
        client.delete(f"/api/users/{body['id']}", headers=admin_headers)

    def test_create_user_invalid_email_rejected(self, client, admin_headers):
        resp = client.post(
            "/api/users",
            headers=admin_headers,
            json={"username": "email_user_c", "password": "password123-long", "email": "not-an-email"},
        )
        assert resp.status_code == 422

    def test_email_uniqueness(self, client, admin_headers):
        a = client.post(
            "/api/users",
            headers=admin_headers,
            json={
                "username": "email_user_d",
                "password": "password123-long",
                "email": "dupe@example.com",
            },
        )
        assert a.status_code == 201
        a_id = a.json()["id"]

        b = client.post(
            "/api/users",
            headers=admin_headers,
            json={
                "username": "email_user_e",
                "password": "password123-long",
                "email": "DUPE@example.com",  # case-insensitive collision
            },
        )
        assert b.status_code == 400
        assert "email" in b.json()["detail"].lower()

        client.delete(f"/api/users/{a_id}", headers=admin_headers)

    def test_update_email(self, client, admin_headers):
        a = client.post(
            "/api/users",
            headers=admin_headers,
            json={"username": "email_user_f", "password": "password123-long"},
        )
        uid = a.json()["id"]

        # Set
        resp = client.patch(
            f"/api/users/{uid}",
            headers=admin_headers,
            json={"email": "set@example.com"},
        )
        assert resp.status_code == 200
        assert resp.json()["email"] == "set@example.com"

        # Clear with empty string
        resp = client.patch(
            f"/api/users/{uid}",
            headers=admin_headers,
            json={"email": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["email"] is None

        client.delete(f"/api/users/{uid}", headers=admin_headers)


# ---------------------------------------------------------------------------
# Self-service: a user can set their own email via /users/me/preferences
# ---------------------------------------------------------------------------


class TestSelfEmail:
    def test_update_own_email(self, client, gm_headers):
        resp = client.patch(
            "/api/users/me/preferences",
            headers=gm_headers,
            json={"email": "Self@Example.COM"},
        )
        assert resp.status_code == 200
        assert resp.json()["email"] == "self@example.com"

        # /me reflects the new email
        me = client.get("/api/auth/me", headers=gm_headers).json()
        assert me["email"] == "self@example.com"

        # Clear
        resp = client.patch(
            "/api/users/me/preferences",
            headers=gm_headers,
            json={"email": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["email"] is None

    def test_self_cannot_take_anothers_email(self, client, admin_headers, gm_headers):
        # Admin claims an email
        client.patch(
            "/api/users/me/preferences",
            headers=admin_headers,
            json={"email": "claimed@example.com"},
        )
        # GM tries the same → 400
        resp = client.patch(
            "/api/users/me/preferences",
            headers=gm_headers,
            json={"email": "CLAIMED@example.com"},
        )
        assert resp.status_code == 400
        # Cleanup admin email
        client.patch(
            "/api/users/me/preferences",
            headers=admin_headers,
            json={"email": ""},
        )


class TestSelfEmailRestrictions:
    def test_email_is_admin_managed_while_sso_matches_by_email(
        self, client, admin_headers, gm_headers, gm_id
    ):
        client.patch("/api/settings", headers=admin_headers, json={"oidc_match_by": "email"})
        try:
            resp = client.patch(
                "/api/users/me/preferences", headers=gm_headers, json={"email": "gm@example.com"}
            )
            assert resp.status_code == 403
            # Other preferences still save, and resending the current email is fine.
            resp = client.patch(
                "/api/users/me/preferences", headers=gm_headers, json={"display_name": "GM"}
            )
            assert resp.status_code == 200
            # An admin can still set it.
            resp = client.patch(
                f"/api/users/{gm_id}", headers=admin_headers, json={"email": "gm@example.com"}
            )
            assert resp.status_code == 200
        finally:
            client.patch("/api/settings", headers=admin_headers, json={"oidc_match_by": "none"})
            client.patch(f"/api/users/{gm_id}", headers=admin_headers, json={"email": ""})
            client.patch("/api/users/me/preferences", headers=gm_headers, json={"display_name": ""})

    def test_guest_accounts_cannot_set_an_email(self, client):
        from backend.auth import create_token
        from backend.config import SessionLocal
        from backend.models import User

        db = SessionLocal()
        guest = User(username="guest_email_check", role="guest", is_guest=True, hashed_password=None)
        db.add(guest)
        db.commit()
        token = create_token(guest.id, guest.username, "guest")
        try:
            resp = client.patch(
                "/api/users/me/preferences",
                headers={"Authorization": f"Bearer {token}"},
                json={"email": "guest@example.com"},
            )
            assert resp.status_code == 403
        finally:
            db.delete(guest)
            db.commit()
            db.close()
