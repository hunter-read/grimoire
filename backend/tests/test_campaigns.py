"""Tests for campaign management endpoints."""
import uuid
import pytest
from backend.tests.conftest import make_campaign, make_game_system, make_book, make_map


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

    def test_list_exposes_access_and_next_session(self, client, gm_headers, gm_campaign):
        c = next(
            c for c in client.get("/api/campaigns", headers=gm_headers).json()
            if c["id"] == gm_campaign["id"]
        )
        assert "last_accessed_at" in c
        assert "next_session" in c  # None when no schedule

    def test_opening_campaign_updates_last_accessed(self, client, gm_headers, gm_campaign):
        before = next(
            c for c in client.get("/api/campaigns", headers=gm_headers).json()
            if c["id"] == gm_campaign["id"]
        )["last_accessed_at"]
        # Opening the campaign detail records access.
        client.get(f"/api/campaigns/{gm_campaign['id']}", headers=gm_headers)
        after = next(
            c for c in client.get("/api/campaigns", headers=gm_headers).json()
            if c["id"] == gm_campaign["id"]
        )["last_accessed_at"]
        assert after >= before


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

    def test_admin_cannot_get_full_detail_of_others(self, client, admin_headers, gm_campaign):
        # Admins inspect a user's campaigns through the read-only user page, not the
        # full campaign-detail endpoint.
        assert (
            client.get(f"/api/campaigns/{gm_campaign['id']}", headers=admin_headers).status_code
            == 403
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

    def test_update_returns_members(self, client, gm_headers, gm_campaign, player_id):
        # The update response must include the full member roster (GM owner + any
        # invited players) so the client's merge doesn't blank the list.
        client.post(
            f"/api/campaigns/{gm_campaign['id']}/invite",
            json={"user_id": player_id},
            headers=gm_headers,
        )
        resp = client.patch(
            f"/api/campaigns/{gm_campaign['id']}",
            json={"name": "Renamed"},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        members = resp.json()["members"]
        assert any(m["is_owner"] for m in members)
        assert any(not m["is_owner"] for m in members)

    def test_custom_system_name(self, client, gm_headers):
        # Create with a free-text system not in the library.
        c = client.post(
            "/api/campaigns",
            json={"name": f"Custom {uid()}", "is_gm_campaign": True, "system_name": "Mörk Borg"},
            headers=gm_headers,
        ).json()
        assert c["system_name"] == "Mörk Borg"
        assert c["system_id"] is None
        # Switching to a library system clears the free-text name.
        sys = make_game_system()
        upd = client.patch(
            f"/api/campaigns/{c['id']}", json={"system_id": sys.id}, headers=gm_headers
        ).json()
        assert upd["system_id"] == sys.id
        assert upd["system_name"] is None
        # Setting a free-text name again clears the library link.
        upd2 = client.patch(
            f"/api/campaigns/{c['id']}", json={"system_name": "Homebrew"}, headers=gm_headers
        ).json()
        assert upd2["system_name"] == "Homebrew"
        assert upd2["system_id"] is None

    def test_nonowner_cannot_update(self, client, player_headers, gm_campaign):
        resp = client.patch(
            f"/api/campaigns/{gm_campaign['id']}", json={"name": "Hack"}, headers=player_headers
        )
        assert resp.status_code == 403

    def test_admin_cannot_update_others(self, client, admin_headers, gm_campaign):
        # Admins have no management rights over campaigns they don't own.
        resp = client.patch(
            f"/api/campaigns/{gm_campaign['id']}",
            json={"description": "Admin edit"},
            headers=admin_headers,
        )
        assert resp.status_code == 403


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
                "visibility": "public",
            },
            headers=gm_headers,
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["resource_type"] == "book"
        assert body["visibility"] == "public"

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

    def test_gm_can_update_visibility(self, client, gm_headers, campaign_with_book):
        campaign, book = campaign_with_book
        resources = client.get(
            f"/api/campaigns/{campaign['id']}/resources", headers=gm_headers
        ).json()
        res_id = next(r["id"] for r in resources if r["resource_id"] == book.id)
        resp = client.patch(
            f"/api/campaigns/{campaign['id']}/resources/{res_id}",
            json={"visibility": "gm"},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["visibility"] == "gm"

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

    def test_bulk_add_links_many_and_skips_duplicates(self, client, gm_headers, gm_id):
        sys = make_game_system()
        b1 = make_book(system_id=sys.id)
        b2 = make_book(system_id=sys.id)
        m1 = make_map()
        campaign = client.post(
            "/api/campaigns",
            json={"name": f"Bulk {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        # Pre-link one book so we can confirm it is skipped in the batch.
        client.post(
            f"/api/campaigns/{campaign['id']}/resources",
            json={"resource_type": "book", "resource_id": b1.id},
            headers=gm_headers,
        )

        resp = client.post(
            f"/api/campaigns/{campaign['id']}/resources/bulk",
            json={
                "resources": [
                    {"resource_type": "book", "resource_id": b1.id},  # duplicate
                    {"resource_type": "book", "resource_id": b2.id, "visibility": "public"},
                    {"resource_type": "map", "resource_id": m1.id, "visibility": "gm"},
                ]
            },
            headers=gm_headers,
        )
        assert resp.status_code == 201
        created = resp.json()
        # Only the two new resources are created; the duplicate is silently skipped.
        assert len(created) == 2
        ids = {r["resource_id"] for r in created}
        assert ids == {b2.id, m1.id}

        # Campaign now has all three linked.
        listed = client.get(
            f"/api/campaigns/{campaign['id']}/resources", headers=gm_headers
        ).json()
        assert len(listed) == 3

    def test_bulk_add_requires_manage(self, client, player_headers, gm_campaign):
        resp = client.post(
            f"/api/campaigns/{gm_campaign['id']}/resources/bulk",
            json={"resources": [{"resource_type": "book", "resource_id": "x"}]},
            headers=player_headers,
        )
        assert resp.status_code in (403, 404)

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
# Resource search (the picker)
# ---------------------------------------------------------------------------


class TestResourceSearch:
    def test_system_filter_narrows_books(self, client, gm_headers):
        sys_a = make_game_system()
        sys_b = make_game_system()
        token = f"srch{uid()}"
        make_book(system_id=sys_a.id, title=f"{token} Alpha")
        make_book(system_id=sys_b.id, title=f"{token} Beta")

        resp = client.get(
            f"/api/campaigns/resources/search?q={token}&resource_type=book"
            f"&system_id={sys_a.id}",
            headers=gm_headers,
        )
        assert resp.status_code == 200
        names = [r["name"] for r in resp.json()]
        assert any("Alpha" in n for n in names)
        assert not any("Beta" in n for n in names)

    def test_folder_name_query_returns_maps_in_folder(self, client, gm_headers):
        folder = f"Abyssal Fall ({uid()})"
        make_map(filename="battle.png", relative_path=f"Maps/{folder}/battle.png")
        make_map(filename="overview.png", relative_path=f"Maps/{folder}/overview.png")

        resp = client.get(
            f"/api/campaigns/resources/search?q={folder}&resource_type=map",
            headers=gm_headers,
        )
        assert resp.status_code == 200
        results = resp.json()
        # Both maps in the folder match by folder path even though their
        # filenames don't contain the query.
        names = {r["name"] for r in results}
        assert {"battle.png", "overview.png"} <= names
        # Folder path is carried in the subtitle for context.
        assert all(folder in r["subtitle"] for r in results if r["name"] in names)

    def test_folder_matches_rank_above_filename(self, client, gm_headers):
        term = f"market{uid()}"
        # One map whose folder matches, one whose filename matches.
        make_map(filename="plain.png", relative_path=f"Maps/{term} Square/plain.png")
        make_map(filename=f"{term}-stall.png", relative_path="Maps/Other/stall.png")

        resp = client.get(
            f"/api/campaigns/resources/search?q={term}&resource_type=map",
            headers=gm_headers,
        )
        results = resp.json()
        assert results[0]["name"] == "plain.png"  # folder hit ranked first


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

    def test_disabled_schedule_keeps_definition_but_no_sessions(self, client, gm_headers):
        # Saving with enabled=False preserves the definition but yields no upcoming
        # sessions (the schedule is inactive, not deleted). Uses its own campaign so
        # it doesn't disturb the class-scoped gm_camp fixture.
        camp = client.post(
            "/api/campaigns",
            json={"name": f"Disable Test {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        resp = client.put(
            f"/api/campaigns/{camp['id']}/schedule",
            json={"frequency": "weekly", "days": [5], "enabled": False},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["enabled"] is False
        assert body["definition"]["days"] == [5]
        assert body["next_sessions"] == []
        # Re-fetch confirms the disabled state persisted with its definition intact.
        got = client.get(f"/api/campaigns/{camp['id']}/schedule", headers=gm_headers).json()
        assert got["enabled"] is False
        assert got["definition"]["days"] == [5]
        assert got["next_sessions"] == []
        # Re-enabling restores upcoming sessions.
        again = client.put(
            f"/api/campaigns/{camp['id']}/schedule",
            json={"frequency": "weekly", "days": [5], "enabled": True},
            headers=gm_headers,
        ).json()
        assert again["enabled"] is True
        assert len(again["next_sessions"]) > 0

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


class TestResourceSearchAccess:
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


# ---------------------------------------------------------------------------
# Admin read-only campaign visibility (via the user page)
# ---------------------------------------------------------------------------


class TestAdminCampaignVisibility:
    def test_main_list_excludes_others_campaigns(
        self, client, admin_headers, gm_campaign, player_campaign
    ):
        """The main /api/campaigns endpoint only returns the admin's own campaigns."""
        resp = client.get("/api/campaigns", headers=admin_headers)
        assert resp.status_code == 200
        ids = [c["id"] for c in resp.json()]
        assert gm_campaign["id"] not in ids
        assert player_campaign["id"] not in ids

    def test_admin_list_by_user_returns_minimal_fields(
        self, client, admin_headers, gm_id, gm_campaign
    ):
        resp = client.get(f"/api/campaigns/admin/by-user/{gm_id}", headers=admin_headers)
        assert resp.status_code == 200
        match = next((c for c in resp.json() if c["id"] == gm_campaign["id"]), None)
        assert match is not None
        # Minimal read-only payload: title, system, description only.
        assert set(match.keys()) == {
            "id",
            "name",
            "description",
            "is_gm_campaign",
            "system_id",
            "system_name",
        }

    def test_admin_list_by_user_404_unknown(self, client, admin_headers):
        resp = client.get("/api/campaigns/admin/by-user/doesnotexist", headers=admin_headers)
        assert resp.status_code == 404

    def test_non_admin_cannot_list_by_user(self, client, gm_headers, gm_id):
        resp = client.get(f"/api/campaigns/admin/by-user/{gm_id}", headers=gm_headers)
        assert resp.status_code == 403


class TestRemovedAdminEndpoints:
    """The soft-delete / restore / list-all admin endpoints have been removed.

    The list endpoints were GET routes; unmatched GETs now fall through to the SPA
    catch-all, so we assert they no longer return the old JSON list. The mutating
    POST routes have no catch-all and return a hard 404/405.
    """

    @staticmethod
    def _assert_not_old_admin_list(resp):
        # The route is gone: the GET falls through to the SPA catch-all, which
        # serves index.html when the frontend is built or a "frontend not found"
        # JSON error (500) when it isn't (e.g. CI's backend-only job). Either way
        # it must not be the old 200 JSON campaign list.
        if resp.status_code != 200:
            return
        try:
            body = resp.json()
        except ValueError:
            return  # HTML SPA response, not JSON — the route is gone.
        assert not isinstance(body, list)

    def test_admin_list_all_no_longer_json(self, client, admin_headers):
        resp = client.get("/api/campaigns/admin/all", headers=admin_headers)
        self._assert_not_old_admin_list(resp)

    def test_admin_list_deleted_no_longer_json(self, client, admin_headers):
        resp = client.get("/api/campaigns/admin/deleted", headers=admin_headers)
        self._assert_not_old_admin_list(resp)

    def test_admin_soft_delete_gone(self, client, admin_headers, gm_campaign):
        resp = client.post(
            f"/api/campaigns/admin/{gm_campaign['id']}/delete",
            json={"reason": "x"},
            headers=admin_headers,
        )
        assert resp.status_code in (404, 405)

    def test_admin_restore_gone(self, client, admin_headers, gm_campaign):
        resp = client.post(
            f"/api/campaigns/admin/{gm_campaign['id']}/restore",
            headers=admin_headers,
        )
        assert resp.status_code in (404, 405)


# ---------------------------------------------------------------------------
# Banner, character art, and character sheet uploads
# ---------------------------------------------------------------------------


def _png_bytes(color=(120, 80, 200)):
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color).save(buf, format="PNG")
    return buf.getvalue()


class TestBannerUpload:
    @pytest.fixture()
    def campaign(self, client, gm_headers):
        resp = client.post(
            "/api/campaigns",
            json={"name": f"Banner {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        )
        assert resp.status_code == 201
        return resp.json()

    def test_owner_can_upload_and_fetch_banner(self, client, gm_headers, campaign):
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/banner",
            files={"file": ("banner.png", _png_bytes(), "image/png")},
            headers=gm_headers,
        )
        assert resp.status_code == 200, resp.text

        # Exposed on the campaign payload.
        body = client.get(f"/api/campaigns/{campaign['id']}", headers=gm_headers).json()
        assert body["has_banner"] is True

        # Image is served back.
        img = client.get(f"/api/campaigns/{campaign['id']}/banner", headers=gm_headers)
        assert img.status_code == 200
        assert img.headers["content-type"].startswith("image/")

    def test_rejects_non_image(self, client, gm_headers, campaign):
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/banner",
            files={"file": ("bad.png", b"not really a png", "image/png")},
            headers=gm_headers,
        )
        assert resp.status_code == 400

    def test_rejects_unsupported_type(self, client, gm_headers, campaign):
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/banner",
            files={"file": ("doc.txt", b"hello", "text/plain")},
            headers=gm_headers,
        )
        assert resp.status_code == 400

    def test_non_owner_cannot_upload(self, client, player_headers, campaign):
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/banner",
            files={"file": ("banner.png", _png_bytes(), "image/png")},
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_owner_can_delete_banner(self, client, gm_headers, campaign):
        client.post(
            f"/api/campaigns/{campaign['id']}/banner",
            files={"file": ("banner.png", _png_bytes(), "image/png")},
            headers=gm_headers,
        )
        resp = client.delete(f"/api/campaigns/{campaign['id']}/banner", headers=gm_headers)
        assert resp.status_code == 204
        body = client.get(f"/api/campaigns/{campaign['id']}", headers=gm_headers).json()
        assert body["has_banner"] is False


class TestCharacterUploads:
    @pytest.fixture()
    def member(self, client, gm_headers, player_headers, player_id):
        """A campaign with an accepted player member; returns (campaign, member_id)."""
        c = client.post(
            "/api/campaigns",
            json={"name": f"Char {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        client.post(
            f"/api/campaigns/{c['id']}/invite",
            json={"user_id": player_id},
            headers=gm_headers,
        )
        client.patch(
            f"/api/campaigns/{c['id']}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        body = client.get(f"/api/campaigns/{c['id']}", headers=gm_headers).json()
        member_id = next(m["id"] for m in body["members"] if not m.get("is_owner"))
        return c, member_id

    def test_player_can_upload_own_art(self, client, player_headers, member):
        c, member_id = member
        resp = client.post(
            f"/api/campaigns/{c['id']}/members/{member_id}/art",
            files={"file": ("art.png", _png_bytes(), "image/png")},
            headers=player_headers,
        )
        assert resp.status_code == 200, resp.text
        body = client.get(f"/api/campaigns/{c['id']}", headers=player_headers).json()
        m = next(m for m in body["members"] if m.get("id") == member_id)
        assert m["has_art"] is True

    def test_owner_can_upload_member_art(self, client, gm_headers, member):
        c, member_id = member
        resp = client.post(
            f"/api/campaigns/{c['id']}/members/{member_id}/art",
            files={"file": ("art.png", _png_bytes(), "image/png")},
            headers=gm_headers,
        )
        assert resp.status_code == 200

    def test_unrelated_user_cannot_upload_art(self, client, admin_headers, member):
        # Admin is neither the member nor the owner of this campaign.
        c, member_id = member
        resp = client.post(
            f"/api/campaigns/{c['id']}/members/{member_id}/art",
            files={"file": ("art.png", _png_bytes(), "image/png")},
            headers=admin_headers,
        )
        assert resp.status_code == 403

    def test_player_can_upload_and_download_sheet(self, client, player_headers, member):
        c, member_id = member
        resp = client.post(
            f"/api/campaigns/{c['id']}/members/{member_id}/sheet",
            files={"file": ("hero.pdf", b"%PDF-1.4 fake", "application/pdf")},
            headers=player_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["character_sheet_filename"] == "hero.pdf"

        dl = client.get(
            f"/api/campaigns/{c['id']}/members/{member_id}/sheet", headers=player_headers
        )
        assert dl.status_code == 200
        assert b"%PDF" in dl.content

    def test_sheet_rejects_unsupported_type(self, client, player_headers, member):
        c, member_id = member
        resp = client.post(
            f"/api/campaigns/{c['id']}/members/{member_id}/sheet",
            files={"file": ("notes.docx", b"junk", "application/msword")},
            headers=player_headers,
        )
        assert resp.status_code == 400

    def test_delete_art(self, client, player_headers, member):
        c, member_id = member
        client.post(
            f"/api/campaigns/{c['id']}/members/{member_id}/art",
            files={"file": ("art.png", _png_bytes(), "image/png")},
            headers=player_headers,
        )
        resp = client.delete(
            f"/api/campaigns/{c['id']}/members/{member_id}/art", headers=player_headers
        )
        assert resp.status_code == 204
        body = client.get(f"/api/campaigns/{c['id']}", headers=player_headers).json()
        m = next(m for m in body["members"] if m.get("id") == member_id)
        assert m["has_art"] is False


# ---------------------------------------------------------------------------
# In-app character sheets: AcroForm fields + duplicate from a template
# ---------------------------------------------------------------------------


def _form_pdf_bytes():
    """A one-page PDF with a single fillable text field named 'name'."""
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    w = fitz.Widget()
    w.field_name = "name"
    w.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    w.rect = fitz.Rect(50, 50, 250, 70)
    w.field_value = ""
    page.add_widget(w)
    data = doc.tobytes()
    doc.close()
    return data


class TestCharacterSheetInApp:
    @pytest.fixture()
    def member(self, client, gm_headers, player_headers, player_id):
        c = client.post(
            "/api/campaigns",
            json={"name": f"Sheet {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        client.post(
            f"/api/campaigns/{c['id']}/invite",
            json={"user_id": player_id},
            headers=gm_headers,
        )
        client.patch(
            f"/api/campaigns/{c['id']}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        body = client.get(f"/api/campaigns/{c['id']}", headers=gm_headers).json()
        member_id = next(m["id"] for m in body["members"] if not m.get("is_owner"))
        return c, member_id

    def _upload_form_sheet(self, client, headers, c, member_id):
        return client.post(
            f"/api/campaigns/{c['id']}/members/{member_id}/sheet",
            files={"file": ("hero.pdf", _form_pdf_bytes(), "application/pdf")},
            headers=headers,
        )

    def test_fields_reports_fillable_and_lists_widgets(self, client, player_headers, member):
        c, member_id = member
        assert self._upload_form_sheet(client, player_headers, c, member_id).status_code == 200
        resp = client.get(
            f"/api/campaigns/{c['id']}/members/{member_id}/sheet/fields", headers=player_headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["fillable"] is True
        assert [f["name"] for f in body["fields"]] == ["name"]
        assert body["fields"][0]["type"] == "text"

    def test_save_fields_persists_value(self, client, player_headers, member):
        c, member_id = member
        self._upload_form_sheet(client, player_headers, c, member_id)
        resp = client.put(
            f"/api/campaigns/{c['id']}/members/{member_id}/sheet/fields",
            json={"fields": {"name": "Aragorn"}},
            headers=player_headers,
        )
        assert resp.status_code == 200, resp.text
        # Re-read to confirm persistence.
        again = client.get(
            f"/api/campaigns/{c['id']}/members/{member_id}/sheet/fields", headers=player_headers
        ).json()
        assert again["fields"][0]["value"] == "Aragorn"

    def test_fields_not_fillable_for_image_sheet(self, client, player_headers, member):
        c, member_id = member
        client.post(
            f"/api/campaigns/{c['id']}/members/{member_id}/sheet",
            files={"file": ("sheet.png", _png_bytes(), "image/png")},
            headers=player_headers,
        )
        resp = client.get(
            f"/api/campaigns/{c['id']}/members/{member_id}/sheet/fields", headers=player_headers
        )
        assert resp.status_code == 200
        assert resp.json() == {"fillable": False, "fields": []}

    def test_unrelated_user_cannot_edit_fields(self, client, player_headers, admin_headers, member):
        c, member_id = member
        self._upload_form_sheet(client, player_headers, c, member_id)
        resp = client.get(
            f"/api/campaigns/{c['id']}/members/{member_id}/sheet/fields", headers=admin_headers
        )
        assert resp.status_code == 403

    def test_duplicate_from_campaign_file(self, client, gm_headers, player_headers, member):
        c, member_id = member
        # GM uploads a form-fillable PDF as a campaign file.
        up = client.post(
            f"/api/campaigns/{c['id']}/files",
            files={"file": ("blank.pdf", _form_pdf_bytes(), "application/pdf")},
            headers=gm_headers,
        )
        assert up.status_code == 201, up.text
        file_id = up.json()["resource_id"]

        resp = client.post(
            f"/api/campaigns/{c['id']}/members/{member_id}/sheet/duplicate",
            json={"source_type": "file", "source_id": file_id},
            headers=player_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["character_sheet_filename"] == "blank.pdf"
        fields = client.get(
            f"/api/campaigns/{c['id']}/members/{member_id}/sheet/fields", headers=player_headers
        ).json()
        assert fields["fillable"] is True

    def test_duplicate_from_library_book(self, client, player_headers, member):
        c, member_id = member
        sys = make_game_system()
        book = make_book(system_id=sys.id, category="character-sheet", title="Blank Sheet")
        with open(book.filepath, "wb") as f:
            f.write(_form_pdf_bytes())
        try:
            resp = client.post(
                f"/api/campaigns/{c['id']}/members/{member_id}/sheet/duplicate",
                json={"source_type": "book", "source_id": book.id},
                headers=player_headers,
            )
            assert resp.status_code == 200, resp.text
        finally:
            import os

            os.path.isfile(book.filepath) and os.unlink(book.filepath)

    def test_sheet_sources_lists_library_and_campaign_pdfs(
        self, client, gm_headers, player_headers, member
    ):
        c, member_id = member
        sys = make_game_system()
        make_book(system_id=sys.id, category="character-sheet", title="A Blank Sheet")
        client.post(
            f"/api/campaigns/{c['id']}/files",
            files={"file": ("camp.pdf", b"%PDF-1.4 x", "application/pdf")},
            headers=gm_headers,
        )
        resp = client.get(f"/api/campaigns/{c['id']}/sheet-sources", headers=player_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert any(b["name"] == "A Blank Sheet" for b in body["books"])
        assert any(f["name"] == "camp.pdf" for f in body["files"])


# ---------------------------------------------------------------------------
# Create wizard: explicit resources, gm_only visibility, suggested resources
# ---------------------------------------------------------------------------


class TestCreateWithResources:
    def test_create_links_only_chosen_resources(self, client, gm_headers):
        sys = make_game_system()
        core = make_book(system_id=sys.id, category="core", title="Core Rules")
        extra = make_book(system_id=sys.id, category="supplement", title="Bestiary")
        resp = client.post(
            "/api/campaigns",
            json={
                "name": f"Wizard {uid()}",
                "is_gm_campaign": True,
                "system_id": sys.id,
                "resources": [
                    {"resource_type": "book", "resource_id": core.id, "visibility": "public"},
                ],
            },
            headers=gm_headers,
        )
        assert resp.status_code == 201
        cid = resp.json()["id"]
        listed = client.get(f"/api/campaigns/{cid}/resources", headers=gm_headers).json()
        ids = [r["resource_id"] for r in listed]
        assert core.id in ids
        # The supplement was NOT chosen, so it must not be auto-linked.
        assert extra.id not in ids

    def test_create_with_no_resources_links_nothing(self, client, gm_headers):
        sys = make_game_system()
        make_book(system_id=sys.id, category="core")
        resp = client.post(
            "/api/campaigns",
            json={"name": f"Empty {uid()}", "is_gm_campaign": True, "system_id": sys.id},
            headers=gm_headers,
        )
        assert resp.status_code == 201
        cid = resp.json()["id"]
        listed = client.get(f"/api/campaigns/{cid}/resources", headers=gm_headers).json()
        assert listed == []


class TestSuggestedResources:
    def test_core_flagged_and_ordered_first(self, client, gm_headers):
        sys = make_game_system()
        make_book(system_id=sys.id, category="supplement", title="Zzz Supplement")
        make_book(system_id=sys.id, category="core", title="Aaa Core")
        resp = client.get(f"/api/campaigns/resources/suggested/{sys.id}", headers=gm_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        # Core comes first and is flagged suggested.
        assert data[0]["suggested"] is True
        assert data[0]["subtitle"] == "core"
        assert data[1]["suggested"] is False

    def test_unknown_system_returns_empty(self, client, gm_headers):
        resp = client.get("/api/campaigns/resources/suggested/nope", headers=gm_headers)
        assert resp.status_code == 200
        assert resp.json() == []


class TestResourceVisibility:
    @pytest.fixture()
    def campaign_with_member(self, client, gm_headers, player_headers, player_id):
        """GM campaign with an accepted player; returns (campaign_id, book)."""
        sys = make_game_system()
        book = make_book(system_id=sys.id, category="core")
        c = client.post(
            "/api/campaigns",
            json={"name": f"Vis {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        client.post(
            f"/api/campaigns/{c['id']}/invite", json={"user_id": player_id}, headers=gm_headers
        )
        client.patch(
            f"/api/campaigns/{c['id']}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        return c["id"], book

    def _add(self, client, gm_headers, cid, book, **fields):
        resp = client.post(
            f"/api/campaigns/{cid}/resources",
            json={"resource_type": "book", "resource_id": book.id, **fields},
            headers=gm_headers,
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_public_visible_to_player(self, client, gm_headers, player_headers, campaign_with_member):
        cid, book = campaign_with_member
        self._add(client, gm_headers, cid, book, visibility="public")
        listed = client.get(f"/api/campaigns/{cid}/resources", headers=player_headers).json()
        assert any(r["resource_id"] == book.id for r in listed)

    def test_gm_only_hidden_from_player(self, client, gm_headers, player_headers, campaign_with_member):
        cid, book = campaign_with_member
        self._add(client, gm_headers, cid, book, visibility="gm")
        owner_list = client.get(f"/api/campaigns/{cid}/resources", headers=gm_headers).json()
        assert any(r["resource_id"] == book.id and r["visibility"] == "gm" for r in owner_list)
        player_list = client.get(f"/api/campaigns/{cid}/resources", headers=player_headers).json()
        assert not any(r["resource_id"] == book.id for r in player_list)

    def test_private_only_visible_to_shared_player(
        self, client, gm_headers, player_headers, player_id, campaign_with_member
    ):
        cid, book = campaign_with_member
        # Shared specifically with this player.
        self._add(client, gm_headers, cid, book, visibility="private", shared_user_ids=[player_id])
        player_list = client.get(f"/api/campaigns/{cid}/resources", headers=player_headers).json()
        assert any(r["resource_id"] == book.id for r in player_list)

    def test_private_hidden_from_unshared_player(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid, book = campaign_with_member
        # Private but shared with nobody — the one player shouldn't see it.
        self._add(client, gm_headers, cid, book, visibility="private", shared_user_ids=[])
        player_list = client.get(f"/api/campaigns/{cid}/resources", headers=player_headers).json()
        assert not any(r["resource_id"] == book.id for r in player_list)

    def test_owner_sees_shared_user_ids(
        self, client, gm_headers, player_id, campaign_with_member
    ):
        cid, book = campaign_with_member
        res = self._add(
            client, gm_headers, cid, book, visibility="private", shared_user_ids=[player_id]
        )
        assert res["shared_user_ids"] == [player_id]

    def test_update_visibility(self, client, gm_headers, campaign_with_member):
        cid, book = campaign_with_member
        res = self._add(client, gm_headers, cid, book, visibility="public")
        resp = client.patch(
            f"/api/campaigns/{cid}/resources/{res['id']}",
            json={"visibility": "gm"},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["visibility"] == "gm"

    def test_reorder_resources(self, client, gm_headers, campaign_with_member):
        cid, book = campaign_with_member
        sys2 = make_game_system()
        b2 = make_book(system_id=sys2.id)
        r1 = self._add(client, gm_headers, cid, book, visibility="public")
        r2 = self._add(client, gm_headers, cid, b2, visibility="public")
        resp = client.put(
            f"/api/campaigns/{cid}/resources/reorder",
            json={"ordered_ids": [r2["id"], r1["id"]]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        listed = client.get(f"/api/campaigns/{cid}/resources", headers=gm_headers).json()
        order = [r["id"] for r in listed]
        assert order.index(r2["id"]) < order.index(r1["id"])


# ---------------------------------------------------------------------------
# Categories (custom groupings for notes and resources)
# ---------------------------------------------------------------------------


class TestCategories:
    @pytest.fixture()
    def campaign(self, client, gm_headers):
        resp = client.post(
            "/api/campaigns",
            json={"name": f"Cat {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        )
        assert resp.status_code == 201
        return resp.json()

    def test_create_and_list_by_kind(self, client, gm_headers, campaign):
        cid = campaign["id"]
        # Note categories are retired (pages nest instead); only resource exists.
        rejected = client.post(
            f"/api/campaigns/{cid}/categories",
            json={"name": "NPCs", "kind": "note"},
            headers=gm_headers,
        )
        assert rejected.status_code == 400
        client.post(
            f"/api/campaigns/{cid}/categories",
            json={"name": "Handouts", "kind": "resource"},
            headers=gm_headers,
        )
        resources = client.get(
            f"/api/campaigns/{cid}/categories?kind=resource", headers=gm_headers
        ).json()
        assert [c["name"] for c in resources] == ["Handouts"]

    def test_non_owner_cannot_create(self, client, player_headers, campaign):
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/categories",
            json={"name": "Nope", "kind": "resource"},
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_rename(self, client, gm_headers, campaign):
        cid = campaign["id"]
        cat = client.post(
            f"/api/campaigns/{cid}/categories",
            json={"name": "Old", "kind": "resource"},
            headers=gm_headers,
        ).json()
        resp = client.patch(
            f"/api/campaigns/{cid}/categories/{cat['id']}",
            json={"name": "New"},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New"

    def test_create_with_icon_and_update(self, client, gm_headers, campaign):
        cid = campaign["id"]
        cat = client.post(
            f"/api/campaigns/{cid}/categories",
            json={"name": "NPCs", "kind": "resource", "icon": "user"},
            headers=gm_headers,
        ).json()
        assert cat["icon"] == "user"
        upd = client.patch(
            f"/api/campaigns/{cid}/categories/{cat['id']}",
            json={"icon": "swords"},
            headers=gm_headers,
        )
        assert upd.json()["icon"] == "swords"
        # Rename without touching icon keeps it.
        ren = client.patch(
            f"/api/campaigns/{cid}/categories/{cat['id']}",
            json={"name": "Villains"},
            headers=gm_headers,
        )
        assert ren.json()["name"] == "Villains"
        assert ren.json()["icon"] == "swords"

    def test_reorder(self, client, gm_headers, campaign):
        cid = campaign["id"]
        a = client.post(
            f"/api/campaigns/{cid}/categories", json={"name": "A", "kind": "resource"}, headers=gm_headers
        ).json()
        b = client.post(
            f"/api/campaigns/{cid}/categories", json={"name": "B", "kind": "resource"}, headers=gm_headers
        ).json()
        # Reverse the order.
        client.put(
            f"/api/campaigns/{cid}/categories/reorder",
            json={"ordered_ids": [b["id"], a["id"]]},
            headers=gm_headers,
        )
        ordered = client.get(
            f"/api/campaigns/{cid}/categories?kind=resource", headers=gm_headers
        ).json()
        assert [c["name"] for c in ordered] == ["B", "A"]

    def test_assign_resource_to_category(self, client, gm_headers, campaign):
        cid = campaign["id"]
        sys = make_game_system()
        book = make_book(system_id=sys.id)
        cat = client.post(
            f"/api/campaigns/{cid}/categories",
            json={"name": "Handouts", "kind": "resource"},
            headers=gm_headers,
        ).json()
        res = client.post(
            f"/api/campaigns/{cid}/resources",
            json={"resource_type": "book", "resource_id": book.id, "visibility": "public"},
            headers=gm_headers,
        ).json()
        # Defaults to no category (built-in Books group).
        assert res["category_id"] is None
        upd = client.patch(
            f"/api/campaigns/{cid}/resources/{res['id']}",
            json={"category_id": cat["id"]},
            headers=gm_headers,
        )
        assert upd.status_code == 200
        assert upd.json()["category_id"] == cat["id"]
        # Clear it back to the type group with the empty-string sentinel.
        cleared = client.patch(
            f"/api/campaigns/{cid}/resources/{res['id']}",
            json={"category_id": ""},
            headers=gm_headers,
        )
        assert cleared.json()["category_id"] is None

    def test_delete_resource_category_unlinks_items(self, client, gm_headers, campaign):
        cid = campaign["id"]
        sys = make_game_system()
        book = make_book(system_id=sys.id)
        cat = client.post(
            f"/api/campaigns/{cid}/categories",
            json={"name": "Handouts", "kind": "resource"},
            headers=gm_headers,
        ).json()
        res = client.post(
            f"/api/campaigns/{cid}/resources",
            json={"resource_type": "book", "resource_id": book.id, "category_id": cat["id"]},
            headers=gm_headers,
        ).json()
        client.delete(
            f"/api/campaigns/{cid}/categories/{cat['id']}?mode=delete_items", headers=gm_headers
        )
        listed = client.get(f"/api/campaigns/{cid}/resources", headers=gm_headers).json()
        assert not any(r["id"] == res["id"] for r in listed)

    def test_resource_group_order_persists(self, client, gm_headers, campaign):
        cid = campaign["id"]
        cat = client.post(
            f"/api/campaigns/{cid}/categories",
            json={"name": "Handouts", "kind": "resource"},
            headers=gm_headers,
        ).json()
        # A campaign starts with an empty (default) group order.
        assert client.get(f"/api/campaigns/{cid}", headers=gm_headers).json()[
            "resource_group_order"
        ] == []
        order = ["type:map", f"cat:{cat['id']}", "type:book"]
        resp = client.put(
            f"/api/campaigns/{cid}/resource-group-order",
            json={"ordered_keys": order},
            headers=gm_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["resource_group_order"] == order
        # Survives a re-fetch.
        assert (
            client.get(f"/api/campaigns/{cid}", headers=gm_headers).json()["resource_group_order"]
            == order
        )

    def test_resource_group_order_drops_unknown_keys(self, client, gm_headers, campaign):
        cid = campaign["id"]
        resp = client.put(
            f"/api/campaigns/{cid}/resource-group-order",
            json={"ordered_keys": ["type:book", "cat:does-not-exist", "bogus", "type:book"]},
            headers=gm_headers,
        )
        # Unknown category, bogus key, and the duplicate are all dropped.
        assert resp.json()["resource_group_order"] == ["type:book"]

    def test_resource_group_order_requires_owner(
        self, client, gm_headers, player_headers, player_id, campaign
    ):
        cid = campaign["id"]
        client.post(
            f"/api/campaigns/{cid}/invite", json={"user_id": player_id}, headers=gm_headers
        )
        client.patch(
            f"/api/campaigns/{cid}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        resp = client.put(
            f"/api/campaigns/{cid}/resource-group-order",
            json={"ordered_keys": ["type:book"]},
            headers=player_headers,
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Campaign file uploads + admin limits + character sheet URL
# ---------------------------------------------------------------------------


class TestCampaignFileUploads:
    @pytest.fixture()
    def campaign(self, client, gm_headers):
        resp = client.post(
            "/api/campaigns",
            json={"name": f"Files {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        )
        assert resp.status_code == 201
        return resp.json()

    def _set_settings(self, client, admin_headers, **kwargs):
        resp = client.patch("/api/settings", json=kwargs, headers=admin_headers)
        assert resp.status_code in (200, 204), resp.text

    def test_gm_uploads_file_becomes_resource(self, client, gm_headers, campaign):
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/files",
            files={"file": ("handout.pdf", b"%PDF-1.4 fake", "application/pdf")},
            headers=gm_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["resource_type"] == "file"
        assert body["name"] == "handout.pdf"
        # Appears in the resource list.
        listed = client.get(f"/api/campaigns/{campaign['id']}/resources", headers=gm_headers).json()
        assert any(r["id"] == body["id"] for r in listed)

    def test_download_file(self, client, gm_headers, campaign):
        res = client.post(
            f"/api/campaigns/{campaign['id']}/files",
            files={"file": ("h.txt", b"hello world", "text/plain")},
            headers=gm_headers,
        ).json()
        dl = client.get(
            f"/api/campaigns/{campaign['id']}/files/{res['resource_id']}", headers=gm_headers
        )
        assert dl.status_code == 200
        assert dl.content == b"hello world"

    def test_removing_file_resource_deletes_file(self, client, gm_headers, campaign):
        res = client.post(
            f"/api/campaigns/{campaign['id']}/files",
            files={"file": ("h.txt", b"data", "text/plain")},
            headers=gm_headers,
        ).json()
        client.delete(f"/api/campaigns/{campaign['id']}/resources/{res['id']}", headers=gm_headers)
        dl = client.get(
            f"/api/campaigns/{campaign['id']}/files/{res['resource_id']}", headers=gm_headers
        )
        assert dl.status_code == 404

    def test_uploads_disabled_blocks_gm(self, client, admin_headers, gm_headers, campaign):
        self._set_settings(client, admin_headers, campaign_uploads_disabled=True)
        try:
            resp = client.post(
                f"/api/campaigns/{campaign['id']}/files",
                files={"file": ("h.txt", b"data", "text/plain")},
                headers=gm_headers,
            )
            assert resp.status_code == 403
        finally:
            self._set_settings(client, admin_headers, campaign_uploads_disabled=False)

    def test_per_file_limit_enforced(self, client, admin_headers, gm_headers, campaign):
        # 0 MB cap rounds to 0 bytes... use 1 MB and a >1MB payload.
        self._set_settings(client, admin_headers, campaign_upload_max_file_mb=1)
        try:
            big = b"x" * (1024 * 1024 + 10)
            resp = client.post(
                f"/api/campaigns/{campaign['id']}/files",
                files={"file": ("big.bin", big, "application/octet-stream")},
                headers=gm_headers,
            )
            assert resp.status_code == 413
        finally:
            self._set_settings(client, admin_headers, campaign_upload_max_file_mb=0)

    def test_player_cannot_upload(self, client, gm_headers, player_headers, player_id, campaign):
        client.post(
            f"/api/campaigns/{campaign['id']}/invite", json={"user_id": player_id}, headers=gm_headers
        )
        client.patch(
            f"/api/campaigns/{campaign['id']}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/files",
            files={"file": ("h.txt", b"data", "text/plain")},
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_uploaded_image_file_is_flagged(self, client, gm_headers, campaign):
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/files",
            files={"file": ("art.png", _png_bytes(), "image/png")},
            headers=gm_headers,
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["is_image"] is True
        listed = client.get(f"/api/campaigns/{campaign['id']}/resources", headers=gm_headers).json()
        row = next(r for r in listed if r["resource_type"] == "file")
        # An image file is its own thumbnail.
        assert row["is_image"] is True
        assert row["has_thumbnail"] is True

    def test_image_upload_new_category(self, client, gm_headers, campaign):
        cid = campaign["id"]
        resp = client.post(
            f"/api/campaigns/{cid}/images",
            files={"file": ("npc.png", _png_bytes(), "image/png")},
            data={"new_category_name": "NPC art"},
            headers=gm_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["is_image"] is True
        assert body["category_id"]
        # The category was created and the image filed under it.
        cats = client.get(f"/api/campaigns/{cid}/categories?kind=resource", headers=gm_headers).json()
        cat = next(c for c in cats if c["name"] == "NPC art")
        assert body["category_id"] == cat["id"]

    def test_image_upload_existing_category(self, client, gm_headers, campaign):
        cid = campaign["id"]
        cat = client.post(
            f"/api/campaigns/{cid}/categories",
            json={"name": "Handouts", "kind": "resource"},
            headers=gm_headers,
        ).json()
        resp = client.post(
            f"/api/campaigns/{cid}/images",
            files={"file": ("map.png", _png_bytes(), "image/png")},
            data={"category_id": cat["id"]},
            headers=gm_headers,
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["category_id"] == cat["id"]

    def test_image_upload_rejects_non_image(self, client, gm_headers, campaign):
        resp = client.post(
            f"/api/campaigns/{campaign['id']}/images",
            files={"file": ("notes.pdf", b"%PDF-1.4 fake", "application/pdf")},
            headers=gm_headers,
        )
        assert resp.status_code == 400


class TestCharacterSheetUrl:
    @pytest.fixture()
    def member(self, client, gm_headers, player_headers, player_id):
        c = client.post(
            "/api/campaigns",
            json={"name": f"SheetUrl {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        client.post(
            f"/api/campaigns/{c['id']}/invite", json={"user_id": player_id}, headers=gm_headers
        )
        client.patch(
            f"/api/campaigns/{c['id']}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        return c["id"], player_id

    def test_player_sets_own_sheet_url(self, client, player_headers, member):
        cid, player_id = member
        resp = client.patch(
            f"/api/campaigns/{cid}/members/{player_id}",
            json={"character_sheet_url": "https://example.com/sheet.pdf"},
            headers=player_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["character_sheet_url"] == "https://example.com/sheet.pdf"
        body = client.get(f"/api/campaigns/{cid}", headers=player_headers).json()
        m = next(m for m in body["members"] if m.get("user_id") == player_id)
        assert m["character_sheet_url"] == "https://example.com/sheet.pdf"

    def test_clear_sheet_url(self, client, player_headers, member):
        cid, player_id = member
        client.patch(
            f"/api/campaigns/{cid}/members/{player_id}",
            json={"character_sheet_url": "https://example.com/x"},
            headers=player_headers,
        )
        resp = client.patch(
            f"/api/campaigns/{cid}/members/{player_id}",
            json={"character_sheet_url": ""},
            headers=player_headers,
        )
        assert resp.json()["character_sheet_url"] is None


# ---------------------------------------------------------------------------
# Per-user campaign access control
# ---------------------------------------------------------------------------


def _make_user(client, admin_headers, role="player"):
    """Create a fresh user via the admin API and log in. Returns (id, headers)."""
    username = f"capacc-{uid()}"
    password = "password12345"
    resp = client.post(
        "/api/users",
        json={"username": username, "password": password, "role": role},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    user_id = resp.json()["id"]
    login = client.post("/api/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200, login.text
    return user_id, {"Authorization": f"Bearer {login.json()['token']}"}


def _set_access(client, admin_headers, user_id, allowed):
    resp = client.patch(
        f"/api/users/{user_id}", json={"campaign_access": allowed}, headers=admin_headers
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestCampaignAccessControl:
    def test_default_access_enabled(self, client, admin_headers):
        _, headers = _make_user(client, admin_headers)
        me = client.get("/api/auth/me", headers=headers).json()
        assert me["campaign_access"] is True

    def test_admin_can_toggle_access(self, client, admin_headers):
        user_id, _ = _make_user(client, admin_headers)
        body = _set_access(client, admin_headers, user_id, False)
        assert body["campaign_access"] is False
        listed = client.get("/api/users", headers=admin_headers).json()
        row = next(u for u in listed if u["id"] == user_id)
        assert row["campaign_access"] is False

    def test_disabled_user_cannot_create_campaign(self, client, admin_headers):
        user_id, headers = _make_user(client, admin_headers)
        _set_access(client, admin_headers, user_id, False)
        resp = client.post(
            "/api/campaigns",
            json={"name": "Nope", "is_gm_campaign": False},
            headers=headers,
        )
        assert resp.status_code == 403

    def test_reenabled_user_can_create_again(self, client, admin_headers):
        user_id, headers = _make_user(client, admin_headers)
        _set_access(client, admin_headers, user_id, False)
        assert (
            client.post(
                "/api/campaigns", json={"name": "x", "is_gm_campaign": False}, headers=headers
            ).status_code
            == 403
        )
        _set_access(client, admin_headers, user_id, True)
        resp = client.post(
            "/api/campaigns", json={"name": "x", "is_gm_campaign": False}, headers=headers
        )
        assert resp.status_code == 201, resp.text

    def test_disabled_user_cannot_be_invited(self, client, admin_headers, gm_headers, gm_id):
        gm_campaign = client.post(
            "/api/campaigns",
            json={"name": f"Invite-{uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        target_id, _ = _make_user(client, admin_headers)
        _set_access(client, admin_headers, target_id, False)
        resp = client.post(
            f"/api/campaigns/{gm_campaign['id']}/invite",
            json={"user_id": target_id},
            headers=gm_headers,
        )
        assert resp.status_code == 403

    def test_disabled_user_cannot_accept_but_can_decline(
        self, client, admin_headers, gm_headers
    ):
        gm_campaign = client.post(
            "/api/campaigns",
            json={"name": f"Accept-{uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        target_id, target_headers = _make_user(client, admin_headers)
        # Invite while enabled, then disable before they respond.
        assert (
            client.post(
                f"/api/campaigns/{gm_campaign['id']}/invite",
                json={"user_id": target_id},
                headers=gm_headers,
            ).status_code
            == 201
        )
        _set_access(client, admin_headers, target_id, False)
        accept = client.patch(
            f"/api/campaigns/{gm_campaign['id']}/members/{target_id}",
            json={"status": "accepted"},
            headers=target_headers,
        )
        assert accept.status_code == 403
        decline = client.patch(
            f"/api/campaigns/{gm_campaign['id']}/members/{target_id}",
            json={"status": "declined"},
            headers=target_headers,
        )
        assert decline.status_code == 200

    def test_eligible_members_reports_access(self, client, admin_headers, gm_headers):
        gm_campaign = client.post(
            "/api/campaigns",
            json={"name": f"Eligible-{uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        target_id, _ = _make_user(client, admin_headers)
        _set_access(client, admin_headers, target_id, False)
        rows = client.get(
            f"/api/campaigns/{gm_campaign['id']}/eligible-members", headers=gm_headers
        ).json()
        row = next(r for r in rows if r["id"] == target_id)
        assert row["campaign_access"] is False

    def test_disabled_gm_locks_campaign_for_everyone(
        self, client, admin_headers, gm_headers, player_id, player_headers
    ):
        # Fresh GM so we don't disable the shared session GM.
        gm_user_id, gm_h = _make_user(client, admin_headers, role="gm")
        gm_campaign = client.post(
            "/api/campaigns",
            json={"name": f"Lock-{uid()}", "is_gm_campaign": True},
            headers=gm_h,
        ).json()
        cid = gm_campaign["id"]
        # Add a player so we can prove they keep read access.
        client.post(f"/api/campaigns/{cid}/invite", json={"user_id": player_id}, headers=gm_h)
        client.patch(
            f"/api/campaigns/{cid}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )

        _set_access(client, admin_headers, gm_user_id, False)

        # Serialization reports the lock.
        body = client.get(f"/api/campaigns/{cid}", headers=gm_h).json()
        assert body["locked"] is True
        assert body["owner_has_campaign_access"] is False

        # GM (owner) management is blocked.
        assert (
            client.patch(
                f"/api/campaigns/{cid}", json={"name": "renamed"}, headers=gm_h
            ).status_code
            == 403
        )
        # Player keeps read access.
        assert client.get(f"/api/campaigns/{cid}", headers=player_headers).status_code == 200

        # Re-enabling unlocks management.
        _set_access(client, admin_headers, gm_user_id, True)
        assert (
            client.patch(
                f"/api/campaigns/{cid}", json={"name": "renamed"}, headers=gm_h
            ).status_code
            == 200
        )
        unlocked = client.get(f"/api/campaigns/{cid}", headers=gm_h).json()
        assert unlocked["locked"] is False

    def test_member_list_flags_disabled_user(
        self, client, admin_headers, gm_headers, gm_id
    ):
        gm_campaign = client.post(
            "/api/campaigns",
            json={"name": f"Flag-{uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        cid = gm_campaign["id"]
        target_id, target_headers = _make_user(client, admin_headers)
        client.post(f"/api/campaigns/{cid}/invite", json={"user_id": target_id}, headers=gm_headers)
        client.patch(
            f"/api/campaigns/{cid}/members/{target_id}",
            json={"status": "accepted"},
            headers=target_headers,
        )
        _set_access(client, admin_headers, target_id, False)
        body = client.get(f"/api/campaigns/{cid}", headers=gm_headers).json()
        member = next(m for m in body["members"] if m["user_id"] == target_id)
        assert member["campaign_access"] is False
