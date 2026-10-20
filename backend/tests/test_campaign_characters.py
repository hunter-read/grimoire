"""A campaign's characters, as its GM sees them on the campaign page.

The GM runs the campaign and keeps their own sheets in it - NPCs, or a solo
game's party. The player has joined and plays one character, with a fallen one
kept beside it. The admin is not at the table. Each character carries who plays
it, so the page can group them by player.
"""
import pytest

from backend.config import SessionLocal
from backend.models import Campaign, CampaignMember, Character, User


SCHEMA = {
    "id": "campaign-roster-demo",
    "name": "Roster Demo",
    "fields": {"hp": {"type": "number", "label": "HP", "default": 10}},
}


@pytest.fixture(autouse=True)
def _clean():
    yield
    db = SessionLocal()
    try:
        db.query(Character).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture
def sheets(client, admin_headers, gm_headers, player_headers):
    everyone = (admin_headers, gm_headers, player_headers)
    for headers in everyone:
        resp = client.post("/api/characters/schemas", json={"document": SCHEMA}, headers=headers)
        assert resp.status_code == 200, resp.text
    yield
    for headers in everyone:
        client.delete("/api/characters/schemas/campaign-roster-demo", headers=headers)


@pytest.fixture
def table(gm_id, player_id):
    db = SessionLocal()
    try:
        campaign = Campaign(name="Roster Table", owner_id=gm_id, is_gm_campaign=True)
        db.add(campaign)
        db.flush()
        db.add(CampaignMember(campaign_id=campaign.id, user_id=player_id, status="accepted"))
        db.commit()
        return campaign.id
    finally:
        db.close()


def _create(client, headers, name, campaign_id, status=None):
    resp = client.post(
        "/api/characters",
        json={"schema_ref": SCHEMA["id"], "name": name, "campaign_id": campaign_id},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    character = resp.json()
    if status:
        resp = client.put(
            f"/api/characters/{character['id']}", json={"status": status}, headers=headers
        )
        assert resp.status_code == 200, resp.text
        character = resp.json()
    return character


def _roster(client, headers, campaign_id):
    resp = client.get("/api/characters", params={"campaign_id": campaign_id}, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["characters"]


def test_gm_sees_every_character_in_their_campaign_with_its_player(
    client, gm_headers, player_headers, gm_id, player_id, sheets, table
):
    _create(client, gm_headers, "Innkeeper", table)
    _create(client, player_headers, "Hero", table)
    _create(client, player_headers, "Fallen Hero", table, status="dead")
    # Not in the campaign, so not on its page.
    _create(client, player_headers, "Side Project", None)

    roster = {c["name"]: c for c in _roster(client, gm_headers, table)}

    assert set(roster) == {"Innkeeper", "Hero", "Fallen Hero"}
    assert roster["Innkeeper"]["user_id"] == gm_id
    assert roster["Innkeeper"]["owner_name"] == "gmuser"
    assert roster["Innkeeper"]["owned"] is True
    assert roster["Hero"]["user_id"] == player_id
    assert roster["Hero"]["owner_name"] == "playeruser"
    assert roster["Hero"]["owned"] is False
    # Kept, and marked, rather than left out.
    assert roster["Fallen Hero"]["status"] == "dead"


def test_owner_name_prefers_the_display_name(client, gm_headers, gm_id, sheets, table):
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=gm_id).one()
        previous = user.display_name
        user.display_name = "The Narrator"
        db.commit()
    finally:
        db.close()
    try:
        created = _create(client, gm_headers, "Villain", table)
        # The single-character read carries it too, not just the list.
        assert created["owner_name"] == "The Narrator"
        assert _roster(client, gm_headers, table)[0]["owner_name"] == "The Narrator"
    finally:
        db = SessionLocal()
        try:
            db.query(User).filter_by(id=gm_id).one().display_name = previous
            db.commit()
        finally:
            db.close()


def test_someone_not_at_the_table_sees_none_of_them(client, gm_headers, admin_headers, sheets, table):
    _create(client, gm_headers, "Innkeeper", table)
    assert _roster(client, admin_headers, table) == []


def test_player_attaches_an_existing_character_to_the_campaign(
    client, gm_headers, player_headers, sheets, table
):
    # Made before joining, then brought to the table from the campaign page.
    loner = _create(client, player_headers, "Wanderer", None)
    resp = client.put(
        f"/api/characters/{loner['id']}", json={"campaign_id": table}, headers=player_headers
    )
    assert resp.status_code == 200, resp.text
    assert [c["name"] for c in _roster(client, gm_headers, table)] == ["Wanderer"]
