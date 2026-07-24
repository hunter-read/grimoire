"""Endpoint tests for campaign session notes.

Covers backend/routers/campaigns/sessions.py: list/create/get/update/delete
sessions, player + GM note upserts, and the note search endpoint, including the
auth/validation guard branches.
"""
import uuid

import pytest


def uid():
    return uuid.uuid4().hex[:8]


@pytest.fixture()
def gm_campaign(client, gm_headers):
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Sess {uid()}", "is_gm_campaign": True},
        headers=gm_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture()
def member_player(client, gm_headers, player_headers, player_id, gm_campaign):
    """Invite + accept the player into the GM campaign so they can view sessions."""
    cid = gm_campaign["id"]
    client.post(f"/api/campaigns/{cid}/invite", json={"user_id": player_id}, headers=gm_headers)
    client.patch(
        f"/api/campaigns/{cid}/members/{player_id}",
        json={"status": "accepted"},
        headers=player_headers,
    )
    return player_id


def _make_session(client, headers, cid, date="2026-05-01", title="Session One"):
    r = client.post(
        f"/api/campaigns/{cid}/sessions",
        json={"session_date": date, "title": title},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


class TestSessionCrud:
    def test_create_list_get(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        s = _make_session(client, gm_headers, cid)
        lst = client.get(f"/api/campaigns/{cid}/sessions", headers=gm_headers)
        assert lst.status_code == 200
        assert any(row["id"] == s["id"] for row in lst.json())
        got = client.get(f"/api/campaigns/{cid}/sessions/{s['id']}", headers=gm_headers)
        assert got.status_code == 200
        assert got.json()["title"] == "Session One"
        assert got.json()["player_notes"] == []

    def test_create_rejects_bad_date(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        r = client.post(
            f"/api/campaigns/{cid}/sessions",
            json={"session_date": "nope", "title": "x"},
            headers=gm_headers,
        )
        assert r.status_code == 400

    def test_update_title(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        s = _make_session(client, gm_headers, cid)
        r = client.patch(
            f"/api/campaigns/{cid}/sessions/{s['id']}",
            json={"title": "Renamed"},
            headers=gm_headers,
        )
        assert r.status_code == 200
        assert r.json()["title"] == "Renamed"

    def test_update_missing_session_404(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        r = client.patch(
            f"/api/campaigns/{cid}/sessions/does-not-exist",
            json={"title": "x"},
            headers=gm_headers,
        )
        assert r.status_code == 404

    def test_delete_session(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        s = _make_session(client, gm_headers, cid)
        d = client.delete(f"/api/campaigns/{cid}/sessions/{s['id']}", headers=gm_headers)
        assert d.status_code == 204
        # Idempotent: deleting again is a no-op.
        d2 = client.delete(f"/api/campaigns/{cid}/sessions/{s['id']}", headers=gm_headers)
        assert d2.status_code == 204

    def test_non_member_cannot_list(self, client, player_headers, gm_campaign):
        r = client.get(f"/api/campaigns/{gm_campaign['id']}/sessions", headers=player_headers)
        assert r.status_code == 403


class TestSessionNotes:
    def test_player_note_upsert_insert_then_update(
        self, client, gm_headers, player_headers, member_player, gm_campaign
    ):
        cid = gm_campaign["id"]
        s = _make_session(client, gm_headers, cid)
        # Insert
        r = client.put(
            f"/api/campaigns/{cid}/sessions/{s['id']}/notes/player",
            json={"content": "we fought a dragon"},
            headers=player_headers,
        )
        assert r.status_code == 200
        assert r.json()["content"] == "we fought a dragon"
        # Update (existing row branch)
        r2 = client.put(
            f"/api/campaigns/{cid}/sessions/{s['id']}/notes/player",
            json={"content": "edited"},
            headers=player_headers,
        )
        assert r2.json()["content"] == "edited"
        # The note now shows up in the session detail.
        got = client.get(f"/api/campaigns/{cid}/sessions/{s['id']}", headers=player_headers)
        assert any(n["content"] == "edited" for n in got.json()["player_notes"])

    def test_player_note_missing_session_404(self, client, player_headers, member_player, gm_campaign):
        cid = gm_campaign["id"]
        r = client.put(
            f"/api/campaigns/{cid}/sessions/nope/notes/player",
            json={"content": "x"},
            headers=player_headers,
        )
        assert r.status_code == 404

    def test_gm_note_upsert_insert_then_update(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        s = _make_session(client, gm_headers, cid)
        r = client.put(
            f"/api/campaigns/{cid}/sessions/{s['id']}/notes/gm",
            json={"internal_content": "secret plot", "external_content": "recap"},
            headers=gm_headers,
        )
        assert r.status_code == 200
        # Update existing GM note (existing-row branch)
        r2 = client.put(
            f"/api/campaigns/{cid}/sessions/{s['id']}/notes/gm",
            json={"external_content": "public recap v2"},
            headers=gm_headers,
        )
        assert r2.status_code == 200
        # GM sees both internal and external in the detail.
        got = client.get(f"/api/campaigns/{cid}/sessions/{s['id']}", headers=gm_headers).json()
        assert got["gm_note"]["internal_content"] == "secret plot"
        assert got["gm_note"]["external_content"] == "public recap v2"

    def test_player_cannot_write_gm_note(
        self, client, gm_headers, player_headers, member_player, gm_campaign
    ):
        cid = gm_campaign["id"]
        s = _make_session(client, gm_headers, cid)
        r = client.put(
            f"/api/campaigns/{cid}/sessions/{s['id']}/notes/gm",
            json={"internal_content": "x"},
            headers=player_headers,
        )
        assert r.status_code == 403


class TestSessionSearch:
    def test_search_finds_player_and_gm_notes(
        self, client, gm_headers, player_headers, member_player, gm_campaign
    ):
        cid = gm_campaign["id"]
        s = _make_session(client, gm_headers, cid, title="Search Session")
        client.put(
            f"/api/campaigns/{cid}/sessions/{s['id']}/notes/player",
            json={"content": "the wizard cast fireball"},
            headers=player_headers,
        )
        client.put(
            f"/api/campaigns/{cid}/sessions/{s['id']}/notes/gm",
            json={"internal_content": "wizard is a spy", "external_content": "wizard helped"},
            headers=gm_headers,
        )
        # GM search sees player notes + external + internal GM notes.
        gm_res = client.get(
            f"/api/campaigns/{cid}/sessions/search?q=wizard", headers=gm_headers
        )
        assert gm_res.status_code == 200
        note_types = {r["note_type"] for r in gm_res.json()["results"]}
        assert "player" in note_types
        assert "gm_internal" in note_types
        assert "gm_external" in note_types

    def test_player_search_hides_gm_internal(
        self, client, gm_headers, player_headers, member_player, gm_campaign
    ):
        cid = gm_campaign["id"]
        s = _make_session(client, gm_headers, cid)
        client.put(
            f"/api/campaigns/{cid}/sessions/{s['id']}/notes/gm",
            json={"internal_content": "goblin ambush secret", "external_content": "goblin recap"},
            headers=gm_headers,
        )
        res = client.get(
            f"/api/campaigns/{cid}/sessions/search?q=goblin", headers=player_headers
        )
        assert res.status_code == 200
        note_types = {r["note_type"] for r in res.json()["results"]}
        assert "gm_internal" not in note_types

    def test_search_empty_when_no_notes(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        res = client.get(
            f"/api/campaigns/{cid}/sessions/search?q=nothingmatches", headers=gm_headers
        )
        assert res.status_code == 200
        assert res.json()["results"] == []
