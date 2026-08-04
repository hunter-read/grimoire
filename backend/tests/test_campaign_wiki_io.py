"""Tests for campaign wiki import / export (markdown, JSON, LegendKeeper)."""
import io
import json
import uuid
import zipfile


def uid():
    return uuid.uuid4().hex[:8]


def _campaign(client, gm_headers):
    resp = client.post(
        "/api/campaigns",
        json={"name": f"IO {uid()}", "is_gm_campaign": True},
        headers=gm_headers,
    )
    assert resp.status_code == 201
    return resp.json()


def _create(client, headers, cid, **kwargs):
    return client.post(f"/api/campaigns/{cid}/wiki", json=kwargs, headers=headers)


def _import(client, headers, cid, filename, content, content_type):
    if isinstance(content, str):
        content = content.encode("utf-8")
    return client.post(
        f"/api/campaigns/{cid}/wiki/import",
        files={"file": (filename, content, content_type)},
        headers=headers,
    )


class TestExport:
    def test_export_markdown_zip(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        _create(client, gm_headers, c["id"], title="The Tavern", body="A cozy inn.")
        resp = client.get(
            f"/api/campaigns/{c['id']}/wiki/export?format=md", headers=gm_headers
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        assert "the-tavern.md" in zf.namelist()
        text = zf.read("the-tavern.md").decode()
        assert "title: The Tavern" in text
        assert "A cozy inn." in text

    def test_export_json_bundle(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        _create(client, gm_headers, c["id"], title="Dragon", body="Big and red.")
        resp = client.get(
            f"/api/campaigns/{c['id']}/wiki/export?format=json", headers=gm_headers
        )
        assert resp.status_code == 200
        bundle = resp.json()
        assert bundle["grimoire_wiki_version"] == 1
        titles = [p["title"] for p in bundle["pages"]]
        assert "Dragon" in titles

    def test_export_requires_owner(self, client, gm_headers, player_headers, player_id):
        c = _campaign(client, gm_headers)
        client.post(
            f"/api/campaigns/{c['id']}/invite", json={"user_id": player_id}, headers=gm_headers
        )
        client.patch(
            f"/api/campaigns/{c['id']}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        resp = client.get(
            f"/api/campaigns/{c['id']}/wiki/export?format=md", headers=player_headers
        )
        assert resp.status_code == 403


class TestImportMarkdown:
    def test_import_single_md_title_from_heading(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import(
            client, gm_headers, c["id"], "notes.md",
            "# The Keep\n\nStone walls everywhere.", "text/markdown",
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["imported"] == 1
        page = resp.json()["pages"][0]
        assert page["title"] == "The Keep"
        assert page["slug"] == "the-keep"

    def test_import_md_title_from_frontmatter(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        body = '---\ntitle: "Captain: Vex"\nvisibility: group\n---\n\nA pirate.'
        resp = _import(client, gm_headers, c["id"], "x.md", body, "text/markdown")
        assert resp.status_code == 201
        page = resp.json()["pages"][0]
        assert page["title"] == "Captain: Vex"
        assert page["visibility"] == "group"

    def test_import_md_title_from_filename(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import(client, gm_headers, c["id"], "Old Mill.md", "just text", "text/markdown")
        assert resp.status_code == 201
        assert resp.json()["pages"][0]["title"] == "Old Mill"


class TestImportJsonRoundTrip:
    def test_round_trip_json_preserves_links(self, client, gm_headers):
        a = _campaign(client, gm_headers)
        # Create Sidekick first so the [[Sidekick]] link resolves to it rather than
        # auto-creating a stub (which would make this a 3-page export).
        _create(client, gm_headers, a["id"], title="Sidekick", body="Helps the Hero.")
        _create(client, gm_headers, a["id"], title="Hero", body="Friend of [[Sidekick]].")
        bundle = client.get(
            f"/api/campaigns/{a['id']}/wiki/export?format=json", headers=gm_headers
        ).content

        b = _campaign(client, gm_headers)
        resp = _import(
            client, gm_headers, b["id"], "wiki.json", bundle, "application/json"
        )
        assert resp.status_code == 201
        assert resp.json()["format"] == "grimoire-json"
        assert resp.json()["imported"] == 2

        pages = client.get(f"/api/campaigns/{b['id']}/wiki", headers=gm_headers).json()
        hero = next(p for p in pages if p["title"] == "Hero")
        full = client.get(
            f"/api/campaigns/{b['id']}/wiki/{hero['id']}", headers=gm_headers
        ).json()
        assert "[[Sidekick]]" in full["body"]
        # Sidekick should have Hero as a backlink, proving links were rebuilt.
        sidekick = next(p for p in pages if p["title"] == "Sidekick")
        sk_full = client.get(
            f"/api/campaigns/{b['id']}/wiki/{sidekick['id']}", headers=gm_headers
        ).json()
        assert any(b["title"] == "Hero" for b in sk_full["backlinks"])

    def test_import_preserves_parent_nesting(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        bundle = {
            "grimoire_wiki_version": 1,
            "campaign": "X",
            "pages": [
                {"title": "Bestiary", "slug": "bestiary", "body": ""},
                {"title": "Goblin", "slug": "goblin", "body": "Sneaky.", "parent": "bestiary"},
            ],
        }
        resp = _import(
            client, gm_headers, c["id"], "w.json",
            json.dumps(bundle), "application/json",
        )
        assert resp.status_code == 201
        pages = client.get(f"/api/campaigns/{c['id']}/wiki", headers=gm_headers).json()
        bestiary = next(p for p in pages if p["title"] == "Bestiary")
        goblin = next(p for p in pages if p["title"] == "Goblin")
        assert goblin["parent_id"] == bestiary["id"]
        assert bestiary["parent_id"] is None


class TestImportLegendKeeper:
    def test_import_lk_single_page_html_to_md(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        lk_page = {
            "id": "abc123",
            "name": "Waterdeep",
            "parentId": None,
            "documents": [
                {
                    "content": "<div class='lk-tab' id='t1'><h1>Waterdeep</h1>"
                    "<p>A great <strong>city</strong>.</p>"
                    "<div data-node-type='secret'>hidden lore</div></div>"
                }
            ],
        }
        resp = _import(
            client, gm_headers, c["id"], "page.json",
            json.dumps(lk_page), "application/json",
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["format"] == "legendkeeper"
        page = resp.json()["pages"][0]
        full = client.get(
            f"/api/campaigns/{c['id']}/wiki/{page['id']}", headers=gm_headers
        ).json()
        assert "# Waterdeep" in full["body"]
        assert "**city**" in full["body"]
        # Secret block stripped.
        assert "hidden lore" not in full["body"]

    def test_import_lk_link_to_wikilink(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        objs = [
            {
                "id": "aaaa",
                "name": "Castle",
                "parentId": None,
                "documents": [
                    {
                        "content": "<div class='lk-tab' id='t'><p>Home of the "
                        "<a href=\"bbbb.html\">Baron</a>.</p></div>"
                    }
                ],
            },
            {
                "id": "bbbb",
                "name": "Baron",
                "parentId": None,
                "documents": [{"content": "<div class='lk-tab' id='t'><p>A noble.</p></div>"}],
            },
        ]
        # Pack as a LegendKeeper-style zip directory with an index.json to skip.
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("index.json", json.dumps({"ignored": True}))
            for o in objs:
                zf.writestr(f"{o['id']}.json", json.dumps(o))
        resp = _import(
            client, gm_headers, c["id"], "wiki.zip", buf.getvalue(), "application/zip"
        )
        assert resp.status_code == 201
        assert resp.json()["imported"] == 2
        pages = client.get(f"/api/campaigns/{c['id']}/wiki", headers=gm_headers).json()
        castle = next(p for p in pages if p["title"] == "Castle")
        full = client.get(
            f"/api/campaigns/{c['id']}/wiki/{castle['id']}", headers=gm_headers
        ).json()
        assert "[[Baron]]" in full["body"]


def _lk_bundle():
    """A LegendKeeper bundle export: a page, a child category page with a table,
    and a grandchild — bodies as ProseMirror JSON, hierarchy via parentId."""
    return {
        "version": 1,
        "exportId": "abc",
        "resources": [
            {
                "id": "magic",
                "name": "Magic Items",
                "documents": [
                    {
                        "id": "d1",
                        "content": {
                            "type": "doc",
                            "content": [
                                {
                                    "type": "heading",
                                    "attrs": {"level": 1},
                                    "content": [{"type": "text", "text": "Attunement"}],
                                },
                                {
                                    "type": "paragraph",
                                    "content": [
                                        {"type": "text", "text": "Cast "},
                                        {
                                            "type": "mention",
                                            "attrs": {"id": "x", "text": "Identify"},
                                        },
                                        {"type": "text", "text": " to learn more."},
                                    ],
                                },
                            ],
                        },
                    }
                ],
            },
            {
                "id": "potions",
                "name": "Potions",
                "parentId": "magic",
                "documents": [
                    {
                        "id": "d2",
                        "content": {
                            "type": "doc",
                            "content": [
                                {
                                    "type": "table",
                                    "content": [
                                        {
                                            "type": "tableRow",
                                            "content": [
                                                {
                                                    "type": "tableHeader",
                                                    "content": [
                                                        {
                                                            "type": "paragraph",
                                                            "content": [
                                                                {"type": "text", "text": "Roll"}
                                                            ],
                                                        }
                                                    ],
                                                },
                                                {
                                                    "type": "tableHeader",
                                                    "content": [
                                                        {
                                                            "type": "paragraph",
                                                            "content": [
                                                                {"type": "text", "text": "Result"}
                                                            ],
                                                        }
                                                    ],
                                                },
                                            ],
                                        },
                                        {
                                            "type": "tableRow",
                                            "content": [
                                                {
                                                    "type": "tableCell",
                                                    "content": [
                                                        {
                                                            "type": "paragraph",
                                                            "content": [
                                                                {"type": "text", "text": "01"}
                                                            ],
                                                        }
                                                    ],
                                                },
                                                {
                                                    "type": "tableCell",
                                                    "content": [
                                                        {
                                                            "type": "paragraph",
                                                            "content": [
                                                                {"type": "text", "text": "Boom."}
                                                            ],
                                                        }
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                }
                            ],
                        },
                    }
                ],
            },
            {
                "id": "healing",
                "name": "Potion of Healing",
                "parentId": "potions",
                "documents": [
                    {
                        "id": "d3",
                        "content": {
                            "type": "doc",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [
                                        {
                                            "type": "text",
                                            "text": "Potion, Rarity Varies",
                                            "marks": [{"type": "em"}],
                                        }
                                    ],
                                }
                            ],
                        },
                    }
                ],
            },
        ],
    }


class TestImportLegendKeeperBundle:
    def test_import_bundle_hierarchy_and_prosemirror(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import(
            client, gm_headers, c["id"], "Magic Items.json",
            json.dumps(_lk_bundle()), "application/json",
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["format"] == "legendkeeper"
        assert resp.json()["imported"] == 3

        pages = client.get(f"/api/campaigns/{c['id']}/wiki", headers=gm_headers).json()
        by_title = {p["title"]: p for p in pages}
        # Three-level hierarchy preserved via parent_id.
        assert by_title["Magic Items"]["parent_id"] is None
        assert by_title["Potions"]["parent_id"] == by_title["Magic Items"]["id"]
        assert by_title["Potion of Healing"]["parent_id"] == by_title["Potions"]["id"]

        # ProseMirror heading + mention -> markdown heading + [[wikilink]].
        magic = client.get(
            f"/api/campaigns/{c['id']}/wiki/{by_title['Magic Items']['id']}", headers=gm_headers
        ).json()
        assert "# Attunement" in magic["body"]
        assert "[[Identify]]" in magic["body"]

        # Table converted to a GitHub-flavored markdown table.
        potions = client.get(
            f"/api/campaigns/{c['id']}/wiki/{by_title['Potions']['id']}", headers=gm_headers
        ).json()
        assert "| Roll | Result |" in potions["body"]
        assert "| 01 | Boom. |" in potions["body"]

    def test_import_bundle_as_lk_extension(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import(
            client, gm_headers, c["id"], "export.lk",
            json.dumps(_lk_bundle()), "application/octet-stream",
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["imported"] == 3


class TestImportConflicts:
    def test_import_does_not_overwrite_existing(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        _create(client, gm_headers, c["id"], title="Inn", body="Original body.")
        resp = _import(
            client, gm_headers, c["id"], "inn.md",
            "# Inn\n\nImported body.", "text/markdown",
        )
        assert resp.status_code == 201
        new_page = resp.json()["pages"][0]
        assert new_page["slug"] == "inn-2"
        pages = client.get(f"/api/campaigns/{c['id']}/wiki", headers=gm_headers).json()
        assert len(pages) == 2

    def test_import_requires_owner(self, client, gm_headers, player_headers, player_id):
        c = _campaign(client, gm_headers)
        client.post(
            f"/api/campaigns/{c['id']}/invite", json={"user_id": player_id}, headers=gm_headers
        )
        client.patch(
            f"/api/campaigns/{c['id']}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        resp = _import(
            client, player_headers, c["id"], "x.md", "# Nope", "text/markdown"
        )
        assert resp.status_code == 403

    def test_import_rejects_garbage(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import(
            client, gm_headers, c["id"], "bad.json", "not json at all", "application/json"
        )
        assert resp.status_code == 400


class TestImportExportIconColor:
    def test_markdown_round_trip_preserves_icon_and_color(self, client, gm_headers):
        """A tinted emoji icon survives export → import unchanged."""
        src = _campaign(client, gm_headers)
        _create(
            client,
            gm_headers,
            src["id"],
            title="Dragon Lair",
            body="Deep below.",
            icon="🐉",
            icon_color="red",
        )
        export = client.get(
            f"/api/campaigns/{src['id']}/wiki/export?format=md", headers=gm_headers
        )
        assert export.status_code == 200

        dest = _campaign(client, gm_headers)
        resp = _import(
            client, gm_headers, dest["id"], "wiki.zip", export.content, "application/zip"
        )
        assert resp.status_code == 201, resp.text
        pages = client.get(f"/api/campaigns/{dest['id']}/wiki", headers=gm_headers).json()
        page = next(p for p in pages if p["title"] == "Dragon Lair")
        assert page["icon"] == "🐉"
        assert page["icon_color"] == "red"

    def test_json_round_trip_preserves_icon_color(self, client, gm_headers):
        src = _campaign(client, gm_headers)
        _create(
            client, gm_headers, src["id"], title="Tinted", icon="castle", icon_color="#a1b2c3"
        )
        export = client.get(
            f"/api/campaigns/{src['id']}/wiki/export?format=json", headers=gm_headers
        )
        bundle = json.loads(export.content)
        assert bundle["pages"][0]["icon_color"] == "#a1b2c3"

        dest = _campaign(client, gm_headers)
        resp = _import(
            client, gm_headers, dest["id"], "wiki.json", export.content, "application/json"
        )
        assert resp.status_code == 201
        pages = client.get(f"/api/campaigns/{dest['id']}/wiki", headers=gm_headers).json()
        page = next(p for p in pages if p["title"] == "Tinted")
        assert page["icon_color"] == "#a1b2c3"

    def test_import_drops_unacceptable_icon_color(self, client, gm_headers):
        """Imported files are untrusted: a tint we'd reject over the API is dropped,
        not stored, since it ends up in a style attribute."""
        c = _campaign(client, gm_headers)
        md = (
            "---\n"
            "title: Sneaky\n"
            "visibility: gm\n"
            "icon: castle\n"
            "icon_color: red; background: url(evil)\n"
            "---\n\n"
            "Body.\n"
        )
        resp = _import(client, gm_headers, c["id"], "sneaky.md", md, "text/markdown")
        assert resp.status_code == 201
        pages = client.get(f"/api/campaigns/{c['id']}/wiki", headers=gm_headers).json()
        page = next(p for p in pages if p["title"] == "Sneaky")
        assert page["icon_color"] is None
        # The rest of the frontmatter still imports.
        assert page["icon"] == "castle"

    def test_import_json_bundle_ignores_non_string_icon_color(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        bundle = {
            "grimoire_wiki_version": 1,
            "campaign": "X",
            "pages": [
                {
                    "title": "Weird",
                    "slug": "weird",
                    "body": "b",
                    "visibility": "gm",
                    "icon": "castle",
                    "icon_color": {"nope": True},
                    "parent": None,
                }
            ],
        }
        resp = _import(
            client,
            gm_headers,
            c["id"],
            "wiki.json",
            json.dumps(bundle),
            "application/json",
        )
        assert resp.status_code == 201
        pages = client.get(f"/api/campaigns/{c['id']}/wiki", headers=gm_headers).json()
        assert next(p for p in pages if p["title"] == "Weird")["icon_color"] is None
