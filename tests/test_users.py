"""Tests for user management endpoints."""
import uuid
import pytest


def unique_user():
    return f"user_{uuid.uuid4().hex[:8]}"


class TestListUsers:
    def test_admin_can_list_users(self, client, admin_headers):
        resp = client.get("/api/users", headers=admin_headers)
        assert resp.status_code == 200
        users = resp.json()
        assert isinstance(users, list)
        usernames = [u["username"] for u in users]
        assert "admin" in usernames

    def test_gm_cannot_list_users(self, client, gm_headers):
        resp = client.get("/api/users", headers=gm_headers)
        assert resp.status_code == 403

    def test_player_cannot_list_users(self, client, player_headers):
        resp = client.get("/api/users", headers=player_headers)
        assert resp.status_code == 403

    def test_unauthenticated_cannot_list_users(self, client):
        resp = client.get("/api/users")
        assert resp.status_code == 401

    def test_user_response_shape(self, client, admin_headers):
        resp = client.get("/api/users", headers=admin_headers)
        assert resp.status_code == 200
        user = resp.json()[0]
        assert "id" in user
        assert "username" in user
        assert "role" in user
        assert "created_at" in user
        assert "hashed_password" not in user


class TestCreateUser:
    def test_admin_creates_player(self, client, admin_headers):
        username = unique_user()
        resp = client.post(
            "/api/users",
            json={
                "username": username,
                "password": "validpass123",
                "role": "player",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["username"] == username
        assert body["role"] == "player"
        assert "id" in body

    def test_admin_creates_gm(self, client, admin_headers):
        username = unique_user()
        resp = client.post(
            "/api/users",
            json={
                "username": username,
                "password": "validpass123",
                "role": "gm",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["role"] == "gm"

    def test_admin_creates_another_admin(self, client, admin_headers):
        username = unique_user()
        resp = client.post(
            "/api/users",
            json={
                "username": username,
                "password": "validpass123",
                "role": "admin",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["role"] == "admin"

    def test_duplicate_username_rejected(self, client, admin_headers):
        username = unique_user()
        client.post(
            "/api/users",
            json={
                "username": username,
                "password": "validpass123",
            },
            headers=admin_headers,
        )
        resp = client.post(
            "/api/users",
            json={
                "username": username,
                "password": "anotherpass123",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_invalid_role_rejected(self, client, admin_headers):
        resp = client.post(
            "/api/users",
            json={
                "username": unique_user(),
                "password": "validpass123",
                "role": "superuser",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 422

    def test_short_password_rejected(self, client, admin_headers):
        resp = client.post(
            "/api/users",
            json={
                "username": unique_user(),
                "password": "short",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 422

    def test_gm_cannot_create_user(self, client, gm_headers):
        resp = client.post(
            "/api/users",
            json={
                "username": unique_user(),
                "password": "validpass123",
            },
            headers=gm_headers,
        )
        assert resp.status_code == 403

    def test_player_cannot_create_user(self, client, player_headers):
        resp = client.post(
            "/api/users",
            json={
                "username": unique_user(),
                "password": "validpass123",
            },
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_default_role_is_player(self, client, admin_headers):
        username = unique_user()
        resp = client.post(
            "/api/users",
            json={
                "username": username,
                "password": "validpass123",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["role"] == "player"


class TestUpdateUser:
    @pytest.fixture
    def temp_user(self, client, admin_headers):
        """Create a throwaway user for update/delete tests."""
        username = unique_user()
        resp = client.post(
            "/api/users",
            json={
                "username": username,
                "password": "temppass123",
                "role": "player",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201
        return resp.json()

    def test_admin_can_change_role(self, client, admin_headers, temp_user):
        user_id = temp_user["id"]
        resp = client.patch(f"/api/users/{user_id}", json={"role": "gm"}, headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["role"] == "gm"

    def test_admin_can_change_password(self, client, admin_headers, temp_user):
        user_id = temp_user["id"]
        resp = client.patch(
            f"/api/users/{user_id}", json={"password": "newpassword123"}, headers=admin_headers
        )
        assert resp.status_code == 200

    def test_cannot_demote_last_admin(self, client, admin_headers):
        """Verify the last-admin constraint by creating an isolated scenario.

        We temporarily reduce the DB to a single admin, confirm demotion is
        blocked with 400, then restore everything so the session stays intact.
        """
        from backend.config import SessionLocal
        from backend.models import User
        from backend.auth import hash_password

        db = SessionLocal()
        # Snapshot current admins and temporarily change them to "gm"
        admins = db.query(User).filter_by(role="admin").all()
        saved_ids = [a.id for a in admins]
        for a in admins:
            a.role = "gm"
        # Create the sole admin for this test
        sole = User(
            username=unique_user(),
            hashed_password=hash_password("solepw123"),
            role="admin",
        )
        db.add(sole)
        db.commit()
        db.refresh(sole)
        sole_id = sole.id
        db.close()

        try:
            resp = client.patch(
                f"/api/users/{sole_id}", json={"role": "player"}, headers=admin_headers
            )
            assert resp.status_code == 400, resp.text
            assert "last admin" in resp.json()["detail"].lower()
        finally:
            db = SessionLocal()
            for uid in saved_ids:
                u = db.query(User).filter_by(id=uid).first()
                if u:
                    u.role = "admin"
            db.query(User).filter_by(id=sole_id).delete()
            db.commit()
            db.close()

    def test_update_nonexistent_user(self, client, admin_headers):
        resp = client.patch("/api/users/nonexistent-id", json={"role": "gm"}, headers=admin_headers)
        assert resp.status_code == 404

    def test_gm_cannot_update_user(self, client, gm_headers, temp_user):
        user_id = temp_user["id"]
        resp = client.patch(f"/api/users/{user_id}", json={"role": "gm"}, headers=gm_headers)
        assert resp.status_code == 403


class TestDeleteUser:
    @pytest.fixture
    def deletable_user(self, client, admin_headers):
        username = unique_user()
        resp = client.post(
            "/api/users",
            json={
                "username": username,
                "password": "deletepass123",
                "role": "player",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201
        return resp.json()

    def test_admin_can_delete_user(self, client, admin_headers, deletable_user):
        user_id = deletable_user["id"]
        resp = client.delete(f"/api/users/{user_id}", headers=admin_headers)
        assert resp.status_code == 204
        # Confirm gone
        users = client.get("/api/users", headers=admin_headers).json()
        assert not any(u["id"] == user_id for u in users)

    def test_cannot_delete_self(self, client, admin_headers, admin_id):
        resp = client.delete(f"/api/users/{admin_id}", headers=admin_headers)
        assert resp.status_code == 400
        assert "own account" in resp.json()["detail"].lower()

    def test_delete_nonexistent_user(self, client, admin_headers):
        resp = client.delete("/api/users/nonexistent-id", headers=admin_headers)
        assert resp.status_code == 404

    def test_gm_cannot_delete_user(self, client, gm_headers, deletable_user):
        user_id = deletable_user["id"]
        resp = client.delete(f"/api/users/{user_id}", headers=gm_headers)
        assert resp.status_code == 403

    def test_delete_user_with_data(self, client, admin_headers):
        """Deleting a user with bookmarks and favorites must not raise FK errors."""
        from tests.conftest import make_game_system, make_book
        from backend.config import SessionLocal
        from backend.models import Bookmark, Favorite

        username = unique_user()
        create = client.post(
            "/api/users",
            json={"username": username, "password": "testpass123", "role": "player"},
            headers=admin_headers,
        )
        assert create.status_code == 201
        user_id = create.json()["id"]

        db = SessionLocal()
        try:
            system = make_game_system()
            db.add(system)
            db.flush()
            book = make_book(system.id)
            db.add(book)
            db.flush()
            db.add(Bookmark(user_id=user_id, book_id=book.id, page_number=1))
            db.add(Favorite(user_id=user_id, item_type="book", item_id=book.id))
            db.commit()
        finally:
            db.close()

        resp = client.delete(f"/api/users/{user_id}", headers=admin_headers)
        assert resp.status_code == 204
