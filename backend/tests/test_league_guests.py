"""League guests, and the books a league shares.

A league's organiser invites guests the way a campaign's GM does. A league
guest reaches leagues and their own armies, never campaigns or characters, and
never the library: the only books they open are the ones a league shares with
them, and every library read the army builder makes is narrowed to their
leagues' games. Their code is on the account, so it outlives the league.
"""
import uuid

import pytest

from backend.config import SessionLocal
from backend.models import Faction, LeagueMember, LeagueResource, LeagueResourceShare, User
from backend.tests.conftest import make_book, make_game_system

from backend import config

from .test_api_keys import _create as _create_key
from .test_armies import _import, _roster


def uid() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture
def roster_dir(tmp_path, monkeypatch):
    """Roster files land in a temporary directory, not the shared test DATA_PATH."""
    monkeypatch.setattr(config, "ARMY_ROSTER_DIR", str(tmp_path / "army_rosters"))
    return tmp_path / "army_rosters"


@pytest.fixture(autouse=True)
def guest_access(client, admin_headers):
    client.patch("/api/settings", json={"guest_access_enabled": True}, headers=admin_headers)
    yield
    client.patch("/api/settings", json={"guest_access_enabled": False}, headers=admin_headers)


@pytest.fixture
def game():
    """A wargame with one faction, named so a roster matches it."""
    system = make_game_system(name=f"Grimdark {uid()}", game_type="wargame")
    db = SessionLocal()
    try:
        faction = Faction(game_system_id=system.id, name="Necrons", slug=f"necrons-{uid()}")
        db.add(faction)
        db.commit()
        faction_id = faction.id
    finally:
        db.close()
    return system, faction_id


@pytest.fixture
def league(client, gm_headers, player_id, game):
    system, _ = game
    r = client.post(
        "/api/leagues",
        json={"name": f"League {uid()}", "game_system_id": system.id},
        headers=gm_headers,
    )
    assert r.status_code == 201, r.text
    lg = r.json()
    client.post(f"/api/leagues/{lg['id']}/members", json={"user_id": player_id}, headers=gm_headers)
    yield lg
    client.delete(f"/api/leagues/{lg['id']}", headers=gm_headers)


def _login(client, code):
    r = client.post("/api/auth/guest-login", json={"code": code})
    client.cookies.clear()
    return r


def _invite(client, headers, league_id, nickname="Recruit"):
    r = client.post(f"/api/leagues/{league_id}/guests", json={"nickname": nickname}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def guest(client, gm_headers, league):
    """A signed-in guest of ``league``: (headers, guest record)."""
    created = _invite(client, gm_headers, league["id"])
    login = _login(client, created["guest_code"])
    assert login.status_code == 200, login.text
    assert login.json()["league_id"] == league["id"]
    assert login.json()["campaign_id"] is None
    return {"Authorization": f"Bearer {login.json()['token']}"}, created


@pytest.fixture
def campaign_guest(client, gm_headers):
    c = client.post(
        "/api/campaigns", json={"name": f"Camp {uid()}", "is_gm_campaign": True}, headers=gm_headers
    ).json()
    created = client.post(
        f"/api/campaigns/{c['id']}/guests", json={"nickname": "Bard"}, headers=gm_headers
    ).json()
    login = _login(client, created["guest_code"])
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['token']}"}, created


def _share(client, headers, league_id, book_id, visibility="public", shared=()):
    return client.post(
        f"/api/leagues/{league_id}/books",
        json={"book_id": book_id, "visibility": visibility, "shared_user_ids": list(shared)},
        headers=headers,
    )


# ---------------------------------------------------------------------------
# Scope: a guest reaches one side of the app
# ---------------------------------------------------------------------------


def test_a_league_guest_is_a_wargame_guest(client, guest, league):
    headers, created = guest
    me = client.get("/api/auth/me", headers=headers).json()
    assert me["role"] == "guest" and me["guest_scope"] == "wargame"
    leagues = client.get("/api/leagues", headers=headers).json()
    assert [lg["id"] for lg in leagues] == [league["id"]]
    detail = client.get(f"/api/leagues/{league['id']}", headers=headers).json()
    assert detail["is_member"] and not detail["can_manage"]
    assert detail["game_system_name"]
    assert {m["user_id"]: m["is_guest"] for m in detail["members"]}[created["user_id"]] is True


@pytest.mark.parametrize(
    "path",
    [
        "/api/campaigns",
        "/api/characters",
        "/api/characters/schemas",
        "/api/rulesets",
        "/api/content/packs",
        "/api/books",
        "/api/systems",
        "/api/search?q=x",
    ],
)
def test_a_league_guest_reaches_no_campaign_side_or_library(client, guest, path):
    headers, _ = guest
    assert client.get(path, headers=headers).status_code == 403


@pytest.mark.parametrize("path", ["/api/leagues", "/api/armies", "/api/armies/games"])
def test_a_campaign_guest_reaches_no_wargames(client, campaign_guest, path):
    headers, _ = campaign_guest
    assert client.get(path, headers=headers).status_code == 403


def test_another_league_reads_as_missing(client, guest, gm_headers, game):
    headers, _ = guest
    other = client.post("/api/leagues", json={"name": "Other"}, headers=gm_headers).json()
    try:
        for path in ("", "/books", "/guests"):
            assert client.get(f"/api/leagues/{other['id']}{path}", headers=headers).status_code == 404
    finally:
        client.delete(f"/api/leagues/{other['id']}", headers=gm_headers)


def test_a_guest_manages_nothing(client, guest, league, player_id):
    headers, created = guest
    lid = league["id"]
    book = make_book(make_game_system().id)
    assert _share(client, headers, lid, book.id).status_code == 403
    assert client.get(f"/api/leagues/{lid}/guests", headers=headers).status_code == 403
    assert client.post(f"/api/leagues/{lid}/guests", json={}, headers=headers).status_code == 403
    assert client.get(f"/api/leagues/{lid}/eligible-members", headers=headers).status_code == 403
    assert client.get(
        f"/api/leagues/{lid}/books/search", params={"q": "book"}, headers=headers
    ).status_code == 403
    assert client.delete(f"/api/leagues/{lid}/members/{player_id}", headers=headers).status_code == 403
    assert client.patch(f"/api/leagues/{lid}", json={"name": "x"}, headers=headers).status_code == 403
    assert client.post("/api/leagues", json={"name": "Mine"}, headers=headers).status_code == 403


def test_guests_are_not_offered_as_members(client, gm_headers, league, guest, campaign_guest):
    _, created = guest
    _, bard = campaign_guest
    eligible = client.get(f"/api/leagues/{league['id']}/eligible-members", headers=gm_headers).json()
    ids = {u["id"] for u in eligible}
    assert created["user_id"] not in ids and bard["user_id"] not in ids
    r = client.post(
        f"/api/leagues/{league['id']}/members", json={"user_id": bard["user_id"]}, headers=gm_headers
    )
    assert r.status_code == 404


def test_guest_invites_need_guest_access(client, gm_headers, admin_headers, league):
    client.patch("/api/settings", json={"guest_access_enabled": False}, headers=admin_headers)
    r = client.post(f"/api/leagues/{league['id']}/guests", json={}, headers=gm_headers)
    assert r.status_code == 403


def test_a_guest_code_stops_when_guest_access_does(client, gm_headers, admin_headers, league):
    created = _invite(client, gm_headers, league["id"])
    client.patch("/api/settings", json={"guest_access_enabled": False}, headers=admin_headers)
    assert _login(client, created["guest_code"]).status_code == 403


# ---------------------------------------------------------------------------
# Books
# ---------------------------------------------------------------------------


def test_a_guest_opens_only_the_books_shared_with_them(client, gm_headers, guest, league, player_id):
    headers, created = guest
    lid = league["id"]
    system = make_game_system(game_type="wargame")
    public = make_book(system.id, title="Public Codex")
    mine = make_book(system.id, title="Mine Alone")
    theirs = make_book(system.id, title="Someone Else's")
    secret = make_book(system.id, title="Organiser Notes")
    unshared = make_book(system.id, title="Never Shared")
    assert _share(client, gm_headers, lid, public.id).status_code == 201
    assert _share(client, gm_headers, lid, mine.id, "private", [created["user_id"]]).status_code == 201
    assert _share(client, gm_headers, lid, theirs.id, "private", [player_id]).status_code == 201
    assert _share(client, gm_headers, lid, secret.id, "organizer").status_code == 201

    listed = client.get(f"/api/leagues/{lid}/books", headers=headers).json()
    assert {b["book_id"] for b in listed} == {public.id, mine.id}
    assert all(b["shared_user_ids"] is None for b in listed)
    for book in (public, mine):
        assert client.get(f"/api/books/{book.id}", headers=headers).status_code == 200
    for book in (theirs, secret, unshared):
        assert client.get(f"/api/books/{book.id}", headers=headers).status_code == 404
        assert client.get(f"/api/books/{book.id}/thumbnail", headers=headers).status_code in (403, 404)

    organiser = client.get(f"/api/leagues/{lid}/books", headers=gm_headers).json()
    assert {b["book_id"] for b in organiser} == {public.id, mine.id, theirs.id, secret.id}
    assert {b["book_id"]: b["shared_user_ids"] for b in organiser}[theirs.id] == [player_id]


def test_shares_go_to_members_only(client, gm_headers, league, admin_id):
    book = make_book(make_game_system().id)
    r = _share(client, gm_headers, league["id"], book.id, "private", [admin_id])
    assert r.status_code == 400
    added = _share(client, gm_headers, league["id"], book.id).json()
    r = client.patch(
        f"/api/leagues/{league['id']}/books/{added['id']}",
        json={"visibility": "private", "shared_user_ids": [admin_id]},
        headers=gm_headers,
    )
    assert r.status_code == 400


def test_a_restricted_book_stays_with_the_organiser(client, gm_headers, guest, league):
    headers, _ = guest
    book = make_book(make_game_system().id, access_level="gm")
    added = _share(client, gm_headers, league["id"], book.id, "public").json()
    assert added["visibility"] == "organizer"
    r = client.patch(
        f"/api/leagues/{league['id']}/books/{added['id']}",
        json={"visibility": "public"},
        headers=gm_headers,
    )
    assert r.json()["visibility"] == "organizer"
    assert client.get(f"/api/books/{book.id}", headers=headers).status_code == 404


def test_only_a_book_the_organiser_can_open_is_shared(client, player_headers, gm_headers, league):
    book = make_book(make_game_system().id, access_level="admin")
    assert _share(client, gm_headers, league["id"], book.id).status_code == 404
    assert _share(client, gm_headers, league["id"], "no-such-book").status_code == 404
    found = client.get(
        f"/api/leagues/{league['id']}/books/search", params={"q": book.title}, headers=gm_headers
    ).json()
    assert found == []


def test_organiser_manages_books(client, gm_headers, guest, league):
    headers, _ = guest
    lid = league["id"]
    system_book = make_book(league["game_system_id"], title=f"Zed League Book {uid()}")
    other_book = make_book(make_game_system().id, title=f"Abe League Book {uid()}")
    found = client.get(
        f"/api/leagues/{lid}/books/search", params={"q": "League Book"}, headers=gm_headers
    ).json()
    ids = [b["book_id"] for b in found]
    # The league's own game first, whatever the title order.
    assert ids.index(system_book.id) < ids.index(other_book.id)

    a = _share(client, gm_headers, lid, system_book.id).json()
    b = _share(client, gm_headers, lid, other_book.id).json()
    assert _share(client, gm_headers, lid, system_book.id).status_code == 409
    assert client.put(
        f"/api/leagues/{lid}/books/order", json={"ordered_ids": [b["id"], a["id"]]}, headers=gm_headers
    ).status_code == 204
    listed = client.get(f"/api/leagues/{lid}/books", headers=gm_headers).json()
    assert [x["id"] for x in listed] == [b["id"], a["id"]]

    r = client.patch(
        f"/api/leagues/{lid}/books/{a['id']}", json={"visibility": "organizer"}, headers=gm_headers
    )
    assert r.status_code == 200
    assert client.get(f"/api/books/{system_book.id}", headers=headers).status_code == 404
    assert client.delete(f"/api/leagues/{lid}/books/{b['id']}", headers=gm_headers).status_code == 204
    assert client.get(f"/api/books/{other_book.id}", headers=headers).status_code == 404
    assert client.delete(f"/api/leagues/{lid}/books/{b['id']}", headers=gm_headers).status_code == 404
    assert client.patch(
        f"/api/leagues/{lid}/books/nope", json={"visibility": "public"}, headers=gm_headers
    ).status_code == 404


def test_private_to_public_clears_shares(client, gm_headers, league, player_id):
    book = make_book(make_game_system().id)
    added = _share(client, gm_headers, league["id"], book.id, "private", [player_id]).json()
    assert added["shared_user_ids"] == [player_id]
    r = client.patch(
        f"/api/leagues/{league['id']}/books/{added['id']}",
        json={"visibility": "public"},
        headers=gm_headers,
    ).json()
    assert r["shared_user_ids"] == []


# ---------------------------------------------------------------------------
# Armies: the library narrowed to the guest's leagues
# ---------------------------------------------------------------------------


def test_a_guest_builds_armies_in_their_leagues_games(client, guest, game):
    headers, _ = guest
    system, faction_id = game
    edition = make_game_system(game_type="wargame", parent_id=system.id)
    elsewhere = make_game_system(game_type="wargame")
    db = SessionLocal()
    try:
        stray = Faction(game_system_id=elsewhere.id, name="Orks", slug=f"orks-{uid()}")
        db.add(stray)
        db.commit()
        stray_id = stray.id
    finally:
        db.close()

    games = client.get("/api/armies/games", headers=headers).json()
    assert {g["id"] for g in games} == {system.id, edition.id}
    factions = client.get(f"/api/armies/games/{system.id}/factions", headers=headers).json()
    assert [f["id"] for f in factions["factions"]] == [faction_id]
    assert "book_count" not in factions["factions"][0]
    assert client.get(f"/api/armies/games/{elsewhere.id}/factions", headers=headers).status_code == 404

    r = client.post(
        "/api/armies",
        json={"name": "Dynasty", "game_system_id": system.id, "faction_id": faction_id},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["game_system_name"] == system.name
    assert client.post(
        "/api/armies", json={"name": "X", "game_system_id": elsewhere.id}, headers=headers
    ).status_code == 400
    # A faction elsewhere reads exactly as a missing one, so ids can't be probed.
    stray_r = client.post("/api/armies", json={"name": "X", "faction_id": stray_id}, headers=headers)
    missing_r = client.post("/api/armies", json={"name": "X", "faction_id": "nope"}, headers=headers)
    assert stray_r.status_code == missing_r.status_code == 400
    assert stray_r.json() == missing_r.json()


def test_full_accounts_still_see_every_game(client, player_headers, game):
    system, _ = game
    elsewhere = make_game_system(game_type="wargame")
    ids = {g["id"] for g in client.get("/api/armies/games", headers=player_headers).json()}
    assert {system.id, elsewhere.id} <= ids
    r = client.get(f"/api/armies/games/{elsewhere.id}/factions", headers=player_headers)
    assert r.status_code == 200


def test_a_roster_matches_only_the_guests_games(client, guest, roster_dir):
    headers, _ = guest
    outside = make_game_system(name=f"Outside Game {uid()}", game_type="wargame")
    r = _import(client, headers, _roster(outside.name), "a.ros")
    assert r.status_code == 201, r.text
    army = r.json()
    assert army["game_system_id"] is None and army["game_system_name"] == ""
    # The roster's own name is the guest's file, not the library's.
    assert army["system_name"] == outside.name


def test_cited_books_open_only_when_shared(client, gm_headers, guest, league, game, roster_dir):
    headers, _ = guest
    system, _ = game
    book = make_book(system.id, title="Codex: Necrons", game_type="wargame")
    army = _import(client, headers, _roster(system.name), "a.ros").json()
    assert army["game_system_id"] == system.id
    pubs = client.get(f"/api/armies/{army['id']}/publications", headers=headers).json()
    assert pubs[0]["suggestions"] == []
    link = {"system_name": system.name, "publication": "Codex: Necrons", "book_id": book.id}
    assert client.put("/api/armies/publication-links", json=link, headers=gm_headers).status_code == 200
    try:
        detail = client.get(f"/api/armies/{army['id']}", headers=headers).json()
        assert detail["publication_links"] == {}
        _share(client, gm_headers, league["id"], book.id)
        detail = client.get(f"/api/armies/{army['id']}", headers=headers).json()
        assert detail["publication_links"]["Codex: Necrons"]["book_id"] == book.id
        assert client.get(
            "/api/armies/publication-links/books", params={"q": "codex"}, headers=headers
        ).status_code == 403
    finally:
        client.delete(
            "/api/armies/publication-links",
            params={"publication": "Codex: Necrons", "system_name": system.name},
            headers=gm_headers,
        )


def test_a_guest_plays_in_their_league(client, guest, gm_headers, gm_id, league, player_id):
    headers, created = guest
    lid = league["id"]
    army = client.post("/api/armies", json={"name": "Mine"}, headers=headers).json()
    r = client.put(
        f"/api/leagues/{lid}/members/{created['user_id']}/army",
        json={"army_id": army["id"]},
        headers=headers,
    )
    assert r.status_code == 200
    game = client.post(
        f"/api/leagues/{lid}/games",
        json={"player_a_id": created["user_id"], "player_b_id": player_id, "score_a": 9, "score_b": 3},
        headers=headers,
    )
    assert game.status_code == 201, game.text
    # The other members read the guest's registered army, as they would anyone's.
    assert client.get(f"/api/armies/{army['id']}", headers=gm_headers).status_code == 200
    guests = client.get(f"/api/leagues/{lid}/guests", headers=gm_headers).json()
    assert guests[0]["army"]["id"] == army["id"]


# ---------------------------------------------------------------------------
# Codes, removal and deletion
# ---------------------------------------------------------------------------


def test_regenerating_retires_the_old_code(client, gm_headers, league):
    created = _invite(client, gm_headers, league["id"])
    old = created["guest_code"]
    fresh = client.post(
        f"/api/leagues/{league['id']}/guests/{created['user_id']}/regenerate", headers=gm_headers
    ).json()
    assert fresh["guest_code"] != old
    assert _login(client, old).status_code == 401
    assert _login(client, fresh["guest_code"]).status_code == 200
    share = client.get(
        f"/api/leagues/{league['id']}/guests/{created['user_id']}/share", headers=gm_headers
    ).json()
    assert share["code"] == fresh["guest_code"] and league["name"] in share["message"]


def test_an_api_key_never_reaches_guest_codes(client, gm_headers, admin_headers, gm_id, league):
    """Invite codes are logins, so only the organiser's signed-in session handles
    them - a key with full armies access gets none, and changes none."""
    created = _invite(client, gm_headers, league["id"])
    base = f"/api/leagues/{league['id']}/guests"
    grant = client.patch(f"/api/users/{gm_id}", json={"api_keys_enabled": True}, headers=admin_headers)
    assert grant.status_code == 200, grant.text
    try:
        key, _ = _create_key(client, gm_headers, {"armies": "write"})
        headers = {"X-API-Key": key}
        # The league itself is a key's to read...
        assert client.get(f"/api/leagues/{league['id']}", headers=headers).status_code == 200
        # ...but not its guests' codes.
        for method, path in [
            ("get", base),
            ("post", base),
            ("post", f"{base}/{created['user_id']}/regenerate"),
            ("get", f"{base}/{created['user_id']}/share"),
        ]:
            r = getattr(client, method)(path, headers=headers)
            assert r.status_code == 403, (method, path, r.text)
    finally:
        client.patch(f"/api/users/{gm_id}", json={"api_keys_enabled": False}, headers=admin_headers)
    # Nothing was minted or rotated: the one guest still signs in with its code.
    guests = client.get(base, headers=gm_headers).json()
    assert [g["user_id"] for g in guests] == [created["user_id"]]
    assert _login(client, created["guest_code"]).status_code == 200


def test_guest_routes_take_only_this_leagues_guests(client, gm_headers, league, player_id):
    other = client.post("/api/leagues", json={"name": "Elsewhere"}, headers=gm_headers).json()
    try:
        stranger = _invite(client, gm_headers, other["id"])
        for uid_ in (stranger["user_id"], player_id):
            base = f"/api/leagues/{league['id']}/guests/{uid_}"
            assert client.post(f"{base}/regenerate", headers=gm_headers).status_code == 404
            assert client.get(f"{base}/share", headers=gm_headers).status_code == 404
            assert client.delete(base, headers=gm_headers).status_code == 404
    finally:
        client.delete(f"/api/leagues/{other['id']}", headers=gm_headers)


def test_a_deleted_league_leaves_its_guest_their_armies(client, gm_headers, league, roster_dir):
    created = _invite(client, gm_headers, league["id"])
    headers = {"Authorization": f"Bearer {_login(client, created['guest_code']).json()['token']}"}
    army = client.post("/api/armies", json={"name": "Keepers"}, headers=headers).json()
    book = make_book(make_game_system().id)
    _share(client, gm_headers, league["id"], book.id)
    assert client.get(f"/api/books/{book.id}", headers=headers).status_code == 200

    assert client.delete(f"/api/leagues/{league['id']}", headers=gm_headers).status_code == 204
    db = SessionLocal()
    try:
        assert db.query(LeagueResource).filter_by(league_id=league["id"]).count() == 0
        assert db.query(User).filter_by(id=created["user_id"]).first() is not None
    finally:
        db.close()

    login = client.post("/api/auth/guest-login", json={"code": created["guest_code"]})
    assert login.status_code == 200 and login.json()["league_id"] is None
    # The session renews: the code on the account is the invite now.
    assert client.post("/api/auth/refresh").status_code == 200
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {login.json()['token']}"}
    assert client.get("/api/leagues", headers=headers).json() == []
    assert [a["id"] for a in client.get("/api/armies", headers=headers).json()] == [army["id"]]
    export = client.get(f"/api/armies/{army['id']}/export", params={"format": "text"}, headers=headers)
    assert export.status_code == 200 and "Keepers" in export.text
    assert client.get(f"/api/books/{book.id}", headers=headers).status_code == 404
    assert client.get("/api/armies/games", headers=headers).json() == []


def test_removing_a_guest_keeps_their_account(client, gm_headers, league):
    lid = league["id"]
    created = _invite(client, gm_headers, lid)
    headers = {"Authorization": f"Bearer {_login(client, created['guest_code']).json()['token']}"}
    book = make_book(make_game_system().id)
    _share(client, gm_headers, lid, book.id, "private", [created["user_id"]])
    assert client.get(f"/api/books/{book.id}", headers=headers).status_code == 200

    assert client.delete(f"/api/leagues/{lid}/guests/{created['user_id']}", headers=gm_headers).status_code == 204
    db = SessionLocal()
    try:
        assert db.query(LeagueMember).filter_by(league_id=lid, user_id=created["user_id"]).first() is None
        assert db.query(LeagueResourceShare).filter_by(user_id=created["user_id"]).count() == 0
    finally:
        db.close()
    assert client.get(f"/api/leagues/{lid}", headers=headers).status_code == 404
    assert client.get(f"/api/books/{book.id}", headers=headers).status_code == 404
    assert _login(client, created["guest_code"]).status_code == 200


def test_a_guest_may_leave(client, gm_headers, guest, league):
    headers, created = guest
    r = client.delete(f"/api/leagues/{league['id']}/members/{created['user_id']}", headers=headers)
    assert r.status_code == 204
    assert client.get(f"/api/leagues/{league['id']}", headers=headers).status_code == 404


def test_a_deleted_organiser_takes_the_league_not_the_guests(client, admin_headers):
    name = f"org_{uid()}"
    client.post(
        "/api/users",
        json={"username": name, "password": "orgpass12345", "role": "gm"},
        headers=admin_headers,
    )
    token = client.post("/api/auth/login", json={"username": name, "password": "orgpass12345"}).json()["token"]
    client.cookies.clear()
    org = {"Authorization": f"Bearer {token}"}
    lg = client.post("/api/leagues", json={"name": "Doomed"}, headers=org).json()
    created = _invite(client, org, lg["id"])
    book = make_book(make_game_system().id)
    _share(client, org, lg["id"], book.id, "private", [created["user_id"]])
    org_id = client.get("/api/auth/me", headers=org).json()["id"]
    assert client.delete(f"/api/users/{org_id}", headers=admin_headers).status_code in (200, 204)
    db = SessionLocal()
    try:
        assert db.query(LeagueResource).filter_by(league_id=lg["id"]).count() == 0
        assert db.query(LeagueResourceShare).filter_by(user_id=created["user_id"]).count() == 0
        assert db.query(User).filter_by(id=created["user_id"]).first() is not None
    finally:
        db.close()
    assert _login(client, created["guest_code"]).status_code == 200


# ---------------------------------------------------------------------------
# Admins: the guest list, merging and converting
# ---------------------------------------------------------------------------


def test_the_guest_list_names_the_league(client, admin_headers, guest, league):
    _, created = guest
    rows = {g["id"]: g for g in client.get("/api/users/guests", headers=admin_headers).json()}
    row = rows[created["user_id"]]
    assert row["guest_scope"] == "wargame"
    assert row["league_id"] == league["id"] and row["league_name"] == league["name"]
    assert row["campaign_id"] is None and row["invited_by"]


def test_a_campaign_guest_and_a_league_guest_do_not_merge(client, admin_headers, guest, campaign_guest):
    _, wargamer = guest
    _, bard = campaign_guest
    r = client.post(
        f"/api/users/{bard['user_id']}/merge",
        json={"source_ids": [wargamer["user_id"]]},
        headers=admin_headers,
    )
    assert r.status_code == 400
    r = client.post(
        f"/api/users/{wargamer['user_id']}/merge",
        json={"source_ids": [bard["user_id"]]},
        headers=admin_headers,
    )
    assert r.status_code == 400


def test_a_shared_guests_code_is_the_admins(client, gm_headers, admin_headers, league):
    """Merged across organisers, no organiser sees or changes the guest's code."""
    a = _invite(client, gm_headers, league["id"], "Alpha")
    other = client.post("/api/leagues", json={"name": "Admin's"}, headers=admin_headers).json()
    try:
        b = _invite(client, admin_headers, other["id"], "Beta")
        r = client.post(
            f"/api/users/{a['user_id']}/merge", json={"source_ids": [b["user_id"]]}, headers=admin_headers
        )
        assert r.status_code == 200, r.text
        # Neither code an organiser was shown signs in any more.
        assert _login(client, b["guest_code"]).status_code == 401
        assert _login(client, a["guest_code"]).status_code == 401
        admin_view = client.get(f"/api/leagues/{other['id']}/guests", headers=admin_headers).json()
        fresh = admin_view[0]["guest_code"]
        assert fresh and fresh not in (a["guest_code"], b["guest_code"])
        login = _login(client, fresh)
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['token']}"}
        assert {lg["id"] for lg in client.get("/api/leagues", headers=headers).json()} == {
            league["id"],
            other["id"],
        }
        listed = client.get(f"/api/leagues/{league['id']}/guests", headers=gm_headers).json()
        assert listed[0]["guest_code"] is None
        base = f"/api/leagues/{league['id']}/guests/{a['user_id']}"
        assert client.post(f"{base}/regenerate", headers=gm_headers).status_code == 403
        assert client.get(f"{base}/share", headers=gm_headers).status_code == 403
    finally:
        client.delete(f"/api/leagues/{other['id']}", headers=admin_headers)


def test_merging_into_a_full_account_ends_the_guest(client, admin_headers, gm_headers, league):
    created = _invite(client, gm_headers, league["id"])
    name = f"full_{uid()}"
    user = client.post(
        "/api/users", json={"username": name, "password": "fullpass12345", "role": "player"},
        headers=admin_headers,
    ).json()
    r = client.post(
        f"/api/users/{user['id']}/merge", json={"source_ids": [created["user_id"]]}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert _login(client, created["guest_code"]).status_code == 401
    db = SessionLocal()
    try:
        row = db.query(LeagueMember).filter_by(league_id=league["id"], user_id=user["id"]).first()
        assert row is not None and not row.is_guest
    finally:
        db.close()


def test_converting_a_league_guest_retires_its_code(client, admin_headers, gm_headers, league):
    created = _invite(client, gm_headers, league["id"])
    r = client.post(
        f"/api/users/{created['user_id']}/convert",
        json={"username": f"conv_{uid()}", "password": "convpass12345", "role": "player"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["campaign_access"] is True
    assert _login(client, created["guest_code"]).status_code == 401
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=created["user_id"]).first()
        assert user.guest_scope is None and user.guest_code_hash is None
        row = db.query(LeagueMember).filter_by(league_id=league["id"], user_id=user.id).first()
        assert row is not None and not row.is_guest
    finally:
        db.close()


def test_an_admin_deletes_a_league_guest(client, admin_headers, gm_headers, league):
    created = _invite(client, gm_headers, league["id"])
    assert client.delete(f"/api/users/{created['user_id']}", headers=admin_headers).status_code in (200, 204)
    assert _login(client, created["guest_code"]).status_code == 401
    detail = client.get(f"/api/leagues/{league['id']}", headers=gm_headers).json()
    assert created["user_id"] not in {m["user_id"] for m in detail["members"]}


def test_another_members_army_names_nothing_outside_the_guests_games(
    client, gm_headers, gm_id, guest, league
):
    """A member's army in some other game shows a guest no system or faction of it."""
    headers, _ = guest
    elsewhere = make_game_system(game_type="wargame")
    db = SessionLocal()
    try:
        orks = Faction(game_system_id=elsewhere.id, name="Orks", slug=f"orks-{uid()}")
        db.add(orks)
        db.commit()
        orks_id = orks.id
    finally:
        db.close()
    client.post(f"/api/leagues/{league['id']}/members", json={"user_id": gm_id}, headers=gm_headers)
    army = client.post(
        "/api/armies",
        json={"name": "Waaagh", "game_system_id": elsewhere.id, "faction_id": orks_id},
        headers=gm_headers,
    ).json()
    client.put(
        f"/api/leagues/{league['id']}/members/{gm_id}/army",
        json={"army_id": army["id"]},
        headers=gm_headers,
    )
    seen = client.get(f"/api/armies/{army['id']}", headers=headers).json()
    assert seen["name"] == "Waaagh"
    assert seen["game_system_id"] is None and seen["game_system_name"] == ""
    assert seen["faction"] is None
    # Its owner still sees it all.
    own = client.get(f"/api/armies/{army['id']}", headers=gm_headers).json()
    assert own["game_system_id"] == elsewhere.id and own["faction"]["id"] == orks_id


def test_restricting_a_book_keeps_league_shares_with_the_organiser(
    client, gm_headers, admin_headers, guest, league
):
    headers, _ = guest
    book = make_book(make_game_system().id)
    shared = _share(client, gm_headers, league["id"], book.id, "public").json()
    assert client.get(f"/api/books/{book.id}", headers=headers).status_code == 200
    r = client.patch(f"/api/books/{book.id}", json={"access_level": "gm"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    client.patch(f"/api/books/{book.id}", json={"access_level": "inherit"}, headers=admin_headers)
    # Lifting the restriction does not undo the demotion, as for a campaign.
    rows = {b["id"]: b for b in client.get(f"/api/leagues/{league['id']}/books", headers=gm_headers).json()}
    assert rows[shared["id"]]["visibility"] == "organizer"
    assert client.get(f"/api/books/{book.id}", headers=headers).status_code == 404


def test_league_shares_follow_a_book_through_cleanup_and_merges(league, gm_headers, client, player_id):
    from backend.models import Book
    from backend.services.library_fs.references import (
        purge_references,
        reference_counts,
        reference_counts_for,
    )
    from backend.services.library_fs.rehome import rehome_references

    system = make_game_system()
    keep, dupe, gone = (make_book(system.id) for _ in range(3))
    _share(client, gm_headers, league["id"], keep.id, "private", [player_id])
    _share(client, gm_headers, league["id"], dupe.id, "private", [player_id])
    _share(client, gm_headers, league["id"], gone.id, "private", [player_id])
    db = SessionLocal()
    try:
        assert reference_counts(db, Book, dupe.id)["leagues"] == 1
        assert reference_counts_for(db, Book, [dupe.id, keep.id])[dupe.id]["leagues"] == 1
        report = rehome_references(db, Book, dupe.id, keep.id)
        assert report["leagues"] == {"moved": 0, "deduplicated": 1}
        purge_references(db, Book, gone.id)
        db.commit()
        rows = db.query(LeagueResource).filter_by(league_id=league["id"]).all()
        assert {r.resource_id for r in rows} == {keep.id}
        assert db.query(LeagueResourceShare).filter_by(resource_id=rows[0].id).count() == 1
    finally:
        db.close()
