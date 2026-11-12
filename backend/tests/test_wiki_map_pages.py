"""Map pages in the campaign wiki: a map with pins linking to pages (issue #578).

What these defend is mostly *who sees what*. A pin is visible only to someone
who can see both its map page and the page it links to, and a GM pin to the GM
alone - a public map must never hand a player the title, label or position of a
page they can't read. The rest is the link graph (pins are links, by page id)
and export/import, which must carry a map page through intact.
"""
import io
import json
import uuid
import zipfile

import pytest

from backend.tests.conftest import make_map


def uid():
    return uuid.uuid4().hex[:8]


@pytest.fixture()
def campaign_id(client, gm_headers, player_headers, player_id):
    """A group campaign with the shared player accepted into it."""
    c = client.post(
        "/api/campaigns", json={"name": f"Maps {uid()}", "is_gm_campaign": True}, headers=gm_headers
    ).json()
    client.post(f"/api/campaigns/{c['id']}/invite", json={"user_id": player_id}, headers=gm_headers)
    client.patch(
        f"/api/campaigns/{c['id']}/members/{player_id}",
        json={"status": "accepted"},
        headers=player_headers,
    )
    return c["id"]


def _link_map(client, gm_headers, cid, visibility="public", **kwargs):
    m = make_map(**kwargs)
    resp = client.post(
        f"/api/campaigns/{cid}/resources",
        json={"resource_type": "map", "resource_id": m.id, "visibility": visibility},
        headers=gm_headers,
    )
    assert resp.status_code in (200, 201), resp.text
    return m


def _page(client, headers, cid, **kwargs):
    resp = client.post(f"/api/campaigns/{cid}/wiki", json=kwargs, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _map_page(client, headers, cid, map_id, **kwargs):
    kwargs.setdefault("title", f"Sword Coast {uid()}")
    kwargs.setdefault("visibility", "group")
    return _page(client, headers, cid, page_type="map", map_id=map_id, **kwargs)


def _get(client, headers, cid, page_id):
    resp = client.get(f"/api/campaigns/{cid}/wiki/{page_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _pin(client, headers, cid, page_id, **kwargs):
    kwargs.setdefault("x", 0.25)
    kwargs.setdefault("y", 0.75)
    return client.post(f"/api/campaigns/{cid}/wiki/{page_id}/pins", json=kwargs, headers=headers)


class TestMapPage:
    def test_create_shows_the_library_map(self, client, gm_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        assert page["page_type"] == "map"
        got = _get(client, gm_headers, campaign_id, page["id"])
        assert got["map"] == {
            "source": "library",
            "id": m.id,
            "name": m.filename,
            "has_thumbnail": False,
        }
        assert got["pins"] == []

    def test_a_note_has_no_map(self, client, gm_headers, campaign_id):
        page = _page(client, gm_headers, campaign_id, title="Plain")
        got = _get(client, gm_headers, campaign_id, page["id"])
        assert got["map"] is None and got["pins"] == []

    def test_map_must_be_linked_to_the_campaign(self, client, gm_headers, campaign_id):
        m = make_map()
        resp = client.post(
            f"/api/campaigns/{campaign_id}/wiki",
            json={"title": "Unlinked", "page_type": "map", "map_id": m.id},
            headers=gm_headers,
        )
        assert resp.status_code == 400
        assert "Link the map" in resp.json()["detail"]

    def test_only_image_maps(self, client, gm_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id, filename=f"atlas-{uid()}.pdf")
        resp = client.post(
            f"/api/campaigns/{campaign_id}/wiki",
            json={"title": "Atlas", "page_type": "map", "map_id": m.id},
            headers=gm_headers,
        )
        assert resp.status_code == 400

    def test_player_cannot_use_a_map_hidden_from_them(
        self, client, gm_headers, player_headers, campaign_id
    ):
        hidden = _link_map(client, gm_headers, campaign_id, visibility="gm")
        resp = client.post(
            f"/api/campaigns/{campaign_id}/wiki",
            json={"title": "Peek", "page_type": "map", "map_id": hidden.id},
            headers=player_headers,
        )
        assert resp.status_code == 400
        shown = _link_map(client, gm_headers, campaign_id, visibility="public")
        assert _map_page(client, player_headers, campaign_id, shown.id)["page_type"] == "map"

    def test_a_missing_map_is_a_placeholder(self, client, gm_headers, campaign_id):
        from backend.config import SessionLocal
        from backend.models import GenericMap

        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        db = SessionLocal()
        db.query(GenericMap).filter_by(id=m.id).update({"is_missing": True})
        db.commit()
        db.close()
        assert _get(client, gm_headers, campaign_id, page["id"])["map"]["source"] == "missing"

    def test_replace_map_keeps_the_pins(self, client, gm_headers, campaign_id):
        old = _link_map(client, gm_headers, campaign_id)
        new = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, old.id)
        assert _pin(client, gm_headers, campaign_id, page["id"], label="Here").status_code == 201
        resp = client.patch(
            f"/api/campaigns/{campaign_id}/wiki/{page['id']}",
            json={"map_id": new.id},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        got = _get(client, gm_headers, campaign_id, page["id"])
        assert got["map"]["id"] == new.id
        assert [p["label"] for p in got["pins"]] == ["Here"]

    def test_campaign_image_as_the_map(self, client, gm_headers, campaign_id):
        from backend.tests.test_wiki_map_copies import png_bytes

        up = client.post(
            f"/api/campaigns/{campaign_id}/images",
            files={"file": ("region.png", png_bytes(), "image/png")},
            headers=gm_headers,
        )
        assert up.status_code in (200, 201), up.text
        page = _page(
            client,
            gm_headers,
            campaign_id,
            title="Region",
            page_type="map",
            map_file_id=up.json()["resource_id"],
        )
        got = _get(client, gm_headers, campaign_id, page["id"])
        assert got["map"]["source"] == "file"
        assert got["map"]["id"] == up.json()["resource_id"]

    def test_another_campaigns_image_is_refused(self, client, gm_headers, campaign_id):
        from backend.tests.test_wiki_map_copies import png_bytes

        other = client.post(
            "/api/campaigns", json={"name": f"Other {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        up = client.post(
            f"/api/campaigns/{other['id']}/images",
            files={"file": ("x.png", png_bytes(), "image/png")},
            headers=gm_headers,
        ).json()
        resp = client.post(
            f"/api/campaigns/{campaign_id}/wiki",
            json={"title": "Stolen", "page_type": "map", "map_file_id": up["resource_id"]},
            headers=gm_headers,
        )
        assert resp.status_code == 400

    def test_players_read_the_picture_of_a_map_page_they_can_see(
        self, client, gm_headers, player_headers, campaign_id
    ):
        from backend.tests.test_wiki_map_copies import png_bytes

        # Uploads start GM-only; putting one on a public map page shares it.
        up = client.post(
            f"/api/campaigns/{campaign_id}/images",
            files={"file": ("secret.png", png_bytes(), "image/png")},
            headers=gm_headers,
        ).json()
        url = f"/api/campaigns/{campaign_id}/files/{up['resource_id']}"
        assert client.get(url, headers=player_headers).status_code == 403
        _page(
            client, gm_headers, campaign_id, title="Shared map", page_type="map",
            visibility="group", map_file_id=up["resource_id"],
        )
        assert client.get(url, headers=player_headers).status_code == 200


class TestPins:
    def test_pin_to_a_page(self, client, gm_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        town = _page(client, gm_headers, campaign_id, title=f"Waterdeep {uid()}", visibility="group")
        resp = _pin(client, gm_headers, campaign_id, page["id"], target_page_id=town["id"], icon="castle")
        assert resp.status_code == 201, resp.text
        pin = resp.json()
        assert pin["target_title"] == town["title"]
        assert (pin["x"], pin["y"]) == (0.25, 0.75)
        assert pin["can_edit"] is True

    def test_pin_title_creates_a_stub_with_the_maps_visibility(
        self, client, gm_headers, player_headers, campaign_id
    ):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id, visibility="group")
        title = f"Neverwinter {uid()}"
        pin = _pin(client, gm_headers, campaign_id, page["id"], target_title=title).json()
        stub = _get(client, player_headers, campaign_id, pin["target_page_id"])
        assert stub["title"] == title and stub["visibility"] == "group"
        # The same title again reuses the page rather than making another.
        again = _pin(client, gm_headers, campaign_id, page["id"], target_title=title).json()
        assert again["target_page_id"] == pin["target_page_id"]

    def test_coordinates_are_fractions(self, client, gm_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        assert _pin(client, gm_headers, campaign_id, page["id"], x=1.5).status_code == 422
        assert _pin(client, gm_headers, campaign_id, page["id"], y=-0.1).status_code == 422

    def test_only_map_pages_have_pins(self, client, gm_headers, campaign_id):
        note = _page(client, gm_headers, campaign_id, title="Note")
        assert _pin(client, gm_headers, campaign_id, note["id"]).status_code == 400

    def test_move_edit_and_delete(self, client, gm_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        town = _page(client, gm_headers, campaign_id, title=f"Town {uid()}", visibility="group")
        pin = _pin(client, gm_headers, campaign_id, page["id"], target_page_id=town["id"]).json()
        url = f"/api/campaigns/{campaign_id}/wiki/{page['id']}/pins/{pin['id']}"
        moved = client.patch(url, json={"x": 0.9, "y": 0.1, "label": "Gate"}, headers=gm_headers)
        assert moved.status_code == 200
        assert (moved.json()["x"], moved.json()["y"], moved.json()["label"]) == (0.9, 0.1, "Gate")
        unlinked = client.patch(url, json={"target_page_id": ""}, headers=gm_headers).json()
        assert unlinked["target_page_id"] is None
        assert client.delete(url, headers=gm_headers).status_code == 204
        assert _get(client, gm_headers, campaign_id, page["id"])["pins"] == []

    def test_pins_are_backlinks(self, client, gm_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        town = _page(client, gm_headers, campaign_id, title=f"Baldur {uid()}", visibility="group")
        _pin(client, gm_headers, campaign_id, page["id"], target_page_id=town["id"])
        backlinks = _get(client, gm_headers, campaign_id, town["id"])["backlinks"]
        assert [(b["id"], b["via_pin"]) for b in backlinks] == [(page["id"], True)]
        # A body link is still an ordinary backlink.
        linker = _page(
            client, gm_headers, campaign_id, title=f"Linker {uid()}", visibility="group",
            body=f"[[{town['title']}]]",
        )
        backlinks = _get(client, gm_headers, campaign_id, town["id"])["backlinks"]
        assert {b["id"]: b["via_pin"] for b in backlinks} == {page["id"]: True, linker["id"]: False}

    def test_editing_the_map_page_body_keeps_pin_links(self, client, gm_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        town = _page(client, gm_headers, campaign_id, title=f"Kept {uid()}", visibility="group")
        _pin(client, gm_headers, campaign_id, page["id"], target_page_id=town["id"])
        client.patch(
            f"/api/campaigns/{campaign_id}/wiki/{page['id']}",
            json={"body": "The coast."},
            headers=gm_headers,
        )
        assert _get(client, gm_headers, campaign_id, town["id"])["backlinks"][0]["id"] == page["id"]

    def test_renaming_and_renesting_the_target_keeps_the_pin(self, client, gm_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        town = _page(client, gm_headers, campaign_id, title=f"Old {uid()}", visibility="group")
        parent = _page(client, gm_headers, campaign_id, title=f"Region {uid()}", visibility="group")
        _pin(client, gm_headers, campaign_id, page["id"], target_page_id=town["id"])
        client.patch(
            f"/api/campaigns/{campaign_id}/wiki/{town['id']}",
            json={"title": "Renamed Town", "parent_id": parent["id"]},
            headers=gm_headers,
        )
        pin = _get(client, gm_headers, campaign_id, page["id"])["pins"][0]
        assert pin["target_page_id"] == town["id"]
        assert pin["target_title"] == "Renamed Town"

    def test_deleting_the_target_unlinks_the_pin(self, client, gm_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        town = _page(client, gm_headers, campaign_id, title=f"Doomed {uid()}", visibility="group")
        _pin(client, gm_headers, campaign_id, page["id"], target_page_id=town["id"], label="Ruins")
        assert (
            client.delete(f"/api/campaigns/{campaign_id}/wiki/{town['id']}", headers=gm_headers)
            .status_code
            == 204
        )
        pins = _get(client, gm_headers, campaign_id, page["id"])["pins"]
        assert [(p["label"], p["target_page_id"]) for p in pins] == [("Ruins", None)]

    def test_deleting_the_map_page_takes_its_pins(self, client, gm_headers, campaign_id):
        from backend.config import SessionLocal
        from backend.models import WikiMapPin

        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        _pin(client, gm_headers, campaign_id, page["id"])
        client.delete(f"/api/campaigns/{campaign_id}/wiki/{page['id']}", headers=gm_headers)
        db = SessionLocal()
        assert db.query(WikiMapPin).filter_by(page_id=page["id"]).count() == 0
        db.close()

    def test_deleting_the_campaign_takes_pages_and_pins(self, client, gm_headers):
        c = client.post(
            "/api/campaigns", json={"name": f"Gone {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        m = _link_map(client, gm_headers, c["id"])
        page = _map_page(client, gm_headers, c["id"], m.id)
        town = _page(client, gm_headers, c["id"], title="Town", visibility="group")
        _pin(client, gm_headers, c["id"], page["id"], target_page_id=town["id"])
        assert client.delete(f"/api/campaigns/{c['id']}", headers=gm_headers).status_code in (
            200,
            204,
        )


class TestPinVisibility:
    def test_a_pin_to_a_hidden_page_is_not_shown(
        self, client, gm_headers, player_headers, campaign_id
    ):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id, visibility="group")
        secret = _page(client, gm_headers, campaign_id, title=f"Lair {uid()}", visibility="gm")
        pin = _pin(
            client, gm_headers, campaign_id, page["id"], target_page_id=secret["id"], label="X"
        ).json()
        _pin(client, gm_headers, campaign_id, page["id"], label="Open")
        player_view = _get(client, player_headers, campaign_id, page["id"])
        assert [p["label"] for p in player_view["pins"]] == ["Open"]
        assert secret["title"] not in json.dumps(player_view)
        # Editing it is a 404, so the pin doesn't confirm itself to the player.
        resp = client.patch(
            f"/api/campaigns/{campaign_id}/wiki/{page['id']}/pins/{pin['id']}",
            json={"x": 0.5},
            headers=player_headers,
        )
        assert resp.status_code == 404

    def test_gm_pins_are_the_gms(self, client, gm_headers, player_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id, visibility="group")
        _pin(client, gm_headers, campaign_id, page["id"], label="Hidden cave", visibility="gm")
        assert [p["label"] for p in _get(client, gm_headers, campaign_id, page["id"])["pins"]] == [
            "Hidden cave"
        ]
        player_view = _get(client, player_headers, campaign_id, page["id"])
        assert player_view["pins"] == []
        assert "Hidden cave" not in json.dumps(player_view)

    def test_a_player_cannot_make_a_gm_pin(self, client, gm_headers, player_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id, visibility="group")
        assert (
            _pin(client, player_headers, campaign_id, page["id"], visibility="gm").status_code
            == 403
        )
        # Ordinary pins: anyone who can edit the page.
        pin = _pin(client, player_headers, campaign_id, page["id"], label="Camp")
        assert pin.status_code == 201

    def test_gm_pins_are_not_backlinks(self, client, gm_headers, player_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id, visibility="group")
        town = _page(client, gm_headers, campaign_id, title=f"Spy {uid()}", visibility="group")
        _pin(client, gm_headers, campaign_id, page["id"], target_page_id=town["id"], visibility="gm")
        assert _get(client, player_headers, campaign_id, town["id"])["backlinks"] == []

    def test_a_player_cannot_pin_a_page_they_cannot_see(
        self, client, gm_headers, player_headers, campaign_id
    ):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id, visibility="group")
        secret = _page(client, gm_headers, campaign_id, title=f"Vault {uid()}", visibility="gm")
        resp = _pin(client, player_headers, campaign_id, page["id"], target_page_id=secret["id"])
        assert resp.status_code == 400

    def test_read_only_viewers_cannot_pin(self, client, gm_headers, player_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id, visibility="gm")
        # A page the player can't see is a 404, not a 403.
        assert _pin(client, player_headers, campaign_id, page["id"]).status_code == 404


def _delete_page(client, headers, cid, page_id):
    resp = client.delete(f"/api/campaigns/{cid}/wiki/{page_id}", headers=headers)
    assert resp.status_code == 204, resp.text


def _pin_rows(page_id):
    from backend.config import SessionLocal
    from backend.models import WikiMapPin

    db = SessionLocal()
    try:
        return [
            (p.label, p.target_page_id, p.visibility)
            for p in db.query(WikiMapPin).filter_by(page_id=page_id).all()
        ]
    finally:
        db.close()


class TestDeletingAPinsTarget:
    """A pin hidden with its page stays hidden once the page is deleted."""

    def test_the_gms_hidden_page_leaves_a_gm_pin(
        self, client, gm_headers, player_headers, campaign_id
    ):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id, title=f"Coast {uid()}")
        secret = _page(client, gm_headers, campaign_id, title=f"Lair {uid()}", visibility="gm")
        _pin(
            client, gm_headers, campaign_id, page["id"], target_page_id=secret["id"],
            label="Secret lair entrance",
        )
        assert _get(client, player_headers, campaign_id, page["id"])["pins"] == []

        _delete_page(client, gm_headers, campaign_id, secret["id"])

        player_view = _get(client, player_headers, campaign_id, page["id"])
        assert player_view["pins"] == []
        assert "Secret lair entrance" not in json.dumps(player_view)
        for fmt in ("json", "md", "mdfile"):
            export = client.get(
                f"/api/campaigns/{campaign_id}/wiki/export?format={fmt}", headers=player_headers
            )
            assert export.status_code == 200, export.text
            content = export.content
            if fmt == "md":
                with zipfile.ZipFile(io.BytesIO(content)) as zf:
                    content = b"".join(zf.read(n) for n in zf.namelist())
            assert b"Secret lair entrance" not in content
        # The GM keeps the spot, as a GM-only pin with no page.
        gm_pins = _get(client, gm_headers, campaign_id, page["id"])["pins"]
        assert [(p["label"], p["target_page_id"], p["visibility"]) for p in gm_pins] == [
            ("Secret lair entrance", None, "gm")
        ]

    def test_a_shared_page_does_not_widen_to_the_whole_map(
        self, client, gm_headers, player_headers, player_id, campaign_id
    ):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        shared = _page(
            client, gm_headers, campaign_id, title=f"Rumour {uid()}", visibility="members",
            shared_user_ids=[player_id],
        )
        _pin(client, gm_headers, campaign_id, page["id"], target_page_id=shared["id"], label="R")
        assert len(_get(client, player_headers, campaign_id, page["id"])["pins"]) == 1
        _delete_page(client, gm_headers, campaign_id, shared["id"])
        assert _pin_rows(page["id"]) == [("R", None, "gm")]
        assert _get(client, player_headers, campaign_id, page["id"])["pins"] == []

    def test_a_players_hidden_page_takes_its_pin(
        self, client, gm_headers, player_headers, campaign_id
    ):
        """Not handed to the GM, who could not read the page it pointed at."""
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        own = _page(client, player_headers, campaign_id, title=f"Stash {uid()}", visibility="gm")
        resp = _pin(
            client, player_headers, campaign_id, page["id"], target_page_id=own["id"], label="S"
        )
        assert resp.status_code == 201, resp.text
        assert _get(client, gm_headers, campaign_id, page["id"])["pins"] == []
        _delete_page(client, player_headers, campaign_id, own["id"])
        assert _pin_rows(page["id"]) == []
        assert _get(client, gm_headers, campaign_id, page["id"])["pins"] == []

    def test_no_gm_pin_is_left_on_a_map_the_gm_cannot_see(
        self, client, gm_headers, player_headers, player_id, campaign_id
    ):
        m = _link_map(client, gm_headers, campaign_id)
        own_map = _map_page(client, player_headers, campaign_id, m.id, visibility="gm")
        shared = _page(
            client, gm_headers, campaign_id, title=f"Clue {uid()}", visibility="members",
            shared_user_ids=[player_id],
        )
        resp = _pin(client, player_headers, campaign_id, own_map["id"], target_page_id=shared["id"])
        assert resp.status_code == 201, resp.text
        _delete_page(client, gm_headers, campaign_id, shared["id"])
        assert _pin_rows(own_map["id"]) == []

    def test_deleting_a_note_category_with_its_pages(
        self, client, gm_headers, player_headers, campaign_id
    ):
        from backend.config import SessionLocal
        from backend.models import CampaignCategory, WikiPage

        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        secret = _page(client, gm_headers, campaign_id, title=f"Vault {uid()}", visibility="gm")
        town = _page(client, gm_headers, campaign_id, title=f"Town {uid()}", visibility="group")
        _pin(client, gm_headers, campaign_id, page["id"], target_page_id=secret["id"], label="V")
        _pin(client, gm_headers, campaign_id, page["id"], target_page_id=town["id"], label="T")
        # Note categories predate nesting, so nothing in the app files a page
        # under one any more; older campaigns still hold them.
        db = SessionLocal()
        cat = CampaignCategory(campaign_id=campaign_id, name="Old", kind="note")
        db.add(cat)
        db.flush()
        db.query(WikiPage).filter(WikiPage.id.in_([secret["id"], town["id"]])).update(
            {WikiPage.category_id: cat.id}, synchronize_session=False
        )
        db.commit()
        cat_id = cat.id
        db.close()

        resp = client.delete(
            f"/api/campaigns/{campaign_id}/categories/{cat_id}?mode=delete_items",
            headers=gm_headers,
        )
        assert resp.status_code in (200, 204), resp.text
        assert sorted(_pin_rows(page["id"])) == [("T", None, "page"), ("V", None, "gm")]
        pins = _get(client, player_headers, campaign_id, page["id"])["pins"]
        assert [p["label"] for p in pins] == ["T"]

    def test_deleting_a_pages_author_keeps_its_pin_hidden(
        self, client, admin_headers, gm_headers, player_headers, campaign_id
    ):
        """The page outlives its author, unreadable, so the pin stays linked and unseen."""
        from backend.config import SessionLocal
        from backend.models import WikiMapPin, WikiPage

        user = client.post(
            "/api/users",
            json={"username": f"gone{uid()}", "password": "refpass123-long", "role": "player"},
            headers=admin_headers,
        )
        assert user.status_code == 201, user.text
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id)
        db = SessionLocal()
        note = WikiPage(
            campaign_id=campaign_id, title="Theirs", slug=f"theirs-{uid()}", body="",
            visibility="gm", page_type="note", created_by_id=user.json()["id"],
        )
        db.add(note)
        db.flush()
        db.add(WikiMapPin(page_id=page["id"], target_page_id=note.id, label="Theirs"))
        db.commit()
        note_id = note.id
        db.close()

        resp = client.delete(f"/api/users/{user.json()['id']}", headers=admin_headers)
        assert resp.status_code == 204, resp.text
        assert _pin_rows(page["id"]) == [("Theirs", note_id, "page")]
        for headers in (gm_headers, player_headers):
            assert _get(client, headers, campaign_id, page["id"])["pins"] == []


class TestMapPageIO:
    def _setup(self, client, gm_headers, campaign_id):
        m = _link_map(client, gm_headers, campaign_id)
        page = _map_page(client, gm_headers, campaign_id, m.id, title="Coast")
        town = _page(client, gm_headers, campaign_id, title="Waterdeep", visibility="group")
        _pin(client, gm_headers, campaign_id, page["id"], target_page_id=town["id"], label="City")
        _pin(client, gm_headers, campaign_id, page["id"], label="Secret", visibility="gm", x=0.1)
        return m, page, town

    def _target_campaign(self, client, gm_headers):
        return client.post(
            "/api/campaigns", json={"name": f"Into {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()["id"]

    def _imported_map_page(self, client, gm_headers, cid):
        pages = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        coast = next(p for p in pages if p["title"] == "Coast")
        town = next(p for p in pages if p["title"] == "Waterdeep")
        return _get(client, gm_headers, cid, coast["id"]), town

    def test_json_round_trip(self, client, gm_headers, campaign_id):
        m, _page_, _town = self._setup(client, gm_headers, campaign_id)
        bundle = client.get(
            f"/api/campaigns/{campaign_id}/wiki/export?format=json", headers=gm_headers
        ).json()
        coast = next(p for p in bundle["pages"] if p["title"] == "Coast")
        assert coast["map_id"] == m.id
        assert {p["label"]: p["target"] for p in coast["pins"]} == {
            "City": "waterdeep",
            "Secret": None,
        }

        cid = self._target_campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{cid}/wiki/import",
            files={"file": ("w.json", json.dumps(bundle).encode(), "application/json")},
            headers=gm_headers,
        )
        assert resp.status_code == 201, resp.text
        got, town = self._imported_map_page(client, gm_headers, cid)
        assert got["map"]["id"] == m.id
        pins = {p["label"]: p for p in got["pins"]}
        assert pins["City"]["target_page_id"] == town["id"]
        assert pins["Secret"]["visibility"] == "gm"
        backlinks = _get(client, gm_headers, cid, town["id"])["backlinks"]
        assert backlinks[0]["via_pin"] is True

    def test_markdown_zip_round_trip(self, client, gm_headers, campaign_id):
        m, _page_, _town = self._setup(client, gm_headers, campaign_id)
        data = client.get(
            f"/api/campaigns/{campaign_id}/wiki/export?format=md", headers=gm_headers
        ).content
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            coast = zf.read("coast.md").decode()
        assert "page_type: map" in coast and f"map: {m.id}" in coast and "pins: [" in coast

        cid = self._target_campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{cid}/wiki/import",
            files={"file": ("w.zip", data, "application/zip")},
            headers=gm_headers,
        )
        assert resp.status_code == 201, resp.text
        got, town = self._imported_map_page(client, gm_headers, cid)
        assert got["page_type"] == "map" and got["map"]["id"] == m.id
        assert {p["label"]: p["target_page_id"] for p in got["pins"]} == {
            "City": town["id"],
            "Secret": None,
        }

    def test_players_export_only_the_pins_they_see(
        self, client, gm_headers, player_headers, campaign_id
    ):
        self._setup(client, gm_headers, campaign_id)
        bundle = client.get(
            f"/api/campaigns/{campaign_id}/wiki/export?format=json", headers=player_headers
        ).json()
        coast = next(p for p in bundle["pages"] if p["title"] == "Coast")
        assert [p["label"] for p in coast["pins"]] == ["City"]

    def test_single_file_lists_the_locations(self, client, gm_headers, campaign_id):
        self._setup(client, gm_headers, campaign_id)
        text = client.get(
            f"/api/campaigns/{campaign_id}/wiki/export?format=mdfile", headers=gm_headers
        ).text
        assert "- City - [[Waterdeep]]" in text

    def test_an_unknown_map_imports_as_a_placeholder(self, client, gm_headers):
        cid = self._target_campaign(client, gm_headers)
        bundle = {
            "grimoire_wiki_version": 1,
            "pages": [
                {
                    "title": "Far Map",
                    "page_type": "map",
                    "map_id": "not-a-map-here",
                    "map_file_id": "../../etc",
                    "pins": [
                        {"x": 2, "y": 0.5, "label": "Clamped"},
                        {"x": "a", "y": 0.5, "label": "Dropped"},
                        {"x": 0.5, "y": 0.5, "visibility": "everyone", "icon_color": "javascript:"},
                    ],
                }
            ],
        }
        resp = client.post(
            f"/api/campaigns/{cid}/wiki/import",
            files={"file": ("w.json", json.dumps(bundle).encode(), "application/json")},
            headers=gm_headers,
        )
        assert resp.status_code == 201, resp.text
        page = _get(client, gm_headers, cid, resp.json()["pages"][0]["id"])
        assert page["map"]["source"] == "missing"
        assert [(p["label"], p["x"], p["visibility"], p["icon_color"]) for p in page["pins"]] == [
            ("Clamped", 1.0, "page", None),
            ("", 0.5, "page", None),
        ]

    def test_template_can_make_a_map_page(self, client, gm_headers, campaign_id):
        resp = client.post(
            f"/api/campaigns/{campaign_id}/wiki/templates",
            json={"name": "Region", "body": "---\npage_type: map\n---\n\nA region."},
            headers=gm_headers,
        )
        assert resp.status_code == 201, resp.text
        used = client.post(
            f"/api/campaigns/{campaign_id}/wiki/templates/{resp.json()['id']}/use",
            headers=gm_headers,
        ).json()
        page = _get(client, gm_headers, campaign_id, used["pages"][0]["id"])
        assert page["page_type"] == "map" and page["map"]["source"] == "none"
