"""The GM screen routes (issue #764): a campaign's board, for its GM alone.

The GM runs two campaigns. The player is at the first table and plays a
character in it; the admin is not at either. The board is the GM's: the player
and the admin are refused everything, reading included.
"""
import hashlib
import json

import pytest

from backend.config import SessionLocal
from backend.models import Character, GmScreenPanel
from backend.services.gm_screen import presets
from backend.tests.conftest import make_campaign


SCHEMA = {
    "id": "gm-screen-party-demo",
    "name": "Party Demo",
    "fields": {
        "char_name": {"type": "text", "label": "Name"},
        "hp_marked": {"type": "number", "label": "HP marked", "default": 0},
        "hp_max": {"type": "number", "label": "HP", "default": 6},
        "gear": {"type": "list", "columns": [{"key": "item"}]},
    },
    "computed": {"evasion": {"formula": "10 + hp_max", "label": "Evasion"}},
}


@pytest.fixture(autouse=True)
def _clean():
    yield
    db = SessionLocal()
    try:
        db.query(GmScreenPanel).delete()
        db.query(Character).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture
def table(client, gm_id, gm_headers, player_id, player_headers):
    """A group campaign the GM runs, with the player accepted into it."""
    campaign = make_campaign(gm_id, name="Screen Table", is_gm_campaign=True)
    assert client.post(
        f"/api/campaigns/{campaign.id}/invite", json={"user_id": player_id}, headers=gm_headers
    ).status_code < 300
    assert client.patch(
        f"/api/campaigns/{campaign.id}/members/{player_id}",
        json={"status": "accepted"},
        headers=player_headers,
    ).status_code == 200
    return campaign.id


def _url(campaign_id: str, rest: str = "") -> str:
    return f"/api/campaigns/{campaign_id}/gm-screen{rest}"


def _add(client, headers, campaign_id, **body):
    resp = client.post(_url(campaign_id, "/panels"), json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _board(client, headers, campaign_id):
    resp = client.get(_url(campaign_id), headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["panels"]


class TestAccess:
    def test_a_new_campaign_has_an_empty_board(self, client, gm_headers, table):
        assert _board(client, gm_headers, table) == []

    @pytest.mark.parametrize("who", ["player_headers", "admin_headers"])
    def test_only_the_gm_reads_or_writes_it(self, client, gm_headers, table, who, request):
        _add(client, gm_headers, table, kind="counter", title="Fear")
        headers = request.getfixturevalue(who)
        assert client.get(_url(table), headers=headers).status_code == 403
        assert client.get(_url(table, "/party"), headers=headers).status_code == 403
        assert client.get(_url(table, "/export"), headers=headers).status_code == 403
        resp = client.post(_url(table, "/panels"), json={"kind": "scratch"}, headers=headers)
        assert resp.status_code == 403
        assert resp.json()["detail"] == "Only the campaign's GM can use its GM screen"

    def test_a_missing_campaign_is_404(self, client, gm_headers):
        assert client.get(_url("nope"), headers=gm_headers).status_code == 404


class TestPanels:
    def test_add_update_and_remove_a_panel(self, client, gm_headers, table):
        panel = _add(
            client,
            gm_headers,
            table,
            kind="counter",
            title="Fear",
            config={"min": 0, "max": 12, "resets": "session"},
        )
        assert (panel["x"], panel["y"], panel["w"], panel["h"]) == (0, 0, 3, 3)
        assert panel["state"] == {"value": 0}

        resp = client.patch(
            _url(table, f"/panels/{panel['id']}"), json={"state": {"value": 5}}, headers=gm_headers
        )
        assert resp.json()["state"] == {"value": 5}
        # Lowering the top brings the value down with it.
        resp = client.patch(
            _url(table, f"/panels/{panel['id']}"),
            json={"config": {"min": 0, "max": 3}, "title": "Malice", "x": 20, "w": 2},
            headers=gm_headers,
        )
        body = resp.json()
        assert (body["state"], body["title"], body["x"], body["w"]) == ({"value": 3}, "Malice", 10, 2)

        resp = client.delete(_url(table, f"/panels/{panel['id']}"), headers=gm_headers)
        assert resp.status_code == 200 and resp.json()["panels"] == []
        assert client.delete(_url(table, f"/panels/{panel['id']}"), headers=gm_headers).status_code == 404

    def test_an_unknown_kind_is_400(self, client, gm_headers, table):
        resp = client.post(_url(table, "/panels"), json={"kind": "macro"}, headers=gm_headers)
        assert resp.status_code == 400
        assert "Unknown panel kind" in resp.json()["detail"]

    def test_new_panels_fill_the_first_gap(self, client, gm_headers, table):
        _add(client, gm_headers, table, kind="counter", x=0, y=0, w=4, h=4)
        _add(client, gm_headers, table, kind="counter", x=8, y=0, w=4, h=4)
        third = _add(client, gm_headers, table, kind="counter", w=4, h=4)
        assert (third["x"], third["y"]) == (4, 0)

    def test_a_board_has_a_limit(self, client, gm_headers, table, monkeypatch):
        from backend.services.gm_screen import panels as p

        monkeypatch.setattr(p, "MAX_PANELS", 1)
        _add(client, gm_headers, table, kind="scratch")
        resp = client.post(_url(table, "/panels"), json={"kind": "scratch"}, headers=gm_headers)
        assert resp.status_code == 400

    def test_layout_moves_several_panels_at_once(self, client, gm_headers, table):
        one = _add(client, gm_headers, table, kind="counter")
        two = _add(client, gm_headers, table, kind="counter")
        resp = client.put(
            _url(table, "/layout"),
            json={
                "panels": [
                    {"id": one["id"], "x": 0, "y": 3, "w": 3, "h": 3},
                    {"id": two["id"], "x": 0, "y": 0, "w": 6, "h": 3},
                    # Removed on another device a moment ago: ignored.
                    {"id": "gone", "x": 0, "y": 0, "w": 1, "h": 1},
                ]
            },
            headers=gm_headers,
        )
        assert resp.status_code == 200, resp.text
        cells = {panel["id"]: (panel["x"], panel["y"], panel["w"]) for panel in resp.json()["panels"]}
        assert cells == {one["id"]: (0, 3, 3), two["id"]: (0, 0, 6)}

    def test_a_note_pins_a_page_of_this_campaign_only(self, client, gm_headers, gm_id, table):
        page = client.post(
            f"/api/campaigns/{table}/wiki", json={"title": "Session Zero"}, headers=gm_headers
        ).json()
        panel = _add(client, gm_headers, table, kind="note", config={"page_id": page["id"]})
        assert panel["config"] == {"page_id": page["id"], "page_slug": page["slug"]}

        other = make_campaign(gm_id, name="Elsewhere", is_gm_campaign=True)
        elsewhere = client.post(
            f"/api/campaigns/{other.id}/wiki", json={"title": "Secret"}, headers=gm_headers
        ).json()
        resp = client.post(
            _url(table, "/panels"),
            json={"kind": "note", "config": {"page_id": elsewhere["id"]}},
            headers=gm_headers,
        )
        assert resp.status_code == 404

        # A slug with no page here pins nothing yet, rather than failing.
        empty = _add(client, gm_headers, table, kind="note", config={"page_slug": "not-written"})
        assert empty["config"] == {"page_id": None, "page_slug": "not-written"}

    def test_an_archived_campaign_is_read_only(self, client, gm_headers, table):
        _add(client, gm_headers, table, kind="scratch")
        assert client.put(
            f"/api/campaigns/{table}/archive", json={"archived": True}, headers=gm_headers
        ).status_code == 200
        assert client.post(_url(table, "/panels"), json={"kind": "scratch"}, headers=gm_headers).status_code == 409
        assert len(_board(client, gm_headers, table)) == 1


class TestResets:
    def test_end_scene_session_and_rest(self, client, gm_headers, table):
        fear = _add(
            client, gm_headers, table, kind="counter", config={"max": 12, "resets": "session"},
            state={"value": 6},
        )
        pools = _add(
            client, gm_headers, table, kind="pools", config={"resets": "scene"},
            state={"items": [{"name": "Swarm", "tokens": 3}]},
        )
        clocks = _add(
            client, gm_headers, table, kind="clocks",
            state={"items": [{"name": "Long", "size": 6, "ticks": 2, "resets": "rest"}]},
        )

        def states(resp):
            return {panel["id"]: panel["state"] for panel in resp.json()["panels"]}

        after = states(client.post(_url(table, "/reset"), json={"scope": "scene"}, headers=gm_headers))
        assert after[fear["id"]] == {"value": 6}
        assert after[pools["id"]]["items"][0]["tokens"] == 0
        assert after[pools["id"]]["items"][0]["name"] == "Swarm"
        assert after[clocks["id"]]["items"][0]["ticks"] == 2

        after = states(client.post(_url(table, "/reset"), json={"scope": "rest"}, headers=gm_headers))
        assert after[clocks["id"]]["items"][0]["ticks"] == 0

        after = states(client.post(_url(table, "/reset"), json={"scope": "session"}, headers=gm_headers))
        assert after[fear["id"]] == {"value": 0}

    def test_an_unknown_reset_is_422(self, client, gm_headers, table):
        assert client.post(_url(table, "/reset"), json={"scope": "week"}, headers=gm_headers).status_code == 422


class TestCopyExportImport:
    def test_copy_brings_the_setup_and_not_the_numbers(self, client, gm_headers, gm_id, table):
        source = make_campaign(gm_id, name="Old Table", is_gm_campaign=True)
        page = client.post(
            f"/api/campaigns/{source.id}/wiki", json={"title": "Fear Rules"}, headers=gm_headers
        ).json()
        _add(client, gm_headers, source.id, kind="counter", title="Fear", config={"max": 12}, state={"value": 9})
        _add(client, gm_headers, source.id, kind="note", config={"page_id": page["id"]})
        # The new table has a page of the same name, so the note finds it.
        here = client.post(
            f"/api/campaigns/{table}/wiki", json={"title": "Fear Rules"}, headers=gm_headers
        ).json()
        _add(client, gm_headers, table, kind="scratch")

        sources = client.get(_url(table, "/sources"), headers=gm_headers).json()["campaigns"]
        assert {"id": source.id, "name": "Old Table", "panel_count": 2} in sources
        assert all(item["id"] != table for item in sources)

        resp = client.post(
            _url(table, "/copy"), json={"source_campaign_id": source.id}, headers=gm_headers
        )
        assert resp.status_code == 200, resp.text
        board = {panel["kind"]: panel for panel in resp.json()["panels"]}
        assert set(board) == {"counter", "note"}
        assert board["counter"]["title"] == "Fear"
        assert board["counter"]["state"] == {"value": 0}
        assert board["note"]["config"]["page_id"] == here["id"]
        # The source is untouched.
        assert len(_board(client, gm_headers, source.id)) == 2

    def test_copy_can_add_below_the_board(self, client, gm_headers, gm_id, table):
        source = make_campaign(gm_id, name="Another", is_gm_campaign=True)
        _add(client, gm_headers, source.id, kind="counter", x=0, y=0)
        _add(client, gm_headers, table, kind="scratch", x=0, y=0, h=5)
        resp = client.post(
            _url(table, "/copy"),
            json={"source_campaign_id": source.id, "replace": False},
            headers=gm_headers,
        )
        cells = sorted((panel["kind"], panel["y"]) for panel in resp.json()["panels"])
        assert cells == [("counter", 5), ("scratch", 0)]

    def test_only_a_board_the_gm_runs_can_be_copied(self, client, gm_headers, admin_id, table):
        theirs = make_campaign(admin_id, name="Not Yours")
        for source_id in (theirs.id, table, "missing"):
            resp = client.post(
                _url(table, "/copy"), json={"source_campaign_id": source_id}, headers=gm_headers
            )
            assert resp.status_code == 404

    def test_an_empty_board_cannot_be_copied(self, client, gm_headers, gm_id, table):
        source = make_campaign(gm_id, name="Empty", is_gm_campaign=True)
        resp = client.post(
            _url(table, "/copy"), json={"source_campaign_id": source.id}, headers=gm_headers
        )
        assert resp.status_code == 400

    def test_export_then_import(self, client, gm_headers, gm_id, table):
        _add(client, gm_headers, table, kind="initiative", title="Turns", config={"mode": "sides"})
        exported = client.get(_url(table, "/export"), headers=gm_headers).json()
        assert exported["format"] == "grimoire://gm-screen/v1"
        assert exported["name"] == "Screen Table"

        other = make_campaign(gm_id, name="Imported", is_gm_campaign=True)
        resp = client.post(_url(other.id, "/import"), json={"document": exported}, headers=gm_headers)
        assert resp.status_code == 200, resp.text
        panel = resp.json()["panels"][0]
        assert (panel["kind"], panel["title"], panel["config"]["mode"]) == ("initiative", "Turns", "sides")

        resp = client.post(
            _url(other.id, "/import"), json={"document": {"panels": [{"kind": "macro"}]}}, headers=gm_headers
        )
        assert resp.status_code == 400


class TestParty:
    @pytest.fixture
    def sheets(self, client, gm_headers, player_headers):
        for headers in (gm_headers, player_headers):
            assert client.post(
                "/api/characters/schemas", json={"document": SCHEMA}, headers=headers
            ).status_code == 200
        yield
        for headers in (gm_headers, player_headers):
            client.delete(f"/api/characters/schemas/{SCHEMA['id']}", headers=headers)

    def _character(self, client, headers, campaign_id, name, **data):
        resp = client.post(
            "/api/characters",
            json={"schema_ref": SCHEMA["id"], "name": name, "campaign_id": campaign_id, "data": data},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    def test_lists_the_party_with_values_and_who_the_gm_may_edit(
        self, client, gm_headers, player_headers, table, sheets
    ):
        hero = self._character(client, player_headers, table, "Hero", hp_marked=2, gear=[{"item": "rope"}])
        npc = self._character(client, gm_headers, table, "Innkeeper")
        self._character(client, player_headers, None, "Not here")

        resp = client.get(_url(table, "/party"), headers=gm_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        party = {c["name"]: c for c in body["characters"]}
        assert set(party) == {"Hero", "Innkeeper"}
        assert party["Hero"]["values"]["hp_marked"] == 2
        assert party["Hero"]["values"]["evasion"] == 16
        # A list is not a stat, so it does not travel.
        assert "gear" not in party["Hero"]["values"]
        assert party["Hero"]["editable"] is False
        assert party["Innkeeper"]["editable"] is True
        fields = {f["name"]: f for f in body["fields"]}
        assert fields["hp_max"] == {"name": "hp_max", "label": "HP", "type": "number", "source": "field"}
        assert fields["evasion"]["source"] == "computed"
        assert "gear" not in fields

        assert client.put(
            f"/api/characters/{hero['id']}", json={"gm_can_edit": True}, headers=player_headers
        ).status_code == 200
        party = {c["name"]: c for c in client.get(_url(table, "/party"), headers=gm_headers).json()["characters"]}
        assert party["Hero"]["editable"] is True
        assert npc["id"] == party["Innkeeper"]["id"]

    def test_a_sheet_the_gm_has_not_installed_still_shows(
        self, client, gm_headers, player_headers, table
    ):
        assert client.post(
            "/api/characters/schemas", json={"document": SCHEMA}, headers=player_headers
        ).status_code == 200
        try:
            self._character(client, player_headers, table, "Hero", hp_max=4)
            character = client.get(_url(table, "/party"), headers=gm_headers).json()["characters"][0]
            assert character["values"]["evasion"] == 14
            assert character["schema_name"] == "Party Demo"
        finally:
            client.delete(f"/api/characters/schemas/{SCHEMA['id']}", headers=player_headers)


PRESET = {
    "id": "demo-screen",
    "name": "Demo Screen",
    "panels": [
        {"kind": "counter", "title": "Fear", "config": {"max": 12, "resets": "session"}},
        {
            "kind": "pools",
            "title": "Pools",
            "config": {"resets": "scene"},
            "state": {"items": [{"name": "Swarm"}]},
        },
    ],
}
PRESET_BODY = json.dumps(PRESET).encode()


class TestPresets:
    @pytest.fixture
    def catalogue(self, monkeypatch):
        index = {
            "screens": [
                {
                    "id": "demo-screen",
                    "name": "Demo Screen",
                    "version": "1.0.0",
                    "system": "Demo",
                    "author": "someone",
                    "panel_count": 2,
                    "path": "gm-screens/demo-screen/demo-screen.json",
                    "sha256": hashlib.sha256(PRESET_BODY).hexdigest(),
                },
                {"name": "No id"},
            ]
        }
        fetched: list[str] = []

        def fetch(url, **kwargs):
            fetched.append(url)
            if url.endswith("gm-screens/index.json"):
                return index
            return {"addons": []}

        monkeypatch.setattr(presets, "fetch_document", fetch)
        monkeypatch.setattr(presets, "downloads_enabled", lambda: True)
        monkeypatch.setattr(presets.source_credentials, "load", lambda db: None)
        return fetched

    def test_browse_lists_the_presets(self, client, gm_headers, table, catalogue):
        resp = client.get(_url(table, "/presets"), headers=gm_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [p["id"] for p in body["presets"]] == ["demo-screen"]
        assert body["presets"][0]["panel_count"] == 2
        assert body["presets"][0]["index_url"].endswith("gm-screens/index.json")
        assert body["errors"] == []

    def test_apply_downloads_checks_and_places_it(self, client, gm_headers, table, catalogue, monkeypatch):
        downloaded: list[str] = []

        def download(url, **kwargs):
            downloaded.append(url)
            return PRESET_BODY

        monkeypatch.setattr(presets, "download_file", download)
        resp = client.post(_url(table, "/presets/apply"), json={"preset_id": "demo-screen"}, headers=gm_headers)
        assert resp.status_code == 200, resp.text
        kinds = [panel["kind"] for panel in resp.json()["panels"]]
        assert kinds == ["counter", "pools"]
        assert downloaded[0].endswith("gm-screens/demo-screen/demo-screen.json")
        assert "gm-screens/gm-screens" not in downloaded[0]

    def test_a_tampered_preset_is_refused(self, client, gm_headers, table, catalogue, monkeypatch):
        monkeypatch.setattr(presets, "download_file", lambda url, **kwargs: b'{"panels": []}')
        resp = client.post(_url(table, "/presets/apply"), json={"preset_id": "demo-screen"}, headers=gm_headers)
        assert resp.status_code == 502
        assert "integrity" in resp.json()["detail"]
        assert _board(client, gm_headers, table) == []

    def test_an_unknown_preset_is_404(self, client, gm_headers, table, catalogue):
        resp = client.post(_url(table, "/presets/apply"), json={"preset_id": "nope"}, headers=gm_headers)
        assert resp.status_code == 404

    def test_downloads_can_be_switched_off(self, client, gm_headers, table, monkeypatch):
        monkeypatch.setattr(presets, "downloads_enabled", lambda: False)
        assert client.get(_url(table, "/presets"), headers=gm_headers).status_code == 403
        resp = client.post(_url(table, "/presets/apply"), json={"preset_id": "x"}, headers=gm_headers)
        assert resp.status_code == 403

    def test_an_unreachable_source_is_reported(self, client, gm_headers, table, monkeypatch):
        from backend.addons.fetch import AddonFetchError

        def fail(url, **kwargs):
            raise AddonFetchError("offline")

        monkeypatch.setattr(presets, "fetch_document", fail)
        monkeypatch.setattr(presets, "downloads_enabled", lambda: True)
        monkeypatch.setattr(presets.source_credentials, "load", lambda db: None)
        body = client.get(_url(table, "/presets"), headers=gm_headers).json()
        assert body["presets"] == []
        # The sources are the admin's settings: a GM hears that one failed, not where.
        assert body["errors"] == [{"url": "", "error": ""}]
        with SessionLocal() as db:
            shown = presets.fetch_catalogue(db)["errors"][0]
        assert shown["url"] and shown["error"] == "offline"

    def test_a_source_without_presets_is_not_an_error(self, client, gm_headers, table, monkeypatch):
        """An add-on index from before GM screens has no gm-screens/ directory: a 404."""
        from backend.addons.fetch import AddonFetchError, DownloadError

        def missing(url, **kwargs):
            try:
                raise DownloadError("status", status=404)
            except DownloadError as exc:
                raise AddonFetchError("source returned HTTP 404") from exc

        monkeypatch.setattr(presets, "fetch_document", missing)
        monkeypatch.setattr(presets, "downloads_enabled", lambda: True)
        monkeypatch.setattr(presets.source_credentials, "load", lambda db: None)
        body = client.get(_url(table, "/presets"), headers=gm_headers).json()
        assert body == {"presets": [], "errors": []}
