"""Tests for campaign management endpoints."""
import uuid
import pytest
from tests.conftest import make_campaign, make_game_system, make_book, make_map, make_token


def uid():
    return uuid.uuid4().hex[:8]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def gm_campaign(client, gm_headers, gm_id):
    resp = client.post(
        "/api/campaigns",
        json={
            "name": "Test GM Campaign",
            "description": "A test campaign",
            "is_gm_campaign": True,
        },
        headers=gm_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture(scope="module")
def player_campaign(client, player_headers, player_id):
    resp = client.post(
        "/api/campaigns",
        json={
            "name": "My Player Campaign",
            "is_gm_campaign": False,
        },
        headers=player_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Campaign CRUD
# ---------------------------------------------------------------------------


class TestListCampaigns:
    def test_returns_list(self, client, gm_headers, gm_campaign):
        resp = client.get("/api/campaigns", headers=gm_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_own_campaign_in_list(self, client, gm_headers, gm_campaign):
        ids = [c["id"] for c in client.get("/api/campaigns", headers=gm_headers).json()]
        assert gm_campaign["id"] in ids

    def test_unauthenticated_denied(self, client):
        assert client.get("/api/campaigns").status_code == 401


class TestCreateCampaign:
    def test_gm_can_create_gm_campaign(self, client, gm_headers):
        resp = client.post(
            "/api/campaigns",
            json={
                "name": f"Campaign {uid()}",
                "is_gm_campaign": True,
            },
            headers=gm_headers,
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["is_gm_campaign"] is True
        assert "id" in body

    def test_player_can_create_personal_campaign(self, client, player_headers):
        resp = client.post(
            "/api/campaigns",
            json={
                "name": f"Personal {uid()}",
                "is_gm_campaign": False,
            },
            headers=player_headers,
        )
        assert resp.status_code == 201

    def test_player_cannot_create_gm_campaign(self, client, player_headers):
        resp = client.post(
            "/api/campaigns",
            json={
                "name": "Player tries GM",
                "is_gm_campaign": True,
            },
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_unauthenticated_denied(self, client):
        assert client.post("/api/campaigns", json={"name": "x"}).status_code == 401


class TestGetCampaign:
    def test_owner_can_get(self, client, gm_headers, gm_campaign):
        resp = client.get(f"/api/campaigns/{gm_campaign['id']}", headers=gm_headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == gm_campaign["id"]

    def test_response_has_members_and_resources(self, client, gm_headers, gm_campaign):
        body = client.get(f"/api/campaigns/{gm_campaign['id']}", headers=gm_headers).json()
        assert "members" in body
        assert "resources" in body

    def test_nonmember_cannot_get(self, client, player_headers, gm_campaign):
        resp = client.get(f"/api/campaigns/{gm_campaign['id']}", headers=player_headers)
        assert resp.status_code == 403

    def test_admin_can_get_any(self, client, admin_headers, gm_campaign):
        assert (
            client.get(f"/api/campaigns/{gm_campaign['id']}", headers=admin_headers).status_code
            == 200
        )

    def test_nonexistent_returns_404(self, client, gm_headers):
        assert client.get("/api/campaigns/nonexistent-id", headers=gm_headers).status_code == 404


class TestUpdateCampaign:
    def test_owner_can_update(self, client, gm_headers, gm_campaign):
        resp = client.patch(
            f"/api/campaigns/{gm_campaign['id']}",
            json={
                "name": "Updated Name",
                "description": "Updated description",
            },
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Name"

    def test_nonowner_cannot_update(self, client, player_headers, gm_campaign):
        resp = client.patch(
            f"/api/campaigns/{gm_campaign['id']}", json={"name": "Hack"}, headers=player_headers
        )
        assert resp.status_code == 403

    def test_admin_can_update_any(self, client, admin_headers, gm_campaign):
        resp = client.patch(
            f"/api/campaigns/{gm_campaign['id']}",
            json={"description": "Admin edit"},
            headers=admin_headers,
        )
        assert resp.status_code == 200


class TestDeleteCampaign:
    def test_owner_can_delete(self, client, gm_headers, gm_id):
        c = make_campaign(owner_id=gm_id, is_gm_campaign=True)
        resp = client.delete(f"/api/campaigns/{c.id}", headers=gm_headers)
        assert resp.status_code == 204
        assert client.get(f"/api/campaigns/{c.id}", headers=gm_headers).status_code == 404

    def test_nonowner_cannot_delete(self, client, player_headers, gm_campaign):
        assert (
            client.delete(f"/api/campaigns/{gm_campaign['id']}", headers=player_headers).status_code
            == 403
        )


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------


class TestMembers:
    @pytest.fixture(scope="class")
    def fresh_campaign(self, client, gm_headers, gm_id):
        resp = client.post(
            "/api/campaigns",
            json={
                "name": f"Member Test {uid()}",
                "is_gm_campaign": True,
            },
            headers=gm_headers,
        )
        assert resp.status_code == 201
        return resp.json()

    def test_gm_can_invite_player(self, client, gm_headers, player_id, fresh_campaign):
        resp = client.post(
            f"/api/campaigns/{fresh_campaign['id']}/invite",
            json={"user_id": player_id},
            headers=gm_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["status"] == "invited"

    def test_duplicate_invite_rejected(self, client, gm_headers, player_id, fresh_campaign):
        resp = client.post(
            f"/api/campaigns/{fresh_campaign['id']}/invite",
            json={"user_id": player_id},
            headers=gm_headers,
        )
        assert resp.status_code == 409

    def test_player_can_accept_invite(self, client, player_headers, player_id, fresh_campaign):
        resp = client.patch(
            f"/api/campaigns/{fresh_campaign['id']}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "accepted"

    def test_accepted_member_can_view_campaign(self, client, player_headers, fresh_campaign):
        assert (
            client.get(f"/api/campaigns/{fresh_campaign['id']}", headers=player_headers).status_code
            == 200
        )

    def test_player_can_set_character_name(self, client, player_headers, player_id, fresh_campaign):
        resp = client.patch(
            f"/api/campaigns/{fresh_campaign['id']}/members/{player_id}",
            json={"character_name": "Aragorn"},
            headers=player_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["character_name"] == "Aragorn"

    def test_gm_can_remove_member(self, client, gm_headers, player_id, fresh_campaign):
        resp = client.delete(
            f"/api/campaigns/{fresh_campaign['id']}/members/{player_id}",
            headers=gm_headers,
        )
        assert resp.status_code == 204

    def test_cannot_invite_to_personal_campaign(
        self, client, gm_headers, player_campaign, player_id
    ):
        resp = client.post(
            f"/api/campaigns/{player_campaign['id']}/invite",
            json={"user_id": player_id},
            headers=gm_headers,
        )
        assert resp.status_code in (400, 403)

    def test_invite_nonexistent_user_returns_404(self, client, gm_headers, fresh_campaign):
        resp = client.post(
            f"/api/campaigns/{fresh_campaign['id']}/invite",
            json={"user_id": "does-not-exist"},
            headers=gm_headers,
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Resources
# ---------------------------------------------------------------------------


class TestResources:
    @pytest.fixture(scope="class")
    def campaign_with_book(self, client, gm_headers, gm_id):
        sys = make_game_system()
        book = make_book(system_id=sys.id)
        resp = client.post(
            "/api/campaigns",
            json={
                "name": f"Resource Test {uid()}",
                "is_gm_campaign": True,
            },
            headers=gm_headers,
        )
        assert resp.status_code == 201
        return resp.json(), book

    def test_gm_can_add_book_resource(self, client, gm_headers, campaign_with_book):
        campaign, book = campaign_with_book
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/resources",
            json={
                "resource_type": "book",
                "resource_id": book.id,
                "shared": True,
            },
            headers=gm_headers,
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["resource_type"] == "book"
        assert body["shared"] is True

    def test_duplicate_resource_rejected(self, client, gm_headers, campaign_with_book):
        campaign, book = campaign_with_book
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/resources",
            json={
                "resource_type": "book",
                "resource_id": book.id,
            },
            headers=gm_headers,
        )
        assert resp.status_code == 409

    def test_gm_can_list_resources(self, client, gm_headers, campaign_with_book):
        campaign, _ = campaign_with_book
        resp = client.get(f"/api/campaigns/{campaign['id']}/resources", headers=gm_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_gm_can_update_sharing(self, client, gm_headers, campaign_with_book):
        campaign, book = campaign_with_book
        resources = client.get(
            f"/api/campaigns/{campaign['id']}/resources", headers=gm_headers
        ).json()
        res_id = next(r["id"] for r in resources if r["resource_id"] == book.id)
        resp = client.patch(
            f"/api/campaigns/{campaign['id']}/resources/{res_id}",
            json={"shared": False},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["shared"] is False

    def test_invalid_resource_type_rejected(self, client, gm_headers, campaign_with_book):
        campaign, _ = campaign_with_book
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/resources",
            json={
                "resource_type": "invalid",
                "resource_id": "some-id",
            },
            headers=gm_headers,
        )
        assert resp.status_code == 400

    def test_gm_can_remove_resource(self, client, gm_headers, campaign_with_book):
        campaign, book = campaign_with_book
        resources = client.get(
            f"/api/campaigns/{campaign['id']}/resources", headers=gm_headers
        ).json()
        res_id = next(r["id"] for r in resources if r["resource_id"] == book.id)
        assert (
            client.delete(
                f"/api/campaigns/{campaign['id']}/resources/{res_id}", headers=gm_headers
            ).status_code
            == 204
        )


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


class TestSessions:
    @pytest.fixture(scope="class")
    def campaign(self, client, gm_headers):
        resp = client.post(
            "/api/campaigns",
            json={
                "name": f"Session Test {uid()}",
                "is_gm_campaign": True,
            },
            headers=gm_headers,
        )
        assert resp.status_code == 201
        return resp.json()

    def test_create_session(self, client, gm_headers, campaign):
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/sessions",
            json={
                "session_date": "2026-05-01",
                "title": "Session 1",
            },
            headers=gm_headers,
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["session_date"] == "2026-05-01"
        assert body["title"] == "Session 1"
        assert "id" in body

    def test_list_sessions(self, client, gm_headers, campaign):
        resp = client.get(f"/api/campaigns/{campaign['id']}/sessions", headers=gm_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
        assert len(resp.json()) >= 1

    def test_get_session_detail(self, client, gm_headers, campaign):
        sessions = client.get(
            f"/api/campaigns/{campaign['id']}/sessions", headers=gm_headers
        ).json()
        sid = sessions[0]["id"]
        resp = client.get(f"/api/campaigns/{campaign['id']}/sessions/{sid}", headers=gm_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "player_notes" in body
        assert "gm_note" in body

    def test_update_session_title(self, client, gm_headers, campaign):
        sessions = client.get(
            f"/api/campaigns/{campaign['id']}/sessions", headers=gm_headers
        ).json()
        sid = sessions[0]["id"]
        resp = client.patch(
            f"/api/campaigns/{campaign['id']}/sessions/{sid}",
            json={"title": "Updated Title"},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Updated Title"

    def test_invalid_date_rejected(self, client, gm_headers, campaign):
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/sessions",
            json={
                "session_date": "not-a-date",
            },
            headers=gm_headers,
        )
        assert resp.status_code == 400

    def test_gm_can_save_gm_note(self, client, gm_headers, campaign):
        sessions = client.get(
            f"/api/campaigns/{campaign['id']}/sessions", headers=gm_headers
        ).json()
        sid = sessions[0]["id"]
        resp = client.put(
            f"/api/campaigns/{campaign['id']}/sessions/{sid}/notes/gm",
            json={"internal_content": "GM secret", "external_content": "Shared recap"},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["internal_content"] == "GM secret"

    def test_delete_session(self, client, gm_headers, campaign):
        create = client.post(
            f"/api/campaigns/{campaign['id']}/sessions",
            json={
                "session_date": "2026-06-01",
            },
            headers=gm_headers,
        )
        sid = create.json()["id"]
        assert (
            client.delete(
                f"/api/campaigns/{campaign['id']}/sessions/{sid}", headers=gm_headers
            ).status_code
            == 204
        )
        assert (
            client.get(
                f"/api/campaigns/{campaign['id']}/sessions/{sid}", headers=gm_headers
            ).status_code
            == 404
        )


# ---------------------------------------------------------------------------
# Schedule
# ---------------------------------------------------------------------------


class TestSchedule:
    @pytest.fixture(scope="class")
    def gm_camp(self, client, gm_headers):
        resp = client.post(
            "/api/campaigns",
            json={
                "name": f"Schedule Test {uid()}",
                "is_gm_campaign": True,
            },
            headers=gm_headers,
        )
        assert resp.status_code == 201
        return resp.json()

    def test_no_schedule_by_default(self, client, gm_headers, gm_camp):
        resp = client.get(f"/api/campaigns/{gm_camp['id']}/schedule", headers=gm_headers)
        assert resp.status_code == 200
        assert resp.json()["definition"] is None

    def test_upsert_weekly_schedule(self, client, gm_headers, gm_camp):
        resp = client.put(
            f"/api/campaigns/{gm_camp['id']}/schedule",
            json={
                "frequency": "weekly",
                "days": [5],  # Saturday
                "time_utc": "18:00",
            },
            headers=gm_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["definition"]["frequency"] == "weekly"
        assert isinstance(body["next_sessions"], list)

    def test_next_sessions_are_future_saturdays(self, client, gm_headers, gm_camp):
        import datetime

        resp = client.get(f"/api/campaigns/{gm_camp['id']}/schedule", headers=gm_headers)
        body = resp.json()
        next_sessions = body["next_sessions"]
        scheduled_days = body["definition"]["days"]  # e.g. [5] for Saturday
        assert len(next_sessions) > 0
        today = datetime.date.today()
        for ds in next_sessions:
            d = datetime.date.fromisoformat(ds)
            assert d.weekday() in scheduled_days
            assert d >= today

    def test_cannot_schedule_personal_campaign(self, client, player_headers, player_campaign):
        resp = client.put(
            f"/api/campaigns/{player_campaign['id']}/schedule",
            json={
                "frequency": "weekly",
                "days": [5],
            },
            headers=player_headers,
        )
        assert resp.status_code == 400

    def test_invalid_frequency_rejected(self, client, gm_headers, gm_camp):
        resp = client.put(
            f"/api/campaigns/{gm_camp['id']}/schedule",
            json={
                "frequency": "daily",
                "days": [0],
            },
            headers=gm_headers,
        )
        assert resp.status_code == 400

    def test_delete_schedule(self, client, gm_headers, gm_camp):
        assert (
            client.delete(
                f"/api/campaigns/{gm_camp['id']}/schedule", headers=gm_headers
            ).status_code
            == 204
        )
        resp = client.get(f"/api/campaigns/{gm_camp['id']}/schedule", headers=gm_headers)
        assert resp.json()["definition"] is None

    def test_custom_schedule(self, client, gm_headers, gm_camp):
        resp = client.put(
            f"/api/campaigns/{gm_camp['id']}/schedule",
            json={
                "frequency": "custom",
                "days": [],
                "custom_dates": ["2027-01-01", "2027-02-14"],
            },
            headers=gm_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["definition"]["frequency"] == "custom"
        assert "2027-01-01" in body["definition"]["custom_dates"]


# ---------------------------------------------------------------------------
# Resource search endpoint
# ---------------------------------------------------------------------------


class TestResourceSearch:
    def test_search_returns_list(self, client, gm_headers):
        resp = client.get("/api/campaigns/resources/search?q=", headers=gm_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_search_finds_book_by_title(self, client, gm_headers):
        sys = make_game_system()
        make_book(system_id=sys.id, title="ZZZ Unique Searchable Book ZZZ")
        resp = client.get("/api/campaigns/resources/search?q=ZZZ+Unique", headers=gm_headers)
        results = resp.json()
        assert any(r["name"] == "ZZZ Unique Searchable Book ZZZ" for r in results)

    def test_unauthenticated_denied(self, client):
        assert client.get("/api/campaigns/resources/search?q=test").status_code == 401


# ---------------------------------------------------------------------------
# Eligible members
# ---------------------------------------------------------------------------


class TestEligibleMembers:
    def test_returns_user_list(self, client, gm_headers, gm_campaign):
        resp = client.get(
            f"/api/campaigns/{gm_campaign['id']}/eligible-members", headers=gm_headers
        )
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)
        assert all("id" in u and "username" in u and "already_invited" in u for u in body)

    def test_nonowner_cannot_list_eligible(self, client, player_headers, gm_campaign):
        resp = client.get(
            f"/api/campaigns/{gm_campaign['id']}/eligible-members", headers=player_headers
        )
        assert resp.status_code == 403
