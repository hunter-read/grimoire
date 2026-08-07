"""Tests for campaign archiving and personal -> group conversion."""
import io
import uuid
import zipfile

import pytest


def uid():
    return uuid.uuid4().hex[:8]


@pytest.fixture
def gm_campaign(client, gm_headers):
    """A fresh GM campaign per test — archiving mutates state."""
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Archive Test {uid()}", "is_gm_campaign": True},
        headers=gm_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
def personal_campaign(client, gm_headers):
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Personal {uid()}", "is_gm_campaign": False},
        headers=gm_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
def joined_campaign(client, gm_headers, player_headers, player_id, gm_campaign):
    """A GM campaign the player has accepted an invitation to."""
    client.post(
        f"/api/campaigns/{gm_campaign['id']}/invite",
        json={"user_id": player_id},
        headers=gm_headers,
    )
    client.patch(
        f"/api/campaigns/{gm_campaign['id']}/members/{player_id}",
        json={"status": "accepted"},
        headers=player_headers,
    )
    return gm_campaign


def archive(client, headers, campaign_id, archived=True):
    return client.put(
        f"/api/campaigns/{campaign_id}/archive",
        json={"archived": archived},
        headers=headers,
    )


# ---------------------------------------------------------------------------
# Archiving
# ---------------------------------------------------------------------------


class TestArchiveCampaign:
    def test_owner_can_archive(self, client, gm_headers, gm_campaign):
        resp = archive(client, gm_headers, gm_campaign["id"])
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_archived"] is True
        assert resp.json()["archived_at"]

    def test_owner_can_unarchive(self, client, gm_headers, gm_campaign):
        archive(client, gm_headers, gm_campaign["id"])
        resp = archive(client, gm_headers, gm_campaign["id"], archived=False)
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_archived"] is False
        # Cleared, so the field never implies a stale archive date.
        assert resp.json()["archived_at"] is None

    def test_archived_campaign_reports_locked(self, client, gm_headers, gm_campaign):
        """The UI hides edit affordances off `locked`, so archiving must set it."""
        resp = archive(client, gm_headers, gm_campaign["id"])
        body = resp.json()
        assert body["locked"] is True
        # …but not by blaming the owner's account access, which is untouched.
        assert body["owner_has_campaign_access"] is True

    def test_nonowner_cannot_archive(self, client, player_headers, gm_campaign):
        resp = archive(client, player_headers, gm_campaign["id"])
        assert resp.status_code == 403

    def test_member_cannot_archive(self, client, player_headers, joined_campaign):
        resp = archive(client, player_headers, joined_campaign["id"])
        assert resp.status_code == 403

    def test_nonexistent_returns_404(self, client, gm_headers):
        resp = archive(client, gm_headers, "does-not-exist")
        assert resp.status_code == 404


class TestArchivedListing:
    def test_hidden_from_default_list(self, client, gm_headers, gm_campaign):
        archive(client, gm_headers, gm_campaign["id"])
        ids = [c["id"] for c in client.get("/api/campaigns", headers=gm_headers).json()]
        assert gm_campaign["id"] not in ids

    def test_included_when_requested(self, client, gm_headers, gm_campaign):
        archive(client, gm_headers, gm_campaign["id"])
        resp = client.get("/api/campaigns?include_archived=true", headers=gm_headers)
        ids = [c["id"] for c in resp.json()]
        assert gm_campaign["id"] in ids

    def test_include_archived_also_returns_active(
        self, client, gm_headers, gm_campaign, personal_campaign
    ):
        """The flag widens the list rather than switching to archived-only."""
        archive(client, gm_headers, gm_campaign["id"])
        resp = client.get("/api/campaigns?include_archived=true", headers=gm_headers)
        ids = [c["id"] for c in resp.json()]
        assert gm_campaign["id"] in ids
        assert personal_campaign["id"] in ids

    def test_hidden_from_members_list_too(
        self, client, gm_headers, player_headers, joined_campaign
    ):
        archive(client, gm_headers, joined_campaign["id"])
        ids = [c["id"] for c in client.get("/api/campaigns", headers=player_headers).json()]
        assert joined_campaign["id"] not in ids

    def test_member_can_include_archived(
        self, client, gm_headers, player_headers, joined_campaign
    ):
        archive(client, gm_headers, joined_campaign["id"])
        resp = client.get("/api/campaigns?include_archived=true", headers=player_headers)
        assert joined_campaign["id"] in [c["id"] for c in resp.json()]

    def test_unarchiving_restores_to_list(self, client, gm_headers, gm_campaign):
        archive(client, gm_headers, gm_campaign["id"])
        archive(client, gm_headers, gm_campaign["id"], archived=False)
        ids = [c["id"] for c in client.get("/api/campaigns", headers=gm_headers).json()]
        assert gm_campaign["id"] in ids

    def test_archived_campaign_drops_out_of_invites(
        self, client, gm_headers, player_headers, player_id, gm_campaign
    ):
        client.post(
            f"/api/campaigns/{gm_campaign['id']}/invite",
            json={"user_id": player_id},
            headers=gm_headers,
        )
        invites = client.get("/api/campaigns/invites", headers=player_headers).json()
        assert gm_campaign["id"] in [i["campaign_id"] for i in invites]

        archive(client, gm_headers, gm_campaign["id"])
        invites = client.get("/api/campaigns/invites", headers=player_headers).json()
        assert gm_campaign["id"] not in [i["campaign_id"] for i in invites]


class TestArchivedIsReadOnly:
    """Archived campaigns stay fully readable but refuse every write."""

    def test_owner_can_still_read(self, client, gm_headers, gm_campaign):
        archive(client, gm_headers, gm_campaign["id"])
        resp = client.get(f"/api/campaigns/{gm_campaign['id']}", headers=gm_headers)
        assert resp.status_code == 200
        assert resp.json()["is_archived"] is True

    def test_member_can_still_read(self, client, gm_headers, player_headers, joined_campaign):
        archive(client, gm_headers, joined_campaign["id"])
        resp = client.get(f"/api/campaigns/{joined_campaign['id']}", headers=player_headers)
        assert resp.status_code == 200

    def test_owner_cannot_update(self, client, gm_headers, gm_campaign):
        archive(client, gm_headers, gm_campaign["id"])
        resp = client.patch(
            f"/api/campaigns/{gm_campaign['id']}",
            json={"name": "Renamed"},
            headers=gm_headers,
        )
        assert resp.status_code == 409

    def test_owner_cannot_create_wiki_page(self, client, gm_headers, gm_campaign):
        archive(client, gm_headers, gm_campaign["id"])
        resp = client.post(
            f"/api/campaigns/{gm_campaign['id']}/wiki",
            json={"title": "New Page"},
            headers=gm_headers,
        )
        assert resp.status_code == 409

    def test_owner_cannot_create_session(self, client, gm_headers, gm_campaign):
        archive(client, gm_headers, gm_campaign["id"])
        resp = client.post(
            f"/api/campaigns/{gm_campaign['id']}/sessions",
            json={"session_date": "2026-01-01", "title": "S1"},
            headers=gm_headers,
        )
        assert resp.status_code == 409

    def test_owner_cannot_invite(self, client, gm_headers, player_id, gm_campaign):
        archive(client, gm_headers, gm_campaign["id"])
        resp = client.post(
            f"/api/campaigns/{gm_campaign['id']}/invite",
            json={"user_id": player_id},
            headers=gm_headers,
        )
        assert resp.status_code == 409

    def test_member_cannot_write_player_note(
        self, client, gm_headers, player_headers, joined_campaign
    ):
        """A member write path that bypasses assert_can_manage entirely."""
        session = client.post(
            f"/api/campaigns/{joined_campaign['id']}/sessions",
            json={"session_date": "2026-02-02", "title": "S"},
            headers=gm_headers,
        ).json()
        archive(client, gm_headers, joined_campaign["id"])
        resp = client.put(
            f"/api/campaigns/{joined_campaign['id']}/sessions/{session['id']}/notes/player",
            json={"content": "nope"},
            headers=player_headers,
        )
        assert resp.status_code == 409

    def test_member_cannot_set_availability(
        self, client, gm_headers, player_headers, joined_campaign
    ):
        archive(client, gm_headers, joined_campaign["id"])
        resp = client.put(
            f"/api/campaigns/{joined_campaign['id']}/availability/2026-03-03",
            json={"status": "available"},
            headers=player_headers,
        )
        assert resp.status_code == 409

    def test_member_can_still_leave(
        self, client, gm_headers, player_headers, player_id, joined_campaign
    ):
        """Archiving must never trap a player: leaving is always their own call."""
        archive(client, gm_headers, joined_campaign["id"])
        resp = client.delete(
            f"/api/campaigns/{joined_campaign['id']}/members/{player_id}",
            headers=player_headers,
        )
        assert resp.status_code == 204
        # And they really are off the roster.
        detail = client.get(f"/api/campaigns/{joined_campaign['id']}", headers=gm_headers).json()
        assert player_id not in [m["user_id"] for m in detail["members"]]

    def test_owner_cannot_remove_someone_else_while_archived(
        self, client, gm_headers, player_id, joined_campaign
    ):
        """The GM editing the roster is still a write to a frozen record."""
        archive(client, gm_headers, joined_campaign["id"])
        resp = client.delete(
            f"/api/campaigns/{joined_campaign['id']}/members/{player_id}",
            headers=gm_headers,
        )
        assert resp.status_code == 409

    def test_writes_resume_after_unarchive(self, client, gm_headers, gm_campaign):
        archive(client, gm_headers, gm_campaign["id"])
        archive(client, gm_headers, gm_campaign["id"], archived=False)
        resp = client.patch(
            f"/api/campaigns/{gm_campaign['id']}",
            json={"name": "Renamed After Unarchive"},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Renamed After Unarchive"

    def test_owner_can_still_delete(self, client, gm_headers, gm_campaign):
        """Archiving tidies a campaign away; it must not block removing it."""
        archive(client, gm_headers, gm_campaign["id"])
        resp = client.delete(f"/api/campaigns/{gm_campaign['id']}", headers=gm_headers)
        assert resp.status_code == 204
        assert client.get(f"/api/campaigns/{gm_campaign['id']}", headers=gm_headers).status_code == 404


# ---------------------------------------------------------------------------
# Personal -> group conversion
# ---------------------------------------------------------------------------


def convert(client, headers, campaign_id, **body):
    return client.post(
        f"/api/campaigns/{campaign_id}/convert-to-group", json=body, headers=headers
    )


class TestConvertToGroup:
    def test_owner_can_convert(self, client, gm_headers, personal_campaign):
        resp = convert(client, gm_headers, personal_campaign["id"])
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_gm_campaign"] is True

    def test_conversion_persists(self, client, gm_headers, personal_campaign):
        convert(client, gm_headers, personal_campaign["id"])
        resp = client.get(f"/api/campaigns/{personal_campaign['id']}", headers=gm_headers)
        assert resp.json()["is_gm_campaign"] is True

    def test_sets_gm_title_when_given(self, client, gm_headers, personal_campaign):
        resp = convert(client, gm_headers, personal_campaign["id"], gm_title="Keeper")
        assert resp.json()["gm_title"] == "Keeper"

    def test_keeps_existing_gm_title_when_omitted(self, client, gm_headers, personal_campaign):
        resp = convert(client, gm_headers, personal_campaign["id"])
        assert resp.json()["gm_title"] == "Game Master"

    def test_blank_gm_title_keeps_existing(self, client, gm_headers, personal_campaign):
        resp = convert(client, gm_headers, personal_campaign["id"], gm_title="   ")
        assert resp.json()["gm_title"] == "Game Master"

    def test_preserves_name_and_description(self, client, gm_headers):
        created = client.post(
            "/api/campaigns",
            json={"name": "Keep Me", "description": "and me", "is_gm_campaign": False},
            headers=gm_headers,
        ).json()
        resp = convert(client, gm_headers, created["id"])
        assert resp.json()["name"] == "Keep Me"
        assert resp.json()["description"] == "and me"

    def test_unlocks_invitations(self, client, gm_headers, player_id, personal_campaign):
        """Inviting is rejected before conversion and allowed after."""
        before = client.post(
            f"/api/campaigns/{personal_campaign['id']}/invite",
            json={"user_id": player_id},
            headers=gm_headers,
        )
        assert before.status_code == 400

        convert(client, gm_headers, personal_campaign["id"])
        after = client.post(
            f"/api/campaigns/{personal_campaign['id']}/invite",
            json={"user_id": player_id},
            headers=gm_headers,
        )
        assert after.status_code == 201

    def test_already_group_returns_409(self, client, gm_headers, gm_campaign):
        resp = convert(client, gm_headers, gm_campaign["id"])
        assert resp.status_code == 409

    def test_player_cannot_convert(self, client, player_headers):
        """A player may own a personal campaign but cannot run a group one —
        converting must not be a way around the create-time role check."""
        created = client.post(
            "/api/campaigns",
            json={"name": "Player Personal", "is_gm_campaign": False},
            headers=player_headers,
        ).json()
        resp = convert(client, player_headers, created["id"])
        assert resp.status_code == 403
        # And the campaign is untouched.
        detail = client.get(f"/api/campaigns/{created['id']}", headers=player_headers)
        assert detail.json()["is_gm_campaign"] is False

    def test_nonowner_cannot_convert(self, client, player_headers, personal_campaign):
        resp = convert(client, player_headers, personal_campaign["id"])
        assert resp.status_code == 403

    def test_archived_campaign_cannot_convert(self, client, gm_headers, personal_campaign):
        archive(client, gm_headers, personal_campaign["id"])
        resp = convert(client, gm_headers, personal_campaign["id"])
        assert resp.status_code == 409

    def test_nonexistent_returns_404(self, client, gm_headers):
        resp = convert(client, gm_headers, "does-not-exist")
        assert resp.status_code == 404

    def test_unauthenticated_denied(self, client, personal_campaign):
        resp = client.post(f"/api/campaigns/{personal_campaign['id']}/convert-to-group", json={})
        assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Wiki export — available to members, and on archived campaigns
# ---------------------------------------------------------------------------


def export(client, headers, campaign_id, fmt="json"):
    return client.get(f"/api/campaigns/{campaign_id}/wiki/export?format={fmt}", headers=headers)


@pytest.fixture
def campaign_with_pages(client, gm_headers, player_headers, player_id, gm_campaign):
    """A joined campaign holding one page of each visibility."""
    cid = gm_campaign["id"]
    client.post(f"/api/campaigns/{cid}/invite", json={"user_id": player_id}, headers=gm_headers)
    client.patch(
        f"/api/campaigns/{cid}/members/{player_id}",
        json={"status": "accepted"},
        headers=player_headers,
    )
    client.post(
        f"/api/campaigns/{cid}/wiki",
        json={"title": "Shared Lore", "body": "open text ||the secret||", "visibility": "group"},
        headers=gm_headers,
    )
    client.post(
        f"/api/campaigns/{cid}/wiki",
        json={"title": "GM Plans", "body": "the twist", "visibility": "gm"},
        headers=gm_headers,
    )
    return gm_campaign


class TestWikiExportAccess:
    def test_owner_exports_everything(self, client, gm_headers, campaign_with_pages):
        resp = export(client, gm_headers, campaign_with_pages["id"])
        assert resp.status_code == 200
        titles = [p["title"] for p in resp.json()["pages"]]
        assert "Shared Lore" in titles and "GM Plans" in titles

    def test_member_can_export(self, client, player_headers, campaign_with_pages):
        """A player can take their own copy of the campaign with them."""
        resp = export(client, player_headers, campaign_with_pages["id"])
        assert resp.status_code == 200
        assert "Shared Lore" in [p["title"] for p in resp.json()["pages"]]

    def test_member_export_omits_gm_pages(self, client, player_headers, campaign_with_pages):
        resp = export(client, player_headers, campaign_with_pages["id"])
        assert "GM Plans" not in [p["title"] for p in resp.json()["pages"]]

    def test_member_export_strips_gm_secrets(self, client, player_headers, campaign_with_pages):
        """||secrets|| must not ride along in the export body."""
        resp = export(client, player_headers, campaign_with_pages["id"])
        body = next(p["body"] for p in resp.json()["pages"] if p["title"] == "Shared Lore")
        assert "the secret" not in body
        assert "open text" in body

    def test_owner_export_keeps_gm_secrets(self, client, gm_headers, campaign_with_pages):
        resp = export(client, gm_headers, campaign_with_pages["id"])
        body = next(p["body"] for p in resp.json()["pages"] if p["title"] == "Shared Lore")
        assert "the secret" in body

    def test_markdown_export_also_filters(self, client, player_headers, campaign_with_pages):
        """The zip path shares the filtering, not just the JSON bundle."""
        resp = export(client, player_headers, campaign_with_pages["id"], fmt="md")
        assert resp.status_code == 200
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            names = zf.namelist()
            joined = "".join(zf.read(n).decode() for n in names)
        assert not any("gm-plans" in n for n in names)
        assert "the twist" not in joined
        assert "the secret" not in joined

    def test_nonmember_cannot_export(self, client, admin_headers, campaign_with_pages):
        resp = export(client, admin_headers, campaign_with_pages["id"])
        assert resp.status_code == 403

    def test_member_can_export_archived_campaign(
        self, client, gm_headers, player_headers, campaign_with_pages
    ):
        """Archiving is exactly when someone wants their notes out."""
        archive(client, gm_headers, campaign_with_pages["id"])
        resp = export(client, player_headers, campaign_with_pages["id"])
        assert resp.status_code == 200
        assert "Shared Lore" in [p["title"] for p in resp.json()["pages"]]

    def test_owner_can_export_archived_campaign(self, client, gm_headers, campaign_with_pages):
        archive(client, gm_headers, campaign_with_pages["id"])
        assert export(client, gm_headers, campaign_with_pages["id"]).status_code == 200

    def test_import_still_blocked_while_archived(self, client, gm_headers, campaign_with_pages):
        """Export opens up; import writes, so it stays frozen."""
        archive(client, gm_headers, campaign_with_pages["id"])
        resp = client.post(
            f"/api/campaigns/{campaign_with_pages['id']}/wiki/import",
            files={"file": ("a.md", b"# Hi\n\nbody", "text/markdown")},
            headers=gm_headers,
        )
        assert resp.status_code == 409

    def test_member_cannot_import(self, client, player_headers, campaign_with_pages):
        resp = client.post(
            f"/api/campaigns/{campaign_with_pages['id']}/wiki/import",
            files={"file": ("a.md", b"# Hi\n\nbody", "text/markdown")},
            headers=player_headers,
        )
        assert resp.status_code == 403
