"""Tests for OPDS catalog endpoints and OPDS token management.

OPDS routes are conditionally registered only when OPDS_ENABLED=true.
The conftest sets up a test database before any backend imports, so we
patch the OPDS_ENABLED flag at the module level and re-register the router
within this test module's session.
"""
import os
import tempfile
import pytest

# Enable OPDS before the app is imported in this test module.
os.environ["OPDS_ENABLED"] = "true"
os.environ["BASE_URL"] = "http://testserver"

from fastapi.testclient import TestClient  # noqa: E402

from backend.config import SessionLocal  # noqa: E402
from backend.models import User, Book, GameSystem  # noqa: E402


# ---------------------------------------------------------------------------
# Module-scoped client with OPDS enabled
# The session-scoped client in conftest was created before OPDS_ENABLED was
# set, so we spin up a fresh app instance for this module.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def opds_client():
    import importlib
    import backend.config as config_mod
    import backend.routers.users.me as me_mod
    import backend.routers.opds.core as opds_core_mod
    import backend.main as main_mod

    # Force config and dependent modules to re-read the env vars we set above.
    importlib.reload(config_mod)
    importlib.reload(me_mod)
    importlib.reload(opds_core_mod)
    importlib.reload(main_mod)

    with TestClient(main_mod.app, raise_server_exceptions=True) as c:
        yield c


@pytest.fixture(scope="module")
def opds_admin_headers(opds_client):
    """Bootstrap admin account and return auth headers."""
    # Try setup first; if already initialised (e.g. shared DB), fall back to login.
    resp = opds_client.post(
        "/api/auth/setup",
        json={"username": "admin", "password": "adminpass123"},
    )
    if resp.status_code not in (200, 400):
        pytest.fail(f"Unexpected setup response: {resp.text}")
    resp = opds_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "adminpass123"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


@pytest.fixture(scope="module")
def opds_player_headers(opds_client, opds_admin_headers):
    """Create a player account and return auth headers."""
    opds_client.post(
        "/api/users",
        json={"username": "opds_player", "password": "playerpass123", "role": "player"},
        headers=opds_admin_headers,
    )
    resp = opds_client.post(
        "/api/auth/login",
        json={"username": "opds_player", "password": "playerpass123"},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


@pytest.fixture(scope="module")
def sample_book():
    """Insert a real (non-missing) book for download tests."""
    f = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    f.write(b"%PDF-1.4 fake")
    f.close()

    db = SessionLocal()
    system = GameSystem(name="OPDS Test System", slug="opds-test-system")
    db.add(system)
    db.commit()
    db.refresh(system)

    book = Book(
        title="OPDS Test Book",
        filename=os.path.basename(f.name),
        filepath=f.name,
        relative_path=os.path.basename(f.name),
        game_system_id=system.id,
        category="core",
        mime_type="application/pdf",
        is_missing=False,
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    book_id = book.id
    db.close()

    yield book_id

    os.unlink(f.name)
    db = SessionLocal()
    db.query(Book).filter_by(id=book_id).delete()
    db.query(GameSystem).filter_by(slug="opds-test-system").delete()
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def explicit_book():
    """Insert an explicit book to test content-filtering in OPDS feeds."""
    db = SessionLocal()
    book = Book(
        title="Explicit OPDS Book",
        filename="explicit_opds.pdf",
        filepath="/tmp/explicit_opds.pdf",
        relative_path="explicit_opds.pdf",
        category="core",
        mime_type="application/pdf",
        is_explicit=True,
        is_missing=False,
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    book_id = book.id
    db.close()

    yield book_id

    db = SessionLocal()
    db.query(Book).filter_by(id=book_id).delete()
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# Helper: get or create an OPDS token for a user via the API
# ---------------------------------------------------------------------------


def _generate_token(client, headers) -> str:
    resp = client.post("/api/users/me/opds/generate", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["feed_url"].split("/opds/")[1]


# ===========================================================================
# OPDS token management (API endpoints)
# ===========================================================================


class TestOPDSTokenManagement:
    def test_status_no_token(self, opds_client, opds_admin_headers):
        resp = opds_client.get("/api/users/me/opds", headers=opds_admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["opds_enabled"] is True
        assert body["has_token"] is False
        assert body["feed_url"] is None

    def test_generate_creates_token(self, opds_client, opds_admin_headers):
        resp = opds_client.post("/api/users/me/opds/generate", headers=opds_admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["opds_enabled"] is True
        assert body["has_token"] is True
        assert body["feed_url"].startswith("http://testserver/opds/")

    def test_status_reflects_token(self, opds_client, opds_admin_headers):
        resp = opds_client.get("/api/users/me/opds", headers=opds_admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["has_token"] is True
        assert body["feed_url"] is not None

    def test_regenerate_changes_token(self, opds_client, opds_admin_headers):
        first = _generate_token(opds_client, opds_admin_headers)
        second = _generate_token(opds_client, opds_admin_headers)
        assert first != second

    def test_revoke_clears_token(self, opds_client, opds_admin_headers):
        _generate_token(opds_client, opds_admin_headers)
        resp = opds_client.delete("/api/users/me/opds", headers=opds_admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["has_token"] is False
        assert body["feed_url"] is None

    def test_status_after_revoke(self, opds_client, opds_admin_headers):
        # Ensure revoke is durable
        _generate_token(opds_client, opds_admin_headers)
        opds_client.delete("/api/users/me/opds", headers=opds_admin_headers)
        resp = opds_client.get("/api/users/me/opds", headers=opds_admin_headers)
        assert resp.json()["has_token"] is False

    def test_unauthenticated_cannot_get_status(self, opds_client):
        # A prior login in this module-scoped client leaves a session cookie in
        # the jar; clear it so this really is an unauthenticated request.
        opds_client.cookies.clear()
        resp = opds_client.get("/api/users/me/opds")
        assert resp.status_code == 401

    def test_unauthenticated_cannot_generate(self, opds_client):
        opds_client.cookies.clear()
        resp = opds_client.post("/api/users/me/opds/generate")
        assert resp.status_code == 401

    def test_unauthenticated_cannot_revoke(self, opds_client):
        opds_client.cookies.clear()
        resp = opds_client.delete("/api/users/me/opds")
        assert resp.status_code == 401


# ===========================================================================
# OPDS feed endpoints (catalog, all-books, entry, download)
# ===========================================================================


class TestOPDSFeeds:
    @pytest.fixture(autouse=True)
    def token(self, opds_client, opds_admin_headers):
        """Ensure admin has a fresh token before each test."""
        self._token = _generate_token(opds_client, opds_admin_headers)

    def test_root_catalog_200(self, opds_client):
        resp = opds_client.get(f"/opds/{self._token}")
        assert resp.status_code == 200

    def test_root_catalog_content_type(self, opds_client):
        resp = opds_client.get(f"/opds/{self._token}")
        assert "application/atom+xml" in resp.headers["content-type"]

    def test_root_catalog_is_xml(self, opds_client):
        resp = opds_client.get(f"/opds/{self._token}")
        assert resp.text.startswith("<?xml")
        assert "<feed" in resp.text

    def test_root_catalog_contains_all_books_link(self, opds_client):
        resp = opds_client.get(f"/opds/{self._token}")
        assert "/all" in resp.text

    def test_all_books_feed_200(self, opds_client, sample_book):
        resp = opds_client.get(f"/opds/{self._token}/all")
        assert resp.status_code == 200

    def test_all_books_feed_is_xml(self, opds_client, sample_book):
        resp = opds_client.get(f"/opds/{self._token}/all")
        assert resp.text.startswith("<?xml")
        assert "<feed" in resp.text

    def test_all_books_contains_sample_book(self, opds_client, sample_book):
        resp = opds_client.get(f"/opds/{self._token}/all")
        assert sample_book in resp.text

    def test_book_entry_200(self, opds_client, sample_book):
        resp = opds_client.get(f"/opds/{self._token}/entry/{sample_book}")
        assert resp.status_code == 200

    def test_book_entry_is_xml(self, opds_client, sample_book):
        resp = opds_client.get(f"/opds/{self._token}/entry/{sample_book}")
        assert "<entry>" in resp.text

    def test_book_entry_contains_download_link(self, opds_client, sample_book):
        resp = opds_client.get(f"/opds/{self._token}/entry/{sample_book}")
        assert f"/download/{sample_book}" in resp.text

    def test_book_entry_nonexistent_404(self, opds_client):
        resp = opds_client.get(f"/opds/{self._token}/entry/nonexistent-id")
        assert resp.status_code == 404

    def test_download_book(self, opds_client, sample_book):
        resp = opds_client.get(f"/opds/{self._token}/download/{sample_book}")
        assert resp.status_code == 200
        assert "application/pdf" in resp.headers["content-type"]

    def test_download_nonexistent_404(self, opds_client):
        resp = opds_client.get(f"/opds/{self._token}/download/nonexistent-id")
        assert resp.status_code == 404

    def test_invalid_token_404(self, opds_client):
        resp = opds_client.get("/opds/not-a-real-token")
        assert resp.status_code == 404

    def test_revoked_token_denied(self, opds_client, opds_admin_headers):
        token = _generate_token(opds_client, opds_admin_headers)
        # Revoke it
        opds_client.delete("/api/users/me/opds", headers=opds_admin_headers)
        resp = opds_client.get(f"/opds/{token}")
        assert resp.status_code == 404

    def test_old_token_denied_after_regenerate(self, opds_client, opds_admin_headers):
        old_token = _generate_token(opds_client, opds_admin_headers)
        _generate_token(opds_client, opds_admin_headers)  # regenerate
        resp = opds_client.get(f"/opds/{old_token}")
        assert resp.status_code == 404


# ===========================================================================
# Explicit content filtering
# ===========================================================================


class TestOPDSExplicitFiltering:
    def test_explicit_book_hidden_when_user_denies(self, opds_client, opds_player_headers, explicit_book):
        # Set player to deny explicit
        db = SessionLocal()
        user = db.query(User).filter_by(username="opds_player").first()
        user.allow_explicit = False
        db.commit()
        db.close()

        token = _generate_token(opds_client, opds_player_headers)
        resp = opds_client.get(f"/opds/{token}/all")
        assert resp.status_code == 200
        assert explicit_book not in resp.text

    def test_explicit_book_visible_when_user_allows(self, opds_client, opds_player_headers, explicit_book):
        db = SessionLocal()
        user = db.query(User).filter_by(username="opds_player").first()
        user.allow_explicit = True
        db.commit()
        db.close()

        token = _generate_token(opds_client, opds_player_headers)
        resp = opds_client.get(f"/opds/{token}/all")
        assert explicit_book in resp.text

    def test_explicit_entry_forbidden_when_denied(self, opds_client, opds_player_headers, explicit_book):
        db = SessionLocal()
        user = db.query(User).filter_by(username="opds_player").first()
        user.allow_explicit = False
        db.commit()
        db.close()

        token = _generate_token(opds_client, opds_player_headers)
        resp = opds_client.get(f"/opds/{token}/entry/{explicit_book}")
        assert resp.status_code == 403

    def test_explicit_download_forbidden_when_denied(self, opds_client, opds_player_headers, explicit_book):
        db = SessionLocal()
        user = db.query(User).filter_by(username="opds_player").first()
        user.allow_explicit = False
        db.commit()
        db.close()

        token = _generate_token(opds_client, opds_player_headers)
        resp = opds_client.get(f"/opds/{token}/download/{explicit_book}")
        assert resp.status_code == 403


# ===========================================================================
# Guests are denied OPDS entirely (campaign-scoped users get no library feed)
# ===========================================================================


class TestOPDSGuestDenied:
    @pytest.fixture
    def guest_headers(self, opds_client, opds_admin_headers):
        """A logged-in guest account and its auth headers.

        Created via the guest-invite flow so the account is a genuine guest
        (role='guest', is_guest=True) attached to a real campaign.
        """
        # A GM campaign is needed to host a guest invite.
        gm = opds_client.post(
            "/api/users",
            json={"username": "opds_guest_gm", "password": "gmpass123456", "role": "gm"},
            headers=opds_admin_headers,
        )
        assert gm.status_code in (200, 201, 400), gm.text
        gm_login = opds_client.post(
            "/api/auth/login",
            json={"username": "opds_guest_gm", "password": "gmpass123456"},
        )
        gm_headers = {"Authorization": f"Bearer {gm_login.json()['token']}"}

        opds_client.patch(
            "/api/settings",
            json={"guest_access_enabled": True},
            headers=opds_admin_headers,
        )
        campaign = opds_client.post(
            "/api/campaigns",
            json={"name": "OPDS Guest Campaign", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        created = opds_client.post(
            f"/api/campaigns/{campaign['id']}/guests",
            json={"nickname": "OpdsGuest"},
            headers=gm_headers,
        ).json()
        login = opds_client.post(
            "/api/auth/guest-login", json={"code": created["guest_code"]}
        )
        assert login.status_code == 200, login.text
        assert login.json()["user"]["role"] == "guest"
        return {"Authorization": f"Bearer {login.json()['token']}"}

    def test_guest_cannot_generate_token(self, opds_client, guest_headers):
        resp = opds_client.post("/api/users/me/opds/generate", headers=guest_headers)
        assert resp.status_code == 403

    def test_guest_status_reports_unavailable(self, opds_client, guest_headers):
        resp = opds_client.get("/api/users/me/opds", headers=guest_headers)
        assert resp.status_code == 200
        assert resp.json()["opds_enabled"] is False

    def test_guest_token_in_db_is_rejected_by_feed(self, opds_client, guest_headers, sample_book):
        # Defense-in-depth: even if a guest somehow holds an opds_token (e.g. a
        # role change after minting), the feed and download routes must deny it.
        db = SessionLocal()
        guest = (
            db.query(User)
            .filter(User.role == "guest", User.is_guest == True)  # noqa: E712
            .first()
        )
        guest.opds_token = "planted-guest-opds-token"
        db.commit()
        db.close()

        assert opds_client.get("/opds/planted-guest-opds-token").status_code == 404
        assert opds_client.get("/opds/planted-guest-opds-token/all").status_code == 404
        assert (
            opds_client.get(
                f"/opds/planted-guest-opds-token/download/{sample_book}"
            ).status_code
            == 404
        )


class TestOpenApiSchema:
    """Regression coverage for #276.

    Registering an OPDS route with `response_class=None` made FastAPI's schema
    generation assert, so `/api/openapi.json` 500'd (and `/api/docs` rendered
    empty) for every instance running with OPDS_ENABLED=true.
    """

    def test_openapi_schema_generates_with_opds_enabled(self, opds_client):
        resp = opds_client.get("/api/openapi.json")
        assert resp.status_code == 200, resp.text
        assert resp.json()["paths"]

    def test_opds_routes_are_documented(self, opds_client):
        paths = opds_client.get("/api/openapi.json").json()["paths"]
        for path in (
            "/opds/{token}",
            "/opds/{token}/all",
            "/opds/{token}/entry/{book_id}",
            "/opds/{token}/download/{book_id}",
        ):
            assert path in paths, f"{path} missing from OpenAPI schema"

    def test_feed_still_returns_atom_not_json(self, opds_client, opds_admin_headers):
        # Declaring a response_class must not make FastAPI re-encode the feed:
        # the handlers return a Response directly, so it passes through as-is.
        token = _generate_token(opds_client, opds_admin_headers)
        resp = opds_client.get(f"/opds/{token}")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith(
            "application/atom+xml;profile=opds-catalog;kind=navigation"
        )
        assert resp.text.startswith("<?xml")
