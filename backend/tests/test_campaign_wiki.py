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
        # carry it. A group page is the shared knowledge base: both the GM who
        # wrote it and the player reading it may edit (issue #233).
        cid = campaign_with_member
        _create(client, gm_headers, cid, title="Lore", visibility="group")
        gm_list = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        assert all(p["can_edit"] is True for p in gm_list)
        player_list = client.get(f"/api/campaigns/{cid}/wiki", headers=player_headers).json()
        assert player_list and all(p["can_edit"] is True for p in player_list)
        # Deleting stays with the author, so the player must not be offered it.
        assert all(p["can_delete"] is False for p in player_list)

    def test_list_flags_authorship(self, client, gm_headers, player_headers, campaign_with_member):
        # `is_mine` backs the "only my notes" filter, so it has to distinguish
        # the two authors on an otherwise identical pair of group pages.
        cid = campaign_with_member
        _create(client, gm_headers, cid, title="GM Wrote", visibility="group")
        _create(client, player_headers, cid, title="Player Wrote", visibility="group")
        listed = client.get(f"/api/campaigns/{cid}/wiki", headers=player_headers).json()
        by_title = {p["title"]: p for p in listed}
        assert by_title["Player Wrote"]["is_mine"] is True
        assert by_title["Player Wrote"]["can_delete"] is True
        assert by_title["GM Wrote"]["is_mine"] is False
        assert by_title["GM Wrote"]["can_delete"] is False


class TestWikiPersonalCampaignVisibility:
    """A personal campaign has one viewer, so its pages are always author-only.

    The UI hides the visibility controls entirely there; the server stores "gm"
    regardless of what arrives, so the column can never hold a value its owner
    has no control to see or undo.
    """

    def _personal(self, client, headers):
        return client.post(
            "/api/campaigns", json={"name": f"Solo {uid()}"}, headers=headers
        ).json()["id"]

    def test_defaults_to_gm_when_visibility_is_omitted(self, client, player_headers):
        cid = self._personal(client, player_headers)
        page = _create(client, player_headers, cid, title="Note").json()
        assert page["visibility"] == "gm"

    def test_coerces_a_supplied_visibility_to_gm(self, client, player_headers):
        # A client sending "group" or "members" gets "gm" stored anyway — there
        # is nobody else in the campaign for those levels to mean anything to.
        cid = self._personal(client, player_headers)
        for sent in ("group", "members"):
            page = _create(
                client, player_headers, cid, title=f"Note {sent}", visibility=sent
            ).json()
            assert page["visibility"] == "gm", sent

    def test_update_cannot_move_a_page_off_gm(self, client, player_headers):
        cid = self._personal(client, player_headers)
        page = _create(client, player_headers, cid, title="Note").json()
        resp = client.patch(
            f"/api/campaigns/{cid}/wiki/{page['id']}",
            json={"visibility": "group"},
            headers=player_headers,
        )
        # Ignored rather than rejected: the client has no control to have sent
        # it from, so a 400 would turn a harmless no-op into an error.
        assert resp.status_code == 200
        assert resp.json()["visibility"] == "gm"

    def test_hiding_is_refused(self, client, player_headers):
        # The UI offers no hide control there; this closes the API behind it.
        cid = self._personal(client, player_headers)
        page = _create(client, player_headers, cid, title="Note").json()
        resp = client.post(
            f"/api/campaigns/{cid}/wiki/{page['id']}/hide", headers=player_headers
        )
        assert resp.status_code == 409

    def test_unhiding_is_still_allowed(self, client, player_headers):
        # Deliberately asymmetric: clearing state is always safe, and refusing
        # would strand a row written before the guard existed.
        cid = self._personal(client, player_headers)
        page = _create(client, player_headers, cid, title="Note").json()
        resp = client.delete(
            f"/api/campaigns/{cid}/wiki/{page['id']}/hide", headers=player_headers
        )
        assert resp.status_code == 200

    def test_a_stale_hidden_row_does_not_drop_a_page(self, client, player_headers):
        """A row from before the guard must not strand its page.

        Writing one directly is the only way to reach this state now, and it is
        exactly what a group campaign converted to personal would leave behind:
        the page must still list, or nothing in the UI could bring it back.
        """
        from backend.config import SessionLocal
        from backend.models import User, WikiPageHidden

        cid = self._personal(client, player_headers)
        page = _create(client, player_headers, cid, title="Note").json()

        db = SessionLocal()
        try:
            uid_ = db.query(User).filter_by(username="playeruser").first().id
            db.add(WikiPageHidden(page_id=page["id"], user_id=uid_))
            db.commit()
        finally:
            db.close()

        listed = client.get(f"/api/campaigns/{cid}/wiki", headers=player_headers).json()
        assert any(p["id"] == page["id"] for p in listed)
        assert all(p["is_hidden"] is False for p in listed)
        # The detail endpoint agrees with the list.
        got = client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=player_headers)
        assert got.json()["is_hidden"] is False
        # ...and search still finds it.
        found = client.get(
            f"/api/campaigns/{cid}/wiki/search?q=Note", headers=player_headers
        ).json()
        assert any(r["id"] == page["id"] for r in found["results"])

    def test_a_group_campaign_still_honours_visibility(
        self, client, gm_headers, campaign_with_member
    ):
        # The coercion is scoped to personal campaigns; a GM campaign is
        # unaffected.
        page = _create(
            client, gm_headers, campaign_with_member, title="Public", visibility="group"
        ).json()
        assert page["visibility"] == "group"


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

    def test_member_can_create_any_visibility(self, client, player_headers, campaign_with_member):
        # Every level is open to a player now — the levels mean the same thing
        # for whoever authors the page (issue #232).
        cid = campaign_with_member
        for visibility in ("group", "gm", "members"):
            resp = _create(
                client, player_headers, cid, title=f"Player {visibility}", visibility=visibility
            )
            assert resp.status_code == 201, visibility
            assert resp.json()["visibility"] == visibility

    def test_player_self_only_page_is_hidden_from_the_gm(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        # "gm" visibility means author-only, so it is symmetric: a player's
        # Self-only note is as private from the GM as the GM's is from them.
        cid = campaign_with_member
        page = _create(client, player_headers, cid, title="My Diary", visibility="gm").json()
        assert (
            client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=player_headers).status_code
            == 200
        )
        assert (
            client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=gm_headers).status_code
            == 403
        )
        listed = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        assert not any(p["id"] == page["id"] for p in listed)

    def test_member_can_edit_gm_authored_group_page(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        # The collaborative knowledge base from issue #233.
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="GM Authored", visibility="group").json()
        resp = client.patch(
            f"/api/campaigns/{cid}/wiki/{page['id']}",
            json={"body": "a player's contribution"},
            headers=player_headers,
        )
        assert resp.status_code == 200
        got = client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=gm_headers).json()
        assert got["body"] == "a player's contribution"

    def test_editor_of_a_group_page_cannot_reclassify_it(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        # Editing text is not the same as owning the page: a player must not be
        # able to take a public page private, which would remove it from
        # everyone else.
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Shared", visibility="group").json()
        resp = client.patch(
            f"/api/campaigns/{cid}/wiki/{page['id']}",
            json={"visibility": "gm"},
            headers=player_headers,
        )
        assert resp.status_code == 403
        # A share list that differs from what's stored is refused as well. (Note
        # a *matching* list is a no-op and does save — see issue #386.)
        resp = client.patch(
            f"/api/campaigns/{cid}/wiki/{page['id']}",
            json={"shared_user_ids": [], "shared_write_user_ids": ["someone-else"]},
            headers=player_headers,
        )
        assert resp.status_code == 403
        assert (
            client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=gm_headers).json()[
                "visibility"
            ]
            == "group"
        )

    def test_member_cannot_delete_a_page_they_did_not_author(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        # Delete is author-only even where edit is open to everyone, so a public
        # page can't be destroyed by a reader.
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="GM Authored", visibility="group").json()
        resp = client.delete(
            f"/api/campaigns/{cid}/wiki/{page['id']}", headers=player_headers
        )
        assert resp.status_code == 403
        # ...and the GM cannot delete the player's page either.
        theirs = _create(client, player_headers, cid, title="Player Page", visibility="group").json()
        assert (
            client.delete(f"/api/campaigns/{cid}/wiki/{theirs['id']}", headers=gm_headers).status_code
            == 403
        )

    def test_write_share_grants_edit_and_read(
        self, client, gm_headers, player_headers, player_id, campaign_with_member
    ):
        cid = campaign_with_member
        # Read-only share: visible, not editable.
        ro = _create(
            client, gm_headers, cid, title="Read Only", visibility="members",
            shared_user_ids=[player_id],
        ).json()
        got = client.get(f"/api/campaigns/{cid}/wiki/{ro['id']}", headers=player_headers)
        assert got.status_code == 200 and got.json()["can_edit"] is False
        assert client.patch(
            f"/api/campaigns/{cid}/wiki/{ro['id']}", json={"body": "no"}, headers=player_headers
        ).status_code == 403

        # Write share: listing the user as a writer alone is enough, since write
        # implies read.
        rw = _create(
            client, gm_headers, cid, title="Writable", visibility="members",
            shared_write_user_ids=[player_id],
        ).json()
        got = client.get(f"/api/campaigns/{cid}/wiki/{rw['id']}", headers=player_headers)
        assert got.status_code == 200 and got.json()["can_edit"] is True
        assert client.patch(
            f"/api/campaigns/{cid}/wiki/{rw['id']}", json={"body": "yes"}, headers=player_headers
        ).status_code == 200

    def test_writer_resending_unchanged_shares_may_still_save(
        self, client, gm_headers, player_headers, player_id, campaign_with_member
    ):
        # The editor resends classification only on change, but an older client
        # (or any caller) echoing back the stored lists is a no-op, not an
        # attempt to reclassify, and must not cost them their edit (issue #386).
        cid = campaign_with_member
        rw = _create(
            client, gm_headers, cid, title="Writable", visibility="members",
            shared_write_user_ids=[player_id],
        ).json()
        resp = client.patch(
            f"/api/campaigns/{cid}/wiki/{rw['id']}",
            json={
                "body": "player edit",
                "visibility": "members",
                "shared_user_ids": [player_id],
                "shared_write_user_ids": [player_id],
            },
            headers=player_headers,
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/campaigns/{cid}/wiki/{rw['id']}", headers=gm_headers).json()
        assert detail["body"] == "player edit"
        # The share rows are untouched by the pass-through save.
        assert detail["shared_write_user_ids"] == [player_id]

    def test_group_page_save_carrying_empty_shares_is_allowed(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        # The issue #233 case: a player contributing to a GM-authored group
        # page. The page has no shares, and the payload carries [] for both.
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Party KB", visibility="group").json()
        resp = client.patch(
            f"/api/campaigns/{cid}/wiki/{page['id']}",
            json={
                "body": "player contribution",
                "visibility": "group",
                "shared_user_ids": [],
                "shared_write_user_ids": [],
            },
            headers=player_headers,
        )
        assert resp.status_code == 200

    def test_non_author_still_cannot_actually_change_shares(
        self, client, gm_headers, player_headers, player_id, admin_id, campaign_with_member
    ):
        # The no-op allowance must not become a way in: a real diff to the share
        # lists is still the author's alone.
        cid = campaign_with_member
        rw = _create(
            client, gm_headers, cid, title="Writable", visibility="members",
            shared_write_user_ids=[player_id],
        ).json()
        resp = client.patch(
            f"/api/campaigns/{cid}/wiki/{rw['id']}",
            json={"shared_user_ids": [player_id, admin_id]},
            headers=player_headers,
        )
        assert resp.status_code == 403
        # Demoting themselves to read-only is a change too, and equally refused.
        assert client.patch(
            f"/api/campaigns/{cid}/wiki/{rw['id']}",
            json={"shared_write_user_ids": []},
            headers=player_headers,
        ).status_code == 403

    def test_author_can_still_change_shares(
        self, client, gm_headers, player_id, admin_id, campaign_with_member
    ):
        cid = campaign_with_member
        rw = _create(
            client, gm_headers, cid, title="Writable", visibility="members",
            shared_write_user_ids=[player_id],
        ).json()
        resp = client.patch(
            f"/api/campaigns/{cid}/wiki/{rw['id']}",
            json={"shared_user_ids": [player_id, admin_id]},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/campaigns/{cid}/wiki/{rw['id']}", headers=gm_headers).json()
        assert sorted(detail["shared_user_ids"]) == sorted([player_id, admin_id])

    def test_resending_an_unchanged_unwritable_parent_is_allowed(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        # Same shape as the sharing gate: re-nesting under a parent you may not
        # write is refused, but leaving the page where it already sits is not a
        # re-nest and must not block an otherwise legitimate edit (issue #386).
        cid = campaign_with_member
        parent = _create(client, gm_headers, cid, title="GM Only", visibility="gm").json()
        child = _create(
            client, gm_headers, cid, title="Public Child", visibility="group",
            parent_id=parent["id"],
        ).json()
        resp = client.patch(
            f"/api/campaigns/{cid}/wiki/{child['id']}",
            json={"body": "player edit", "parent_id": parent["id"]},
            headers=player_headers,
        )
        assert resp.status_code == 200

    def test_moving_under_an_unwritable_parent_is_still_refused(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        parent = _create(client, gm_headers, cid, title="GM Only", visibility="gm").json()
        loose = _create(client, gm_headers, cid, title="Loose", visibility="group").json()
        # An unreadable parent reports "invalid" rather than "forbidden" so the
        # response doesn't confirm the hidden page exists.
        assert client.patch(
            f"/api/campaigns/{cid}/wiki/{loose['id']}",
            json={"parent_id": parent["id"]},
            headers=player_headers,
        ).status_code == 400

    def test_share_lists_are_not_exposed_to_readers(
        self, client, gm_headers, player_headers, player_id, campaign_with_member
    ):
        # Who else holds access is the author's business; a reader shouldn't be
        # able to enumerate it.
        cid = campaign_with_member
        page = _create(
            client, gm_headers, cid, title="Shared", visibility="members",
            shared_user_ids=[player_id],
        ).json()
        got = client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=player_headers).json()
        assert got["shared_user_ids"] == []
        author_view = client.get(
            f"/api/campaigns/{cid}/wiki/{page['id']}", headers=gm_headers
        ).json()
        assert author_view["shared_user_ids"] == [player_id]

    def test_cannot_nest_under_a_page_without_write_access(
        self, client, gm_headers, player_headers, player_id, campaign_with_member
    ):
        # A note may not be created under a private page the user only reads.
        cid = campaign_with_member
        parent = _create(
            client, gm_headers, cid, title="Read Only Parent", visibility="members",
            shared_user_ids=[player_id],
        ).json()
        denied = _create(
            client, player_headers, cid, title="Child", visibility="group",
            parent_id=parent["id"],
        )
        assert denied.status_code == 403
        # A page they can't see at all reads as an invalid parent rather than
        # confirming it exists.
        unseen = _create(client, gm_headers, cid, title="Hidden Parent", visibility="gm").json()
        assert _create(
            client, player_headers, cid, title="Child2", visibility="group",
            parent_id=unseen["id"],
        ).status_code == 400
        # But a public parent is fair game.
        public = _create(client, gm_headers, cid, title="Public Parent", visibility="group").json()
        assert _create(
            client, player_headers, cid, title="Child3", visibility="group",
            parent_id=public["id"],
        ).status_code == 201


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

    def test_secrets_are_gm_only_not_author_only(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        """A ||secret|| is the GM's, whoever wrote the page around it.

        Secrets hide text *from players*, so they are keyed on campaign
        ownership and not on authorship: the GM can annotate a player-authored
        page with notes that page's own author cannot read. The permission
        rework made every visibility level author-relative (issues #232/#233);
        this mechanism deliberately did not follow.

        The other direction — a player *typing* ``||`` — is not the mirror of
        this. Rather than granting them a secret they'd then be unable to see,
        their pipes are escaped to literal text; see
        ``test_player_pipes_are_stored_as_literal_text``.
        """
        cid = campaign_with_member
        # The player authors the page; the GM adds the secret.
        page = _create(
            client, player_headers, cid, title="Player Log", body="placeholder",
            visibility="group",
        ).json()
        self._patch(client, cid, page["id"], self.BODY, gm_headers)
        # The GM sees their own secret, markers and all.
        assert self._get(client, cid, page["id"], gm_headers)["body"] == self.BODY
        # The page's author does not.
        theirs = self._get(client, cid, page["id"], player_headers)["body"]
        assert "doppelganger" not in theirs
        assert "||" not in theirs

    def test_player_cannot_hide_text_from_the_gm_in_their_own_page(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        # The same rule on the write path: a player saving ||pipes|| does not get
        # a private channel inside a shared page. The text reaches the GM, as
        # escaped literal characters rather than as a secret span.
        cid = campaign_with_member
        page = _create(client, player_headers, cid, title="Log", visibility="group").json()
        self._patch(client, cid, page["id"], "Plain. ||hidden from the gm||", player_headers)
        gm_body = self._get(client, cid, page["id"], gm_headers)["body"]
        assert "hidden from the gm" in gm_body
        assert "||hidden from the gm||" not in gm_body  # not stored as a secret

    def test_player_pipes_are_stored_as_literal_text(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        """A player's ||pipes|| are escaped, not honoured and not dropped.

        Honouring them would store a real secret that the very next read strips
        from its author's view — the player writes a sentence, saves, and watches
        it vanish. Escaping keeps what they typed on screen for them, and stops
        the text ever being mistaken for a GM secret.
        """
        cid = campaign_with_member
        page = _create(
            client, player_headers, cid, title="Log", visibility="group",
            body="Plain ||not a secret|| tail",
        ).json()
        # The words survive for the player who wrote them...
        theirs = self._get(client, cid, page["id"], player_headers)["body"]
        assert "not a secret" in theirs
        # ...and the pipes are inert: escaped, so nothing reads as a secret span.
        assert "||" not in theirs
        assert r"\|\|" in theirs
        # The GM sees the same literal text, not a secret.
        assert "not a secret" in self._get(client, cid, page["id"], gm_headers)["body"]

    def test_player_pipes_on_update_are_escaped_too(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        page = _create(client, player_headers, cid, title="Log", visibility="group").json()
        self._patch(client, cid, page["id"], "Body ||mine|| end", player_headers)
        theirs = self._get(client, cid, page["id"], player_headers)["body"]
        assert "mine" in theirs and "||" not in theirs

    def test_escaping_a_players_pipes_does_not_disturb_gm_secrets(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        # The two mechanisms coexist on one page: the GM's secret is re-woven in
        # and stays hidden, while the player's own pipes become literal text.
        cid = campaign_with_member
        page = _create(client, player_headers, cid, title="Log", visibility="group").json()
        self._patch(client, cid, page["id"], "Intro. ||gm hidden|| Outro.", gm_headers)
        seen = self._get(client, cid, page["id"], player_headers)["body"]
        assert "gm hidden" not in seen

        # The player edits, typing pipes of their own.
        self._patch(client, cid, page["id"], seen.replace("Outro.", "Outro ||mine||."), player_headers)
        gm_body = self._get(client, cid, page["id"], gm_headers)["body"]
        # The GM's secret survived the player's edit...
        assert "||gm hidden||" in gm_body
        # ...and the player's pipes are inert text, not a second secret.
        assert r"\|\|mine\|\|" in gm_body
        # The player still can't see the GM's secret, but keeps their own words.
        after = self._get(client, cid, page["id"], player_headers)["body"]
        assert "gm hidden" not in after and "mine" in after

    def test_player_pipes_escape_is_idempotent_across_saves(
        self, client, player_headers, campaign_with_member
    ):
        # Re-saving must not stack backslashes on text that is already escaped.
        cid = campaign_with_member
        page = _create(
            client, player_headers, cid, title="Log", visibility="group",
            body="A ||b|| c",
        ).json()
        first = self._get(client, cid, page["id"], player_headers)["body"]
        self._patch(client, cid, page["id"], first, player_headers)
        assert self._get(client, cid, page["id"], player_headers)["body"] == first

    def test_markdown_tables_survive_a_player_edit(
        self, client, player_headers, campaign_with_member
    ):
        # Single pipes are ordinary markdown (tables!) and must not be touched —
        # only runs of two or more are the secret marker.
        cid = campaign_with_member
        table = "| Name | HP |\n|------|----|\n| Bob  | 12 |"
        page = _create(
            client, player_headers, cid, title="Statblock", visibility="group", body=table,
        ).json()
        assert self._get(client, cid, page["id"], player_headers)["body"] == table

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
        Returns (page_id, player's clean stripped view of the body).

        Secrets are GM-only regardless of who wrote the page they sit in, so the
        GM can annotate a player's session log with hidden notes and the player —
        the page's own author — still never sees them.
        """
        page = _create(
            client, player_headers, cid, title=f"Log {uid()}", body="placeholder",
            visibility="group",
        ).json()
        pid = page["id"]
        assert self._patch(client, cid, pid, body, gm_headers).status_code == 200
        seen = self._get(client, cid, pid, player_headers)["body"]
        # Sanity: the player's copy never contains the secret or a marker, even
        # though they authored the page.
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

    def test_player_reorder_leaves_invisible_pages_in_place(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        """A player's drag must not renumber the pages they cannot see.

        sort_order is global but the player sees a subset, so their submitted
        list is applied relative to the slots the pages they moved already
        occupied. The GM's own view of the pages the player never saw has to come
        back unchanged.
        """
        cid = campaign_with_member
        # Interleave GM-only and public pages, then fix a known global order.
        secret1 = _create(client, gm_headers, cid, title="Secret One", visibility="gm").json()
        pub_a = _create(client, gm_headers, cid, title="Public A", visibility="group").json()
        secret2 = _create(client, gm_headers, cid, title="Secret Two", visibility="gm").json()
        pub_b = _create(client, gm_headers, cid, title="Public B", visibility="group").json()
        client.put(
            f"/api/campaigns/{cid}/wiki/reorder",
            json={"ordered_ids": [secret1["id"], pub_a["id"], secret2["id"], pub_b["id"]]},
            headers=gm_headers,
        )

        # The player sees only the two public pages, and swaps them.
        visible = [
            p["id"] for p in client.get(f"/api/campaigns/{cid}/wiki", headers=player_headers).json()
        ]
        assert visible == [pub_a["id"], pub_b["id"]]
        assert client.put(
            f"/api/campaigns/{cid}/wiki/reorder",
            json={"ordered_ids": [pub_b["id"], pub_a["id"]]},
            headers=player_headers,
        ).status_code == 200

        # The swap took effect for the player...
        after = [
            p["id"] for p in client.get(f"/api/campaigns/{cid}/wiki", headers=player_headers).json()
        ]
        assert after == [pub_b["id"], pub_a["id"]]
        # ...and for the GM the secret pages still bracket them exactly as before:
        # only the two public pages traded places.
        gm_order = [
            p["id"] for p in client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        ]
        assert gm_order == [secret1["id"], pub_b["id"], secret2["id"], pub_a["id"]]

    def test_reorder_skips_pages_the_user_cannot_write(
        self, client, gm_headers, player_headers, player_id, campaign_with_member
    ):
        # A page shared read-only holds its slot even if the client asks to move it.
        cid = campaign_with_member
        ro = _create(
            client, gm_headers, cid, title="Read Only", visibility="members",
            shared_user_ids=[player_id],
        ).json()
        mine = _create(client, player_headers, cid, title="Mine", visibility="group").json()
        client.put(
            f"/api/campaigns/{cid}/wiki/reorder",
            json={"ordered_ids": [ro["id"], mine["id"]]},
            headers=gm_headers,
        )
        before = [
            p["id"] for p in client.get(f"/api/campaigns/{cid}/wiki", headers=player_headers).json()
        ]
        assert before == [ro["id"], mine["id"]]
        # The player tries to pull their page above the read-only one. Their own
        # page is movable but the read-only one isn't, so it keeps its slot and
        # the order is unchanged.
        assert client.put(
            f"/api/campaigns/{cid}/wiki/reorder",
            json={"ordered_ids": [mine["id"], ro["id"]]},
            headers=player_headers,
        ).status_code == 200
        after = [
            p["id"] for p in client.get(f"/api/campaigns/{cid}/wiki", headers=player_headers).json()
        ]
        assert after == [ro["id"], mine["id"]]


class TestWikiHiddenPages:
    """Per-user hiding: declutter my own view without touching anyone else's."""

    def test_hide_removes_from_my_list_only(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Clutter", visibility="group").json()
        assert client.post(
            f"/api/campaigns/{cid}/wiki/{page['id']}/hide", headers=player_headers
        ).status_code == 200

        player_list = client.get(f"/api/campaigns/{cid}/wiki", headers=player_headers).json()
        assert not any(p["id"] == page["id"] for p in player_list)
        # The GM's view is untouched — hiding is not deleting.
        gm_list = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        assert any(p["id"] == page["id"] for p in gm_list)
        # The page itself is still readable by its direct URL.
        got = client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=player_headers)
        assert got.status_code == 200 and got.json()["is_hidden"] is True

    def test_include_hidden_lists_them_again(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Clutter", visibility="group").json()
        client.post(f"/api/campaigns/{cid}/wiki/{page['id']}/hide", headers=player_headers)
        listed = client.get(
            f"/api/campaigns/{cid}/wiki?include_hidden=true", headers=player_headers
        ).json()
        row = next(p for p in listed if p["id"] == page["id"])
        assert row["is_hidden"] is True

    def test_unhide_restores(self, client, gm_headers, player_headers, campaign_with_member):
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Clutter", visibility="group").json()
        client.post(f"/api/campaigns/{cid}/wiki/{page['id']}/hide", headers=player_headers)
        assert client.delete(
            f"/api/campaigns/{cid}/wiki/{page['id']}/hide", headers=player_headers
        ).status_code == 200
        listed = client.get(f"/api/campaigns/{cid}/wiki", headers=player_headers).json()
        assert any(p["id"] == page["id"] for p in listed)

    def test_hiding_a_parent_hides_its_descendants(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        parent = _create(client, gm_headers, cid, title="Parent", visibility="group").json()
        child = _create(
            client, gm_headers, cid, title="Child", visibility="group", parent_id=parent["id"]
        ).json()
        grandchild = _create(
            client, gm_headers, cid, title="Grandchild", visibility="group", parent_id=child["id"]
        ).json()
        client.post(f"/api/campaigns/{cid}/wiki/{parent['id']}/hide", headers=player_headers)

        listed = {p["id"] for p in client.get(
            f"/api/campaigns/{cid}/wiki", headers=player_headers
        ).json()}
        assert parent["id"] not in listed
        assert child["id"] not in listed
        assert grandchild["id"] not in listed

    def test_hidden_pages_are_excluded_from_search(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        page = _create(
            client, gm_headers, cid, title="Findable", body="needle", visibility="group"
        ).json()
        assert client.get(
            f"/api/campaigns/{cid}/wiki/search?q=needle", headers=player_headers
        ).json()["results"]
        client.post(f"/api/campaigns/{cid}/wiki/{page['id']}/hide", headers=player_headers)
        assert client.get(
            f"/api/campaigns/{cid}/wiki/search?q=needle", headers=player_headers
        ).json()["results"] == []

    def test_cannot_hide_a_page_you_cannot_see(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        secret = _create(client, gm_headers, cid, title="Secret", visibility="gm").json()
        assert client.post(
            f"/api/campaigns/{cid}/wiki/{secret['id']}/hide", headers=player_headers
        ).status_code == 403

    def test_mine_filter_returns_only_my_pages(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        _create(client, gm_headers, cid, title="Theirs", visibility="group")
        mine = _create(client, player_headers, cid, title="Mine", visibility="group").json()
        listed = client.get(f"/api/campaigns/{cid}/wiki?mine=true", headers=player_headers).json()
        assert [p["id"] for p in listed] == [mine["id"]]


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
