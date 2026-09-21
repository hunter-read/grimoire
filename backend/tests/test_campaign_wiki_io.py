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

    def test_export_allowed_for_members(self, client, gm_headers, player_headers, player_id):
        """Export is open to any campaign viewer so a player can take their own
        copy of the wiki with them (filtered to what they can see — see
        ``test_campaign_archive.py::TestWikiExportAccess``)."""
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
        assert resp.status_code == 200

    def test_export_requires_membership(self, client, gm_headers, admin_headers):
        """A non-member still cannot export, admin or not."""
        c = _campaign(client, gm_headers)
        resp = client.get(
            f"/api/campaigns/{c['id']}/wiki/export?format=md", headers=admin_headers
        )
        assert resp.status_code == 403

    def test_export_rejects_an_unknown_format(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = client.get(
            f"/api/campaigns/{c['id']}/wiki/export?format=pdf", headers=gm_headers
        )
        assert resp.status_code == 422


class TestExportCombinedMarkdown:
    """`format=mdfile`: every page in one document (issue #289)."""

    def test_single_file_holds_every_page_under_the_campaign_heading(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        _create(client, gm_headers, c["id"], title="The Tavern", body="A cozy inn.")
        _create(client, gm_headers, c["id"], title="The Docks", body="Smells of fish.")
        resp = client.get(
            f"/api/campaigns/{c['id']}/wiki/export?format=mdfile", headers=gm_headers
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/markdown")
        assert resp.headers["content-disposition"].endswith('-wiki.md"')
        text = resp.content.decode()
        assert text.startswith(f"# {c['name']}\n")
        assert "## The Tavern" in text
        assert "## The Docks" in text
        assert "A cozy inn." in text
        assert "Smells of fish." in text

    def test_nesting_becomes_heading_depth(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        parent = _create(client, gm_headers, c["id"], title="Region", body="Wide.").json()
        _create(
            client, gm_headers, c["id"], title="City", body="Busy.", parent_id=parent["id"]
        )
        text = client.get(
            f"/api/campaigns/{c['id']}/wiki/export?format=mdfile", headers=gm_headers
        ).content.decode()
        assert "## Region" in text
        assert "### City" in text
        # The child follows its parent rather than sorting independently.
        assert text.index("## Region") < text.index("### City")

    def test_page_headings_are_pushed_below_the_page_title(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        _create(client, gm_headers, c["id"], title="Lore", body="# Origins\n\nLong ago.")
        text = client.get(
            f"/api/campaigns/{c['id']}/wiki/export?format=mdfile", headers=gm_headers
        ).content.decode()
        assert "## Lore" in text
        # The page's own H1 becomes an H3, one level under its H2 page title.
        assert "### Origins" in text
        assert "\n# Origins" not in text

    def test_headings_inside_a_code_fence_are_left_alone(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        _create(
            client, gm_headers, c["id"], title="Snippet", body="```\n# not a heading\n```"
        )
        text = client.get(
            f"/api/campaigns/{c['id']}/wiki/export?format=mdfile", headers=gm_headers
        ).content.decode()
        assert "# not a heading" in text
        assert "### not a heading" not in text

    def test_member_export_omits_hidden_pages_and_gm_secrets(
        self, client, gm_headers, player_headers, player_id
    ):
        c = _campaign(client, gm_headers)
        client.post(
            f"/api/campaigns/{c['id']}/invite", json={"user_id": player_id}, headers=gm_headers
        )
        client.patch(
            f"/api/campaigns/{c['id']}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        _create(client, gm_headers, c["id"], title="Secret Plot", body="Hidden.", visibility="gm")
        _create(
            client,
            gm_headers,
            c["id"],
            title="Town Square",
            body="Open to all. ||The mayor is a lich.||",
            visibility="group",
        )
        text = client.get(
            f"/api/campaigns/{c['id']}/wiki/export?format=mdfile", headers=player_headers
        ).content.decode()
        assert "## Town Square" in text
        assert "Secret Plot" not in text
        assert "lich" not in text


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


def _zip(files: dict) -> bytes:
    """A zip archive of {path: text}, paths being zip-relative with `/`."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path, text in files.items():
            zf.writestr(path, text)
    return buf.getvalue()


def _import_zip(client, headers, cid, files):
    return _import(client, headers, cid, "vault.zip", _zip(files), "application/zip")


def _by_title(client, headers, cid):
    pages = client.get(f"/api/campaigns/{cid}/wiki", headers=headers).json()
    return {p["title"]: p for p in pages}


class TestImportZipFolders:
    def test_folders_become_parent_pages(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {
            "Places/Cities/Waterdeep.md": "A big city.",
            "Places/Barovia.md": "Misty.",
            "Loose.md": "At the root.",
        })
        assert resp.status_code == 201, resp.text
        pages = _by_title(client, gm_headers, c["id"])
        assert pages["Places"]["parent_id"] is None
        assert pages["Cities"]["parent_id"] == pages["Places"]["id"]
        assert pages["Waterdeep"]["parent_id"] == pages["Cities"]["id"]
        assert pages["Barovia"]["parent_id"] == pages["Places"]["id"]
        assert pages["Loose"]["parent_id"] is None

    def test_missing_intermediate_folder_still_nests(self, client, gm_headers):
        """`Places/Cities/` with no file directly in `Places/` keeps both rungs."""
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {
            "Places/Cities/Waterdeep.md": "A big city.",
        })
        assert resp.status_code == 201
        pages = _by_title(client, gm_headers, c["id"])
        assert pages["Places"]["parent_id"] is None
        assert pages["Cities"]["parent_id"] == pages["Places"]["id"]
        assert pages["Waterdeep"]["parent_id"] == pages["Cities"]["id"]

    def test_folder_note_becomes_the_folder_page(self, client, gm_headers):
        """Obsidian's `Places/Places.md` is the Places page, not a child of it."""
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {
            "Places/Places.md": "Where things happen.",
            "Places/Barovia.md": "Misty.",
        })
        assert resp.status_code == 201
        assert resp.json()["imported"] == 2
        pages = _by_title(client, gm_headers, c["id"])
        assert len(pages) == 2
        assert pages["Places"]["parent_id"] is None
        assert pages["Barovia"]["parent_id"] == pages["Places"]["id"]
        body = client.get(
            f"/api/campaigns/{c['id']}/wiki/{pages['Places']['id']}", headers=gm_headers
        ).json()["body"]
        assert "Where things happen." in body

    def test_index_md_becomes_the_folder_page(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {
            "Lore/index.md": "# Lore\n\nAll of it.",
            "Lore/Gods.md": "Many.",
        })
        assert resp.status_code == 201
        pages = _by_title(client, gm_headers, c["id"])
        assert len(pages) == 2
        assert pages["Lore"]["parent_id"] is None
        assert pages["Gods"]["parent_id"] == pages["Lore"]["id"]

    def test_nested_folder_note_hangs_off_its_own_parent(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {
            "Places/Cities/Cities.md": "Urban sprawl.",
            "Places/Cities/Waterdeep.md": "A big city.",
        })
        assert resp.status_code == 201
        pages = _by_title(client, gm_headers, c["id"])
        assert pages["Places"]["parent_id"] is None
        assert pages["Cities"]["parent_id"] == pages["Places"]["id"]
        assert pages["Waterdeep"]["parent_id"] == pages["Cities"]["id"]

    def test_frontmatter_parent_wins_over_the_folder(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {
            "bestiary.md": "---\ntitle: Bestiary\n---\n\nBeasts.",
            "Folder/goblin.md": "---\ntitle: Goblin\nparent: Bestiary\n---\n\nSneaky.",
        })
        assert resp.status_code == 201
        pages = _by_title(client, gm_headers, c["id"])
        assert pages["Goblin"]["parent_id"] == pages["Bestiary"]["id"]

    def test_grimoire_zip_export_round_trips_its_nesting(self, client, gm_headers):
        """The app's own flat zip export keeps using frontmatter, not folders."""
        src = _campaign(client, gm_headers)
        parent = _create(client, gm_headers, src["id"], title="Bestiary", body="").json()
        _create(
            client, gm_headers, src["id"],
            title="Goblin", body="Sneaky.", parent_id=parent["id"],
        )
        export = client.get(
            f"/api/campaigns/{src['id']}/wiki/export?format=md", headers=gm_headers
        )
        dest = _campaign(client, gm_headers)
        resp = _import(
            client, gm_headers, dest["id"], "wiki.zip", export.content, "application/zip"
        )
        assert resp.status_code == 201
        assert resp.json()["imported"] == 2
        pages = _by_title(client, gm_headers, dest["id"])
        assert pages["Goblin"]["parent_id"] == pages["Bestiary"]["id"]

    def test_a_single_top_folder_is_still_a_page(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {"Vault/Note.md": "Text."})
        assert resp.status_code == 201
        pages = _by_title(client, gm_headers, c["id"])
        assert pages["Vault"]["parent_id"] is None
        assert pages["Note"]["parent_id"] == pages["Vault"]["id"]

    def test_wikilinks_still_resolve_across_folders(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {
            "Places/Barovia.md": "Ruled by [[Strahd]].",
            "People/Strahd.md": "A vampire.",
        })
        assert resp.status_code == 201
        pages = _by_title(client, gm_headers, c["id"])
        body = client.get(
            f"/api/campaigns/{c['id']}/wiki/{pages['Barovia']['id']}", headers=gm_headers
        ).json()["body"]
        assert "[[Strahd]]" in body
        # Four pages, not five: no stub was spawned for the link target.
        assert len(pages) == 4

    def test_same_filename_in_two_folders_both_import(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {
            "North/Notes.md": "Cold.",
            "South/Notes.md": "Warm.",
        })
        assert resp.status_code == 201
        pages = client.get(f"/api/campaigns/{c['id']}/wiki", headers=gm_headers).json()
        notes = [p for p in pages if p["title"] == "Notes"]
        assert len(notes) == 2
        assert {p["parent_id"] for p in notes} == {
            next(p["id"] for p in pages if p["title"] == "North"),
            next(p["id"] for p in pages if p["title"] == "South"),
        }

    def test_path_traversal_segments_are_dropped(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {"../../Evil/Note.md": "Text."})
        assert resp.status_code == 201
        pages = _by_title(client, gm_headers, c["id"])
        assert ".." not in pages
        assert pages["Note"]["parent_id"] == pages["Evil"]["id"]
        assert pages["Evil"]["parent_id"] is None

    def test_backslash_paths_are_treated_as_folders(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {"Places\\Barovia.md": "Misty."})
        assert resp.status_code == 201
        pages = _by_title(client, gm_headers, c["id"])
        assert pages["Barovia"]["parent_id"] == pages["Places"]["id"]

    def test_index_page_is_titled_after_its_folder(self, client, gm_headers):
        """`Lore/index.md` reads as "Lore", not "index"."""
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {"Lore/index.md": "All of it."})
        assert resp.status_code == 201
        assert resp.json()["imported"] == 1
        assert resp.json()["pages"][0]["title"] == "Lore"

    def test_index_page_keeps_its_own_heading_as_the_title(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import_zip(
            client, gm_headers, c["id"], {"Lore/index.md": "# Ancient Lore\n\nx."}
        )
        assert resp.status_code == 201
        assert resp.json()["pages"][0]["title"] == "Ancient Lore"

    def test_hugo_underscore_index_claims_its_folder(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {
            "Lore/_index.md": "All of it.",
            "Lore/Gods.md": "Many.",
        })
        assert resp.status_code == 201
        pages = _by_title(client, gm_headers, c["id"])
        assert len(pages) == 2
        assert pages["Gods"]["parent_id"] == pages["Lore"]["id"]

    def test_folder_pages_are_empty_placeholders(self, client, gm_headers):
        """A folder with no note of its own gets a blank page, not invented text."""
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {"Places/Barovia.md": "Misty."})
        assert resp.status_code == 201
        pages = _by_title(client, gm_headers, c["id"])
        detail = client.get(
            f"/api/campaigns/{c['id']}/wiki/{pages['Places']['id']}", headers=gm_headers
        ).json()
        assert detail["body"] == ""

    def test_a_folder_named_like_a_page_does_not_hijack_its_links(self, client, gm_headers):
        """A `Strahd/` folder must not steal [[Strahd]] from the Strahd page."""
        c = _campaign(client, gm_headers)
        resp = _import_zip(client, gm_headers, c["id"], {
            "Strahd/Castle.md": "His home.",
            "Strahd.md": "A vampire, see [[Strahd]].",
        })
        assert resp.status_code == 201
        pages = client.get(f"/api/campaigns/{c['id']}/wiki", headers=gm_headers).json()
        # The folder page and the real page both exist, and the folder is a root.
        strahds = [p for p in pages if p["title"] == "Strahd"]
        assert len(strahds) == 2
        assert any(p["parent_id"] is None for p in strahds)


def _import_folder(client, headers, cid, files, *, paths=True):
    """Post `{path: text}` as a folder pick, the way the browser's picker does."""
    parts = [
        ("files", (path.rsplit("/", 1)[-1], text.encode("utf-8"), "text/markdown"))
        for path, text in files.items()
    ]
    data = {"paths": list(files)} if paths else None
    return client.post(
        f"/api/campaigns/{cid}/wiki/import",
        files=parts,
        data=data,
        headers=headers,
    )


class TestImportFolderUpload:
    def test_picked_folder_keeps_its_structure(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import_folder(client, gm_headers, c["id"], {
            "Vault/Places/Cities/Waterdeep.md": "A big city.",
            "Vault/Places/Barovia.md": "Misty.",
            "Vault/Loose.md": "Top level.",
        })
        assert resp.status_code == 201, resp.text
        pages = _by_title(client, gm_headers, c["id"])
        assert pages["Vault"]["parent_id"] is None
        assert pages["Places"]["parent_id"] == pages["Vault"]["id"]
        assert pages["Cities"]["parent_id"] == pages["Places"]["id"]
        assert pages["Waterdeep"]["parent_id"] == pages["Cities"]["id"]
        assert pages["Barovia"]["parent_id"] == pages["Places"]["id"]
        assert pages["Loose"]["parent_id"] == pages["Vault"]["id"]

    def test_folder_note_and_frontmatter_work_the_same_as_in_a_zip(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _import_folder(client, gm_headers, c["id"], {
            "Places/Places.md": "Where things happen.",
            "Places/Barovia.md": "Misty.",
        })
        assert resp.status_code == 201
        assert resp.json()["imported"] == 2
        pages = _by_title(client, gm_headers, c["id"])
        assert pages["Barovia"]["parent_id"] == pages["Places"]["id"]

    def test_wikilinks_resolve_across_the_whole_pick(self, client, gm_headers):
        """The set arrives in one request, so cross-links find real pages."""
        c = _campaign(client, gm_headers)
        resp = _import_folder(client, gm_headers, c["id"], {
            "Places/Barovia.md": "Ruled by [[Strahd]].",
            "People/Strahd.md": "A vampire.",
        })
        assert resp.status_code == 201
        pages = client.get(f"/api/campaigns/{c['id']}/wiki", headers=gm_headers).json()
        # Four pages: two folders, two notes - no stub spawned for the link.
        assert len(pages) == 4

    def test_dot_directories_are_skipped(self, client, gm_headers):
        """A picked vault brings `.obsidian/` along; its markdown isn't wiki content."""
        c = _campaign(client, gm_headers)
        resp = _import_folder(client, gm_headers, c["id"], {
            "Vault/.obsidian/templates/Daily.md": "A template.",
            "Vault/Real.md": "A note.",
        })
        assert resp.status_code == 201
        titles = set(_by_title(client, gm_headers, c["id"]))
        assert "Daily" not in titles
        assert ".obsidian" not in titles
        assert titles == {"Vault", "Real"}

    def test_non_markdown_files_are_ignored(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        parts = [
            ("files", ("Note.md", b"A note.", "text/markdown")),
            ("files", ("map.png", b"\x89PNG\r\n\x1a\n", "image/png")),
        ]
        resp = client.post(
            f"/api/campaigns/{c['id']}/wiki/import",
            files=parts,
            data={"paths": ["Vault/Note.md", "Vault/map.png"]},
            headers=gm_headers,
        )
        assert resp.status_code == 201
        assert set(_by_title(client, gm_headers, c["id"])) == {"Vault", "Note"}

    def test_a_folder_of_only_non_markdown_is_rejected(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{c['id']}/wiki/import",
            files=[("files", ("map.png", b"\x89PNG", "image/png"))],
            data={"paths": ["Vault/map.png"]},
            headers=gm_headers,
        )
        assert resp.status_code == 400
        assert "markdown" in resp.json()["detail"].lower()

    def test_falls_back_to_filenames_when_no_paths_are_sent(self, client, gm_headers):
        """Without paths there is no structure to keep, but the notes still import."""
        c = _campaign(client, gm_headers)
        resp = _import_folder(
            client, gm_headers, c["id"],
            {"Alpha.md": "One.", "Beta.md": "Two."},
            paths=False,
        )
        assert resp.status_code == 201
        assert resp.json()["imported"] == 2
        pages = _by_title(client, gm_headers, c["id"])
        assert pages["Alpha"]["parent_id"] is None
        assert pages["Beta"]["parent_id"] is None

    def test_mismatched_paths_count_is_rejected(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{c['id']}/wiki/import",
            files=[
                ("files", ("a.md", b"A.", "text/markdown")),
                ("files", ("b.md", b"B.", "text/markdown")),
            ],
            data={"paths": ["Vault/a.md"]},
            headers=gm_headers,
        )
        assert resp.status_code == 400
        assert "one entry per file" in resp.json()["detail"]

    def test_sending_both_a_file_and_a_folder_is_rejected(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{c['id']}/wiki/import",
            files=[
                ("file", ("solo.md", b"Solo.", "text/markdown")),
                ("files", ("a.md", b"A.", "text/markdown")),
            ],
            data={"paths": ["Vault/a.md"]},
            headers=gm_headers,
        )
        assert resp.status_code == 400
        assert "not both" in resp.json()["detail"]

    def test_import_with_no_file_at_all_is_rejected(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{c['id']}/wiki/import",
            data={"paths": ["Vault/a.md"]},
            headers=gm_headers,
        )
        assert resp.status_code == 400
        assert "No file uploaded" in resp.json()["detail"]

    def test_too_many_files_is_rejected(self, client, gm_headers, monkeypatch):
        from backend.routers.campaigns import wiki_io

        monkeypatch.setattr(wiki_io, "_MAX_IMPORT_FILES", 2)
        c = _campaign(client, gm_headers)
        resp = _import_folder(client, gm_headers, c["id"], {
            "V/a.md": "A.", "V/b.md": "B.", "V/c.md": "C.",
        })
        assert resp.status_code == 413
        assert "Too many files" in resp.json()["detail"]

    def test_an_oversized_folder_is_rejected(self, client, gm_headers, monkeypatch):
        """The cap is on the whole pick, so many small files can't slip past it."""
        from backend.routers.campaigns import wiki_io

        monkeypatch.setattr(wiki_io, "_MAX_IMPORT_BYTES", 100)
        c = _campaign(client, gm_headers)
        resp = _import_folder(client, gm_headers, c["id"], {
            "V/a.md": "x" * 60, "V/b.md": "y" * 60,
        })
        assert resp.status_code == 413
        assert "too large" in resp.json()["detail"].lower()

    def test_folder_import_requires_owner(self, client, gm_headers, player_headers, player_id):
        c = _campaign(client, gm_headers)
        client.post(f"/api/campaigns/{c['id']}/invite", json={"user_id": player_id},
                    headers=gm_headers)
        resp = _import_folder(client, player_headers, c["id"], {"V/a.md": "A."})
        assert resp.status_code == 403
