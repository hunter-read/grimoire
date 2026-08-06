"""Tests for the campaign wiki (page-centric notes with visibility + [[links]])."""
import uuid

import pytest


def uid():
    return uuid.uuid4().hex[:8]


@pytest.fixture()
def gm_campaign(client, gm_headers):
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Wiki {uid()}", "is_gm_campaign": True},
        headers=gm_headers,
    )
    assert resp.status_code == 201
    return resp.json()


@pytest.fixture()
def campaign_with_member(client, gm_headers, player_headers, player_id):
    """GM campaign with an accepted player; returns the campaign id."""
    c = client.post(
        "/api/campaigns",
        json={"name": f"WikiMem {uid()}", "is_gm_campaign": True},
        headers=gm_headers,
    ).json()
    client.post(
        f"/api/campaigns/{c['id']}/invite", json={"user_id": player_id}, headers=gm_headers
    )
    client.patch(
        f"/api/campaigns/{c['id']}/members/{player_id}",
        json={"status": "accepted"},
        headers=player_headers,
    )
    return c["id"]


def _create(client, headers, cid, **kwargs):
    resp = client.post(f"/api/campaigns/{cid}/wiki", json=kwargs, headers=headers)
    return resp


class TestWikiCRUD:
    def test_create_and_get_page(self, client, gm_headers, gm_campaign):
        resp = _create(
            client, gm_headers, gm_campaign["id"], title="The Tavern", body="A cozy inn."
        )
        assert resp.status_code == 201, resp.text
        page_id = resp.json()["id"]
        got = client.get(
            f"/api/campaigns/{gm_campaign['id']}/wiki/{page_id}", headers=gm_headers
        ).json()
        assert got["title"] == "The Tavern"
        assert got["body"] == "A cozy inn."
        assert got["slug"] == "the-tavern"
        assert got["can_edit"] is True

    def test_duplicate_title_gets_unique_slug(self, client, gm_headers, gm_campaign):
        a = _create(client, gm_headers, gm_campaign["id"], title="Dragon").json()
        b = _create(client, gm_headers, gm_campaign["id"], title="Dragon").json()
        assert a["slug"] == "dragon"
        assert b["slug"] == "dragon-2"

    def test_unicode_title_keeps_letters_in_slug(self, client, gm_headers, gm_campaign):
        # German special characters (and other Unicode letters) must survive
        # slugification so [[links]] resolve; the frontend slugify matches this
        # (issue #252).
        page = _create(client, gm_headers, gm_campaign["id"], title="Breitfuß").json()
        assert page["slug"] == "breitfuß"
        page2 = _create(client, gm_headers, gm_campaign["id"], title="Zürich Straße").json()
        assert page2["slug"] == "zürich-straße"

    def test_update_page(self, client, gm_headers, gm_campaign):
        page = _create(client, gm_headers, gm_campaign["id"], title="Notes").json()
        resp = client.patch(
            f"/api/campaigns/{gm_campaign['id']}/wiki/{page['id']}",
            json={"body": "Updated body", "title": "Renamed"},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["slug"] == "renamed"

    def test_delete_page(self, client, gm_headers, gm_campaign):
        page = _create(client, gm_headers, gm_campaign["id"], title="Temp").json()
        resp = client.delete(
            f"/api/campaigns/{gm_campaign['id']}/wiki/{page['id']}", headers=gm_headers
        )
        assert resp.status_code == 204
        assert (
            client.get(
                f"/api/campaigns/{gm_campaign['id']}/wiki/{page['id']}", headers=gm_headers
            ).status_code
            == 404
        )

    def test_list_only_visible_pages(self, client, gm_headers, gm_campaign):
        _create(client, gm_headers, gm_campaign["id"], title="One", visibility="gm")
        resp = client.get(f"/api/campaigns/{gm_campaign['id']}/wiki", headers=gm_headers)
        assert resp.status_code == 200
        assert any(p["title"] == "One" for p in resp.json())

    def test_list_includes_can_edit(self, client, gm_headers, player_headers, campaign_with_member):
        # The sidebar gates the quick icon picker on can_edit, so the list must
        # carry it. The GM owns the page; the player can view but not edit it.
        cid = campaign_with_member
        _create(client, gm_headers, cid, title="Lore", visibility="group")
        gm_list = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        assert all(p["can_edit"] is True for p in gm_list)
        player_list = client.get(f"/api/campaigns/{cid}/wiki", headers=player_headers).json()
        assert all(p["can_edit"] is False for p in player_list)


class TestWikiVisibility:
    def test_gm_page_hidden_from_player(self, client, gm_headers, player_headers, campaign_with_member):
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Secret", visibility="gm").json()
        # GM sees it...
        assert client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=gm_headers).status_code == 200
        # ...player gets 403.
        assert (
            client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=player_headers).status_code
            == 403
        )
        # And it's absent from the player's list.
        listed = client.get(f"/api/campaigns/{cid}/wiki", headers=player_headers).json()
        assert not any(p["id"] == page["id"] for p in listed)

    def test_group_page_visible_to_player(self, client, gm_headers, player_headers, campaign_with_member):
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Public Lore", visibility="group").json()
        assert (
            client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=player_headers).status_code
            == 200
        )

    def test_members_page_visible_only_to_shared_user(
        self, client, gm_headers, player_headers, player_id, campaign_with_member
    ):
        cid = campaign_with_member
        # Shared with the player.
        shared = _create(
            client, gm_headers, cid, title="For You", visibility="members", shared_user_ids=[player_id]
        ).json()
        assert (
            client.get(f"/api/campaigns/{cid}/wiki/{shared['id']}", headers=player_headers).status_code
            == 200
        )
        # Not shared with anyone.
        private = _create(
            client, gm_headers, cid, title="For Nobody", visibility="members", shared_user_ids=[]
        ).json()
        assert (
            client.get(f"/api/campaigns/{cid}/wiki/{private['id']}", headers=player_headers).status_code
            == 403
        )

    def test_member_can_create_group_page_only(self, client, player_headers, campaign_with_member):
        cid = campaign_with_member
        ok = _create(client, player_headers, cid, title="Player Page", visibility="group")
        assert ok.status_code == 201
        denied = _create(client, player_headers, cid, title="Player GM Page", visibility="gm")
        assert denied.status_code == 403

    def test_member_cannot_edit_others_page(self, client, gm_headers, player_headers, campaign_with_member):
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="GM Authored", visibility="group").json()
        resp = client.patch(
            f"/api/campaigns/{cid}/wiki/{page['id']}",
            json={"body": "hacked"},
            headers=player_headers,
        )
        assert resp.status_code == 403


class TestWikiGmSecrets:
    BODY = "Public intro. ||The duke is a doppelganger|| The rest is shared."

    def _get(self, client, cid, pid, headers):
        return client.get(f"/api/campaigns/{cid}/wiki/{pid}", headers=headers).json()

    def _patch(self, client, cid, pid, body, headers):
        return client.patch(
            f"/api/campaigns/{cid}/wiki/{pid}", json={"body": body}, headers=headers
        )

    def test_owner_sees_secret_spans(self, client, gm_headers, player_headers, campaign_with_member):
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Lore", body=self.BODY, visibility="group").json()
        got = self._get(client, cid, page["id"], gm_headers)
        assert got["body"] == self.BODY

    def test_player_gets_secret_fully_stripped_no_trace(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Lore", body=self.BODY, visibility="group").json()
        got = self._get(client, cid, page["id"], player_headers)
        # The player's body leaks nothing: no hidden text, no pipe markers, and no
        # placeholder token hinting a secret exists or where.
        assert "doppelganger" not in got["body"]
        assert "||" not in got["body"]
        assert "⟦" not in got["body"] and "GM·" not in got["body"]
        assert got["body"] == "Public intro.  The rest is shared."

    def test_multiline_secret_fully_stripped(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        body = "Before.\n||line one\nline two||\nAfter."
        page = _create(client, gm_headers, cid, title="Multi", body=body, visibility="group").json()
        got = self._get(client, cid, page["id"], player_headers)
        assert "line one" not in got["body"]
        assert "line two" not in got["body"]
        assert got["body"] == "Before.\n\nAfter."

    def test_personal_campaign_keeps_secrets(self, client, player_headers):
        # A player's personal (non-GM) campaign — only the owner ever views it, so
        # nothing is stripped.
        c = client.post(
            "/api/campaigns", json={"name": f"Personal {uid()}"}, headers=player_headers
        ).json()
        page = _create(client, player_headers, c["id"], title="Mine", body=self.BODY).json()
        got = self._get(client, c["id"], page["id"], player_headers)
        assert got["body"] == self.BODY

    def test_search_snippet_hides_secret_from_player(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        _create(
            client,
            gm_headers,
            cid,
            title="Findable",
            body="visible text ||hidden treasure|| more",
            visibility="group",
        )
        # The player searching the secret's words gets no match.
        resp = client.get(f"/api/campaigns/{cid}/wiki/search?q=treasure", headers=player_headers)
        assert resp.status_code == 200
        assert resp.json()["results"] == []
        # ...but a visible word still matches; the snippet carries no secret text.
        resp2 = client.get(f"/api/campaigns/{cid}/wiki/search?q=visible", headers=player_headers)
        hit = next(r for r in resp2.json()["results"] if r["title"] == "Findable")
        assert "treasure" not in hit["snippet"]

    def _authored_page_with_secret(self, client, gm_headers, player_headers, cid, body):
        """Player authors a group page; the GM edits it to a body with ||secret||s.
        Returns (page_id, player's clean stripped view of the body)."""
        page = _create(
            client, player_headers, cid, title=f"Log {uid()}", body="placeholder",
            visibility="group",
        ).json()
        pid = page["id"]
        assert self._patch(client, cid, pid, body, gm_headers).status_code == 200
        seen = self._get(client, cid, pid, player_headers)["body"]
        # Sanity: the player's copy never contains the secret or a marker.
        assert "||" not in seen and "⟦" not in seen
        return pid, seen

    def test_player_edit_above_secret_keeps_it_in_place(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        pid, seen = self._authored_page_with_secret(
            client, gm_headers, player_headers, cid,
            "We met the duke. ||He is a doppelganger.|| The feast ended.",
        )
        # Player edits the text BEFORE the (invisible) secret and re-saves.
        new = seen.replace("We met the duke.", "We met the duke at dusk.")
        assert self._patch(client, cid, pid, new, player_headers).status_code == 200

        gm_body = self._get(client, cid, pid, gm_headers)["body"]
        assert gm_body == (
            "We met the duke at dusk. ||He is a doppelganger.|| The feast ended."
        )
        assert "doppelganger" not in self._get(client, cid, pid, player_headers)["body"]

    def test_player_edit_below_secret_keeps_it_in_place(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        pid, seen = self._authored_page_with_secret(
            client, gm_headers, player_headers, cid,
            "We met the duke. ||He is a doppelganger.|| The feast ended.",
        )
        new = seen.replace("The feast ended.", "The feast ended in a brawl.")
        assert self._patch(client, cid, pid, new, player_headers).status_code == 200
        gm_body = self._get(client, cid, pid, gm_headers)["body"]
        assert gm_body == (
            "We met the duke. ||He is a doppelganger.|| The feast ended in a brawl."
        )

    def test_player_edit_both_sides_does_not_move_secret_below(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        # The reporter's 3-paragraph case: editing the public blocks above AND below
        # a secret must keep the secret between them, never dropped to the bottom.
        cid = campaign_with_member
        pid, seen = self._authored_page_with_secret(
            client, gm_headers, player_headers, cid,
            "Para A.\n\n||the hidden twist||\n\nPara B.",
        )
        new = seen.replace("Para A.", "Para A edited.").replace("Para B.", "Para B edited.")
        assert self._patch(client, cid, pid, new, player_headers).status_code == 200
        gm_body = self._get(client, cid, pid, gm_headers)["body"]
        assert gm_body == "Para A edited.\n\n||the hidden twist||\n\nPara B edited."

    def test_player_rewriting_around_secret_preserves_it_at_bottom(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        # When the text on both sides of the secret is rewritten past recognition,
        # the position can't be recovered — the secret survives, appended at the end.
        cid = campaign_with_member
        pid, _seen = self._authored_page_with_secret(
            client, gm_headers, player_headers, cid,
            "Original intro line. ||dont lose me|| Original outro line.",
        )
        new = "A totally rewritten note with nothing in common."
        assert self._patch(client, cid, pid, new, player_headers).status_code == 200
        gm_body = self._get(client, cid, pid, gm_headers)["body"]
        assert "||dont lose me||" in gm_body  # survived
        assert gm_body.startswith("A totally rewritten note")

    def test_player_edit_preserves_multiple_secrets(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        pid, seen = self._authored_page_with_secret(
            client, gm_headers, player_headers, cid,
            "A ||first secret|| B ||second secret|| C",
        )
        new = seen.replace("A ", "A (edited) ").replace(" C", " C!")
        assert self._patch(client, cid, pid, new, player_headers).status_code == 200
        gm_body = self._get(client, cid, pid, gm_headers)["body"]
        assert "||first secret||" in gm_body
        assert "||second secret||" in gm_body
        assert gm_body.index("first secret") < gm_body.index("second secret")

    def test_owner_edit_stores_body_verbatim(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        # The owner submits raw ||...||, which is stored as-is (no merge for them).
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Owned", body="x", visibility="group").json()
        pid = page["id"]
        body = "Alpha ||owner secret|| Omega"
        assert self._patch(client, cid, pid, body, gm_headers).status_code == 200
        assert self._get(client, cid, pid, gm_headers)["body"] == body


class TestWikiLinks:
    def test_link_autocreates_stub_and_backlink(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        src = _create(
            client, gm_headers, cid, title="Hub", body="See [[The Castle]] for details."
        ).json()
        # A stub page for "The Castle" should now exist.
        listed = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        castle = next((p for p in listed if p["slug"] == "the-castle"), None)
        assert castle is not None
        # The Castle page should report Hub as a backlink.
        castle_full = client.get(
            f"/api/campaigns/{cid}/wiki/{castle['id']}", headers=gm_headers
        ).json()
        assert any(b["id"] == src["id"] for b in castle_full["backlinks"])

    def test_links_rebuilt_on_update(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        target = _create(client, gm_headers, cid, title="Target").json()
        src = _create(client, gm_headers, cid, title="Source", body="[[Target]]").json()
        # Backlink exists.
        t = client.get(f"/api/campaigns/{cid}/wiki/{target['id']}", headers=gm_headers).json()
        assert any(b["id"] == src["id"] for b in t["backlinks"])
        # Remove the link; backlink should disappear.
        client.patch(
            f"/api/campaigns/{cid}/wiki/{src['id']}", json={"body": "no links"}, headers=gm_headers
        )
        t2 = client.get(f"/api/campaigns/{cid}/wiki/{target['id']}", headers=gm_headers).json()
        assert not any(b["id"] == src["id"] for b in t2["backlinks"])

    def test_grimoire_embed_not_treated_as_page_link(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        _create(client, gm_headers, cid, title="WithEmbed", body="[[book:abc123:5]]")
        listed = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        # No stub page should be created for an embed target.
        assert not any(p["slug"].startswith("book") for p in listed)

    def test_file_and_image_embeds_not_page_links(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        _create(
            client,
            gm_headers,
            cid,
            title="WithFileEmbeds",
            body="[[image:img123]] and [[file:doc456]]",
        )
        listed = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        # File/image embeds must not auto-create stub pages.
        assert not any(p["slug"].startswith(("image", "file")) for p in listed)

    def test_audio_embed_not_page_link(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        _create(client, gm_headers, cid, title="WithAudioEmbed", body="[[audio:track789]]")
        listed = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        # An audio embed must not auto-create a stub page.
        assert not any(p["slug"].startswith("audio") for p in listed)

    def test_stub_inherits_source_visibility(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        _create(client, gm_headers, cid, title="GroupHub", body="[[Sub Page]]", visibility="group")
        listed = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        stub = next(p for p in listed if p["slug"] == "sub-page")
        assert stub["visibility"] == "group"


class TestWikiSearchAndTitles:
    def test_search_matches_title_and_body(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        _create(client, gm_headers, cid, title="Findable", body="treasure hoard here")
        resp = client.get(f"/api/campaigns/{cid}/wiki/search?q=treasure", headers=gm_headers)
        assert resp.status_code == 200
        assert any(r["title"] == "Findable" for r in resp.json()["results"])

    def test_titles_endpoint(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        _create(client, gm_headers, cid, title="Autocomplete Me")
        resp = client.get(f"/api/campaigns/{cid}/wiki/titles", headers=gm_headers)
        assert resp.status_code == 200
        assert any(t["title"] == "Autocomplete Me" for t in resp.json())


class TestWikiIcons:
    def test_create_with_icon(self, client, gm_headers, gm_campaign):
        resp = _create(client, gm_headers, gm_campaign["id"], title="NPC", icon="user")
        assert resp.status_code == 201
        assert resp.json()["icon"] == "user"

    def test_update_and_clear_icon(self, client, gm_headers, gm_campaign):
        page = _create(client, gm_headers, gm_campaign["id"], title="Lore").json()
        cid = gm_campaign["id"]
        upd = client.patch(
            f"/api/campaigns/{cid}/wiki/{page['id']}", json={"icon": "scroll"}, headers=gm_headers
        )
        assert upd.json()["icon"] == "scroll"
        cleared = client.patch(
            f"/api/campaigns/{cid}/wiki/{page['id']}", json={"icon": ""}, headers=gm_headers
        )
        assert cleared.json()["icon"] is None

    def test_emoji_icon_round_trips(self, client, gm_headers, gm_campaign):
        """An emoji is stored verbatim — the picker's emoji tab needs no key mapping."""
        resp = _create(client, gm_headers, gm_campaign["id"], title="Dragon", icon="🐉")
        assert resp.status_code == 201
        assert resp.json()["icon"] == "🐉"
        got = client.get(
            f"/api/campaigns/{gm_campaign['id']}/wiki/{resp.json()['id']}", headers=gm_headers
        )
        assert got.json()["icon"] == "🐉"

    def test_create_with_icon_color(self, client, gm_headers, gm_campaign):
        resp = _create(
            client, gm_headers, gm_campaign["id"], title="NPC", icon="user", icon_color="red"
        )
        assert resp.status_code == 201
        assert resp.json()["icon_color"] == "red"

    def test_update_and_clear_icon_color(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        page = _create(client, gm_headers, cid, title="Lore").json()
        assert page["icon_color"] is None
        upd = client.patch(
            f"/api/campaigns/{cid}/wiki/{page['id']}",
            json={"icon_color": "#A1B2C3"},
            headers=gm_headers,
        )
        # Hex is normalized to lowercase on the way in.
        assert upd.json()["icon_color"] == "#a1b2c3"
        cleared = client.patch(
            f"/api/campaigns/{cid}/wiki/{page['id']}",
            json={"icon_color": ""},
            headers=gm_headers,
        )
        assert cleared.json()["icon_color"] is None

    @pytest.mark.parametrize(
        "bad",
        [
            "notacolour",
            "#abc",
            "#12345g",
            "red; background: url(x)",
            "url(javascript:alert(1))",
            "var(--red)",
        ],
    )
    def test_rejects_invalid_icon_color(self, client, gm_headers, gm_campaign, bad):
        """The tint lands in a style attribute, so only presets/#rrggbb are accepted."""
        resp = _create(client, gm_headers, gm_campaign["id"], title="Bad", icon_color=bad)
        assert resp.status_code == 422

    def test_icon_color_appears_in_list(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        _create(client, gm_headers, cid, title="Tinted", icon="castle", icon_color="blue")
        listing = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        row = next(p for p in listing if p["title"] == "Tinted")
        assert row["icon_color"] == "blue"
        assert row["icon"] == "castle"


class TestWikiReorder:
    def test_reorder_pages(self, client, gm_headers):
        cid = client.post(
            "/api/campaigns",
            json={"name": f"Order {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()["id"]
        a = _create(client, gm_headers, cid, title="Apage").json()
        b = _create(client, gm_headers, cid, title="Bpage").json()
        # Put B before A.
        resp = client.put(
            f"/api/campaigns/{cid}/wiki/reorder",
            json={"ordered_ids": [b["id"], a["id"]]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        listed = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        order = [p["id"] for p in listed]
        assert order.index(b["id"]) < order.index(a["id"])


class TestWikiMigration:
    def test_migrate_rolls_content_and_purges_empty(self, client, admin_headers, gm_headers, gm_id):
        from backend.config import SessionLocal
        from backend.models import (
            Campaign,
            GMSessionNote,
            PlayerSessionNote,
            SessionNote,
            WikiPage,
        )
        from backend import wiki_migration

        db = SessionLocal()
        try:
            campaign = Campaign(name=f"Legacy {uid()}", owner_id=gm_id, is_gm_campaign=True)
            db.add(campaign)
            db.commit()
            db.refresh(campaign)
            cid = campaign.id

            # Session with content -> should produce pages.
            s1 = SessionNote(campaign_id=cid, session_date="2024-01-01", title="Opening")
            db.add(s1)
            db.commit()
            db.refresh(s1)
            db.add(
                GMSessionNote(
                    session_id=s1.id,
                    internal_content="secret plot",
                    external_content="recap for players",
                )
            )
            db.add(PlayerSessionNote(session_id=s1.id, user_id=gm_id, content="my notes"))

            # Empty session -> should be purged, no pages.
            s2 = SessionNote(campaign_id=cid, session_date="2024-01-08", title="Empty")
            db.add(s2)
            db.commit()

            wiki_migration.migrate(db)

            pages = db.query(WikiPage).filter_by(campaign_id=cid).all()
            visibilities = sorted(p.visibility for p in pages)
            # gm (internal) + group (external) + group (player) = 3 pages.
            assert len(pages) == 3
            assert visibilities == ["gm", "group", "group"]
            # All legacy sessions consumed.
            assert db.query(SessionNote).filter_by(campaign_id=cid).count() == 0
        finally:
            db.close()


class TestWikiNesting:
    def test_create_under_parent(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        parent = _create(client, gm_headers, cid, title="Bestiary").json()
        child = _create(
            client, gm_headers, cid, title="Goblin", parent_id=parent["id"]
        ).json()
        assert child["parent_id"] == parent["id"]

    def test_reject_unknown_parent(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        resp = _create(client, gm_headers, cid, title="Orphan", parent_id="nope")
        assert resp.status_code == 400

    def test_reject_self_parent(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        page = _create(client, gm_headers, cid, title="Loop").json()
        resp = client.patch(
            f"/api/campaigns/{cid}/wiki/{page['id']}",
            json={"parent_id": page["id"]},
            headers=gm_headers,
        )
        assert resp.status_code == 400

    def test_reject_descendant_cycle(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        a = _create(client, gm_headers, cid, title="A").json()
        b = _create(client, gm_headers, cid, title="B", parent_id=a["id"]).json()
        # Moving A under B would create a cycle (B is A's child).
        resp = client.patch(
            f"/api/campaigns/{cid}/wiki/{a['id']}",
            json={"parent_id": b["id"]},
            headers=gm_headers,
        )
        assert resp.status_code == 400

    def test_move_to_top_level_with_empty_sentinel(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        parent = _create(client, gm_headers, cid, title="Parent").json()
        child = _create(client, gm_headers, cid, title="Child", parent_id=parent["id"]).json()
        moved = client.patch(
            f"/api/campaigns/{cid}/wiki/{child['id']}",
            json={"parent_id": ""},
            headers=gm_headers,
        ).json()
        assert moved["parent_id"] is None

    def test_delete_reparents_children(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        grand = _create(client, gm_headers, cid, title="Grandparent").json()
        parent = _create(client, gm_headers, cid, title="Parent", parent_id=grand["id"]).json()
        child = _create(client, gm_headers, cid, title="Child", parent_id=parent["id"]).json()
        # Deleting the middle page lifts its child up to the grandparent.
        client.delete(f"/api/campaigns/{cid}/wiki/{parent['id']}", headers=gm_headers)
        got = client.get(f"/api/campaigns/{cid}/wiki/{child['id']}", headers=gm_headers).json()
        assert got["parent_id"] == grand["id"]


class TestCampaignDeleteCascade:
    """Deleting a campaign must clear everything referencing its wiki pages.

    `wiki_pages.parent_id` and both `wiki_page_links` sides point at wiki_pages
    with no ON DELETE, so without ORM cascades SQLite (foreign_keys=ON) rejects
    the delete and the whole campaign becomes undeletable.
    """

    def _campaign(self, client, gm_headers):
        return client.post(
            "/api/campaigns",
            json={"name": f"Del {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()["id"]

    def test_delete_campaign_with_nested_pages(self, client, gm_headers):
        cid = self._campaign(client, gm_headers)
        parent = _create(client, gm_headers, cid, title="Parent").json()
        _create(client, gm_headers, cid, title="Child", parent_id=parent["id"])

        resp = client.delete(f"/api/campaigns/{cid}", headers=gm_headers)
        assert resp.status_code == 204, resp.text
        assert client.get(f"/api/campaigns/{cid}", headers=gm_headers).status_code == 404

    def test_delete_campaign_with_wiki_links(self, client, gm_headers):
        cid = self._campaign(client, gm_headers)
        _create(client, gm_headers, cid, title="Target")
        _create(client, gm_headers, cid, title="Source", body="See [[Target]].")

        resp = client.delete(f"/api/campaigns/{cid}", headers=gm_headers)
        assert resp.status_code == 204, resp.text

    def test_delete_campaign_leaves_no_orphans(self, client, gm_headers):
        """Nesting and links together, with a direct check for leftover rows."""
        from backend.config import SessionLocal
        from backend.models import WikiPage, WikiPageLink

        cid = self._campaign(client, gm_headers)
        target = _create(client, gm_headers, cid, title="Bestiary").json()
        _create(
            client,
            gm_headers,
            cid,
            title="Goblin",
            parent_id=target["id"],
            body="Lives near [[Bestiary]].",
        )

        db = SessionLocal()
        try:
            # Guard the fixture: the bug only reproduces if a link row exists.
            assert db.query(WikiPageLink).filter_by(campaign_id=cid).count() == 1
        finally:
            db.close()

        resp = client.delete(f"/api/campaigns/{cid}", headers=gm_headers)
        assert resp.status_code == 204, resp.text

        db = SessionLocal()
        try:
            assert db.query(WikiPage).filter_by(campaign_id=cid).count() == 0
            assert db.query(WikiPageLink).filter_by(campaign_id=cid).count() == 0
        finally:
            db.close()


class TestNoteCategoryMigration:
    def test_note_categories_become_parent_pages(self, client, gm_headers, gm_id):
        from backend.config import SessionLocal
        from backend.models import CampaignCategory, Campaign, WikiPage
        from backend import wiki_category_migration

        db = SessionLocal()
        try:
            campaign = Campaign(name=f"Cat {uid()}", owner_id=gm_id, is_gm_campaign=True)
            db.add(campaign)
            db.commit()
            db.refresh(campaign)
            cid = campaign.id

            cat = CampaignCategory(campaign_id=cid, kind="note", name="Bestiary", icon="swords")
            db.add(cat)
            db.commit()
            db.refresh(cat)
            page = WikiPage(
                campaign_id=cid, title="Goblin", slug="goblin", category_id=cat.id,
                created_by_id=gm_id,
            )
            db.add(page)
            db.commit()
            page_id = page.id

            wiki_category_migration.migrate(db)

            # The note category is gone, replaced by a parent page of the same name.
            assert db.query(CampaignCategory).filter_by(id=cat.id).first() is None
            parent = (
                db.query(WikiPage)
                .filter_by(campaign_id=cid, title="Bestiary", parent_id=None)
                .first()
            )
            assert parent is not None
            assert parent.icon == "swords"
            # The page now nests under that parent and no longer references a category.
            moved = db.query(WikiPage).filter_by(id=page_id).first()
            assert moved.parent_id == parent.id
            assert moved.category_id is None

            # Idempotent: a second run finds no note categories and does nothing.
            wiki_category_migration.migrate(db)
            assert db.query(WikiPage).filter_by(campaign_id=cid, title="Bestiary").count() == 1
        finally:
            db.close()
