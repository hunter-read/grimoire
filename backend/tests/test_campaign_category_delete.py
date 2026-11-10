"""A campaign whose resources or wiki pages sit in a custom category can still
be deleted, by its owner or along with the owner's account.

`campaign_resources.category_id` and `wiki_pages.category_id` point at
`campaign_categories` with no ON DELETE. When a campaign goes, its resources,
pages and categories are all deleted in one flush, so the items must be
deleted before the categories they are filed under or the database rejects the
delete.
"""
import uuid

import pytest

from backend.config import SessionLocal
from backend.models import (
    Book,
    Campaign,
    CampaignCategory,
    CampaignResource,
    WikiPage,
)

from .conftest import make_book, make_game_system


def _make_gm(client, admin_headers):
    username = f"catgm_{uuid.uuid4().hex[:8]}"
    password = "password123-long"
    resp = client.post(
        "/api/users",
        json={"username": username, "password": password, "role": "gm"},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    login = client.post("/api/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200, login.text
    return resp.json(), {"Authorization": f"Bearer {login.json()['token']}"}


@pytest.fixture
def book():
    made = make_book(make_game_system().id)
    yield made
    db = SessionLocal()
    try:
        db.query(Book).filter_by(id=made.id).delete()
        db.commit()
    finally:
        db.close()


def _campaign_with_filed_resource(client, headers, book_id):
    """A campaign holding one resource filed under a custom resource category."""
    campaign = client.post(
        "/api/campaigns",
        json={"name": f"Filed {uuid.uuid4().hex[:8]}", "is_gm_campaign": True},
        headers=headers,
    )
    assert campaign.status_code == 201, campaign.text
    cid = campaign.json()["id"]
    category = client.post(
        f"/api/campaigns/{cid}/categories",
        json={"name": "Handouts", "kind": "resource"},
        headers=headers,
    )
    assert category.status_code == 201, category.text
    resource = client.post(
        f"/api/campaigns/{cid}/resources",
        json={
            "resource_type": "book",
            "resource_id": book_id,
            "category_id": category.json()["id"],
        },
        headers=headers,
    )
    assert resource.status_code in (200, 201), resource.text

    db = SessionLocal()
    try:
        # Guard the fixture: the failure needs a resource that names the category.
        filed = db.query(CampaignResource).filter_by(campaign_id=cid).one()
        assert filed.category_id == category.json()["id"]
    finally:
        db.close()
    return cid


def _file_a_wiki_page(client, headers, cid):
    """Put one wiki page under a custom note category.

    Note categories are no longer created through the API (they became parent
    pages), but rows from before that change can still exist.
    """
    page = client.post(
        f"/api/campaigns/{cid}/wiki",
        json={"title": f"Page {uuid.uuid4().hex[:6]}"},
        headers=headers,
    )
    assert page.status_code in (200, 201), page.text
    db = SessionLocal()
    try:
        category = CampaignCategory(campaign_id=cid, kind="note", name="Lore")
        db.add(category)
        db.flush()
        db.query(WikiPage).filter_by(id=page.json()["id"]).update({"category_id": category.id})
        db.commit()
    finally:
        db.close()


def _assert_campaign_gone(cid):
    db = SessionLocal()
    try:
        assert db.query(Campaign).filter_by(id=cid).count() == 0
        assert db.query(CampaignResource).filter_by(campaign_id=cid).count() == 0
        assert db.query(WikiPage).filter_by(campaign_id=cid).count() == 0
        assert db.query(CampaignCategory).filter_by(campaign_id=cid).count() == 0
    finally:
        db.close()


class TestDeleteCampaignWithCategories:
    def test_owner_deletes_a_campaign_with_a_filed_resource(self, client, admin_headers, book):
        _, headers = _make_gm(client, admin_headers)
        cid = _campaign_with_filed_resource(client, headers, book.id)

        resp = client.delete(f"/api/campaigns/{cid}", headers=headers)
        assert resp.status_code == 204, resp.text
        _assert_campaign_gone(cid)

    def test_owner_deletes_a_campaign_with_a_filed_wiki_page(self, client, admin_headers, book):
        _, headers = _make_gm(client, admin_headers)
        cid = _campaign_with_filed_resource(client, headers, book.id)
        _file_a_wiki_page(client, headers, cid)

        resp = client.delete(f"/api/campaigns/{cid}", headers=headers)
        assert resp.status_code == 204, resp.text
        _assert_campaign_gone(cid)

    def test_admin_deletes_the_owner(self, client, admin_headers, book):
        user, headers = _make_gm(client, admin_headers)
        cid = _campaign_with_filed_resource(client, headers, book.id)
        _file_a_wiki_page(client, headers, cid)

        resp = client.delete(f"/api/users/{user['id']}", headers=admin_headers)
        assert resp.status_code == 204, resp.text
        _assert_campaign_gone(cid)

    def test_owner_deletes_their_own_account(self, client, admin_headers, book):
        _, headers = _make_gm(client, admin_headers)
        cid = _campaign_with_filed_resource(client, headers, book.id)
        _file_a_wiki_page(client, headers, cid)

        resp = client.delete("/api/users/me", headers=headers)
        assert resp.status_code == 204, resp.text
        _assert_campaign_gone(cid)
