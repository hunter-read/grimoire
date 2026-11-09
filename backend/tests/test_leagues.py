"""Leagues: membership, armies, games and standings."""
import datetime
import uuid
from types import SimpleNamespace

import pytest

from backend.config import SessionLocal
from backend.models import Army, League, LeagueGame, LeagueMember, PublicationLink, User
from backend.services import leagues as league_service
from backend.services.campaigns.user_data import purge_user_data, reassign_user_data
from backend.tests.conftest import make_book, make_game_system


@pytest.fixture
def league(client, gm_headers, gm_id, player_id):
    """A league organised by the GM, with the GM and the player as members."""
    system = make_game_system(game_type="wargame")
    r = client.post(
        "/api/leagues",
        json={"name": " Winter League ", "game_system_id": system.id, "points_limit": 1000},
        headers=gm_headers,
    )
    assert r.status_code == 201, r.text
    league = r.json()
    for uid in (gm_id, player_id):
        assert client.post(
            f"/api/leagues/{league['id']}/members", json={"user_id": uid}, headers=gm_headers
        ).status_code == 201
    yield league
    client.delete(f"/api/leagues/{league['id']}", headers=gm_headers)


def test_service_results_and_standings():
    assert league_service.decide_result(20, 10, None) == "a"
    assert league_service.decide_result(5, 9, None) == "b"
    assert league_service.decide_result(7, 7, "draw") == "draw"
    assert league_service.decide_result(None, None, "b") == "b"
    for args in ((None, None, None), (1, 2, "a"), (None, None, "maybe")):
        with pytest.raises(league_service.LeagueGameError):
            league_service.decide_result(*args)

    def game(a, b, sa, sb, r):
        return SimpleNamespace(player_a_id=a, player_b_id=b, score_a=sa, score_b=sb, result=r)

    rows = league_service.standings(
        [
            {"user_id": "x", "name": "Xan"},
            {"user_id": "y", "name": "Yvette"},
            {"user_id": "z", "name": "Zed"},
        ],
        [game("x", "y", 20, 10, "a"), game("y", "z", 5, 5, "draw"), game("x", "gone", 1, 0, "a")],
    )
    assert [r["user_id"] for r in rows] == ["x", "z", "y"]
    assert rows[0]["points"] == 6 and rows[0]["won"] == 2
    assert rows[1]["drawn"] == 1 and rows[2]["lost"] == 1


def test_standings_break_ties_on_score_difference():
    def game(a, b, sa, sb, r):
        return SimpleNamespace(player_a_id=a, player_b_id=b, score_a=sa, score_b=sb, result=r)

    rows = league_service.standings(
        [{"user_id": "a", "name": "Ann"}, {"user_id": "b", "name": "Bo"}, {"user_id": "c", "name": "Cy"}],
        [game("b", "c", 30, 0, "a"), game("a", "c", 11, 10, "a")],
        (2, 1, 0),
    )
    assert [r["user_id"] for r in rows] == ["b", "a", "c"]
    assert rows[0]["points"] == rows[1]["points"] == 2


def test_only_gms_create_and_only_people_see(client, player_headers, admin_headers, gm_headers, league):
    assert client.post("/api/leagues", json={"name": "Nope"}, headers=player_headers).status_code == 403
    assert league["name"] == "Winter League"
    assert league["game_system_name"]
    mine = client.get("/api/leagues", headers=player_headers).json()
    assert league["id"] in {lg["id"] for lg in mine}
    assert client.get(f"/api/leagues/{league['id']}", headers=admin_headers).status_code == 200
    assert league["id"] in {lg["id"] for lg in client.get("/api/leagues", headers=admin_headers).json()}
    detail = client.get(f"/api/leagues/{league['id']}", headers=player_headers).json()
    assert detail["is_member"] and not detail["can_manage"]
    assert detail["member_count"] == 2 and detail["organizer_name"]
    assert client.patch(
        f"/api/leagues/{league['id']}", json={"name": "Mine now"}, headers=player_headers
    ).status_code == 403
    assert client.delete(f"/api/leagues/{league['id']}", headers=player_headers).status_code == 403
    # A league you are not part of does not exist, as far as you can tell.
    other = client.post("/api/leagues", json={"name": "Private"}, headers=gm_headers).json()
    assert client.get(f"/api/leagues/{other['id']}", headers=player_headers).status_code == 404
    client.delete(f"/api/leagues/{other['id']}", headers=gm_headers)


def test_league_settings(client, gm_headers, league):
    rpg = make_game_system(game_type="ttrpg")
    r = client.patch(
        f"/api/leagues/{league['id']}",
        json={"points_win": 4, "status": "finished", "name": " Spring ", "description": "d"},
        headers=gm_headers,
    )
    assert r.status_code == 200
    assert r.json()["points_win"] == 4 and r.json()["status"] == "finished"
    assert r.json()["name"] == "Spring" and r.json()["description"] == "d"
    # A null where a number belongs changes nothing.
    r = client.patch(f"/api/leagues/{league['id']}", json={"points_win": None}, headers=gm_headers)
    assert r.json()["points_win"] == 4
    assert client.patch(
        f"/api/leagues/{league['id']}", json={"status": "paused"}, headers=gm_headers
    ).status_code == 422
    assert client.patch(
        f"/api/leagues/{league['id']}", json={"game_system_id": rpg.id}, headers=gm_headers
    ).status_code == 400
    assert client.post(
        "/api/leagues", json={"name": "x", "game_system_id": rpg.id}, headers=gm_headers
    ).status_code == 400


def test_members_and_armies(client, gm_headers, player_headers, player_id, gm_id, league):
    eligible = client.get(f"/api/leagues/{league['id']}/eligible-members", headers=gm_headers).json()
    assert player_id not in {u["id"] for u in eligible}
    assert client.get(
        f"/api/leagues/{league['id']}/eligible-members", headers=player_headers
    ).status_code == 403
    assert client.post(
        f"/api/leagues/{league['id']}/members", json={"user_id": "nobody"}, headers=gm_headers
    ).status_code == 404
    # Adding someone twice changes nothing.
    again = client.post(
        f"/api/leagues/{league['id']}/members", json={"user_id": player_id}, headers=gm_headers
    )
    assert again.status_code == 201 and again.json()["member_count"] == 2

    army = client.post(
        "/api/armies",
        json={"name": "Bones", "units": [{"name": "W", "points": 100}]},
        headers=player_headers,
    ).json()
    # Private before it is registered in the league.
    assert client.get(f"/api/armies/{army['id']}", headers=gm_headers).status_code == 404
    r = client.put(
        f"/api/leagues/{league['id']}/members/{player_id}/army",
        json={"army_id": army["id"]},
        headers=player_headers,
    )
    assert r.status_code == 200
    member = next(m for m in r.json()["members"] if m["user_id"] == player_id)
    assert member["army"] == {"id": army["id"], "name": "Bones", "points": 100, "cost_name": "pts"}
    # League people may now read the army, but not change it.
    seen = client.get(f"/api/armies/{army['id']}", headers=gm_headers)
    assert seen.status_code == 200 and not seen.json()["can_edit"]
    assert client.patch(
        f"/api/armies/{army['id']}", json={"name": "Mine"}, headers=gm_headers
    ).status_code == 403

    # Not someone else's army, and not someone else's slot.
    assert client.put(
        f"/api/leagues/{league['id']}/members/{gm_id}/army",
        json={"army_id": army["id"]},
        headers=gm_headers,
    ).status_code == 400
    assert client.put(
        f"/api/leagues/{league['id']}/members/{gm_id}/army",
        json={"army_id": None},
        headers=player_headers,
    ).status_code == 403

    # A member can leave; only the organiser removes others.
    assert client.delete(
        f"/api/leagues/{league['id']}/members/{gm_id}", headers=player_headers
    ).status_code == 403
    assert client.delete(
        f"/api/leagues/{league['id']}/members/{player_id}", headers=player_headers
    ).status_code == 204
    assert client.get(f"/api/leagues/{league['id']}", headers=player_headers).status_code == 404
    assert client.put(
        f"/api/leagues/{league['id']}/members/{player_id}/army",
        json={"army_id": None},
        headers=gm_headers,
    ).status_code == 404
    client.delete(f"/api/armies/{army['id']}", headers=player_headers)


def test_guests_cannot_be_members(client, gm_headers, league):
    db = SessionLocal()
    try:
        guest = User(username=f"guest-{uuid.uuid4().hex[:8]}", role="guest", is_guest=True)
        db.add(guest)
        db.commit()
        guest_id = guest.id
    finally:
        db.close()
    eligible = client.get(f"/api/leagues/{league['id']}/eligible-members", headers=gm_headers).json()
    assert guest_id not in {u["id"] for u in eligible}
    assert client.post(
        f"/api/leagues/{league['id']}/members", json={"user_id": guest_id}, headers=gm_headers
    ).status_code == 404


def test_games_and_standings(client, gm_headers, player_headers, gm_id, player_id, league):
    base = f"/api/leagues/{league['id']}/games"
    game = {
        "player_a_id": player_id,
        "player_b_id": gm_id,
        "score_a": 20,
        "score_b": 10,
        "mission": " Take and Hold ",
        "played_on": "2026-11-01",
    }
    r = client.post(base, json=game, headers=player_headers)
    assert r.status_code == 201, r.text
    detail = r.json()
    assert detail["standings"][0]["user_id"] == player_id
    assert detail["standings"][0]["points"] == 3
    logged = detail["games"][0]
    assert logged["can_edit"] and logged["mission"] == "Take and Hold"
    assert logged["played_on"] == "2026-11-01" and logged["result"] == "a"
    game_id = logged["id"]

    # Validation.
    assert client.post(base, json=dict(game, player_b_id=player_id), headers=player_headers).status_code == 400
    assert client.post(base, json=dict(game, result="b"), headers=player_headers).status_code == 400
    assert client.post(base, json=dict(game, player_b_id="stranger"), headers=player_headers).status_code == 400
    assert client.post(base, json=dict(game, score_a=None, score_b=None), headers=player_headers).status_code == 400

    # A player can edit; the organiser can edit or delete anything.
    r = client.put(f"{base}/{game_id}", json=dict(game, score_a=10, score_b=10), headers=player_headers)
    assert r.json()["games"][0]["result"] == "draw"
    r = client.put(
        f"{base}/{game_id}",
        json=dict(game, player_a_id=gm_id, player_b_id=player_id, score_a=1, score_b=2),
        headers=gm_headers,
    )
    assert r.json()["games"][0]["player_a"]["id"] == gm_id
    assert client.put(f"{base}/missing", json=game, headers=gm_headers).status_code == 404
    assert client.delete(f"{base}/{game_id}", headers=gm_headers).status_code == 204
    assert client.get(f"/api/leagues/{league['id']}", headers=gm_headers).json()["games"] == []


def test_members_log_only_their_own_games(
    client, gm_headers, admin_id, gm_id, player_id, player_headers, league
):
    client.post(f"/api/leagues/{league['id']}/members", json={"user_id": admin_id}, headers=gm_headers)
    base = f"/api/leagues/{league['id']}/games"
    other = {"player_a_id": gm_id, "player_b_id": admin_id, "result": "a"}
    assert client.post(base, json=other, headers=player_headers).status_code == 403
    r = client.post(base, json=other, headers=gm_headers)
    game_id = r.json()["games"][0]["id"]
    detail = client.get(f"/api/leagues/{league['id']}", headers=player_headers).json()
    assert detail["games"][0]["can_edit"] is False
    # Neither a player in it nor the organiser: hands off.
    assert client.put(f"{base}/{game_id}", json=other, headers=player_headers).status_code == 403
    assert client.delete(f"{base}/{game_id}", headers=player_headers).status_code == 403
    # And a player cannot hand their game to two others.
    mine = client.post(
        base, json={"player_a_id": player_id, "player_b_id": gm_id, "result": "b"}, headers=player_headers
    ).json()["games"]
    my_game = next(g for g in mine if g["player_a"]["id"] == player_id)
    assert client.put(f"{base}/{my_game['id']}", json=other, headers=player_headers).status_code == 403
    assert client.delete(f"{base}/{my_game['id']}", headers=player_headers).status_code == 204


# ---------------------------------------------------------------------------
# Accounts going away
# ---------------------------------------------------------------------------


def _user(name: str, role: str = "player") -> str:
    db = SessionLocal()
    try:
        user = User(username=f"{name}-{uuid.uuid4().hex[:8]}", role=role)
        db.add(user)
        db.commit()
        return user.id
    finally:
        db.close()


def _seed_league(db, organiser: str, players: tuple[str, str]) -> str:
    league = League(name="Seeded", organizer_id=organiser)
    db.add(league)
    db.flush()
    for uid in players:
        db.add(LeagueMember(league_id=league.id, user_id=uid))
    db.add(
        LeagueGame(
            league_id=league.id,
            player_a_id=players[0],
            player_b_id=players[1],
            result="a",
            recorded_by=players[0],
            played_on=datetime.date(2026, 11, 1),
        )
    )
    db.commit()
    return league.id


def test_deleting_an_organiser_takes_their_leagues():
    organiser, a, b = _user("org", "gm"), _user("a"), _user("b")
    db = SessionLocal()
    try:
        league_id = _seed_league(db, organiser, (a, b))
        purge_user_data(db, organiser)
        db.query(User).filter_by(id=organiser).delete()
        db.commit()
        assert db.query(League).filter_by(id=league_id).count() == 0
        assert db.query(LeagueMember).filter_by(league_id=league_id).count() == 0
        assert db.query(LeagueGame).filter_by(league_id=league_id).count() == 0
    finally:
        db.close()


def test_deleting_a_player_takes_their_games_and_clears_attribution():
    organiser, a, b = _user("org", "gm"), _user("a"), _user("b")
    system = make_game_system(game_type="wargame")
    book = make_book(system.id, game_type="wargame")
    db = SessionLocal()
    try:
        league_id = _seed_league(db, organiser, (a, b))
        army = Army(user_id=a, name="Gone", data={}, progress={})
        db.add(army)
        db.add(PublicationLink(system_name="x", publication=f"P {a}", book_id=book.id, created_by=a))
        db.commit()
        db.query(LeagueMember).filter_by(league_id=league_id, user_id=a).update(
            {"army_id": army.id}
        )
        db.commit()
        purge_user_data(db, a)
        db.query(User).filter_by(id=a).delete()
        db.commit()
        assert db.query(LeagueGame).filter_by(league_id=league_id).count() == 0
        assert [m.user_id for m in db.query(LeagueMember).filter_by(league_id=league_id)] == [b]
        link = db.query(PublicationLink).filter_by(publication=f"P {a}").one()
        assert link.created_by is None
    finally:
        db.close()


def test_merging_accounts_moves_leagues_and_games():
    organiser, a, b, c = _user("org", "gm"), _user("a"), _user("b"), _user("c")
    db = SessionLocal()
    try:
        played = _seed_league(db, organiser, (a, c))
        against = _seed_league(db, organiser, (a, b))
        run = _seed_league(db, a, (b, c))
        reassign_user_data(db, a, b)
        db.commit()
        # A game against the account it merges into would be against itself.
        assert db.query(LeagueGame).filter_by(league_id=against).count() == 0
        moved = db.query(LeagueGame).filter_by(league_id=played).one()
        assert moved.player_a_id == b
        assert db.query(League).filter_by(id=run).one().organizer_id == b
        # b was already in `against`: the membership a held there is dropped.
        assert [m.user_id for m in db.query(LeagueMember).filter_by(league_id=against)] == [b]
    finally:
        db.close()
