"""The API's view of the armory: game types and factions on systems and books."""
import uuid

from backend.config import SessionLocal
from backend.models import Book, Faction
from backend.services.factions import factions_for_books, system_factions
from backend.tests.conftest import make_book, make_game_system


def _wargame_with_factions():
    """A wargame system with Space Marines > Blood Angels, and Necrons, and books."""
    uid = uuid.uuid4().hex[:8]
    system = make_game_system(name=f"War {uid}", slug=f"war-{uid}", game_type="wargame")
    db = SessionLocal()
    try:
        marines = Faction(game_system_id=system.id, name="Space Marines", slug="space-marines")
        db.add(marines)
        db.flush()
        blood = Faction(
            game_system_id=system.id,
            name="Blood Angels",
            slug="space-marines--blood-angels",
            parent_id=marines.id,
        )
        necrons = Faction(game_system_id=system.id, name="Necrons", slug="necrons")
        db.add_all([blood, necrons])
        db.flush()
        ids = {"marines": marines.id, "blood": blood.id, "necrons": necrons.id}
        db.commit()
    finally:
        db.close()
    codex = make_book(system.id, category="army-book", game_type="wargame", title="Codex")
    rules = make_book(system.id, category="core", game_type="wargame", title="Rules")
    db = SessionLocal()
    try:
        book = db.get(Book, codex.id)
        book.factions.extend([db.get(Faction, ids["blood"]), db.get(Faction, ids["necrons"])])
        db.commit()
    finally:
        db.close()
    return system, codex, rules, ids


def test_systems_list_filters_by_game_type(client, admin_headers):
    uid = uuid.uuid4().hex[:8]
    rpg = make_game_system(name=f"Shared {uid}", slug=f"shared-{uid}")
    war = make_game_system(name=f"Shared {uid}", slug=f"shared-{uid}", game_type="wargame")

    def ids(query: str) -> set:
        resp = client.get(f"/api/systems{query}", headers=admin_headers)
        assert resp.status_code == 200
        return {s["id"] for s in resp.json() if s["name"] == f"Shared {uid}"}

    assert ids("") == {rpg.id, war.id}
    assert ids("?game_type=ttrpg") == {rpg.id}
    assert ids("?game_type=wargame") == {war.id}
    assert client.get("/api/systems?game_type=boardgame", headers=admin_headers).status_code == 422

    listed = client.get("/api/systems?game_type=wargame", headers=admin_headers).json()
    assert next(s for s in listed if s["id"] == war.id)["game_type"] == "wargame"


def test_system_factions_endpoint(client, admin_headers):
    system, _, _, ids = _wargame_with_factions()
    resp = client.get(f"/api/systems/{system.id}/factions", headers=admin_headers)
    assert resp.status_code == 200
    rows = resp.json()["factions"]
    assert [(f["name"], f["depth"], f["book_count"]) for f in rows] == [
        ("Necrons", 0, 1),
        ("Space Marines", 0, 0),
        ("Blood Angels", 1, 1),
    ]
    assert rows[2]["parent_id"] == ids["marines"]

    rpg = make_game_system()
    resp = client.get(f"/api/systems/{rpg.id}/factions", headers=admin_headers)
    assert resp.json() == {"factions": []}
    assert client.get("/api/systems/nope/factions", headers=admin_headers).status_code == 404


def test_books_carry_their_game_type_and_factions(client, admin_headers):
    system, codex, rules, _ = _wargame_with_factions()

    page = client.get(f"/api/systems/{system.id}/books", headers=admin_headers).json()
    by_id = {b["id"]: b for b in page["books"]}
    assert by_id[codex.id]["game_type"] == "wargame"
    assert [f["name"] for f in by_id[codex.id]["factions"]] == ["Blood Angels", "Necrons"]
    assert by_id[rules.id]["factions"] == []

    detail = client.get(f"/api/systems/{system.id}", headers=admin_headers).json()
    assert detail["game_type"] == "wargame"
    shelf = {b["id"]: b for b in detail["books"]}
    assert len(shelf[codex.id]["factions"]) == 2

    book = client.get(f"/api/books/{codex.id}", headers=admin_headers).json()
    assert book["game_type"] == "wargame"
    assert book["game_system"]["game_type"] == "wargame"
    assert {f["name"] for f in book["factions"]} == {"Blood Angels", "Necrons"}


def test_role_playing_books_default_to_ttrpg(client, admin_headers):
    system = make_game_system()
    book = make_book(system.id)
    detail = client.get(f"/api/books/{book.id}", headers=admin_headers).json()
    assert (detail["game_type"], detail["factions"]) == ("ttrpg", [])
    assert client.get(f"/api/systems/{system.id}", headers=admin_headers).json()[
        "game_type"
    ] == "ttrpg"


def test_faction_helpers_handle_empty_input():
    db = SessionLocal()
    try:
        assert factions_for_books(db, []) == {}
        assert system_factions(db, "no-such-system", None) == []
    finally:
        db.close()


def test_stats_count_the_armory(client, admin_headers):
    before = client.get("/api/stats", headers=admin_headers).json()
    system = make_game_system(game_type="wargame")
    make_book(system.id, game_type="wargame")
    after = client.get("/api/stats", headers=admin_headers).json()
    assert after["armory_books"] == before["armory_books"] + 1
    assert after["books"] == before["books"] + 1
