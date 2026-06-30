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
    STRIPPED = "Public intro.  The rest is shared."

    def test_owner_sees_secret_spans(self, client, gm_headers, player_headers, campaign_with_member):
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Lore", body=self.BODY, visibility="group").json()
        got = client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=gm_headers).json()
        assert got["body"] == self.BODY

    def test_player_gets_secret_stripped(self, client, gm_headers, player_headers, campaign_with_member):
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Lore", body=self.BODY, visibility="group").json()
        got = client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=player_headers).json()
        assert got["body"] == self.STRIPPED
        assert "doppelganger" not in got["body"]

    def test_multiline_secret_stripped(self, client, gm_headers, player_headers, campaign_with_member):
        cid = campaign_with_member
        body = "Before.\n||line one\nline two||\nAfter."
        page = _create(client, gm_headers, cid, title="Multi", body=body, visibility="group").json()
        got = client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=player_headers).json()
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
        got = client.get(f"/api/campaigns/{c['id']}/wiki/{page['id']}", headers=player_headers).json()
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
        # ...but a visible word still matches, with the secret stripped from the snippet.
        resp2 = client.get(f"/api/campaigns/{cid}/wiki/search?q=visible", headers=player_headers)
        hit = next(r for r in resp2.json()["results"] if r["title"] == "Findable")
        assert "treasure" not in hit["snippet"]


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
