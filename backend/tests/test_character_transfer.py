"""A GM handing a character they prepared to a player at their table (#726).

The GM runs the campaign and the player has joined it. The admin is a member
of a different table, so they stand in for someone the GM may not give a
character to.
"""
import pytest

from backend.config import SessionLocal
from backend.models import (
    Campaign,
    CampaignMember,
    Character,
    CharacterSchema,
    Ruleset,
    RulesetEntry,
)


SCHEMA = {
    "id": "transfer-demo",
    "name": "Transfer Demo",
    "version": "1.2.0",
    "content_types": {
        "spell": {
            "identity_field": "name",
            "fields": {"name": {"type": "text"}, "level": {"type": "number"}},
        }
    },
    "fields": {
        "hp": {"type": "number", "label": "HP", "default": 10},
        "spells": {"type": "content_list", "content_type": "spell"},
    },
    "computed": {"spell_levels": {"formula": "sum_refs(spells, 'level')"}},
}


@pytest.fixture(autouse=True)
def _clean(client, player_headers):
    yield
    db = SessionLocal()
    try:
        db.query(Character).delete()
        db.query(RulesetEntry).delete()
        db.query(Ruleset).delete()
        db.commit()
    finally:
        db.close()
    # The transfer may have installed the sheet for the player.
    client.delete("/api/characters/schemas/transfer-demo", headers=player_headers)


@pytest.fixture
def gm_sheet(client, gm_headers):
    resp = client.post("/api/characters/schemas", json={"document": SCHEMA}, headers=gm_headers)
    assert resp.status_code == 200, resp.text
    yield
    client.delete("/api/characters/schemas/transfer-demo", headers=gm_headers)


def _campaign(owner_id, *members, status="accepted"):
    db = SessionLocal()
    try:
        campaign = Campaign(name="Transfer Table", owner_id=owner_id)
        db.add(campaign)
        db.flush()
        for user_id in members:
            db.add(CampaignMember(campaign_id=campaign.id, user_id=user_id, status=status))
        db.commit()
        return campaign.id
    finally:
        db.close()


@pytest.fixture
def table(gm_id, player_id):
    return _campaign(gm_id, player_id)


def _create(client, headers, campaign_id=None, **data):
    resp = client.post(
        "/api/characters",
        json={
            "schema_ref": "transfer-demo",
            "name": "Pregen",
            "campaign_id": campaign_id,
            "data": data,
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _transfer(client, headers, character_id, user_id):
    return client.post(
        f"/api/characters/{character_id}/transfer", json={"user_id": user_id}, headers=headers
    )


class TestCandidates:
    def test_the_gm_is_offered_the_players_at_their_table(
        self, client, gm_headers, gm_sheet, table, player_id
    ):
        created = _create(client, gm_headers, table)
        assert [p["user_id"] for p in created["transfer_candidates"]] == [player_id]

    def test_nobody_is_offered_outside_a_campaign(self, client, gm_headers, gm_sheet):
        assert _create(client, gm_headers)["transfer_candidates"] == []

    def test_an_unanswered_invitation_is_not_a_seat(
        self, client, gm_headers, gm_sheet, gm_id, player_id
    ):
        invited = _campaign(gm_id, player_id, status="invited")
        assert _create(client, gm_headers, invited)["transfer_candidates"] == []

    def test_a_player_cannot_hand_on_a_character_at_someone_elses_table(
        self, client, gm_headers, player_headers, gm_sheet, table
    ):
        client.post("/api/characters/schemas", json={"document": SCHEMA}, headers=player_headers)
        created = _create(client, player_headers, table)
        assert created["transfer_candidates"] == []


class TestTransfer:
    def test_moves_the_character_and_keeps_the_gm_editing(
        self, client, gm_headers, player_headers, gm_sheet, table, player_id
    ):
        created = _create(client, gm_headers, table, hp=7)
        resp = _transfer(client, gm_headers, created["id"], player_id)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # The GM now reads it as a party member's sheet they may still edit.
        assert body["owned"] is False
        assert body["editable"] is True
        assert body["gm_can_edit"] is True
        assert body["campaign_id"] == table
        assert body["transfer_candidates"] == []

        theirs = client.get(f"/api/characters/{created['id']}", headers=player_headers).json()
        assert theirs["owned"] is True
        assert theirs["user_id"] == player_id
        assert theirs["data"]["hp"] == 7

    def test_installs_the_sheet_for_a_player_who_lacks_it(
        self, client, gm_headers, player_headers, gm_sheet, table, player_id
    ):
        created = _create(client, gm_headers, table)
        _transfer(client, gm_headers, created["id"], player_id)
        theirs = client.get(f"/api/characters/{created['id']}", headers=player_headers).json()
        assert theirs["schema_missing"] is False
        assert theirs["schema_version"] == "1.2.0"

    def test_the_copied_sheet_carries_only_layouts_derived_from_its_source(
        self, client, gm_headers, player_headers, table, player_id
    ):
        supplied = {
            "layout_ast": [{"tag": "div", "attrs": {"class": "x"}, "children": []}],
            "styles_css": "body { display: none }",
            "mobile_layout_ast": [{"tag": "div", "attrs": {}, "children": []}],
            "mobile_styles_css": "body { display: none }",
        }
        resp = client.post(
            "/api/characters/schemas",
            json={"document": {**SCHEMA, **supplied}},
            headers=gm_headers,
        )
        assert resp.status_code == 200, resp.text
        try:
            created = _create(client, gm_headers, table)
            assert _transfer(client, gm_headers, created["id"], player_id).status_code == 200
            theirs = client.get(
                "/api/characters/schemas/transfer-demo", headers=player_headers
            ).json()["document"]
            for key in supplied:
                assert key not in theirs
        finally:
            client.delete("/api/characters/schemas/transfer-demo", headers=gm_headers)

    def test_keeps_the_players_own_copy_of_the_sheet(
        self, client, gm_headers, player_headers, gm_sheet, table, player_id
    ):
        older = {**SCHEMA, "version": "1.0.0"}
        client.post("/api/characters/schemas", json={"document": older}, headers=player_headers)
        created = _create(client, gm_headers, table)
        _transfer(client, gm_headers, created["id"], player_id)
        theirs = client.get(f"/api/characters/{created['id']}", headers=player_headers).json()
        assert theirs["schema_version"] == "1.0.0"

    def test_copies_entries_from_the_gms_personal_rulesets(
        self, client, gm_headers, player_headers, gm_sheet, table, gm_id, player_id
    ):
        db = SessionLocal()
        try:
            homebrew = Ruleset(
                owner_id=gm_id, schema_id="transfer-demo", name="GM homebrew", created_by_id=gm_id
            )
            db.add(homebrew)
            db.flush()
            db.add(
                RulesetEntry(
                    ruleset_id=homebrew.id,
                    schema_id="transfer-demo",
                    content_type="spell",
                    entry_id="secret-spell",
                    name="Secret Spell",
                    data={"name": "Secret Spell", "level": 3},
                )
            )
            db.commit()
        finally:
            db.close()

        created = _create(client, gm_headers, table, spells=[{"_ref": "secret-spell"}])
        assert created["computed"]["spell_levels"] == 3
        _transfer(client, gm_headers, created["id"], player_id)

        theirs = client.get(f"/api/characters/{created['id']}", headers=player_headers).json()
        # Still resolves for its new owner, from a personal ruleset of theirs.
        assert theirs["computed"]["spell_levels"] == 3
        db = SessionLocal()
        try:
            copy = db.query(Ruleset).filter_by(owner_id=player_id).one()
            assert copy.name == "Pregen"
            assert copy.description == "Copied with a character a GM gave you."
        finally:
            db.close()

    def test_skips_entries_the_player_can_already_read(
        self, client, gm_headers, player_headers, gm_sheet, table, player_id
    ):
        # A campaign ruleset reaches everyone at the table, so nothing is copied.
        ruleset = client.post(
            "/api/rulesets",
            json={"schema_id": "transfer-demo", "name": "Table rules", "campaign_id": table},
            headers=gm_headers,
        ).json()["id"]
        client.post(
            f"/api/rulesets/{ruleset}/entries",
            json={"content_type": "spell", "data": {"name": "Shared Spell", "level": 2}},
            headers=gm_headers,
        )
        created = _create(client, gm_headers, table, spells=[{"_ref": "shared-spell"}])
        _transfer(client, gm_headers, created["id"], player_id)

        theirs = client.get(f"/api/characters/{created['id']}", headers=player_headers).json()
        assert theirs["computed"]["spell_levels"] == 2
        db = SessionLocal()
        try:
            assert db.query(Ruleset).filter_by(owner_id=player_id).count() == 0
        finally:
            db.close()

    def test_a_player_not_at_the_table_is_refused(
        self, client, gm_headers, gm_sheet, table, admin_id
    ):
        created = _create(client, gm_headers, table)
        resp = _transfer(client, gm_headers, created["id"], admin_id)
        assert resp.status_code == 400

    def test_a_character_in_no_campaign_cannot_be_handed_on(
        self, client, gm_headers, gm_sheet, player_id
    ):
        created = _create(client, gm_headers)
        assert _transfer(client, gm_headers, created["id"], player_id).status_code == 400

    def test_only_the_owner_can_transfer(
        self, client, gm_headers, player_headers, gm_sheet, table, gm_id
    ):
        created = _create(client, gm_headers, table)
        # The player reads it, but it is not theirs to give away.
        resp = _transfer(client, player_headers, created["id"], gm_id)
        assert resp.status_code == 404

    def test_a_player_cannot_give_their_character_to_the_gm(
        self, client, gm_headers, player_headers, gm_sheet, table, gm_id
    ):
        client.post("/api/characters/schemas", json={"document": SCHEMA}, headers=player_headers)
        created = _create(client, player_headers, table)
        assert _transfer(client, player_headers, created["id"], gm_id).status_code == 400

    def test_works_without_the_sheet_installed(
        self, client, gm_headers, player_headers, gm_sheet, table, gm_id, player_id
    ):
        created = _create(client, gm_headers, table)
        db = SessionLocal()
        try:
            db.query(CharacterSchema).filter_by(user_id=gm_id, schema_id="transfer-demo").delete()
            db.commit()
        finally:
            db.close()
        resp = _transfer(client, gm_headers, created["id"], player_id)
        assert resp.status_code == 200, resp.text
        theirs = client.get(f"/api/characters/{created['id']}", headers=player_headers).json()
        assert theirs["owned"] is True
        assert theirs["schema_missing"] is True
