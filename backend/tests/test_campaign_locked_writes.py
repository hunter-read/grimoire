"""A locked campaign is read-only for everyone.

A campaign is locked while its owner's campaign access is disabled (writes get
403) or while it is archived (writes get 409). These tests walk the app's route
table, so every POST, PUT, PATCH and DELETE under ``/api/campaigns/{campaign_id}``
is checked - a route added later is covered without being listed here.
"""

import re
import uuid

import pytest

from backend.main import app
from backend.route_table import endpoint_routes
from backend.routers.campaigns._writable import ACCESS_DISABLED, ARCHIVED, allowed_states

PREFIX = "/api/campaigns/{campaign_id}"
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
BOTH = frozenset({ARCHIVED, ACCESS_DISABLED})

# The only writes that stay open while a campaign is locked, and the states they
# stay open in. Each handler applies its own narrower check, tested below.
EXPECTED_OPEN = {
    # Unarchiving is the way out of the archived state.
    ("PUT", f"{PREFIX}/archive"): frozenset({ARCHIVED}),
    # Archiving is a tidying step, not a lock against removal.
    ("DELETE", PREFIX): frozenset({ARCHIVED}),
    # Declining an invitation stays open while the GM's access is disabled
    # (anything else is refused); an archived campaign refuses it too.
    ("PATCH", f"{PREFIX}/members/{{user_id}}"): frozenset({ACCESS_DISABLED}),
    # A member may always leave (the owner removing someone else is refused).
    ("DELETE", f"{PREFIX}/members/{{user_id}}"): BOTH,
    # Hiding a page is per-user decluttering and writes nothing to the campaign.
    ("POST", f"{PREFIX}/wiki/{{page_id}}/hide"): BOTH,
    ("DELETE", f"{PREFIX}/wiki/{{page_id}}/hide"): BOTH,
}

LOCKED_DETAIL = "Campaign is locked: the GM's campaign access has been disabled"


def _write_routes():
    out = []
    for route in endpoint_routes(app.routes):
        if route.path != PREFIX and not route.path.startswith(PREFIX + "/"):
            continue
        for method in sorted(route.methods & WRITE_METHODS):
            out.append((method, route.path, getattr(route, "original_route", route).endpoint))
    return out


WRITE_ROUTES = _write_routes()


def _url(path: str, campaign_id: str, member_id: str) -> str:
    def fill(match: re.Match) -> str:
        name = match.group(1)
        if name == "campaign_id":
            return campaign_id
        if name in ("user_id", "member_id"):
            return member_id
        if name == "session_date":
            return "2030-01-01"
        return "missing"

    return re.sub(r"\{(\w+)\}", fill, path)


def _routes_refused_in(state: str):
    return [
        pytest.param(method, path, id=f"{method} {path[len(PREFIX):] or '/'}")
        for method, path, _ in WRITE_ROUTES
        if state not in EXPECTED_OPEN.get((method, path), frozenset())
    ]


def _make_user(client, admin_headers, role):
    username = f"lock_{role}_{uuid.uuid4().hex[:8]}"
    resp = client.post(
        "/api/users",
        json={"username": username, "password": "lockedpassword123", "role": role},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    login = client.post("/api/auth/login", json={"username": username, "password": "lockedpassword123"})
    assert login.status_code == 200, login.text
    return resp.json()["id"], {"Authorization": f"Bearer {login.json()['token']}"}


def _set_access(client, admin_headers, user_id, allowed):
    resp = client.patch(
        f"/api/users/{user_id}", json={"campaign_access": allowed}, headers=admin_headers
    )
    assert resp.status_code == 200, resp.text


def _campaign_with_member(client, admin_headers):
    """A GM campaign with one accepted player and one wiki page."""
    owner_id, owner = _make_user(client, admin_headers, "gm")
    player_id, player = _make_user(client, admin_headers, "player")
    resp = client.post(
        "/api/campaigns", json={"name": "Locked", "is_gm_campaign": True}, headers=owner
    )
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]
    assert client.post(
        f"/api/campaigns/{cid}/invite", json={"user_id": player_id}, headers=owner
    ).status_code < 300
    assert client.patch(
        f"/api/campaigns/{cid}/members/{player_id}", json={"status": "accepted"}, headers=player
    ).status_code == 200
    page = client.post(
        f"/api/campaigns/{cid}/wiki", json={"title": "Notes", "visibility": "group"}, headers=owner
    )
    assert page.status_code < 300, page.text
    return {
        "id": cid,
        "owner_id": owner_id,
        "owner": owner,
        "player_id": player_id,
        "player": player,
        "page_id": page.json()["id"],
    }


@pytest.fixture(scope="module")
def gm_access_disabled(client, admin_headers):
    c = _campaign_with_member(client, admin_headers)
    _set_access(client, admin_headers, c["owner_id"], False)
    return c


@pytest.fixture(scope="module")
def archived(client, admin_headers):
    c = _campaign_with_member(client, admin_headers)
    resp = client.put(f"/api/campaigns/{c['id']}/archive", json={"archived": True}, headers=c["owner"])
    assert resp.status_code == 200, resp.text
    return c


@pytest.fixture
def fresh_gm_access_disabled(client, admin_headers):
    """Like ``gm_access_disabled``, but per test, for tests that change it."""
    c = _campaign_with_member(client, admin_headers)
    _set_access(client, admin_headers, c["owner_id"], False)
    return c


def test_the_route_table_has_campaign_writes():
    # Guards the walk itself: an empty list would make every test below vacuous.
    assert len(WRITE_ROUTES) > 40


def test_only_the_listed_writes_are_marked_to_run_while_locked():
    marked = {
        (method, path): allowed_states(endpoint)
        for method, path, endpoint in WRITE_ROUTES
        if allowed_states(endpoint)
    }
    assert marked == EXPECTED_OPEN


@pytest.mark.parametrize("who", ["owner", "player"])
@pytest.mark.parametrize("method,path", _routes_refused_in(ACCESS_DISABLED))
def test_writes_refused_while_gm_access_is_disabled(client, gm_access_disabled, who, method, path):
    c = gm_access_disabled
    url = _url(path, c["id"], c["player_id"])
    resp = client.request(method, url, headers=c[who])
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"] == LOCKED_DETAIL


@pytest.mark.parametrize("who", ["owner", "player"])
@pytest.mark.parametrize("method,path", _routes_refused_in(ARCHIVED))
def test_writes_refused_while_archived(client, archived, who, method, path):
    c = archived
    url = _url(path, c["id"], c["player_id"])
    resp = client.request(method, url, headers=c[who])
    assert resp.status_code == 409, resp.text
    assert "archived" in resp.json()["detail"]


def test_reads_still_work_while_locked(client, gm_access_disabled):
    c = gm_access_disabled
    for who in ("owner", "player"):
        assert client.get(f"/api/campaigns/{c['id']}", headers=c[who]).status_code == 200
        assert client.get(f"/api/campaigns/{c['id']}/wiki", headers=c[who]).status_code == 200


def test_an_outsider_gets_the_handlers_own_answer(client, admin_headers, gm_access_disabled):
    _, outsider = _make_user(client, admin_headers, "player")
    c = gm_access_disabled
    resp = client.patch(f"/api/campaigns/{c['id']}", json={"name": "x"}, headers=outsider)
    assert resp.status_code == 403
    assert resp.json()["detail"] != LOCKED_DETAIL
    missing = client.patch("/api/campaigns/no-such-campaign", json={"name": "x"}, headers=outsider)
    assert missing.status_code == 404


class TestWhatStaysOpenWhileGmAccessIsDisabled:
    def test_a_member_can_leave(self, client, fresh_gm_access_disabled):
        c = fresh_gm_access_disabled
        resp = client.delete(f"/api/campaigns/{c['id']}/members/{c['player_id']}", headers=c["player"])
        assert resp.status_code < 300, resp.text
        assert client.get(f"/api/campaigns/{c['id']}", headers=c["player"]).status_code == 403

    def test_the_owner_cannot_remove_a_member(self, client, fresh_gm_access_disabled):
        c = fresh_gm_access_disabled
        resp = client.delete(f"/api/campaigns/{c['id']}/members/{c['player_id']}", headers=c["owner"])
        assert resp.status_code == 403
        assert resp.json()["detail"] == LOCKED_DETAIL

    def test_a_member_can_decline(self, client, fresh_gm_access_disabled):
        c = fresh_gm_access_disabled
        url = f"/api/campaigns/{c['id']}/members/{c['player_id']}"
        assert client.patch(url, json={"status": "declined"}, headers=c["player"]).status_code == 200

    def test_a_member_cannot_accept_or_change_their_character(self, client, fresh_gm_access_disabled):
        c = fresh_gm_access_disabled
        url = f"/api/campaigns/{c['id']}/members/{c['player_id']}"
        for body in ({"status": "accepted"}, {"character_name": "Vex"}, {"status": "declined", "character_name": "Vex"}):
            resp = client.patch(url, json=body, headers=c["player"])
            assert resp.status_code == 403, body
            assert resp.json()["detail"] == LOCKED_DETAIL

    def test_a_pending_invitee_can_decline_but_not_accept(self, client, admin_headers):
        owner_id, owner = _make_user(client, admin_headers, "gm")
        invitee_id, invitee = _make_user(client, admin_headers, "player")
        cid = client.post(
            "/api/campaigns", json={"name": "Pending", "is_gm_campaign": True}, headers=owner
        ).json()["id"]
        client.post(f"/api/campaigns/{cid}/invite", json={"user_id": invitee_id}, headers=owner)
        _set_access(client, admin_headers, owner_id, False)
        url = f"/api/campaigns/{cid}/members/{invitee_id}"
        assert client.patch(url, json={"status": "accepted"}, headers=invitee).status_code == 403
        assert client.patch(url, json={"status": "declined"}, headers=invitee).status_code == 200

    def test_a_member_can_hide_and_unhide_a_page(self, client, fresh_gm_access_disabled):
        c = fresh_gm_access_disabled
        url = f"/api/campaigns/{c['id']}/wiki/{c['page_id']}/hide"
        assert client.post(url, headers=c["player"]).status_code == 200
        assert client.delete(url, headers=c["player"]).status_code == 200

    def test_the_owner_cannot_archive_or_delete(self, client, fresh_gm_access_disabled):
        c = fresh_gm_access_disabled
        archive = client.put(f"/api/campaigns/{c['id']}/archive", json={"archived": True}, headers=c["owner"])
        assert archive.status_code == 403
        assert client.delete(f"/api/campaigns/{c['id']}", headers=c["owner"]).status_code == 403

    def test_writes_resume_once_access_is_restored(self, client, admin_headers, fresh_gm_access_disabled):
        c = fresh_gm_access_disabled
        url = f"/api/campaigns/{c['id']}/wiki/{c['page_id']}"
        assert client.patch(url, json={"body": "edited"}, headers=c["owner"]).status_code == 403
        _set_access(client, admin_headers, c["owner_id"], True)
        assert client.patch(url, json={"body": "edited"}, headers=c["owner"]).status_code == 200


class TestWhatStaysOpenWhileArchived:
    def test_the_owner_can_unarchive(self, client, admin_headers):
        c = _campaign_with_member(client, admin_headers)
        url = f"/api/campaigns/{c['id']}/archive"
        assert client.put(url, json={"archived": True}, headers=c["owner"]).status_code == 200
        assert client.put(url, json={"archived": False}, headers=c["owner"]).status_code == 200

    def test_the_owner_can_delete(self, client, admin_headers):
        c = _campaign_with_member(client, admin_headers)
        client.put(f"/api/campaigns/{c['id']}/archive", json={"archived": True}, headers=c["owner"])
        assert client.delete(f"/api/campaigns/{c['id']}", headers=c["owner"]).status_code < 300

    def test_a_member_can_leave(self, client, admin_headers):
        c = _campaign_with_member(client, admin_headers)
        client.put(f"/api/campaigns/{c['id']}/archive", json={"archived": True}, headers=c["owner"])
        url = f"/api/campaigns/{c['id']}/members/{c['player_id']}"
        assert client.delete(url, headers=c["player"]).status_code < 300
