"""A user's character-builder rows across account deletion and guest merges.

Characters, installed sheets and personal rulesets all hang off ``users.id``.
SQLite runs with foreign_keys=ON, so deleting a user who has any of them fails
unless ``purge_user_data`` clears them first; and merging a guest into another
account has to carry them across or the player loses their characters.
"""
import uuid

from backend.config import SessionLocal
from backend.models import Character, CharacterSchema, Ruleset, RulesetEntry, User


def _player(client, admin_headers) -> str:
    resp = client.post(
        "/api/users",
        json={
            "username": f"char_{uuid.uuid4().hex[:8]}",
            "password": "testpass123",
            "role": "player",
        },
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _give_builder_rows(user_id: str, *, schema_id: str = "lifecycle-sheet") -> dict:
    """A sheet, a character on it, and a personal ruleset with one entry."""
    db = SessionLocal()
    try:
        db.add(
            CharacterSchema(
                user_id=user_id,
                schema_id=schema_id,
                name="Lifecycle",
                document={"id": schema_id, "name": "Lifecycle", "fields": {}},
            )
        )
        character = Character(user_id=user_id, schema_ref=schema_id, name="Vex", data={})
        ruleset = Ruleset(
            schema_id=schema_id, name="Mine", owner_id=user_id, created_by_id=user_id
        )
        db.add_all([character, ruleset])
        db.flush()
        db.add(
            RulesetEntry(
                ruleset_id=ruleset.id,
                schema_id=schema_id,
                content_type="feat",
                entry_id="lucky",
                name="Lucky",
                data={"name": "Lucky"},
            )
        )
        db.commit()
        return {"character": character.id, "ruleset": ruleset.id}
    finally:
        db.close()


class TestDeletingAUser:
    def test_takes_their_characters_sheets_and_personal_rulesets(
        self, client, admin_headers
    ):
        user_id = _player(client, admin_headers)
        rows = _give_builder_rows(user_id)

        resp = client.delete(f"/api/users/{user_id}", headers=admin_headers)
        assert resp.status_code == 204, resp.text

        db = SessionLocal()
        try:
            assert db.query(Character).filter_by(id=rows["character"]).first() is None
            assert db.query(CharacterSchema).filter_by(user_id=user_id).count() == 0
            assert db.query(Ruleset).filter_by(id=rows["ruleset"]).first() is None
            assert db.query(RulesetEntry).filter_by(ruleset_id=rows["ruleset"]).count() == 0
        finally:
            db.close()

    def test_a_shared_ruleset_they_made_outlives_them(self, client, admin_headers):
        user_id = _player(client, admin_headers)
        db = SessionLocal()
        try:
            server = Ruleset(schema_id="lifecycle-sheet", name="Core", created_by_id=user_id)
            db.add(server)
            db.commit()
            server_id = server.id
        finally:
            db.close()

        assert client.delete(f"/api/users/{user_id}", headers=admin_headers).status_code == 204

        db = SessionLocal()
        try:
            survivor = db.query(Ruleset).filter_by(id=server_id).first()
            assert survivor is not None
            # Attribution, not ownership: the author is cleared, the content stays.
            assert survivor.created_by_id is None
            db.delete(survivor)
            db.commit()
        finally:
            db.close()


class TestMergingAGuest:
    def _guest_pair(self, client, admin_headers, gm_headers):
        client.patch(
            "/api/settings", json={"guest_access_enabled": True}, headers=admin_headers
        )
        created = []
        for name in ("Lifecycle A", "Lifecycle B"):
            campaign_id = client.post(
                "/api/campaigns",
                json={"name": name, "is_gm_campaign": True},
                headers=gm_headers,
            ).json()["id"]
            created.append(
                client.post(
                    f"/api/campaigns/{campaign_id}/guests",
                    json={"nickname": "Rowan"},
                    headers=gm_headers,
                ).json()["user_id"]
            )
        return created

    def test_carries_their_characters_and_personal_rulesets_across(
        self, client, admin_headers, gm_headers
    ):
        keep, absorb = self._guest_pair(client, admin_headers, gm_headers)
        # Both accounts installed the same sheet; the target's copy wins.
        _give_builder_rows(keep)
        rows = _give_builder_rows(absorb)

        resp = client.post(
            f"/api/users/{keep}/merge",
            json={"source_ids": [absorb]},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text

        db = SessionLocal()
        try:
            assert db.query(User).filter_by(id=absorb).first() is None
            assert db.query(Character).filter_by(id=rows["character"]).one().user_id == keep
            assert db.query(Ruleset).filter_by(id=rows["ruleset"]).one().owner_id == keep
            assert db.query(CharacterSchema).filter_by(user_id=keep).count() == 1
            assert db.query(CharacterSchema).filter_by(user_id=absorb).count() == 0
        finally:
            db.close()
