"""Tests for identity-based [[wiki links]] — the `:id-` and `:#Heading` suffixes.

Covers the three scenarios in issue #287 (duplicate titles, delete/recreate,
rename) plus heading targets from issue #279.
"""
import uuid

import pytest

from backend.routers.campaigns.wikilinks import (
    build_target,
    extract_headings,
    find_heading,
    parse_page_links,
    parse_target,
)


def uid():
    return uuid.uuid4().hex[:8]


@pytest.fixture()
def gm_campaign(client, gm_headers):
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Links {uid()}", "is_gm_campaign": True},
        headers=gm_headers,
    )
    assert resp.status_code == 201
    return resp.json()


def _create(client, headers, cid, **kwargs):
    return client.post(f"/api/campaigns/{cid}/wiki", json=kwargs, headers=headers)


def _get(client, headers, cid, pid):
    return client.get(f"/api/campaigns/{cid}/wiki/{pid}", headers=headers).json()


class TestParseTarget:
    def test_plain_title(self):
        assert parse_target("Ancient Ruins") == ("Ancient Ruins", None, None)

    def test_id_suffix(self):
        assert parse_target("Ancient Ruins:id-abc123") == ("Ancient Ruins", "abc123", None)

    def test_heading_suffix(self):
        assert parse_target("Ancient Ruins:#Loot") == ("Ancient Ruins", None, "Loot")

    def test_id_and_heading(self):
        assert parse_target("Ruins:id-abc123:#Loot") == ("Ruins", "abc123", "Loot")

    def test_title_containing_a_colon_is_left_alone(self):
        # The suffixes are matched by shape, so an ordinary colon in a title is
        # not mistaken for a separator.
        assert parse_target("Ancient Ruins: The Depths") == (
            "Ancient Ruins: The Depths",
            None,
            None,
        )

    def test_title_with_colon_plus_real_suffixes(self):
        assert parse_target("Ruins: The Depths:id-x1:#Loot") == (
            "Ruins: The Depths",
            "x1",
            "Loot",
        )

    def test_heading_starting_with_hash_needs_no_escape(self):
        # Markdown "# # of coin" is a heading whose text is "# of coin".
        assert parse_target("Prices:## of coin") == ("Prices", None, "# of coin")

    def test_heading_of_only_hashes(self):
        assert parse_target("Prices:###") == ("Prices", None, "##")

    def test_empty_heading_suffix_is_dropped(self):
        assert parse_target("Prices:#") == ("Prices", None, None)

    def test_id_like_text_mid_title_is_not_a_suffix(self):
        # ":id-" only counts at the very end (before an optional :#Heading).
        assert parse_target("Rules:id-42 and more") == ("Rules:id-42 and more", None, None)

    def test_round_trips_through_build_target(self):
        for title, pid, heading in [
            ("Ruins", None, None),
            ("Ruins", "abc", None),
            ("Ruins", None, "Loot"),
            ("Ruins", "abc", "Loot"),
            ("Ruins: Deep", "abc", "# of coin"),
        ]:
            assert parse_target(build_target(title, pid, heading)) == (title, pid, heading)


class TestParsePageLinks:
    def test_skips_embeds(self):
        links = parse_page_links("[[book:abc:5]] and [[map:xyz]] and [[Real Page]]")
        assert [link.title for link in links] == ["Real Page"]

    def test_distinct_by_identity_not_text(self):
        # Same page via two headings collapses to one link row target.
        links = parse_page_links("[[Ruins:#A]] then [[Ruins:#B]]")
        assert len(links) == 1

    def test_pinned_and_unpinned_are_separate_targets(self):
        links = parse_page_links("[[Ruins]] and [[Ruins:id-xyz]]")
        assert len(links) == 2


class TestHeadingExtraction:
    def test_extracts_atx_headings_with_levels(self):
        body = "# Top\n\ntext\n\n## Sub\n\n### Deep"
        assert extract_headings(body) == [
            {"text": "Top", "level": 1},
            {"text": "Sub", "level": 2},
            {"text": "Deep", "level": 3},
        ]

    def test_ignores_headings_inside_fenced_code(self):
        body = "# Real\n\n```\n# not a heading\n```\n\n## Also Real"
        assert [h["text"] for h in extract_headings(body)] == ["Real", "Also Real"]

    def test_strips_closing_hashes(self):
        assert extract_headings("## Balanced ##") == [{"text": "Balanced", "level": 2}]

    def test_heading_text_may_start_with_hash(self):
        assert extract_headings("# # of coin") == [{"text": "# of coin", "level": 1}]

    def test_find_heading_prefers_h1_over_h2(self):
        body = "## Loot\n\n# Loot\n"
        assert find_heading(body, "Loot")["level"] == 1

    def test_find_heading_takes_the_first_of_equal_level(self):
        body = "# Loot\n\nfirst\n\n# Loot\n\nsecond"
        # Both are H1; the tie breaks on document order. (Only one can win, and
        # it must be deterministic.)
        assert find_heading(body, "Loot") == {"text": "Loot", "level": 1}

    def test_find_heading_is_case_and_space_insensitive(self):
        assert find_heading("# The  Loot", "the loot") is not None

    def test_find_heading_returns_none_when_absent(self):
        assert find_heading("# Something", "Nothing") is None


class TestDuplicateTitles:
    """Issue #287 scenario 1 — two pages whose titles share a slug."""

    def test_second_page_is_addressable_by_id(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        first = _create(client, gm_headers, cid, title="Ancient Ruins", body="first").json()
        second = _create(client, gm_headers, cid, title="ancient ruins", body="second").json()
        assert first["slug"] == "ancient-ruins"
        assert second["slug"] == "ancient-ruins-2"

        # A pinned link reaches the second page, which a bare title never could.
        src = _create(
            client,
            gm_headers,
            cid,
            title="Index",
            body=f"See [[Ancient Ruins:id-{second['id']}]].",
        ).json()
        got = _get(client, gm_headers, cid, second["id"])
        assert [b["id"] for b in got["backlinks"]] == [src["id"]]
        # ...and the unpinned page keeps its own, separate backlink set.
        assert _get(client, gm_headers, cid, first["id"])["backlinks"] == []

    def test_titles_endpoint_reports_the_immediate_parent(
        self, client, gm_headers, gm_campaign
    ):
        cid = gm_campaign["id"]
        north = _create(client, gm_headers, cid, title="Northlands").json()
        south = _create(client, gm_headers, cid, title="Southmarch").json()
        _create(client, gm_headers, cid, title="Ancient Ruins", parent_id=north["id"])
        _create(client, gm_headers, cid, title="ancient ruins", parent_id=south["id"])
        titles = client.get(f"/api/campaigns/{cid}/wiki/titles", headers=gm_headers).json()
        by_id = {t["title"]: t for t in titles}
        assert by_id["Ancient Ruins"]["parent_title"] == "Northlands"
        assert by_id["ancient ruins"]["parent_title"] == "Southmarch"
        # A top-level page has no parent to qualify with.
        assert by_id["Northlands"]["parent_title"] is None

    def test_parent_title_is_hidden_when_the_parent_is_not_visible(
        self, client, gm_headers, player_headers, player_id
    ):
        c = client.post(
            "/api/campaigns",
            json={"name": f"Par {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        cid = c["id"]
        client.post(f"/api/campaigns/{cid}/invite", json={"user_id": player_id}, headers=gm_headers)
        client.patch(
            f"/api/campaigns/{cid}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        secret_parent = _create(
            client, gm_headers, cid, title="GM Only Parent", visibility="gm"
        ).json()
        _create(
            client,
            gm_headers,
            cid,
            title="Child Page",
            visibility="group",
            parent_id=secret_parent["id"],
        )
        titles = client.get(
            f"/api/campaigns/{cid}/wiki/titles", headers=player_headers
        ).json()
        child = next(t for t in titles if t["title"] == "Child Page")
        # The parent's title must not leak through the suggestion list.
        assert child["parent_title"] is None

    def test_titles_endpoint_flags_ambiguity(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        _create(client, gm_headers, cid, title="Ancient Ruins")
        _create(client, gm_headers, cid, title="ancient ruins")
        _create(client, gm_headers, cid, title="Unique Page")
        titles = client.get(f"/api/campaigns/{cid}/wiki/titles", headers=gm_headers).json()
        by_title = {t["title"]: t for t in titles}
        assert by_title["Ancient Ruins"]["ambiguous"] is True
        assert by_title["ancient ruins"]["ambiguous"] is True
        assert by_title["Unique Page"]["ambiguous"] is False
        assert all("id" in t for t in titles)


class TestDeleteAndRecreate:
    """Issue #287 scenario 2 — deleting a page then recreating it."""

    def test_recreating_by_title_restores_backlinks(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        target = _create(client, gm_headers, cid, title="The Tavern").json()
        src = _create(
            client, gm_headers, cid, title="Town", body="Visit [[The Tavern]]."
        ).json()
        assert [b["id"] for b in _get(client, gm_headers, cid, target["id"])["backlinks"]] == [
            src["id"]
        ]

        client.delete(f"/api/campaigns/{cid}/wiki/{target['id']}", headers=gm_headers)
        # Recreating under the same title relinks: the unpinned [[The Tavern]] in
        # Town resolves to the new page without Town being edited.
        again = _create(client, gm_headers, cid, title="The Tavern").json()
        assert again["slug"] == "the-tavern"  # not "the-tavern-2"
        client.patch(
            f"/api/campaigns/{cid}/wiki/{src['id']}", json={"body": "Visit [[The Tavern]]."},
            headers=gm_headers,
        )
        assert [b["id"] for b in _get(client, gm_headers, cid, again["id"])["backlinks"]] == [
            src["id"]
        ]

    def test_pinned_link_to_deleted_page_does_not_recreate_a_stub(
        self, client, gm_headers, gm_campaign
    ):
        cid = gm_campaign["id"]
        target = _create(client, gm_headers, cid, title="The Tavern").json()
        src = _create(
            client,
            gm_headers,
            cid,
            title="Town",
            body=f"Visit [[The Tavern:id-{target['id']}]].",
        ).json()
        client.delete(f"/api/campaigns/{cid}/wiki/{target['id']}", headers=gm_headers)

        # Saving the referencing page must NOT resurrect the deleted target.
        client.patch(
            f"/api/campaigns/{cid}/wiki/{src['id']}",
            json={"body": f"Visit [[The Tavern:id-{target['id']}]] still."},
            headers=gm_headers,
        )
        pages = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        assert [p["title"] for p in pages] == ["Town"]

    def test_deleting_a_target_clears_stale_backlinks_on_sources(
        self, client, gm_headers, gm_campaign
    ):
        cid = gm_campaign["id"]
        a = _create(client, gm_headers, cid, title="Page A").json()
        b = _create(client, gm_headers, cid, title="Page B", body="[[Page A]]").json()
        assert len(_get(client, gm_headers, cid, a["id"])["backlinks"]) == 1
        client.delete(f"/api/campaigns/{cid}/wiki/{a['id']}", headers=gm_headers)
        # Page B survives and simply has no outgoing resolved link any more.
        assert _get(client, gm_headers, cid, b["id"])["backlinks"] == []


class TestRename:
    """Issue #287 scenario 3 — renaming a page with inbound links."""

    def test_rename_rewrites_inbound_link_text(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        target = _create(client, gm_headers, cid, title="Old Keep").json()
        src = _create(
            client, gm_headers, cid, title="Index", body="Go to [[Old Keep]] now."
        ).json()
        client.patch(
            f"/api/campaigns/{cid}/wiki/{target['id']}",
            json={"title": "New Keep"},
            headers=gm_headers,
        )
        body = _get(client, gm_headers, cid, src["id"])["body"]
        assert body == "Go to [[New Keep]] now."
        # And the link still resolves — no stub was manufactured.
        pages = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        assert sorted(p["title"] for p in pages) == ["Index", "New Keep"]

    def test_rename_preserves_label_id_and_heading(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        target = _create(client, gm_headers, cid, title="Old Keep", body="# Loot").json()
        src = _create(
            client,
            gm_headers,
            cid,
            title="Index",
            body=f"[[Old Keep:id-{target['id']}:#Loot|the keep]]",
        ).json()
        client.patch(
            f"/api/campaigns/{cid}/wiki/{target['id']}",
            json={"title": "New Keep"},
            headers=gm_headers,
        )
        body = _get(client, gm_headers, cid, src["id"])["body"]
        assert body == f"[[New Keep:id-{target['id']}:#Loot|the keep]]"

    def test_rename_leaves_unrelated_links_alone(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        target = _create(client, gm_headers, cid, title="Old Keep").json()
        other = _create(client, gm_headers, cid, title="Other Place").json()
        src = _create(
            client,
            gm_headers,
            cid,
            title="Index",
            body="[[Old Keep]] and [[Other Place]] and [[book:abc:2]]",
        ).json()
        client.patch(
            f"/api/campaigns/{cid}/wiki/{target['id']}",
            json={"title": "New Keep"},
            headers=gm_headers,
        )
        body = _get(client, gm_headers, cid, src["id"])["body"]
        assert body == "[[New Keep]] and [[Other Place]] and [[book:abc:2]]"
        assert other["title"] == "Other Place"

    def test_slug_equivalent_rename_leaves_bodies_untouched(
        self, client, gm_headers, gm_campaign
    ):
        cid = gm_campaign["id"]
        target = _create(client, gm_headers, cid, title="the keep").json()
        src = _create(client, gm_headers, cid, title="Index", body="[[the keep]]").json()
        # "The Keep" slugifies the same, so existing link text still resolves and
        # there's no need to churn the source bodies.
        client.patch(
            f"/api/campaigns/{cid}/wiki/{target['id']}",
            json={"title": "The Keep"},
            headers=gm_headers,
        )
        assert _get(client, gm_headers, cid, src["id"])["body"] == "[[the keep]]"


class TestHeadingLinksEndpoint:
    """Issue #279 — headings offered to the autocomplete."""

    def test_titles_endpoint_returns_headings(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        _create(
            client, gm_headers, cid, title="Bestiary", body="# Goblins\n\ntext\n\n## Loot"
        )
        titles = client.get(f"/api/campaigns/{cid}/wiki/titles", headers=gm_headers).json()
        entry = next(t for t in titles if t["title"] == "Bestiary")
        assert entry["headings"] == [
            {"text": "Goblins", "level": 1},
            {"text": "Loot", "level": 2},
        ]

    def test_headings_inside_gm_secrets_are_hidden_from_players(
        self, client, gm_headers, player_headers, player_id
    ):
        c = client.post(
            "/api/campaigns",
            json={"name": f"Sec {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        cid = c["id"]
        client.post(f"/api/campaigns/{cid}/invite", json={"user_id": player_id}, headers=gm_headers)
        client.patch(
            f"/api/campaigns/{cid}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        _create(
            client,
            gm_headers,
            cid,
            title="Notes",
            body="# Public\n\n||\n# Secret Heading\n||",
            visibility="group",
        )
        gm_titles = client.get(f"/api/campaigns/{cid}/wiki/titles", headers=gm_headers).json()
        gm_entry = next(t for t in gm_titles if t["title"] == "Notes")
        assert {h["text"] for h in gm_entry["headings"]} == {"Public", "Secret Heading"}

        player_titles = client.get(
            f"/api/campaigns/{cid}/wiki/titles", headers=player_headers
        ).json()
        player_entry = next(t for t in player_titles if t["title"] == "Notes")
        assert [h["text"] for h in player_entry["headings"]] == ["Public"]

    def test_heading_link_creates_a_normal_page_link(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        target = _create(client, gm_headers, cid, title="Bestiary", body="# Goblins").json()
        src = _create(
            client, gm_headers, cid, title="Index", body="[[Bestiary:#Goblins]]"
        ).json()
        # The heading is addressing only — the link row is page-to-page, and no
        # stub page named "Bestiary:#Goblins" is created.
        assert [b["id"] for b in _get(client, gm_headers, cid, target["id"])["backlinks"]] == [
            src["id"]
        ]
        pages = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        assert sorted(p["title"] for p in pages) == ["Bestiary", "Index"]

    def test_unpinned_link_with_heading_still_autocreates_the_page(
        self, client, gm_headers, gm_campaign
    ):
        cid = gm_campaign["id"]
        _create(client, gm_headers, cid, title="Index", body="[[Brand New:#Intro]]")
        pages = client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        # The stub is named for the title alone, not the whole target.
        assert "Brand New" in [p["title"] for p in pages]
