"""The army builder: rosters, hand-built lists, exports and page links."""
import io
import os
import uuid
import zipfile
from unittest.mock import patch

import pytest
from sqlalchemy import text

from backend import auth, config
from backend.config import SessionLocal
from backend.models import Army, Faction, PublicationLink, User
from backend.services.armies import battlescribe, export, links, manual, matching, storage
from backend.services.campaigns.user_data import purge_user_data, reassign_user_data
from backend.tests.conftest import make_book, make_game_system

ROSTER = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<roster id="r1" name="Dynasty of Bones" battleScribeVersion="2.03"
        gameSystemId="gs40k" gameSystemName="{system}"
        xmlns="http://www.battlescribe.net/schema/rosterSchema">
  <costs><cost name="pts" typeId="points" value="195.0"/></costs>
  <costLimits><costLimit name="pts" typeId="points" value="2000.0"/></costLimits>
  <forces>
    <force id="f1" name="Army Roster" entryId="e" catalogueId="c1" catalogueName="Xenos - Necrons">
      <publications><publication id="p1" name="Codex: Necrons"/></publications>
      <selections>
        <selection id="s1" name="Overlord" entryId="o" number="1" type="model"
                   publicationId="p1" page="82">
          <costs><cost name="pts" typeId="points" value="85.0"/></costs>
          <categories>
            <category id="k1" name="Character" entryId="x" primary="true"/>
            <category id="k2" name="Infantry" entryId="y" primary="false"/>
          </categories>
          <profiles>
            <profile id="pr1" name="Overlord" typeName="Unit" publicationId="p1" page="82" hidden="false">
              <characteristics>
                <characteristic name="M" typeId="m">5"</characteristic>
                <characteristic name="T" typeId="t">5</characteristic>
              </characteristics>
            </profile>
            <profile id="pr2" name="Secret" typeName="Unit" hidden="true"><characteristics/></profile>
          </profiles>
          <rules>
            <rule id="ru1" name="Reanimation Protocols" publicationId="p1" page="70" hidden="false">
              <description>Models come back.</description>
            </rule>
          </rules>
          <selections>
            <selection id="s1a" name="Resurrection Orb" entryId="ro" number="1" type="upgrade">
              <costs><cost name="pts" typeId="points" value="0"/></costs>
            </selection>
          </selections>
        </selection>
        <selection id="s2" name="Necron Warriors" entryId="w" number="10" type="unit">
          <costs><cost name="pts" typeId="points" value="110"/></costs>
          <categories><category id="k3" name="Battleline" entryId="z" primary="true"/></categories>
        </selection>
      </selections>
    </force>
  </forces>
</roster>
"""


def _roster(system="Warhammer 40,000 10th Edition") -> bytes:
    return ROSTER.replace("{system}", system).encode()


def _rosz(xml: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Dynasty of Bones.ros", xml)
    return buf.getvalue()


@pytest.fixture
def roster_dir(tmp_path, monkeypatch):
    """Roster files land in a temporary directory, not the shared test DATA_PATH."""
    monkeypatch.setattr(config, "ARMY_ROSTER_DIR", str(tmp_path / "army_rosters"))
    return tmp_path / "army_rosters"


# ---------------------------------------------------------------------------
# Reading rosters
# ---------------------------------------------------------------------------


def test_parse_roster():
    data = battlescribe.parse_roster(battlescribe.roster_xml(_rosz(_roster())))
    assert data["game_system_name"] == "Warhammer 40,000 10th Edition"
    force = data["forces"][0]
    assert force["catalogue"] == "Xenos - Necrons"
    overlord, warriors = force["units"]
    assert overlord["primary_category"] == "Character"
    assert overlord["publication"] == "Codex: Necrons" and overlord["page"] == "82"
    assert [p["name"] for p in overlord["profiles"]] == ["Overlord"]  # hidden one dropped
    assert overlord["profiles"][0]["characteristics"][0] == {"name": "M", "value": '5"'}
    assert overlord["rules"][0]["description"] == "Models come back."
    assert overlord["children"][0]["name"] == "Resurrection Orb"
    assert warriors["number"] == 10 and warriors["primary_category"] == "Battleline"
    assert battlescribe.roster_points(data, "pts") == 195
    assert battlescribe.roster_limit(data, "pts") == 2000
    assert battlescribe.main_cost_name(data) == "pts"
    # Without the roster total, the units are summed.
    data["costs"] = []
    assert battlescribe.roster_points(data, "pts") == 195


@pytest.mark.parametrize(
    "xml",
    [
        b"not xml",
        b"<catalogue/>",
        b'<!DOCTYPE x [<!ENTITY a "b">]><roster/>',
        # A declaration far from the top is still refused.
        b"<!--" + b"x" * 5000 + b'--><!DOCTYPE roster [<!ENTITY a "b">]><roster/>',
        # The same in UTF-16, with a byte-order mark and without one.
        '<!DOCTYPE x [<!ENTITY a "b">]><roster/>'.encode("utf-16"),
        '<!DOCTYPE x [<!ENTITY a "b">]><roster/>'.encode("utf-16-le"),
        '<!DOCTYPE x [<!ENTITY a "b">]><roster/>'.encode("utf-16-be"),
        b'<!DOCTYPE roster SYSTEM "file:///etc/passwd"><roster/>',
    ],
)
def test_parse_refuses_what_is_not_a_roster(xml):
    with pytest.raises(battlescribe.RosterError):
        battlescribe.parse_roster(xml)


def test_roster_file_errors():
    with pytest.raises(battlescribe.RosterError):
        battlescribe.roster_xml(b"PK\x03\x04broken")
    empty = io.BytesIO()
    with zipfile.ZipFile(empty, "w") as z:
        z.writestr("readme.txt", "hi")
    with pytest.raises(battlescribe.RosterError):
        battlescribe.roster_xml(empty.getvalue())
    with patch.object(battlescribe, "MAX_ROSTER_BYTES", 10):
        with pytest.raises(battlescribe.RosterError):
            battlescribe.roster_xml(b"x" * 20)
        with pytest.raises(battlescribe.RosterError):
            battlescribe.roster_xml(_rosz(_roster()))
    with patch.object(battlescribe, "MAX_SELECTIONS", 1):
        with pytest.raises(battlescribe.RosterError):
            battlescribe.parse_roster(_roster())
    with patch.object(battlescribe, "MAX_DOCUMENT_BYTES", 10):
        with pytest.raises(battlescribe.RosterError):
            battlescribe.parse_roster(_roster())


def test_parse_reads_a_utf16_roster():
    xml = _roster().decode("utf-8").replace('encoding="UTF-8"', 'encoding="UTF-16"')
    assert battlescribe.parse_roster(xml.encode("utf-16"))["name"] == "Dynasty of Bones"


def test_limits_and_cost_names():
    assert battlescribe.roster_limit({"cost_limits": [{"name": "pts", "value": -1}]}, "pts") is None
    assert battlescribe.roster_limit({}, "pts") is None
    assert battlescribe.main_cost_name({"costs": [{"name": "PL", "value": 3}]}) == "PL"
    assert battlescribe.main_cost_name({}) == "pts"
    assert battlescribe._number("abc") == 0


def test_manual_lists():
    data = manual.build_manual(
        [{"name": "Knights", "number": 5, "points": 120, "categories": ["Battleline"], "notes": "x"}]
    )
    unit = data["forces"][0]["units"][0]
    assert unit["number"] == 5 and unit["costs"] == [{"name": "pts", "value": 120}]
    assert unit["id"] and unit["notes"] == "x"
    assert battlescribe.roster_points(data, "pts") == 120
    for bad in (
        "x",
        [{"name": ""}],
        ["x"],
        [{"name": "A", "points": "lots"}],
        [{"name": "A", "categories": "x"}],
        [{"name": 5}],
    ):
        with pytest.raises(manual.ManualListError):
            manual.build_manual(bad)
    with patch.object(manual, "MAX_UNITS", 1):
        with pytest.raises(manual.ManualListError):
            manual.build_manual([{"name": "A"}, {"name": "B"}])


def test_text_export():
    data = battlescribe.parse_roster(_roster())
    text = export.army_text("Bones", data, 195, 2000, "pts", "Warhammer 40,000 10th Edition")
    assert text.startswith("Bones (195/2000 pts)\nWarhammer 40,000 10th Edition\n")
    assert "Overlord [85 pts]" in text and "  - Resurrection Orb" in text
    assert "10x Necron Warriors [110 pts]" in text
    nested = {
        "forces": [
            {"name": "", "catalogue": "", "units": [], "forces": [{"name": "Allies", "units": []}]}
        ]
    }
    assert "== Allies ==" in export.army_text("X", nested, 0, None, "pts")


def test_storage_round_trip(roster_dir):
    storage.save("a1", b"one", ".ros")
    storage.save("a1", b"two", ".rosz")  # replaces
    assert storage.load("a1") == (b"two", ".rosz")
    storage.delete("a1")
    assert storage.load("a1") is None
    with pytest.raises(ValueError):
        storage.save("a1", b"x", ".exe")


def test_storage_deletes_only_after_a_commit(roster_dir):
    storage.save("kept", b"x", ".ros")
    storage.save("gone", b"x", ".ros")
    storage.delete_after_commit(SessionLocal(), [])  # nothing to do
    db = SessionLocal()
    try:
        storage.delete_after_commit(db, ["kept"])
        db.execute(text("SELECT 1"))  # a transaction to roll back, as a purge has
        db.rollback()
        db.commit()  # the rollback settled it: a later commit removes nothing
    finally:
        db.close()
    assert storage.load("kept") is not None
    db = SessionLocal()
    try:
        storage.delete_after_commit(db, ["gone"])
        db.commit()
    finally:
        db.close()
    assert storage.load("gone") is None


def test_the_roster_directory_is_a_data_directory():
    from backend.config import paths
    from backend.services.backup._archive import ASSET_DIRS

    assert paths.ARMY_ROSTER_DIR in paths._DATA_DIRS
    assert (paths.ARMY_ROSTER_DIR, "army_rosters") in ASSET_DIRS


# ---------------------------------------------------------------------------
# The API
# ---------------------------------------------------------------------------


@pytest.fixture
def necrons():
    """A wargame edition system with a Necrons faction, named like the roster."""
    name = f"Warhammer 40,000 10th Edition {uuid.uuid4().hex[:6]}"
    system = make_game_system(name=name, game_type="wargame")
    db = SessionLocal()
    try:
        faction = Faction(game_system_id=system.id, name="Necrons", slug="necrons")
        db.add(faction)
        db.add(Faction(game_system_id=system.id, name="Space Marines", slug="space-marines"))
        db.commit()
        faction_id = faction.id
    finally:
        db.close()
    return system, faction_id


def _import(client, headers, raw, filename="Dynasty of Bones.rosz", **form):
    return client.post(
        "/api/armies/import",
        files={"file": (filename, raw, "application/octet-stream")},
        data=form,
        headers=headers,
    )


def test_import_view_and_export(client, player_headers, roster_dir, necrons):
    system, faction_id = necrons
    raw = _rosz(_roster(system.name))
    r = _import(client, player_headers, raw)
    assert r.status_code == 201, r.text
    army = r.json()
    assert army["game_system_id"] == system.id and army["faction"]["id"] == faction_id
    assert army["game_system_name"] == system.name
    assert army["points"] == 195 and army["points_limit"] == 2000
    assert army["publications"] == ["Codex: Necrons"] and army["can_edit"]
    assert army["source"] == "battlescribe" and army["source_filename"] == "Dynasty of Bones.rosz"

    listed = client.get("/api/armies", headers=player_headers).json()
    assert army["id"] in {a["id"] for a in listed}

    exported = client.get(
        f"/api/armies/{army['id']}/export", params={"format": "roster"}, headers=player_headers
    )
    assert exported.status_code == 200 and exported.content == raw
    assert "Dynasty of Bones.rosz" in exported.headers["content-disposition"]
    text = client.get(f"/api/armies/{army['id']}/export", headers=player_headers)
    assert text.headers["content-type"].startswith("text/plain")
    assert "Overlord [85 pts]" in text.text

    r = client.patch(f"/api/armies/{army['id']}", json={"units": []}, headers=player_headers)
    assert r.status_code == 400  # an imported list is read-only

    r = client.delete(f"/api/armies/{army['id']}", headers=player_headers)
    assert r.status_code == 204
    assert storage.load(army["id"]) is None
    assert client.get(f"/api/armies/{army['id']}", headers=player_headers).status_code == 404


def test_import_rejects_junk_and_takes_a_name(client, player_headers, roster_dir):
    assert _import(client, player_headers, b"nope", "x.ros").status_code == 400
    r = _import(client, player_headers, _roster("Unknown Game"), "list.ros", name="Renamed")
    assert r.status_code == 201
    assert r.json()["name"] == "Renamed" and r.json()["game_system_id"] is None
    assert storage.load(r.json()["id"])[1] == ".ros"
    with patch("backend.routers.armies.core.MAX_UPLOAD_BYTES", 10):
        assert _import(client, player_headers, _roster(), "x.ros").status_code == 413


def test_a_failed_import_leaves_no_file(client, player_headers, roster_dir, monkeypatch):
    from backend.routers.armies import core

    real = core.storage.save
    saved = []

    def _save(army_id, raw, ext):
        saved.append(army_id)
        real(army_id, raw, ext)

    def _fail(*_a, **_k):
        raise RuntimeError("database went away")

    monkeypatch.setattr(core.storage, "save", _save)
    monkeypatch.setattr("sqlalchemy.orm.Session.commit", _fail)
    with pytest.raises(RuntimeError):
        _import(client, player_headers, _roster(), "x.ros")
    assert saved and storage.load(saved[0]) is None


def test_import_does_not_match_a_hidden_system(client, player_headers, roster_dir):
    name = f"Secret Wargame {uuid.uuid4().hex[:6]}"
    make_game_system(name=name, game_type="wargame", access_level="admin")
    r = _import(client, player_headers, _roster(name), "x.ros")
    assert r.status_code == 201
    assert r.json()["game_system_id"] is None and r.json()["system_name"] == name


def test_manual_army_and_progress(client, player_headers, gm_headers, necrons):
    system, faction_id = necrons
    r = client.post(
        "/api/armies",
        json={
            "name": "My Crusade",
            "game_system_id": system.id,
            "faction_id": faction_id,
            "points_limit": 1000,
            "units": [{"name": "Warriors", "number": 10, "points": 110}],
        },
        headers=player_headers,
    )
    assert r.status_code == 201, r.text
    army = r.json()
    unit_id = army["data"]["forces"][0]["units"][0]["id"]
    assert army["points"] == 110 and army["source"] == "manual"

    r = client.patch(
        f"/api/armies/{army['id']}",
        json={
            "units": [
                {"id": unit_id, "name": "Warriors", "points": 110},
                {"name": "Lord", "points": 70, "category": "HQ"},
            ],
            "name": " Renamed ",
            "notes": "n",
            "points_limit": 1500,
        },
        headers=player_headers,
    )
    body = r.json()
    assert body["points"] == 180 and body["name"] == "Renamed" and body["notes"] == "n"
    assert body["data"]["forces"][0]["units"][0]["id"] == unit_id
    assert body["data"]["forces"][0]["units"][1]["primary_category"] == "HQ"
    bad = client.patch(f"/api/armies/{army['id']}", json={"units": [{"name": ""}]}, headers=player_headers)
    assert bad.status_code == 400

    r = client.put(
        f"/api/armies/{army['id']}/units/{unit_id}/progress",
        json={"experience": 6, "honours": [" Hardened ", ""], "notes": "Held the line"},
        headers=player_headers,
    )
    assert r.json() == {"experience": 6, "honours": ["Hardened"], "notes": "Held the line"}
    detail = client.get(f"/api/armies/{army['id']}", headers=player_headers).json()
    assert detail["progress"][unit_id]["experience"] == 6

    # Someone else's army is invisible, and cannot be changed.
    assert client.get(f"/api/armies/{army['id']}", headers=gm_headers).status_code == 404
    assert client.patch(
        f"/api/armies/{army['id']}", json={"name": "Mine"}, headers=gm_headers
    ).status_code == 404
    # Moving systems drops a faction that belonged to the old one.
    other = make_game_system(game_type="wargame")
    r = client.patch(
        f"/api/armies/{army['id']}", json={"game_system_id": other.id}, headers=player_headers
    )
    assert r.json()["faction"] is None and r.json()["game_system_id"] == other.id
    assert client.get(
        f"/api/armies/{army['id']}/export", params={"format": "roster"}, headers=player_headers
    ).status_code == 404
    # Not a faction of the army's system; but a faction with no system brings its own.
    r = client.patch(
        f"/api/armies/{army['id']}", json={"faction_id": faction_id}, headers=player_headers
    )
    assert r.status_code == 400
    r = client.patch(
        f"/api/armies/{army['id']}",
        json={"game_system_id": None, "faction_id": faction_id},
        headers=player_headers,
    )
    assert r.json()["game_system_id"] == system.id
    client.delete(f"/api/armies/{army['id']}", headers=player_headers)


def test_system_and_faction_checks(client, player_headers, necrons):
    _system, faction_id = necrons
    rpg = make_game_system(game_type="ttrpg")
    r = client.post("/api/armies", json={"name": "X", "game_system_id": rpg.id}, headers=player_headers)
    assert r.status_code == 400
    hidden = make_game_system(game_type="wargame", access_level="admin")
    r = client.post(
        "/api/armies", json={"name": "X", "game_system_id": hidden.id}, headers=player_headers
    )
    assert r.status_code == 400
    other = make_game_system(game_type="wargame")
    r = client.post(
        "/api/armies",
        json={"name": "X", "game_system_id": other.id, "faction_id": faction_id},
        headers=player_headers,
    )
    assert r.status_code == 400
    r = client.post("/api/armies", json={"name": "X", "faction_id": "nope"}, headers=player_headers)
    assert r.status_code == 400
    r = client.post("/api/armies", json={"name": "X", "units": "nope"}, headers=player_headers)
    assert r.status_code == 422


def test_publication_links(client, player_headers, gm_headers, roster_dir, necrons):
    system, _faction = necrons
    book = make_book(system.id, title="Codex: Necrons", game_type="wargame")
    army = _import(client, player_headers, _roster(system.name), "a.ros").json()
    pubs = client.get(f"/api/armies/{army['id']}/publications", headers=player_headers).json()
    assert pubs[0]["publication"] == "Codex: Necrons" and pubs[0]["link"] is None
    assert pubs[0]["suggestions"][0]["book_id"] == book.id

    found = client.get(
        "/api/armies/publication-links/books", params={"q": "codex: nec"}, headers=gm_headers
    )
    assert found.status_code == 200 and book.id in {b["book_id"] for b in found.json()}
    assert client.get(
        "/api/armies/publication-links/books", params={"q": "codex"}, headers=player_headers
    ).status_code == 403

    body = {
        "system_name": system.name,
        "publication": "Codex: Necrons",
        "book_id": book.id,
        "page_offset": 2,
    }
    assert client.put("/api/armies/publication-links", json=body, headers=player_headers).status_code == 403
    r = client.put("/api/armies/publication-links", json=body, headers=gm_headers)
    assert r.status_code == 200 and r.json()["page_offset"] == 2
    body["page_offset"] = 4
    client.put("/api/armies/publication-links", json=body, headers=gm_headers)
    detail = client.get(f"/api/armies/{army['id']}", headers=player_headers).json()
    assert detail["publication_links"]["Codex: Necrons"] == {
        "book_id": book.id,
        "book_title": "Codex: Necrons",
        "page_offset": 4,
    }
    missing = dict(body, book_id="nope")
    assert client.put("/api/armies/publication-links", json=missing, headers=gm_headers).status_code == 404
    blank = dict(body, publication="  ")
    assert client.put("/api/armies/publication-links", json=blank, headers=gm_headers).status_code == 400
    r = client.delete(
        "/api/armies/publication-links",
        params={"publication": "Codex: Necrons", "system_name": system.name},
        headers=gm_headers,
    )
    assert r.status_code == 204
    db = SessionLocal()
    try:
        assert db.query(PublicationLink).filter_by(book_id=book.id).count() == 0
    finally:
        db.close()


def test_a_link_to_a_hidden_book_resolves_to_nothing(client, player_headers, admin_headers, roster_dir, necrons):
    system, _faction = necrons
    book = make_book(system.id, title="Index: Necrons", game_type="wargame", access_level="admin")
    army = _import(client, player_headers, _roster(system.name), "a.ros").json()
    body = {"system_name": system.name, "publication": "Codex: Necrons", "book_id": book.id}
    assert client.put("/api/armies/publication-links", json=body, headers=admin_headers).status_code == 200
    detail = client.get(f"/api/armies/{army['id']}", headers=player_headers).json()
    assert detail["publication_links"] == {}
    assert client.get(f"/api/armies/{army['id']}", headers=admin_headers).json()[
        "publication_links"
    ]["Codex: Necrons"]["book_id"] == book.id


def test_links_helpers():
    assert links.system_key("  Warhammer ") == "warhammer"
    data = {
        "forces": [
            {
                "units": [],
                "forces": [
                    {"units": [{"publication": "A", "children": [{"rules": [{"publication": "B"}]}]}]}
                ],
            }
        ]
    }
    assert links.publications_in(data) == ["A", "B"]
    db = SessionLocal()
    try:
        admin = auth.CurrentUser("x", "x", "admin")
        assert links.resolve(db, admin, "x", []) == {}
        assert links.suggest(db, admin, None, "") == []
        assert links.search_books(db, admin, "x") == []
        assert matching.match_system(db, admin, "") is None
        assert matching.match_faction(db, admin, None, "Necrons") is None
    finally:
        db.close()


def test_faction_matching_prefers_the_longest_name(necrons):
    system, _faction = necrons
    admin = auth.CurrentUser("x", "x", "admin")
    db = SessionLocal()
    try:
        db.add(Faction(game_system_id=system.id, name="Chaos Space Marines", slug="csm"))
        db.commit()
        best = matching.match_faction(db, admin, system.id, "Chaos - Chaos Space Marines")
        assert best is not None and best.name == "Chaos Space Marines"
        assert matching.match_faction(db, admin, system.id, "Orks") is None
    finally:
        db.close()


def test_admin_sees_any_army(client, player_headers, admin_headers):
    army = client.post("/api/armies", json={"name": "Mine"}, headers=player_headers).json()
    detail = client.get(f"/api/armies/{army['id']}", headers=admin_headers)
    assert detail.status_code == 200 and detail.json()["can_edit"]
    client.delete(f"/api/armies/{army['id']}", headers=player_headers)


def test_guests_have_no_armies_or_leagues(client):
    db = SessionLocal()
    try:
        guest = User(username=f"guest-{uuid.uuid4().hex[:8]}", role="guest", is_guest=True)
        db.add(guest)
        db.commit()
        token = auth.create_token(guest.id, guest.username, "guest")
    finally:
        db.close()
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/armies", headers=headers).status_code == 403
    assert client.get("/api/leagues", headers=headers).status_code == 403


# ---------------------------------------------------------------------------
# Accounts going away
# ---------------------------------------------------------------------------


def _user(name: str) -> str:
    db = SessionLocal()
    try:
        user = User(username=f"{name}-{uuid.uuid4().hex[:8]}", role="player")
        db.add(user)
        db.commit()
        return user.id
    finally:
        db.close()


def test_deleting_a_user_takes_their_armies_and_rosters(roster_dir):
    user_id = _user("general")
    db = SessionLocal()
    try:
        army = Army(user_id=user_id, name="Doomed", data={}, progress={})
        db.add(army)
        db.commit()
        army_id = army.id
        storage.save(army_id, b"roster", ".ros")
        purge_user_data(db, user_id)
        db.query(User).filter_by(id=user_id).delete()
        db.commit()
        assert db.query(Army).filter_by(user_id=user_id).count() == 0
        assert storage.load(army_id) is None
        assert not os.path.exists(os.path.join(str(roster_dir), f"{army_id}.ros"))
    finally:
        db.close()


def test_merging_a_user_moves_their_armies():
    source, target = _user("old"), _user("new")
    db = SessionLocal()
    try:
        db.add(Army(user_id=source, name="Moved", data={}, progress={}))
        db.commit()
        reassign_user_data(db, source, target)
        db.commit()
        assert [a.name for a in db.query(Army).filter_by(user_id=target)] == ["Moved"]
    finally:
        db.close()
