"""A faction is a folder name, so it is only named to someone who can see a
book filed under it: in a system's faction list, on an army, and when an army is
set to it or matched to it on import. A faction with no books hides nothing and
stays listed.
"""
import uuid

import pytest

from backend import auth
from backend.config import SessionLocal
from backend.models import Army, Book, Faction, FolderAccessRule
from backend.routers.armies import _helpers as army_helpers
from backend.services.armies import matching
from backend.services.factions import hidden_faction_ids, system_factions

from .conftest import make_book, make_game_system


@pytest.fixture
def armory():
    """A wargame with Open (a visible book), Secret (one admin-only book),
    Imperium > Hidden Chapter (one book under an admin-only folder) and Empty.
    """
    uid = uuid.uuid4().hex[:8]
    system = make_game_system(name=f"War {uid}", slug=f"war-{uid}", game_type="wargame")
    folder = f"armory/War {uid}/Factions/Imperium/Hidden Chapter"
    db = SessionLocal()
    try:
        made = {}
        for key, name, parent in (
            ("open", "Open", None),
            ("secret", "Secret Unreleased Chapter", None),
            ("imperium", "Imperium", None),
            ("chapter", "Hidden Chapter", "imperium"),
            ("empty", "Empty", None),
        ):
            faction = Faction(
                game_system_id=system.id,
                name=name,
                slug=f"{key}-{uid}",
                parent_id=made[parent].id if parent else None,
            )
            db.add(faction)
            db.flush()
            made[key] = faction
        ids = {key: f.id for key, f in made.items()}
        db.add(FolderAccessRule(path=folder, level="admin"))
        db.commit()
    finally:
        db.close()
    books = {
        "open": make_book(system.id, category="army-book", game_type="wargame"),
        "secret": make_book(
            system.id, category="army-book", game_type="wargame", access_level="admin"
        ),
        "chapter": make_book(
            system.id,
            category="army-book",
            game_type="wargame",
            relative_path=f"{folder}/codex.pdf",
        ),
    }
    db = SessionLocal()
    try:
        for key, book in books.items():
            row = db.get(Book, book.id)
            row.factions.append(db.get(Faction, ids[key]))
            db.flush()
        db.commit()
    finally:
        db.close()
    yield system, ids
    db = SessionLocal()
    try:
        db.query(FolderAccessRule).filter_by(path=folder).delete()
        db.commit()
    finally:
        db.close()


def _names(client, headers, system_id):
    resp = client.get(f"/api/systems/{system_id}/factions", headers=headers)
    assert resp.status_code == 200, resp.text
    return {f["name"]: f["book_count"] for f in resp.json()["factions"]}


def test_the_faction_list_leaves_out_factions_whose_books_are_hidden(
    client, player_headers, gm_headers, admin_headers, armory
):
    system, _ = armory
    seen_below_admin = {"Open": 1, "Empty": 0}
    assert _names(client, player_headers, system.id) == seen_below_admin
    assert _names(client, gm_headers, system.id) == seen_below_admin
    assert _names(client, admin_headers, system.id) == {
        "Open": 1,
        "Secret Unreleased Chapter": 1,
        "Imperium": 0,
        "Hidden Chapter": 1,
        "Empty": 0,
    }
    games = client.get(f"/api/armies/games/{system.id}/factions", headers=player_headers)
    assert {f["name"] for f in games.json()["factions"]} == set(seen_below_admin)


def test_a_parent_stays_listed_while_a_sub_factions_book_shows(
    client, player_headers, armory
):
    system, ids = armory
    db = SessionLocal()
    try:
        visible = make_book(system.id, category="army-book", game_type="wargame")
        row = db.get(Book, visible.id)
        row.factions.append(db.get(Faction, ids["chapter"]))
        db.commit()
    finally:
        db.close()
    names = _names(client, player_headers, system.id)
    assert names["Imperium"] == 0 and names["Hidden Chapter"] == 1


def test_an_army_cannot_be_set_to_a_hidden_faction(client, player_headers, armory):
    system, ids = armory
    for key in ("secret", "chapter", "imperium"):
        resp = client.post(
            "/api/armies",
            json={"name": "Sneaky", "game_system_id": system.id, "faction_id": ids[key], "units": []},
            headers=player_headers,
        )
        assert resp.status_code == 400, key
    resp = client.post(
        "/api/armies",
        json={"name": "Fine", "game_system_id": system.id, "faction_id": ids["open"], "units": []},
        headers=player_headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["faction"]["name"] == "Open"


def test_an_armys_faction_is_named_only_to_who_may_see_it(armory):
    system, ids = armory
    player = auth.CurrentUser(f"p-{uuid.uuid4()}", "p", "player")
    admin = auth.CurrentUser(f"a-{uuid.uuid4()}", "a", "admin")
    army = Army(
        id=str(uuid.uuid4()),
        user_id=admin.id,
        name="Hidden",
        game_system_id=system.id,
        faction_id=ids["secret"],
    )
    db = SessionLocal()
    try:
        assert army_helpers.summary(db, army, admin)["faction"]["name"] == (
            "Secret Unreleased Chapter"
        )
        assert army_helpers.summary(db, army, player)["faction"] is None
        # A faction whose books show, in a system hidden from the reader.
        army.faction_id = ids["open"]
        assert army_helpers.summary(db, army, player)["faction"]["name"] == "Open"
        system.access_level = "admin"
        db.merge(system)
        db.commit()
        assert army_helpers.summary(db, army, player)["faction"] is None
    finally:
        db.close()


def test_an_import_does_not_match_a_hidden_faction(armory):
    system, ids = armory
    player = auth.CurrentUser(f"p-{uuid.uuid4()}", "p", "player")
    db = SessionLocal()
    try:
        assert hidden_faction_ids(db, system.id, player) == {
            ids["secret"],
            ids["imperium"],
            ids["chapter"],
        }
        assert matching.match_faction(db, player, system.id, "Xenos - Secret Unreleased Chapter") is None
        found = matching.match_faction(db, player, system.id, "Imperium - Open")
        assert found is not None and found.id == ids["open"]
        assert system_factions(db, "no-such-system", player) == []
    finally:
        db.close()
