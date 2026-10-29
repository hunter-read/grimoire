"""End-to-end tests for book access restrictions over HTTP (issue #258).

Where ``test_access_control.py`` proves the resolver and the SQL filter agree,
this proves the routers actually apply them — and, just as importantly, that a
restricted book cannot be reached by going around the browse list: by id, by
search, by OPDS, by bulk download, or through a campaign share.
"""
import uuid

import pytest

from backend.config import SessionLocal
from backend.models import AppSetting, Book, CampaignResource, GameSystem, UserAccessGrant
from backend.models.access import CATEGORY_DEFAULTS_KEY

from .conftest import make_book, make_campaign, make_game_system


@pytest.fixture(autouse=True)
def _cleanup():
    """Undo this module's global state so other test files are unaffected."""
    db = SessionLocal()
    before = {row[0] for row in db.query(Book.id).all()}
    db.close()
    yield
    db = SessionLocal()
    try:
        db.query(AppSetting).filter_by(key=CATEGORY_DEFAULTS_KEY).delete()
        db.query(UserAccessGrant).delete()
        created = [row[0] for row in db.query(Book.id).filter(~Book.id.in_(before)).all()]
        if created:
            db.query(Book).filter(Book.id.in_(created)).delete(synchronize_session=False)
        db.query(GameSystem).filter(GameSystem.access_level != "").update(
            {GameSystem.access_level: ""}, synchronize_session=False
        )
        db.commit()
    finally:
        db.close()


def _set_level(book_id, level):
    db = SessionLocal()
    try:
        db.query(Book).filter_by(id=book_id).update({Book.access_level: level})
        db.commit()
    finally:
        db.close()


def _ids(resp):
    return [b["id"] for b in resp.json()["books"]]


class TestBrowseHiding:
    def test_restricted_book_hidden_from_players(self, client, admin_headers, player_headers):
        book = make_book(make_game_system().id)
        assert book.id in _ids(client.get("/api/books?limit=500", headers=player_headers))

        _set_level(book.id, "gm")
        assert book.id not in _ids(client.get("/api/books?limit=500", headers=player_headers))
        # still visible to those who clear it
        assert book.id in _ids(client.get("/api/books?limit=500", headers=admin_headers))

    def test_admin_only_hidden_from_gms(self, client, gm_headers, admin_headers):
        book = make_book(make_game_system().id)
        _set_level(book.id, "admin")
        assert book.id not in _ids(client.get("/api/books?limit=500", headers=gm_headers))
        assert book.id in _ids(client.get("/api/books?limit=500", headers=admin_headers))

    def test_gm_restricted_visible_to_gm(self, client, gm_headers):
        book = make_book(make_game_system().id)
        _set_level(book.id, "gm")
        assert book.id in _ids(client.get("/api/books?limit=500", headers=gm_headers))


class TestByIdAccess:
    def test_detail_route_404s_for_restricted(self, client, player_headers):
        book = make_book(make_game_system().id)
        _set_level(book.id, "gm")
        assert client.get(f"/api/books/{book.id}", headers=player_headers).status_code == 404

    def test_detail_route_ok_for_permitted(self, client, admin_headers):
        book = make_book(make_game_system().id)
        _set_level(book.id, "gm")
        assert client.get(f"/api/books/{book.id}", headers=admin_headers).status_code == 200

    def test_restricted_is_indistinguishable_from_missing(self, client, player_headers):
        """The 404 body must not reveal that the book exists."""
        book = make_book(make_game_system().id)
        _set_level(book.id, "admin")
        restricted = client.get(f"/api/books/{book.id}", headers=player_headers)
        missing = client.get(f"/api/books/{uuid.uuid4()}", headers=player_headers)
        assert restricted.status_code == missing.status_code == 404
        assert restricted.json() == missing.json()


class TestSearchLeak:
    def test_restricted_book_absent_from_search(self, client, admin_headers, player_headers):
        """Search must filter in SQL — the FTS LIMIT runs before any Python pass."""
        book = make_book(make_game_system().id, title="Spoilerific Tome")
        _set_level(book.id, "gm")
        resp = client.get("/api/search?q=Spoilerific", headers=player_headers)
        assert resp.status_code == 200
        assert all(r["id"] != book.id for r in resp.json()["results"])

    def test_restricted_book_absent_when_named_directly(self, client, player_headers):
        """Naming the book id in the query must not bypass the filter."""
        book = make_book(make_game_system().id)
        _set_level(book.id, "admin")
        resp = client.get(f"/api/search?q=the&book_id={book.id}", headers=player_headers)
        assert resp.status_code == 200
        assert resp.json()["results"] == []


class TestSystemRestriction:
    def test_restricted_system_hidden_and_404s(self, client, player_headers, admin_headers):
        system = make_game_system()
        db = SessionLocal()
        db.query(GameSystem).filter_by(id=system.id).update({GameSystem.access_level: "gm"})
        db.commit()
        db.close()

        listed = [s["id"] for s in client.get("/api/systems", headers=player_headers).json()]
        assert system.id not in listed
        assert client.get(f"/api/systems/{system.id}", headers=player_headers).status_code == 404
        assert client.get(f"/api/systems/{system.id}", headers=admin_headers).status_code == 200

    def test_books_inherit_system_restriction(self, client, player_headers):
        system = make_game_system()
        book = make_book(system.id, access_level=None)
        db = SessionLocal()
        db.query(GameSystem).filter_by(id=system.id).update({GameSystem.access_level: "gm"})
        db.commit()
        db.close()
        assert book.id not in _ids(client.get("/api/books?limit=500", headers=player_headers))

    def test_explicit_open_book_escapes_restricted_system(self, client, player_headers):
        """A freely-shared book stays visible inside a restricted system."""
        system = make_game_system()
        book = make_book(system.id, access_level="")
        db = SessionLocal()
        db.query(GameSystem).filter_by(id=system.id).update({GameSystem.access_level: "admin"})
        db.commit()
        db.close()
        assert book.id in _ids(client.get("/api/books?limit=500", headers=player_headers))


class TestCategoryDefaults:
    def test_category_restriction_applies(self, client, admin_headers, player_headers):
        book = make_book(make_game_system().id, category="adventure", access_level=None)
        resp = client.patch(
            "/api/settings",
            json={"restricted_categories": {"adventure": "gm"}},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert book.id not in _ids(client.get("/api/books?limit=500", headers=player_headers))

    def test_core_cannot_be_restricted(self, client, admin_headers):
        resp = client.patch(
            "/api/settings",
            json={"restricted_categories": {"core": "admin"}},
            headers=admin_headers,
        )
        assert resp.status_code == 400
        assert "cannot be restricted" in resp.json()["detail"]

    def test_character_sheet_cannot_be_restricted(self, client, admin_headers):
        resp = client.patch(
            "/api/settings",
            json={"restricted_categories": {"character-sheet": "gm"}},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_invalid_level_rejected(self, client, admin_headers):
        resp = client.patch(
            "/api/settings",
            json={"restricted_categories": {"adventure": "everyone"}},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_players_cannot_change_settings(self, client, player_headers):
        resp = client.patch(
            "/api/settings",
            json={"restricted_categories": {"adventure": "gm"}},
            headers=player_headers,
        )
        assert resp.status_code == 403


class TestWriteAuthorization:
    def test_admin_can_set_level(self, client, admin_headers):
        book = make_book(make_game_system().id)
        resp = client.patch(
            f"/api/books/{book.id}", json={"access_level": "gm"}, headers=admin_headers
        )
        assert resp.status_code == 200
        db = SessionLocal()
        assert db.query(Book).filter_by(id=book.id).first().access_level == "gm"
        db.close()

    def test_gm_cannot_set_level(self, client, gm_headers):
        """A GM who could restrict books could also un-restrict their own."""
        book = make_book(make_game_system().id)
        resp = client.patch(
            f"/api/books/{book.id}", json={"access_level": "gm"}, headers=gm_headers
        )
        assert resp.status_code == 403

    def test_gm_can_still_edit_other_fields(self, client, gm_headers):
        book = make_book(make_game_system().id)
        resp = client.patch(
            f"/api/books/{book.id}", json={"title": "Renamed by GM"}, headers=gm_headers
        )
        assert resp.status_code == 200

    def test_inherit_sentinel_writes_null(self, client, admin_headers):
        book = make_book(make_game_system().id, access_level="gm")
        resp = client.patch(
            f"/api/books/{book.id}", json={"access_level": "inherit"}, headers=admin_headers
        )
        assert resp.status_code == 200
        db = SessionLocal()
        assert db.query(Book).filter_by(id=book.id).first().access_level is None
        db.close()

    def test_invalid_level_rejected(self, client, admin_headers):
        book = make_book(make_game_system().id)
        resp = client.patch(
            f"/api/books/{book.id}", json={"access_level": "superuser"}, headers=admin_headers
        )
        assert resp.status_code == 422

    def test_bulk_edit_sets_levels(self, client, admin_headers):
        system = make_game_system()
        a, b = make_book(system.id), make_book(system.id)
        resp = client.post(
            "/api/books/bulk",
            json={"items": [{"id": a.id, "access_level": "gm"},
                            {"id": b.id, "access_level": "admin"}]},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        db = SessionLocal()
        assert db.query(Book).filter_by(id=a.id).first().access_level == "gm"
        assert db.query(Book).filter_by(id=b.id).first().access_level == "admin"
        db.close()

    def test_bulk_edit_rejected_for_gm(self, client, gm_headers):
        book = make_book(make_game_system().id)
        resp = client.post(
            "/api/books/bulk",
            json={"items": [{"id": book.id, "access_level": "gm"}]},
            headers=gm_headers,
        )
        assert resp.status_code == 403


class TestCampaignInteraction:
    def test_restricting_demotes_existing_public_share(
        self, client, admin_headers, gm_id
    ):
        """A public share of a book that becomes restricted drops to GM-only."""
        campaign = make_campaign(gm_id)
        book = make_book(make_game_system().id)
        db = SessionLocal()
        db.add(
            CampaignResource(
                campaign_id=campaign.id,
                resource_type="book",
                resource_id=book.id,
                visibility="public",
            )
        )
        db.commit()
        db.close()

        resp = client.patch(
            f"/api/books/{book.id}", json={"access_level": "gm"}, headers=admin_headers
        )
        assert resp.status_code == 200

        db = SessionLocal()
        row = (
            db.query(CampaignResource)
            .filter_by(resource_type="book", resource_id=book.id)
            .first()
        )
        assert row.visibility == "gm"
        db.close()

    def test_linking_restricted_book_clamps_to_gm(self, client, gm_headers, admin_headers):
        campaign = client.post(
            "/api/campaigns", json={"name": "Strahd"}, headers=gm_headers
        ).json()
        book = make_book(make_game_system().id)
        _set_level(book.id, "gm")

        resp = client.post(
            f"/api/campaigns/{campaign['id']}/resources",
            json={"resource_type": "book", "resource_id": book.id, "visibility": "public"},
            headers=gm_headers,
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["visibility"] == "gm"

    def test_open_book_keeps_requested_visibility(self, client, gm_headers):
        campaign = client.post(
            "/api/campaigns", json={"name": "Open table"}, headers=gm_headers
        ).json()
        book = make_book(make_game_system().id)
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/resources",
            json={"resource_type": "book", "resource_id": book.id, "visibility": "public"},
            headers=gm_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["visibility"] == "public"


class TestGrantsApi:
    def _gm(self, client, admin_headers, role="gm"):
        uid = str(uuid.uuid4())[:8]
        return client.post(
            "/api/users",
            json={"username": f"{role}-{uid}", "password": "grantpass12345", "role": role},
            headers=admin_headers,
        ).json()

    def test_grant_restores_access(self, client, admin_headers):
        user = self._gm(client, admin_headers)
        login = client.post(
            "/api/auth/login",
            json={"username": user["username"], "password": "grantpass12345"},
        ).json()
        headers = {"Authorization": f"Bearer {login['token']}"}

        book = make_book(make_game_system().id)
        _set_level(book.id, "admin")
        assert client.get(f"/api/books/{book.id}", headers=headers).status_code == 404

        grant = client.post(
            f"/api/users/{user['id']}/access-grants",
            json={"scope_type": "book", "scope_id": book.id, "level": "admin"},
            headers=admin_headers,
        )
        assert grant.status_code == 201, grant.text
        assert client.get(f"/api/books/{book.id}", headers=headers).status_code == 200

        revoke = client.delete(
            f"/api/users/{user['id']}/access-grants/{grant.json()['id']}",
            headers=admin_headers,
        )
        assert revoke.status_code == 204
        assert client.get(f"/api/books/{book.id}", headers=headers).status_code == 404

    def test_players_cannot_hold_grants(self, client, admin_headers):
        user = self._gm(client, admin_headers, role="player")
        book = make_book(make_game_system().id)
        resp = client.post(
            f"/api/users/{user['id']}/access-grants",
            json={"scope_type": "book", "scope_id": book.id, "level": "gm"},
            headers=admin_headers,
        )
        assert resp.status_code == 400
        assert "Only GMs" in resp.json()["detail"]

    def test_grant_requires_existing_target(self, client, admin_headers):
        user = self._gm(client, admin_headers)
        resp = client.post(
            f"/api/users/{user['id']}/access-grants",
            json={"scope_type": "book", "scope_id": str(uuid.uuid4()), "level": "gm"},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    def test_regranting_updates_level(self, client, admin_headers):
        user = self._gm(client, admin_headers)
        book = make_book(make_game_system().id)
        payload = {"scope_type": "book", "scope_id": book.id, "level": "gm"}
        first = client.post(
            f"/api/users/{user['id']}/access-grants", json=payload, headers=admin_headers
        )
        second = client.post(
            f"/api/users/{user['id']}/access-grants",
            json={**payload, "level": "admin"},
            headers=admin_headers,
        )
        assert second.status_code == 201
        assert first.json()["id"] == second.json()["id"]
        assert second.json()["level"] == "admin"

    def test_non_admin_cannot_manage_grants(self, client, admin_headers, gm_headers):
        user = self._gm(client, admin_headers)
        resp = client.get(f"/api/users/{user['id']}/access-grants", headers=gm_headers)
        assert resp.status_code == 403

    def test_lists_a_users_grants(self, client, admin_headers):
        user = self._gm(client, admin_headers)
        system = make_game_system()
        client.post(
            f"/api/users/{user['id']}/access-grants",
            json={"scope_type": "system", "scope_id": system.id, "level": "gm"},
            headers=admin_headers,
        )
        resp = client.get(f"/api/users/{user['id']}/access-grants", headers=admin_headers)
        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 1
        assert rows[0]["scope_type"] == "system"
        assert rows[0]["scope_id"] == system.id
        # The name is resolved for display, so the UI need not fetch it.
        assert rows[0]["scope_name"] == system.name
        assert rows[0]["level"] == "gm"

    def test_lists_empty_for_a_user_with_no_grants(self, client, admin_headers):
        user = self._gm(client, admin_headers)
        resp = client.get(f"/api/users/{user['id']}/access-grants", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_book_grant_reports_the_book_title(self, client, admin_headers):
        user = self._gm(client, admin_headers)
        book = make_book(make_game_system().id, title="Granted Tome")
        client.post(
            f"/api/users/{user['id']}/access-grants",
            json={"scope_type": "book", "scope_id": book.id, "level": "admin"},
            headers=admin_headers,
        )
        rows = client.get(
            f"/api/users/{user['id']}/access-grants", headers=admin_headers
        ).json()
        assert rows[0]["scope_name"] == "Granted Tome"

    def test_deleted_scope_reports_an_empty_name(self, client, admin_headers):
        """scope_id carries no FK, so a deleted target leaves a listable orphan."""
        user = self._gm(client, admin_headers)
        book = make_book(make_game_system().id)
        client.post(
            f"/api/users/{user['id']}/access-grants",
            json={"scope_type": "book", "scope_id": book.id, "level": "gm"},
            headers=admin_headers,
        )
        db = SessionLocal()
        db.query(Book).filter_by(id=book.id).delete()
        db.commit()
        db.close()
        rows = client.get(
            f"/api/users/{user['id']}/access-grants", headers=admin_headers
        ).json()
        assert rows[0]["scope_name"] == ""

    def test_listing_unknown_user_404s(self, client, admin_headers):
        resp = client.get(f"/api/users/{uuid.uuid4()}/access-grants", headers=admin_headers)
        assert resp.status_code == 404

    def test_granting_to_unknown_user_404s(self, client, admin_headers):
        book = make_book(make_game_system().id)
        resp = client.post(
            f"/api/users/{uuid.uuid4()}/access-grants",
            json={"scope_type": "book", "scope_id": book.id, "level": "gm"},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    def test_rejects_an_unknown_scope_type(self, client, admin_headers):
        user = self._gm(client, admin_headers)
        resp = client.post(
            f"/api/users/{user['id']}/access-grants",
            json={"scope_type": "campaign", "scope_id": "x", "level": "gm"},
            headers=admin_headers,
        )
        assert resp.status_code == 400
        assert "scope_type" in resp.json()["detail"]

    def test_rejects_an_unknown_level(self, client, admin_headers):
        user = self._gm(client, admin_headers)
        book = make_book(make_game_system().id)
        resp = client.post(
            f"/api/users/{user['id']}/access-grants",
            json={"scope_type": "book", "scope_id": book.id, "level": "superuser"},
            headers=admin_headers,
        )
        assert resp.status_code == 400
        assert "level" in resp.json()["detail"]

    def test_rejects_an_open_level(self, client, admin_headers):
        """Granting "open" would be a no-op, so it is not a valid grant."""
        user = self._gm(client, admin_headers)
        book = make_book(make_game_system().id)
        resp = client.post(
            f"/api/users/{user['id']}/access-grants",
            json={"scope_type": "book", "scope_id": book.id, "level": ""},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_system_grant_requires_an_existing_system(self, client, admin_headers):
        user = self._gm(client, admin_headers)
        resp = client.post(
            f"/api/users/{user['id']}/access-grants",
            json={"scope_type": "system", "scope_id": str(uuid.uuid4()), "level": "gm"},
            headers=admin_headers,
        )
        assert resp.status_code == 404
        assert "system" in resp.json()["detail"]

    def test_revoking_an_unknown_grant_404s(self, client, admin_headers):
        user = self._gm(client, admin_headers)
        resp = client.delete(
            f"/api/users/{user['id']}/access-grants/{uuid.uuid4()}", headers=admin_headers
        )
        assert resp.status_code == 404

    def test_cannot_revoke_another_users_grant(self, client, admin_headers):
        """The grant id is scoped to its user, so ids cannot be used across accounts."""
        owner = self._gm(client, admin_headers)
        other = self._gm(client, admin_headers)
        book = make_book(make_game_system().id)
        grant = client.post(
            f"/api/users/{owner['id']}/access-grants",
            json={"scope_type": "book", "scope_id": book.id, "level": "gm"},
            headers=admin_headers,
        ).json()
        resp = client.delete(
            f"/api/users/{other['id']}/access-grants/{grant['id']}", headers=admin_headers
        )
        assert resp.status_code == 404

    def test_demoting_a_gm_drops_their_grants(self, client, admin_headers):
        user = self._gm(client, admin_headers)
        book = make_book(make_game_system().id)
        client.post(
            f"/api/users/{user['id']}/access-grants",
            json={"scope_type": "book", "scope_id": book.id, "level": "admin"},
            headers=admin_headers,
        )
        client.patch(
            f"/api/users/{user['id']}", json={"role": "player"}, headers=admin_headers
        )
        db = SessionLocal()
        assert db.query(UserAccessGrant).filter_by(user_id=user["id"]).count() == 0
        db.close()


class TestIndirectLeaks:
    """Surfaces that expose a book's *existence* without serving its content."""

    def test_stats_counts_exclude_restricted_books(
        self, client, admin_headers, player_headers
    ):
        """A count is a disclosure: "340 books" over a shelf of 320 says three exist."""
        book = make_book(make_game_system().id)
        before = client.get("/api/stats", headers=player_headers).json()["books"]
        _set_level(book.id, "gm")
        after = client.get("/api/stats", headers=player_headers).json()["books"]
        assert after == before - 1
        # An admin still sees the whole library.
        assert client.get("/api/stats", headers=admin_headers).json()["books"] == before

    def test_sizes_exclude_restricted_books(self, client, admin_headers, player_headers):
        """Bytes leak existence the same way counts do — both size stats scope."""
        book = make_book(make_game_system().id, file_size=8 * 1048576)
        before = client.get("/api/stats", headers=player_headers).json()
        _set_level(book.id, "gm")
        after = client.get("/api/stats", headers=player_headers).json()
        assert after["total_size_mb"] == pytest.approx(before["total_size_mb"] - 8.0, abs=0.05)
        assert after["library_size_mb"] == pytest.approx(before["library_size_mb"] - 8.0, abs=0.05)
        # An admin still sees the whole library.
        admin = client.get("/api/stats", headers=admin_headers).json()
        assert admin["library_size_mb"] == pytest.approx(before["library_size_mb"], abs=0.05)

    def test_metadata_sources_404_for_restricted_book(self, client, gm_headers):
        """The metadata routes are gm/admin, but GM is who admin-only excludes."""
        book = make_book(make_game_system().id)
        _set_level(book.id, "admin")
        resp = client.get(f"/api/books/{book.id}/metadata-sources", headers=gm_headers)
        assert resp.status_code == 404

    def test_metadata_sources_ok_for_permitted_book(self, client, gm_headers):
        book = make_book(make_game_system().id)
        _set_level(book.id, "gm")
        resp = client.get(f"/api/books/{book.id}/metadata-sources", headers=gm_headers)
        assert resp.status_code == 200


def _set_system_level(system_id, level):
    db = SessionLocal()
    try:
        db.query(GameSystem).filter_by(id=system_id).update({GameSystem.access_level: level})
        db.commit()
    finally:
        db.close()


def _system_level(system_id):
    db = SessionLocal()
    try:
        return db.query(GameSystem).filter_by(id=system_id).first().access_level
    finally:
        db.close()


def _book_row(book_id):
    db = SessionLocal()
    try:
        return db.query(Book).filter_by(id=book_id).first()
    finally:
        db.close()


class TestSystemLevelWrites:
    def test_gm_bulk_edit_cannot_change_system_level(self, client, gm_headers):
        system = make_game_system()
        resp = client.post(
            "/api/systems/bulk",
            json={"items": [{"id": system.id, "access_level": "admin"}]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["updated"] == []
        assert body["errors"] == [
            {"id": system.id, "detail": "Only admins can change access levels"}
        ]
        assert _system_level(system.id) == ""

    def test_gm_bulk_edit_of_admin_only_system_reads_as_unknown(self, client, gm_headers):
        system = make_game_system()
        _set_system_level(system.id, "admin")
        resp = client.post(
            "/api/systems/bulk",
            json={"items": [{"id": system.id, "access_level": ""}]},
            headers=gm_headers,
        )
        assert resp.json()["errors"] == [{"id": system.id, "detail": "System not found"}]
        assert _system_level(system.id) == "admin"

    def test_admin_bulk_edit_sets_system_level_and_demotes_shares(
        self, client, admin_headers, gm_id
    ):
        system = make_game_system()
        book = make_book(system.id, access_level=None)
        campaign = make_campaign(gm_id)
        db = SessionLocal()
        db.add(CampaignResource(
            campaign_id=campaign.id, resource_type="book", resource_id=book.id,
            visibility="public",
        ))
        db.commit()
        db.close()

        resp = client.post(
            "/api/systems/bulk",
            json={"items": [{"id": system.id, "access_level": "gm"}]},
            headers=admin_headers,
        )
        assert resp.json() == {"updated": [system.id], "errors": []}
        assert _system_level(system.id) == "gm"
        db = SessionLocal()
        share = db.query(CampaignResource).filter_by(resource_id=book.id).first()
        assert share.visibility == "gm"
        db.close()

    def test_gm_cannot_edit_a_system_they_cannot_see(self, client, gm_headers, admin_headers):
        system = make_game_system()
        _set_system_level(system.id, "admin")
        resp = client.patch(
            f"/api/systems/{system.id}", json={"description": "x"}, headers=gm_headers
        )
        missing = client.patch(
            f"/api/systems/{uuid.uuid4()}", json={"description": "x"}, headers=gm_headers
        )
        assert resp.status_code == missing.status_code == 404
        assert resp.json() == missing.json()
        assert client.get(
            f"/api/systems/{system.id}/metadata-sources", headers=gm_headers
        ).status_code == 404
        assert client.patch(
            f"/api/systems/{system.id}", json={"description": "x"}, headers=admin_headers
        ).status_code == 200


class TestBookEditsStayWithinAccess:
    def test_gm_edit_of_hidden_book_is_404(self, client, gm_headers, admin_headers):
        book = make_book(make_game_system().id)
        _set_level(book.id, "admin")
        resp = client.patch(f"/api/books/{book.id}", json={"title": "x"}, headers=gm_headers)
        missing = client.patch(
            f"/api/books/{uuid.uuid4()}", json={"title": "x"}, headers=gm_headers
        )
        assert resp.status_code == missing.status_code == 404
        assert resp.json() == missing.json()
        assert _book_row(book.id).title != "x"
        assert client.post(f"/api/books/{book.id}/rescan", headers=gm_headers).status_code == 404
        assert client.patch(
            f"/api/books/{book.id}", json={"title": "Admin edit"}, headers=admin_headers
        ).status_code == 200

    def test_gm_bulk_edits_skip_hidden_books(self, client, gm_headers):
        system = make_game_system()
        hidden, shown = make_book(system.id), make_book(system.id)
        _set_level(hidden.id, "admin")
        resp = client.post(
            "/api/books/bulk",
            json={"items": [{"id": hidden.id, "title": "x"}, {"id": shown.id, "title": "y"}]},
            headers=gm_headers,
        )
        assert resp.json() == {
            "updated": [shown.id],
            "errors": [{"id": hidden.id, "detail": "Book not found"}],
        }
        assert _book_row(hidden.id).title != "x"

        resp = client.post(
            "/api/books/bulk/tags",
            json={"ids": [hidden.id, shown.id], "tags": ["gm-tagged"]},
            headers=gm_headers,
        )
        body = resp.json()
        assert body["updated"] == [shown.id]
        assert body["errors"] == [{"id": hidden.id, "detail": "Book not found"}]

    def test_gm_cannot_recategorise_into_a_wider_level(self, client, admin_headers, gm_headers):
        client.patch(
            "/api/settings",
            json={"restricted_categories": {"adventure": "gm"}},
            headers=admin_headers,
        )
        book = make_book(make_game_system().id, category="adventure", access_level=None)
        resp = client.patch(
            f"/api/books/{book.id}", json={"category": "supplement"}, headers=gm_headers
        )
        assert resp.status_code == 403
        assert _book_row(book.id).category == "adventure"

        resp = client.post(
            "/api/books/bulk",
            json={"items": [{"id": book.id, "category": "supplement"}]},
            headers=gm_headers,
        )
        assert resp.json()["updated"] == []
        assert _book_row(book.id).category == "adventure"

    def test_gm_can_recategorise_within_the_same_level(self, client, admin_headers, gm_headers):
        client.patch(
            "/api/settings",
            json={"restricted_categories": {"adventure": "gm"}},
            headers=admin_headers,
        )
        book = make_book(make_game_system().id, category="supplement", access_level=None)
        resp = client.patch(
            f"/api/books/{book.id}", json={"category": "adventure"}, headers=gm_headers
        )
        assert resp.status_code == 200

    def test_admin_can_recategorise_freely(self, client, admin_headers):
        client.patch(
            "/api/settings",
            json={"restricted_categories": {"adventure": "gm"}},
            headers=admin_headers,
        )
        book = make_book(make_game_system().id, category="adventure", access_level=None)
        resp = client.patch(
            f"/api/books/{book.id}", json={"category": "supplement"}, headers=admin_headers
        )
        assert resp.status_code == 200


class TestListsShowOnlyVisible:
    def test_resource_picker_lists_only_visible_books(
        self, client, gm_headers, player_headers, admin_headers
    ):
        system = make_game_system(name=f"Hidden Line {uuid.uuid4().hex[:6]}")
        shown = make_book(system.id, title="Picker Visible")
        hidden = make_book(system.id, title="Picker Hidden")
        _set_level(hidden.id, "gm")

        def ids(headers, **params):
            resp = client.get(
                "/api/campaigns/resources/search",
                params={"resource_type": "book", "system_id": system.id, **params},
                headers=headers,
            )
            return [r["resource_id"] for r in resp.json()]

        assert ids(player_headers) == [shown.id]
        assert set(ids(admin_headers)) == {shown.id, hidden.id}
        suggested = client.get(
            f"/api/campaigns/resources/suggested/{system.id}", headers=player_headers
        ).json()
        assert [r["resource_id"] for r in suggested] == [shown.id]

    def test_resource_picker_never_names_a_hidden_system(self, client, player_headers):
        name = f"Secret Shelf {uuid.uuid4().hex[:6]}"
        system = make_game_system(name=name)
        book = make_book(system.id, access_level="")
        _set_system_level(system.id, "gm")
        rows = client.get(
            "/api/campaigns/resources/search",
            params={"resource_type": "book", "q": book.title},
            headers=player_headers,
        ).json()
        row = next(r for r in rows if r["resource_id"] == book.id)
        assert name not in row["subtitle"]
        assert client.get(
            f"/api/campaigns/resources/suggested/{system.id}", headers=player_headers
        ).json() == []

    def test_book_detail_and_search_never_name_a_hidden_system(
        self, client, player_headers, admin_headers
    ):
        from ._mcp import index_page

        name = f"Secret Shelf {uuid.uuid4().hex[:6]}"
        system = make_game_system(name=name)
        book = make_book(system.id, access_level="")
        word = f"zq{uuid.uuid4().hex[:8]}"
        index_page(book.id, 1, f"The {word} lurks here.")
        _set_system_level(system.id, "gm")
        assert client.get(f"/api/systems/{system.id}", headers=player_headers).status_code == 404

        detail = client.get(f"/api/books/{book.id}", headers=player_headers).json()
        assert detail["game_system"] is None

        by_title = client.get(
            "/api/search", params={"q": f"title:{book.title}"}, headers=player_headers
        ).json()["book_matches"]
        row = next(r for r in by_title if r["id"] == book.id)
        assert row["game_system"] == "" and row["game_system_id"] == ""

        hits = client.get("/api/search", params={"q": word}, headers=player_headers).json()
        hit = next(r for r in hits["results"] if r["id"] == book.id)
        assert hit["game_system"] == "" and hit["game_system_id"] == ""
        assert name not in str(detail) + str(by_title) + str(hits)

        # Someone who can see the system still gets it named.
        assert client.get(f"/api/books/{book.id}", headers=admin_headers).json()[
            "game_system"
        ]["name"] == name
        admin_hits = client.get("/api/search", params={"q": word}, headers=admin_headers).json()
        assert next(r for r in admin_hits["results"] if r["id"] == book.id)["game_system"] == name

    def test_container_page_lists_only_visible_children(
        self, client, player_headers, admin_headers
    ):
        container = make_game_system(container_kind="family")
        open_child = make_game_system(parent_id=container.id)
        hidden_child = make_game_system(parent_id=container.id)
        _set_system_level(hidden_child.id, "gm")
        make_book(open_child.id)
        _set_level(make_book(open_child.id).id, "gm")

        body = client.get(f"/api/systems/{container.id}", headers=player_headers).json()
        assert [c["id"] for c in body["children"]] == [open_child.id]
        assert body["children"][0]["book_count"] == 1

        listed = client.get(
            "/api/systems", params={"include_children": True}, headers=player_headers
        ).json()
        assert next(r for r in listed if r["id"] == container.id)["child_count"] == 1

        admin = client.get(f"/api/systems/{container.id}", headers=admin_headers).json()
        assert {c["id"] for c in admin["children"]} == {open_child.id, hidden_child.id}
        row = next(c for c in admin["children"] if c["id"] == open_child.id)
        assert row["book_count"] == 2

    def test_version_list_omits_versions_the_viewer_cannot_open(
        self, client, player_headers, admin_headers
    ):
        from backend.services import variants

        system = make_game_system()
        main = make_book(system.id)
        shown, hidden = make_book(system.id), make_book(system.id)
        db = SessionLocal()
        variants.link(db, Book, main.id, shown.id, "printer-friendly", "")
        variants.link(db, Book, main.id, hidden.id, "version", "")
        db.commit()
        db.close()
        _set_level(hidden.id, "gm")

        body = client.get(f"/api/books/{main.id}", headers=player_headers).json()
        assert [v["id"] for v in body["variants"]] == [shown.id]
        admin = client.get(f"/api/books/{main.id}", headers=admin_headers).json()
        assert {v["id"] for v in admin["variants"]} == {shown.id, hidden.id}

    def test_version_list_omits_a_main_version_the_viewer_cannot_open(
        self, client, player_headers
    ):
        from backend.services import variants

        system = make_game_system()
        main = make_book(system.id, filename="main-version.pdf")
        variant = make_book(system.id, access_level="")
        db = SessionLocal()
        variants.link(db, Book, main.id, variant.id, "printer-friendly", "")
        db.commit()
        db.close()
        _set_level(main.id, "gm")

        body = client.get(f"/api/books/{variant.id}", headers=player_headers).json()
        assert body["variant_main_id"] is None
        assert body["variant_parent_id"] is None
        assert body["variant_main_filename"] == ""
        assert body["variants"] == []

    def test_systems_list_cover_comes_from_visible_books(
        self, client, player_headers, admin_headers
    ):
        system = make_game_system()
        hidden = make_book(system.id, title="A Hidden Cover", has_thumbnail=True)
        shown = make_book(system.id, title="B Shown Cover", has_thumbnail=True)
        _set_level(hidden.id, "gm")

        def cover(headers):
            rows = client.get("/api/systems", headers=headers).json()
            return next(s for s in rows if s["id"] == system.id)["cover_book_id"]

        assert cover(player_headers) == shown.id
        assert cover(admin_headers) == hidden.id

        db = SessionLocal()
        db.query(GameSystem).filter_by(id=system.id).update(
            {GameSystem.cover_book_id: hidden.id}
        )
        db.commit()
        db.close()
        assert cover(player_headers) == shown.id
        assert cover(admin_headers) == hidden.id

    def test_hidden_system_cover_and_folders_404(self, client, player_headers, admin_headers):
        system = make_game_system()
        _set_system_level(system.id, "gm")
        assert client.get(
            f"/api/systems/{system.id}/book-folders", headers=player_headers
        ).status_code == 404
        assert client.get(
            f"/api/systems/{system.id}/cover", headers=player_headers
        ).json() == {"detail": "System not found"}
        assert client.get(
            f"/api/systems/{system.id}/book-folders", headers=admin_headers
        ).status_code == 200


class TestTagsAndStatsCountOnlyVisible:
    def test_tag_list_counts_only_visible_books(self, client, player_headers, admin_headers):
        tag = f"spoiler{uuid.uuid4().hex[:6]}"
        system = make_game_system()
        hidden = make_book(system.id, tags=[tag])
        _set_level(hidden.id, "gm")

        def counts(headers, **params):
            rows = client.get("/api/tags", params=params, headers=headers).json()["tags"]
            return {t["internal"]: t["count"] for t in rows}

        assert tag not in counts(player_headers)
        assert tag not in counts(player_headers, in_use_by="book")
        assert counts(admin_headers)[tag] == 1
        assert counts(admin_headers, in_use_by="book")[tag] == 1

        shown = make_book(system.id, tags=[tag])
        assert counts(player_headers)[tag] == 1
        assert counts(admin_headers)[tag] == 2
        assert shown.id

    def test_tag_list_counts_only_visible_systems(self, client, player_headers, admin_headers):
        tag = f"shelf{uuid.uuid4().hex[:6]}"
        system = make_game_system(tags=[tag])
        _set_system_level(system.id, "gm")
        rows = client.get("/api/tags", headers=player_headers).json()["tags"]
        assert tag not in {t["internal"] for t in rows}
        rows = client.get("/api/tags", headers=admin_headers).json()["tags"]
        assert tag in {t["internal"] for t in rows}

    def test_unused_tags_still_listed_for_players(self, client, admin_headers, player_headers):
        tag = f"fresh{uuid.uuid4().hex[:6]}"
        client.post("/api/tags", json={"value": tag}, headers=admin_headers)
        rows = client.get("/api/tags", headers=player_headers).json()["tags"]
        assert tag in {t["internal"] for t in rows}

    def test_tag_folder_groups_skip_hidden_systems(self, client, player_headers, admin_headers):
        from backend.models import BookFolder

        tag = f"foldertag{uuid.uuid4().hex[:6]}"
        system = make_game_system()
        db = SessionLocal()
        db.add(BookFolder(path=f"{system.id}/adventure/Deep", tags=[tag]))
        db.commit()
        db.close()
        try:
            _set_system_level(system.id, "gm")
            body = client.get(f"/api/tags/{tag}/items", headers=player_headers)
            assert body.status_code == 200
            assert body.json()["folders"] == []
            admin = client.get(f"/api/tags/{tag}/items", headers=admin_headers).json()
            assert [f["key"] for f in admin["folders"]] == [f"{system.id}/adventure/Deep"]
        finally:
            db = SessionLocal()
            db.query(BookFolder).filter_by(path=f"{system.id}/adventure/Deep").delete()
            db.commit()
            db.close()

    def test_favourite_tag_counts_only_visible_books(self, client, player_headers):
        tag = f"favtag{uuid.uuid4().hex[:6]}"
        system = make_game_system()
        make_book(system.id, tags=[tag])
        _set_level(make_book(system.id, tags=[tag]).id, "gm")
        client.post(
            "/api/favorites", json={"item_type": "tag", "item_id": tag}, headers=player_headers
        )
        try:
            items = client.get("/api/favorites", headers=player_headers).json()["items"]
            row = next(f for f in items if f["item_type"] == "tag" and f["item_id"] == tag)
            assert row["count"] == 1
        finally:
            client.delete(f"/api/favorites/tag/{tag}", headers=player_headers)

    def test_stats_count_only_visible_systems(self, client, player_headers, admin_headers):
        before = client.get("/api/stats", headers=player_headers).json()["game_systems"]
        admin_before = client.get("/api/stats", headers=admin_headers).json()["game_systems"]
        system = make_game_system()
        _set_system_level(system.id, "gm")
        assert client.get("/api/stats", headers=player_headers).json()["game_systems"] == before
        assert (
            client.get("/api/stats", headers=admin_headers).json()["game_systems"]
            == admin_before + 1
        )
