"""Campaign resources hold only what the owner can open, and each viewer's list
shows only the books that viewer can read.

Covers the three ways a resource is linked (the create wizard, a single add,
the bulk add) and the two ways the links are read back (the resource list and
the campaign detail).
"""
import uuid

import pytest

from backend.config import SessionLocal
from backend.models import AppSetting, Book, CampaignFile
from backend.models.access import CATEGORY_DEFAULTS_KEY

from .conftest import make_book, make_campaign, make_game_system


@pytest.fixture
def books():
    """Make books for one test and delete them after, so a restricted book
    never lingers in another module's browse results."""
    made = []

    def _make(level=None, **kwargs):
        if level is not None:
            kwargs["access_level"] = level
        book = make_book(make_game_system().id, **kwargs)
        made.append(book.id)
        return book

    yield _make
    db = SessionLocal()
    try:
        db.query(Book).filter(Book.id.in_(made)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def clear_category_defaults():
    """Drop the global ``restricted_categories`` setting a test wrote, so it
    cannot hide books from another module's tests."""
    yield
    db = SessionLocal()
    try:
        db.query(AppSetting).filter_by(key=CATEGORY_DEFAULTS_KEY).delete()
        db.commit()
    finally:
        db.close()


def _campaign(client, headers, **extra):
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Resources {uuid.uuid4().hex[:8]}", **extra},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _join(client, gm_headers, player_headers, player_id, campaign_id):
    client.post(
        f"/api/campaigns/{campaign_id}/invite", json={"user_id": player_id}, headers=gm_headers
    )
    resp = client.patch(
        f"/api/campaigns/{campaign_id}/members/{player_id}",
        json={"status": "accepted"},
        headers=player_headers,
    )
    assert resp.status_code == 200, resp.text


def _listed(client, headers, campaign_id):
    resp = client.get(f"/api/campaigns/{campaign_id}/resources", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _detail_ids(client, headers, campaign_id):
    resp = client.get(f"/api/campaigns/{campaign_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    return {r["resource_id"] for r in resp.json()["resources"]}


def _book(book_id, visibility="public"):
    return {"resource_type": "book", "resource_id": book_id, "visibility": visibility}


class TestCreateWizard:
    def test_player_cannot_link_admin_only_book(self, client, player_headers, books):
        hidden = books("admin")
        open_book = books()
        campaign = _campaign(
            client, player_headers, resources=[_book(hidden.id), _book(open_book.id)]
        )

        listed = _listed(client, player_headers, campaign["id"])
        assert [r["resource_id"] for r in listed] == [open_book.id]
        assert hidden.title not in {r["name"] for r in listed}
        assert hidden.id not in _detail_ids(client, player_headers, campaign["id"])

    def test_gm_level_book_is_kept_from_players(
        self, client, gm_headers, player_headers, player_id, books
    ):
        gm_book = books("gm")
        campaign = _campaign(
            client, gm_headers, is_gm_campaign=True, resources=[_book(gm_book.id)]
        )
        _join(client, gm_headers, player_headers, player_id, campaign["id"])

        owner_rows = _listed(client, gm_headers, campaign["id"])
        assert [(r["resource_id"], r["visibility"]) for r in owner_rows] == [(gm_book.id, "gm")]
        assert _listed(client, player_headers, campaign["id"]) == []

    def test_another_campaigns_file_is_skipped(self, client, gm_headers, gm_id):
        other = make_campaign(gm_id)
        db = SessionLocal()
        f = CampaignFile(campaign_id=other.id, stored_path="x.pdf", filename="secret-notes.pdf")
        db.add(f)
        db.commit()
        file_id = f.id
        db.close()

        campaign = _campaign(
            client,
            gm_headers,
            resources=[{"resource_type": "file", "resource_id": file_id, "visibility": "gm"}],
        )
        assert _listed(client, gm_headers, campaign["id"]) == []


class TestAddResource:
    def test_unreadable_book_is_refused(self, client, player_headers, books):
        hidden = books("gm")
        campaign = _campaign(client, player_headers)
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/resources",
            json=_book(hidden.id),
            headers=player_headers,
        )
        assert resp.status_code == 404
        assert hidden.title not in resp.text
        assert _listed(client, player_headers, campaign["id"]) == []

    def test_missing_book_answers_the_same(self, client, player_headers):
        campaign = _campaign(client, player_headers)
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/resources",
            json=_book(str(uuid.uuid4())),
            headers=player_headers,
        )
        assert resp.status_code == 404

    def test_another_campaigns_file_is_refused(self, client, gm_headers, gm_id):
        other = make_campaign(gm_id)
        db = SessionLocal()
        f = CampaignFile(campaign_id=other.id, stored_path="y.pdf", filename="other.pdf")
        db.add(f)
        db.commit()
        file_id = f.id
        db.close()

        campaign = _campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/resources",
            json={"resource_type": "file", "resource_id": file_id, "visibility": "gm"},
            headers=gm_headers,
        )
        assert resp.status_code == 404

    def test_bulk_add_skips_unreadable_books(self, client, gm_headers, books):
        hidden = books("admin")
        open_book = books()
        campaign = _campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/resources/bulk",
            json={"resources": [_book(hidden.id), _book(open_book.id)]},
            headers=gm_headers,
        )
        assert resp.status_code in (200, 201), resp.text
        assert [r["resource_id"] for r in resp.json()] == [open_book.id]


class TestListing:
    def test_book_restricted_after_linking_drops_out(
        self, client, gm_headers, player_headers, player_id, books
    ):
        book = books()
        campaign = _campaign(client, gm_headers, is_gm_campaign=True, resources=[_book(book.id)])
        _join(client, gm_headers, player_headers, player_id, campaign["id"])
        assert [r["resource_id"] for r in _listed(client, player_headers, campaign["id"])] == [
            book.id
        ]

        # Set directly, leaving the share public, so the listing filter alone is
        # what keeps it from the player.
        db = SessionLocal()
        db.query(Book).filter_by(id=book.id).update({Book.access_level: "admin"})
        db.commit()
        db.close()

        assert _listed(client, player_headers, campaign["id"]) == []
        assert book.id not in _detail_ids(client, player_headers, campaign["id"])
        # The GM owner cannot read an admin-only book either.
        assert _listed(client, gm_headers, campaign["id"]) == []

    def test_book_restricted_through_category_default_drops_out(
        self, client, admin_headers, gm_headers, player_headers, player_id, books,
        clear_category_defaults,
    ):
        # Inherits its level, so the category default alone restricts it.
        book = books(category="adventure", access_level=None)
        campaign = _campaign(client, gm_headers, is_gm_campaign=True, resources=[_book(book.id)])
        _join(client, gm_headers, player_headers, player_id, campaign["id"])
        assert [r["resource_id"] for r in _listed(client, player_headers, campaign["id"])] == [
            book.id
        ]

        resp = client.patch(
            "/api/settings",
            json={"restricted_categories": {"adventure": "gm"}},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text

        assert _listed(client, player_headers, campaign["id"]) == []
        assert book.id not in _detail_ids(client, player_headers, campaign["id"])
        # The GM can still read a GM-level book, so it stays in their list.
        assert [r["resource_id"] for r in _listed(client, gm_headers, campaign["id"])] == [
            book.id
        ]

    def test_book_moved_into_restricted_category_drops_out(
        self, client, gm_headers, player_headers, player_id, books, clear_category_defaults
    ):
        db = SessionLocal()
        db.add(AppSetting(key=CATEGORY_DEFAULTS_KEY, value='{"adventure": "gm"}'))
        db.commit()
        db.close()
        book = books(category="supplement", access_level=None)
        campaign = _campaign(client, gm_headers, is_gm_campaign=True, resources=[_book(book.id)])
        _join(client, gm_headers, player_headers, player_id, campaign["id"])
        assert [r["resource_id"] for r in _listed(client, player_headers, campaign["id"])] == [
            book.id
        ]

        resp = client.patch(
            f"/api/books/{book.id}", json={"category": "adventure"}, headers=gm_headers
        )
        assert resp.status_code == 200, resp.text

        assert _listed(client, player_headers, campaign["id"]) == []
        assert book.id not in _detail_ids(client, player_headers, campaign["id"])
