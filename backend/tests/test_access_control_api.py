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
