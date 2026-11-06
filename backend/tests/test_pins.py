"""The pins API: folders and game systems a user keeps one click away."""
import pytest

from backend.config import SessionLocal
from backend.models import Pin, User
from backend.routers.pins import core as pins_core
from backend.services.campaigns.user_data import purge_user_data


def _pin(client, headers, collection="maps", target="Tom Cartos/Caverns"):
    return client.post("/api/pins", json={"collection": collection, "target": target}, headers=headers)


def _list(client, headers, collection=None):
    url = "/api/pins" + (f"?collection={collection}" if collection else "")
    resp = client.get(url, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["pins"]


class TestPins:
    def test_pin_list_and_unpin(self, client, gm_headers):
        resp = _pin(client, gm_headers, target="/Czepeku/Night/")
        assert resp.status_code == 200, resp.text
        pin = resp.json()
        # Stored as the gallery spells a folder: no leading or trailing slash.
        assert pin["target"] == "Czepeku/Night"
        assert pin in _list(client, gm_headers, "maps")
        assert pin not in _list(client, gm_headers, "tokens")

        assert client.delete(f"/api/pins/{pin['id']}", headers=gm_headers).status_code == 204
        assert pin not in _list(client, gm_headers, "maps")

    def test_pinning_twice_returns_the_same_pin(self, client, gm_headers):
        first = _pin(client, gm_headers, collection="audio", target="Tavern").json()
        second = _pin(client, gm_headers, collection="audio", target="Tavern").json()
        assert first == second
        assert [p["target"] for p in _list(client, gm_headers, "audio")].count("Tavern") == 1

    def test_pins_are_per_user(self, client, gm_headers, player_headers):
        pin = _pin(client, gm_headers, collection="models", target="Loot Studios").json()
        assert pin not in _list(client, player_headers)
        # Someone else's pin cannot be removed, and reads as missing.
        resp = client.delete(f"/api/pins/{pin['id']}", headers=player_headers)
        assert resp.status_code == 404

    def test_oldest_first(self, client, player_headers):
        for target in ("sys-b", "sys-a", "sys-c"):
            _pin(client, player_headers, collection="systems", target=target)
        targets = [p["target"] for p in _list(client, player_headers, "systems")]
        assert targets[-3:] == ["sys-b", "sys-a", "sys-c"]

    @pytest.mark.parametrize(
        "body",
        [
            {"collection": "books", "target": "x"},
            {"collection": "maps", "target": "   "},
            {"collection": "maps", "target": "/"},
            {"collection": "maps", "target": "x" * 1001},
        ],
    )
    def test_invalid_pins_are_rejected(self, client, gm_headers, body):
        assert client.post("/api/pins", json=body, headers=gm_headers).status_code == 422

    def test_invalid_collection_filter(self, client, gm_headers):
        assert client.get("/api/pins?collection=books", headers=gm_headers).status_code == 400

    def test_unknown_pin(self, client, gm_headers):
        assert client.delete("/api/pins/nope", headers=gm_headers).status_code == 404

    def test_a_view_holds_a_bounded_number(self, client, gm_headers, monkeypatch):
        monkeypatch.setattr(pins_core, "MAX_PINS_PER_COLLECTION", 1)
        for pin in _list(client, gm_headers, "tokens"):
            client.delete(f"/api/pins/{pin['id']}", headers=gm_headers)
        assert _pin(client, gm_headers, collection="tokens", target="One").status_code == 200
        # Re-pinning an existing pin is still fine at the cap.
        assert _pin(client, gm_headers, collection="tokens", target="One").status_code == 200
        resp = _pin(client, gm_headers, collection="tokens", target="Two")
        assert resp.status_code == 400
        assert "unpin" in resp.json()["detail"]

    def test_requires_login(self, client):
        assert client.get("/api/pins").status_code == 401


class TestPinLifecycle:
    def test_deleting_a_user_removes_their_pins(self, client, admin_headers):
        resp = client.post(
            "/api/users",
            json={"username": "pinner", "password": "pinner-pass-123", "role": "player"},
            headers=admin_headers,
        )
        assert resp.status_code in (200, 201), resp.text
        db = SessionLocal()
        try:
            user = db.query(User).filter_by(username="pinner").one()
            db.add(Pin(user_id=user.id, collection="maps", target="Somewhere"))
            db.commit()
            purge_user_data(db, user.id)
            db.commit()
            assert db.query(Pin).filter_by(user_id=user.id).count() == 0
        finally:
            db.close()
