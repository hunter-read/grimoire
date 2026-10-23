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
from backend.tests.conftest import wait_for_startup_scan  # noqa: E402


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
        wait_for_startup_scan()
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

    def test_status_lists_every_feed_version(self, opds_client, opds_admin_headers):
        token = _generate_token(opds_client, opds_admin_headers)
        body = opds_client.get("/api/users/me/opds", headers=opds_admin_headers).json()
        assert body["feed_urls"] == [
            {"version": "v2", "url": f"http://testserver/opds/v2/{token}"},
            {"version": "v1", "url": f"http://testserver/opds/{token}"},
        ]
        # feed_url stays the v1 URL, so a client reading it is unaffected.
        assert body["feed_url"] == f"http://testserver/opds/{token}"

    def test_generate_returns_every_feed_version(self, opds_client, opds_admin_headers):
        body = opds_client.post("/api/users/me/opds/generate", headers=opds_admin_headers).json()
        assert [f["version"] for f in body["feed_urls"]] == ["v2", "v1"]

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
        assert body["feed_urls"] is None

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

    def test_cover_link_uses_the_feed_token(self, opds_client, sample_book):
        from backend.config import SessionLocal
        from backend.models import Book

        db = SessionLocal()
        try:
            db.query(Book).filter_by(id=sample_book).update({"has_thumbnail": True})
            db.commit()
        finally:
            db.close()
        resp = opds_client.get(f"/opds/{self._token}/entry/{sample_book}")
        assert f"/opds/{self._token}/cover/{sample_book}" in resp.text
        assert "?token=" not in resp.text
        assert 'type="image/webp"' in resp.text

    def test_cover_is_served_with_the_feed_token(
        self, opds_client, sample_book, tmp_path, monkeypatch
    ):
        from backend.routers.books import core as books_core

        thumb = tmp_path / "cover.webp"
        thumb.write_bytes(b"RIFF\x00\x00\x00\x00WEBPVP8 ")
        monkeypatch.setattr(books_core, "book_thumbnail_path", lambda book: str(thumb))
        resp = opds_client.get(f"/opds/{self._token}/cover/{sample_book}")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/webp"

    def test_cover_missing_or_unknown_is_404(self, opds_client, sample_book, monkeypatch):
        from backend.routers.books import core as books_core

        monkeypatch.setattr(books_core, "book_thumbnail_path", lambda book: None)
        assert opds_client.get(f"/opds/{self._token}/cover/{sample_book}").status_code == 404
        assert opds_client.get(f"/opds/{self._token}/cover/nope").status_code == 404
        assert opds_client.get(f"/opds/bad-token/cover/{sample_book}").status_code == 404

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
        assert opds_client.get("/opds/v2/planted-guest-opds-token").status_code == 404
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

    def test_openapi_schema_generates_with_opds_enabled(self, opds_client, opds_admin_headers):
        resp = opds_client.get("/api/openapi.json", headers=opds_admin_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["paths"]

    def test_opds_routes_are_documented(self, opds_client, opds_admin_headers):
        paths = opds_client.get("/api/openapi.json", headers=opds_admin_headers).json()["paths"]
        for path in (
            "/opds/{token}",
            "/opds/{token}/all",
            "/opds/{token}/entry/{book_id}",
            "/opds/{token}/download/{book_id}",
            "/opds/{token}/cover/{book_id}",
            "/opds/v2/{token}",
            "/opds/v2/{token}/all",
            "/opds/v2/{token}/system/{system_id}",
            "/opds/v2/{token}/other",
            "/opds/v2/{token}/entry/{book_id}",
            "/opds/v2/{token}/download/{book_id}",
            "/opds/v2/{token}/cover/{book_id}",
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


class TestOpdsTokenAtRest:
    """The feed token is never stored as itself (issue #583)."""

    def _row(self, username):
        db = SessionLocal()
        try:
            user = db.query(User).filter_by(username=username).one()
            return user.opds_token_hash, user.opds_token_sealed
        finally:
            db.close()

    def test_the_database_holds_no_usable_token(self, opds_client, opds_admin_headers):
        token = _generate_token(opds_client, opds_admin_headers)
        token_hash, sealed = self._row("admin")
        assert token not in (token_hash, sealed) and token not in sealed
        assert opds_client.get(f"/opds/{token}").status_code == 200
        for stolen in (token_hash, sealed):
            assert opds_client.get(f"/opds/{stolen}").status_code == 404

    def test_the_feed_url_can_be_shown_again(self, opds_client, opds_admin_headers):
        token = _generate_token(opds_client, opds_admin_headers)
        status = opds_client.get("/api/users/me/opds", headers=opds_admin_headers).json()
        assert status["has_token"] is True
        assert status["feed_url"].endswith(f"/opds/{token}")

    def test_a_changed_secret_key_offers_a_new_token(
        self, opds_client, opds_admin_headers, monkeypatch
    ):
        from backend import token_vault

        token = _generate_token(opds_client, opds_admin_headers)
        # The sealing key only, so the admin stays signed in.
        monkeypatch.setattr(token_vault, "_secret", lambda: "a-different-secret")
        status = opds_client.get("/api/users/me/opds", headers=opds_admin_headers).json()
        assert status["has_token"] is False and status["feed_url"] is None
        assert opds_client.get(f"/opds/{token}").status_code == 404
        fresh = _generate_token(opds_client, opds_admin_headers)
        assert opds_client.get(f"/opds/{fresh}").status_code == 200

    def test_revoking_clears_both_values(self, opds_client, opds_admin_headers):
        _generate_token(opds_client, opds_admin_headers)
        assert opds_client.delete("/api/users/me/opds", headers=opds_admin_headers).status_code == 200
        assert self._row("admin") == (None, None)


class TestEntryQuoting:
    """Tag and MIME attributes are quoted so any value gives well-formed XML."""

    def _entry(self, tags, mime="application/pdf"):
        import xml.etree.ElementTree as ET

        from backend.models import Book
        from backend.routers.opds.core import _book_to_entry

        book = Book(id="b1", title="T", mime_type=mime, has_thumbnail=False)
        xml = _book_to_entry(book, "http://x/opds/tok", tags)
        return ET.fromstring(xml.replace("<entry>", '<entry xmlns="http://www.w3.org/2005/Atom">', 1))

    def test_tag_with_both_quote_kinds(self):
        root = self._entry(["it's \"fine\"", "<b>&"])
        terms = [c.get("term") for c in root.iter("{http://www.w3.org/2005/Atom}category")]
        assert terms == ["it's \"fine\"", "<b>&"]

    def test_mime_type_is_quoted(self):
        root = self._entry([], mime='a"b')
        links = list(root.iter("{http://www.w3.org/2005/Atom}link"))
        assert links[-1].get("type") == 'a"b'


# ===========================================================================
# v2 — the catalog browsable by game system (issue #673)
# ===========================================================================


def _make_system(db, slug, name, **kw):
    system = GameSystem(name=name, slug=slug, **kw)
    db.add(system)
    db.flush()
    return system


def _make_book(db, title, system=None, **kw):
    book = Book(
        title=title,
        filename=f"{title}.pdf",
        filepath=f"/tmp/{title}.pdf",
        relative_path=f"{title}.pdf",
        game_system_id=system.id if system else None,
        category="core",
        mime_type="application/pdf",
        is_missing=False,
        **kw,
    )
    db.add(book)
    db.flush()
    return book


@pytest.fixture(scope="module")
def v2_library():
    """Systems covering each case the v2 root has to sort out."""
    db = SessionLocal()
    zeta = _make_system(db, "v2-zeta", "Zeta Quest")
    alpha = _make_system(db, "v2-alpha", "alpha Saga")  # lower-case: sort ignores case
    empty = _make_system(db, "v2-empty", "V2 Empty System")
    spicy = _make_system(db, "v2-spicy", "V2 Spicy System", is_explicit=True)
    locked = _make_system(db, "v2-locked", "V2 Locked System", access_level="gm")
    ids = {
        "zeta": zeta.id,
        "alpha": alpha.id,
        "empty": empty.id,
        "spicy": spicy.id,
        "locked": locked.id,
        "zeta_book": _make_book(db, "V2 Zeta Core", zeta).id,
        "zeta_book_2": _make_book(db, "V2 Zeta Bestiary", zeta).id,
        "alpha_book": _make_book(db, "V2 Alpha Core", alpha).id,
        "spicy_book": _make_book(db, "V2 Spicy Core", spicy).id,
        "locked_book": _make_book(db, "V2 Locked Core", locked).id,
        "loose_book": _make_book(db, "V2 Loose Pamphlet").id,
    }
    db.commit()
    db.close()

    yield ids

    db = SessionLocal()
    db.query(Book).filter(Book.title.like("V2 %")).delete(synchronize_session=False)
    db.query(GameSystem).filter(GameSystem.slug.like("v2-%")).delete(synchronize_session=False)
    db.commit()
    db.close()


def _set_player_explicit(allow):
    db = SessionLocal()
    db.query(User).filter_by(username="opds_player").update({"allow_explicit": allow})
    db.commit()
    db.close()


def _nav_titles(xml_text):
    import xml.etree.ElementTree as ET

    ns = {"a": "http://www.w3.org/2005/Atom"}
    root = ET.fromstring(xml_text)
    return [e.find("a:title", ns).text for e in root.findall("a:entry", ns)]


class TestOPDSv2:
    @pytest.fixture(autouse=True)
    def token(self, opds_client, opds_admin_headers):
        self._token = _generate_token(opds_client, opds_admin_headers)
        self._root = f"http://testserver/opds/v2/{self._token}"

    def test_root_is_a_navigation_feed(self, opds_client, v2_library):
        resp = opds_client.get(f"/opds/v2/{self._token}")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith(
            "application/atom+xml;profile=opds-catalog;kind=navigation"
        )
        assert f'<link rel="self" href="{self._root}"' in resp.text

    def test_root_lists_all_books_then_each_system(self, opds_client, v2_library):
        titles = _nav_titles(opds_client.get(f"/opds/v2/{self._token}").text)
        assert titles[0] == "All Books"
        assert titles.index("alpha Saga") < titles.index("Zeta Quest")
        assert titles[-1] == "Other Books"

    def test_root_links_each_system_feed_with_its_count(self, opds_client, v2_library):
        text = opds_client.get(f"/opds/v2/{self._token}").text
        assert f'href="{self._root}/system/{v2_library["zeta"]}"' in text
        assert "<content type='text'>2 books</content>" in text
        assert "<content type='text'>1 book</content>" in text

    def test_root_leaves_out_a_system_with_no_books(self, opds_client, v2_library):
        titles = _nav_titles(opds_client.get(f"/opds/v2/{self._token}").text)
        assert "V2 Empty System" not in titles

    def test_system_feed_holds_only_that_systems_books(self, opds_client, v2_library):
        resp = opds_client.get(f"/opds/v2/{self._token}/system/{v2_library['zeta']}")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith(
            "application/atom+xml;profile=opds-catalog;kind=acquisition"
        )
        assert "<title>Zeta Quest</title>" in resp.text
        assert v2_library["zeta_book"] in resp.text
        assert v2_library["zeta_book_2"] in resp.text
        assert v2_library["alpha_book"] not in resp.text
        assert f'<link rel="up" href="{self._root}"' in resp.text

    def test_system_feed_links_stay_in_v2(self, opds_client, v2_library):
        text = opds_client.get(f"/opds/v2/{self._token}/system/{v2_library['zeta']}").text
        book = v2_library["zeta_book"]
        assert f"{self._root}/entry/{book}" in text
        assert f"{self._root}/download/{book}" in text
        assert f"/opds/{self._token}/" not in text

    def test_unknown_system_is_404(self, opds_client):
        assert opds_client.get(f"/opds/v2/{self._token}/system/nope").status_code == 404

    def test_other_feed_holds_books_without_a_system(self, opds_client, v2_library):
        resp = opds_client.get(f"/opds/v2/{self._token}/other")
        assert resp.status_code == 200
        assert v2_library["loose_book"] in resp.text
        assert v2_library["zeta_book"] not in resp.text

    def test_all_feed_lists_every_book_under_v2(self, opds_client, v2_library):
        text = opds_client.get(f"/opds/v2/{self._token}/all").text
        for key in ("zeta_book", "alpha_book", "loose_book"):
            assert v2_library[key] in text
        assert f"{self._root}/entry/{v2_library['alpha_book']}" in text

    def test_entry_download_and_cover(self, opds_client, sample_book, monkeypatch, tmp_path):
        from backend.routers.books import core as books_core

        entry = opds_client.get(f"/opds/v2/{self._token}/entry/{sample_book}")
        assert entry.status_code == 200
        assert f'<link rel="up" href="{self._root}/all"' in entry.text
        assert f"{self._root}/download/{sample_book}" in entry.text

        download = opds_client.get(f"/opds/v2/{self._token}/download/{sample_book}")
        assert download.status_code == 200

        thumb = tmp_path / "cover.webp"
        thumb.write_bytes(b"RIFF\x00\x00\x00\x00WEBPVP8 ")
        monkeypatch.setattr(books_core, "book_thumbnail_path", lambda book: str(thumb))
        cover = opds_client.get(f"/opds/v2/{self._token}/cover/{sample_book}")
        assert cover.status_code == 200

    def test_invalid_token_is_404_everywhere(self, opds_client, v2_library):
        for path in ("", "/all", "/other", f"/system/{v2_library['zeta']}"):
            assert opds_client.get(f"/opds/v2/not-a-real-token{path}").status_code == 404

    def test_v1_is_unchanged(self, opds_client, v2_library):
        root = opds_client.get(f"/opds/{self._token}").text
        assert _nav_titles(root) == ["All Books"]
        text = opds_client.get(f"/opds/{self._token}/all").text
        assert f"http://testserver/opds/{self._token}/entry/{v2_library['zeta_book']}" in text
        assert "/opds/v2/" not in text

    def test_admin_sees_restricted_and_explicit_systems(self, opds_client, v2_library):
        titles = _nav_titles(opds_client.get(f"/opds/v2/{self._token}").text)
        assert "V2 Locked System" in titles
        assert "V2 Spicy System" in titles


class TestOPDSv2Restrictions:
    def test_restricted_system_is_hidden_from_a_player(
        self, opds_client, opds_player_headers, v2_library
    ):
        _set_player_explicit(True)
        token = _generate_token(opds_client, opds_player_headers)
        titles = _nav_titles(opds_client.get(f"/opds/v2/{token}").text)
        assert "V2 Locked System" not in titles
        resp = opds_client.get(f"/opds/v2/{token}/system/{v2_library['locked']}")
        assert resp.status_code == 404

    def test_explicit_system_is_hidden_when_the_user_denies_explicit(
        self, opds_client, opds_player_headers, v2_library
    ):
        _set_player_explicit(False)
        token = _generate_token(opds_client, opds_player_headers)
        titles = _nav_titles(opds_client.get(f"/opds/v2/{token}").text)
        assert "V2 Spicy System" not in titles
        assert "Zeta Quest" in titles
        resp = opds_client.get(f"/opds/v2/{token}/system/{v2_library['spicy']}")
        assert resp.status_code == 404

    def test_explicit_system_is_shown_when_the_user_allows_explicit(
        self, opds_client, opds_player_headers, v2_library
    ):
        _set_player_explicit(True)
        token = _generate_token(opds_client, opds_player_headers)
        titles = _nav_titles(opds_client.get(f"/opds/v2/{token}").text)
        assert "V2 Spicy System" in titles
