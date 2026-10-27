"""MCP tools: library, pages and campaigns, read and write.

Each tool reuses a REST handler, so these tests check what MCP adds on top -
the text the model reads, the permission and role gates, and that access
restrictions and GM secrets survive the trip.
"""
import base64
import io
import uuid
import zipfile

import pytest
from PIL import Image

from backend.config import SessionLocal
from backend.mcp_server.tools import campaigns as campaign_tools
from backend.mcp_server.tools import library as library_tools
from backend.models import Bookmark, CampaignMember, WikiPage
from backend.tests._mcp import (
    allow_keys,
    call_error,
    call_text,
    index_page,
    make_key,
    make_pdf_book,
    mcp_test_client,
    result_of,
)
from backend.tests.conftest import make_book, make_campaign, make_game_system


@pytest.fixture(scope="module")
def mcp_client():
    with mcp_test_client() as c:
        yield c


@pytest.fixture(scope="module")
def admin_key(client, admin_headers):
    return make_key(client, admin_headers, {"*": "write"})


@pytest.fixture(scope="module")
def read_key(client, admin_headers):
    return make_key(client, admin_headers, {"*": "read"})


@pytest.fixture(scope="module")
def player_key(client, admin_headers, player_id, player_headers):
    allow_keys(client, admin_headers, player_id)
    yield make_key(client, player_headers, {"*": "write"})
    allow_keys(client, admin_headers, player_id, allowed=False)


@pytest.fixture(scope="module")
def library(tmp_path_factory):
    """A system holding a real 4-page PDF (pages 1-2 indexed), and odd formats."""
    directory = tmp_path_factory.mktemp("mcp-library")
    system = make_game_system(name=f"Mcp Tools {uuid.uuid4().hex[:4]}", edition="2e")
    book = make_pdf_book(
        directory,
        system.id,
        [
            "Chapter one: heroes.",
            "Grappling: roll Might against Agility.",
            "Fire drakes breathe fire.",
            "",
        ],
        toc=[[1, "Heroes", 1], [2, "Grappling", 2], [1, "Bestiary", 3]],
        title="Drake Rules",
        description="The core rules.",
        tags=["core-rules"],
        indexed=True,
        authors=["Ann Author"],
    )
    index_page(book.id, 1, "Chapter one: heroes.")
    index_page(book.id, 2, "Grappling: roll Might against Agility.")
    variant = make_book(
        system_id=system.id,
        title="Drake Rules (printer friendly)",
        variant_parent_id=book.id,
        variant_label="Printer friendly",
    )
    unindexed = make_book(system_id=system.id, title="Drake Notes", category="homebrew")
    restricted = make_pdf_book(
        directory, system.id, ["Admin eyes only."], title="Secret Drakes", access_level="admin"
    )

    png = directory / "handout.png"
    Image.new("RGB", (20, 10), "red").save(png)
    image_book = make_book(
        system_id=system.id, title="Handout", filepath=str(png), mime_type="image/png"
    )

    cbz = directory / "comic.cbz"
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(buf, format="PNG")
    with zipfile.ZipFile(cbz, "w") as zf:
        zf.writestr("page01.png", buf.getvalue())
    comic = make_book(
        system_id=system.id, title="Comic", filepath=str(cbz), mime_type="application/x-cbz"
    )
    missing = make_book(
        system_id=system.id,
        title="Gone",
        filepath=str(directory / "gone.pdf"),
        mime_type="application/pdf",
    )
    plain = directory / "plain.txt"
    plain.write_text("Just text.")
    text_book = make_book(
        system_id=system.id, title="Plain", filepath=str(plain), mime_type="text/plain"
    )
    return {
        "system": system,
        "book": book,
        "variant": variant,
        "unindexed": unindexed,
        "restricted": restricted,
        "image": image_book,
        "comic": comic,
        "missing": missing,
        "text": text_book,
    }


# ---------------------------------------------------------------------------
# Library
# ---------------------------------------------------------------------------


class TestListGameSystems:
    def test_lists_systems_with_counts_and_ids(self, mcp_client, read_key, library):
        text = call_text(mcp_client, read_key, "list_game_systems", {})
        system = library["system"]
        assert f"{system.name}, 2e: " in text
        assert f"[system_id: {system.id}]" in text

    def test_empty_library(self, mcp_client, read_key, monkeypatch):
        from backend.routers.systems import core

        monkeypatch.setattr(core, "list_systems", lambda **kw: [])
        assert "no game systems" in call_text(mcp_client, read_key, "list_game_systems", {})


class TestListBooks:
    def test_lists_a_systems_books(self, mcp_client, read_key, library):
        text = call_text(
            mcp_client, read_key, "list_books", {"system_id": library["system"].id}
        )
        assert f"Drake Rules ({library['system'].name}, core, 4 pages)" in text
        assert f"[book_id: {library['book'].id}]" in text
        # Variants fold into their main book.
        assert "printer friendly" not in text
        # An admin-only book is listed for the admin, and hidden from a player.
        assert "Secret Drakes" in text

    def test_restricted_books_are_hidden_from_a_player(self, mcp_client, player_key, library):
        text = call_text(
            mcp_client, player_key, "list_books", {"system_id": library["system"].id}
        )
        assert "Drake Rules" in text and "Secret Drakes" not in text

    def test_pages_through_with_offset(self, mcp_client, read_key, library):
        args = {"system_id": library["system"].id, "limit": 1}
        assert "call again with offset=1" in call_text(mcp_client, read_key, "list_books", args)
        far = call_text(mcp_client, read_key, "list_books", {**args, "offset": 500})
        assert far == "No books past offset 500."

    def test_no_match(self, mcp_client, read_key, library):
        args = {"system_id": library["system"].id, "category": "no-such-category"}
        assert call_text(mcp_client, read_key, "list_books", args) == "No books matched."


class TestGetBook:
    def test_details_and_contents(self, mcp_client, read_key, library):
        text = call_text(mcp_client, read_key, "get_book", {"book_id": library["book"].id})
        assert text.startswith("# Drake Rules")
        assert f"System: {library['system'].name}" in text
        assert "Pages: 4" in text
        assert "Authors: Ann Author" in text
        assert "Tags: core-rules" in text
        assert "The core rules." in text
        assert "- Heroes (p. 1)\n  - Grappling (p. 2)\n- Bestiary (p. 3)" in text
        assert f"Printer friendly [book_id: {library['variant'].id}]" in text
        assert "not indexed" not in text

    def test_contents_are_capped(self, mcp_client, read_key, library, monkeypatch):
        monkeypatch.setattr(library_tools, "TOC_LIMIT", 1)
        text = call_text(mcp_client, read_key, "get_book", {"book_id": library["book"].id})
        assert "[contents cut at 1 entries]" in text
        assert "Bestiary" not in text

    def test_unindexed_book_without_outline(self, mcp_client, read_key, library):
        text = call_text(mcp_client, read_key, "get_book", {"book_id": library["unindexed"].id})
        assert "not indexed" in text
        assert "Contents:" not in text

    def test_unknown_book(self, mcp_client, read_key):
        assert call_error(mcp_client, read_key, "get_book", {"book_id": "nope"}) == (
            "Book not found"
        )

    def test_restricted_book_is_hidden_from_a_player(self, mcp_client, player_key, library):
        msg = call_error(mcp_client, player_key, "get_book", {"book_id": library["restricted"].id})
        assert msg == "Book not found"


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------


class TestReadPages:
    def test_one_page(self, mcp_client, read_key, library):
        text = call_text(
            mcp_client, read_key, "read_pages", {"book_id": library["book"].id, "start_page": 2}
        )
        assert text == "Drake Rules, pages 2-2:\n\n--- Page 2 ---\nGrappling: roll Might against Agility."

    def test_range_falls_back_to_the_file_and_stops_at_the_last_page(
        self, mcp_client, read_key, library
    ):
        text = call_text(
            mcp_client,
            read_key,
            "read_pages",
            {"book_id": library["book"].id, "start_page": 3, "end_page": 9},
        )
        assert "pages 3-4" in text
        assert "Fire drakes breathe fire." in text  # page 3 is not in the index
        assert "--- Page 4 ---\n(no text on this page" in text

    @pytest.mark.parametrize(
        "args, message",
        [
            ({"start_page": 3, "end_page": 2}, "end_page is before start_page"),
            ({"start_page": 1, "end_page": 11}, "Read at most 10 pages at a time"),
            ({"start_page": 5}, "Drake Rules has 4 pages"),
        ],
    )
    def test_bad_ranges(self, mcp_client, read_key, library, args, message):
        args = {"book_id": library["book"].id, **args}
        assert call_error(mcp_client, read_key, "read_pages", args) == message


class TestViewPage:
    def _view(self, mcp_client, key, book, page=1):
        return result_of(
            mcp_client, key, "tools/call",
            {"name": "view_page", "arguments": {"book_id": book.id, "page": page}},
        )

    def test_renders_a_pdf_page_as_webp(self, mcp_client, read_key, library):
        res = self._view(mcp_client, read_key, library["book"], 2)
        assert res["isError"] is False
        caption, image = res["content"]
        assert caption == {"type": "text", "text": "Drake Rules, page 2:"}
        assert image["type"] == "image" and image["mimeType"] == "image/webp"
        data = base64.b64decode(image["data"])
        assert data[:4] == b"RIFF" and Image.open(io.BytesIO(data)).width == 1000

    def test_image_file_and_comic_pages_pass_through(self, mcp_client, read_key, library):
        image = self._view(mcp_client, read_key, library["image"])["content"][1]
        assert image["mimeType"] == "image/png"
        comic = self._view(mcp_client, read_key, library["comic"])["content"][1]
        assert comic["mimeType"] == "image/png"

    @pytest.mark.parametrize(
        "which, page, message",
        [
            ("book", 9, "This book has 4 pages"),
            ("image", 2, "An image file has only one page"),
            ("comic", 2, "No page 2 in this archive"),
            ("missing", 1, "The book's file is missing from the library"),
            ("text", 1, "This book has no rendered pages; use read_pages instead"),
        ],
    )
    def test_refusals(self, mcp_client, read_key, library, which, page, message):
        res = self._view(mcp_client, read_key, library[which], page)
        assert res["isError"] is True
        assert res["content"][0]["text"] == message


# ---------------------------------------------------------------------------
# Library writes
# ---------------------------------------------------------------------------


class TestTagBooks:
    def test_tags_readable_books_and_reports_the_rest(self, mcp_client, admin_key, library):
        text = call_text(
            mcp_client,
            admin_key,
            "tag_books",
            {"book_ids": [library["unindexed"].id, "nope"], "tags": ["Dragons"]},
        )
        assert f"- {library['unindexed'].id}: now tagged " in text
        assert "dragons" in text.lower()
        assert text.endswith("Not found: nope")

    def test_ids_the_bulk_route_refuses_are_reported(
        self, mcp_client, admin_key, library, monkeypatch
    ):
        monkeypatch.setattr(library_tools, "load_book", lambda ctx, book_id: {})
        text = call_text(
            mcp_client,
            admin_key,
            "tag_books",
            {"book_ids": [library["unindexed"].id, "nope"], "tags": ["Dragons"]},
        )
        assert f"- {library['unindexed'].id}: now tagged " in text
        assert text.endswith("Not found: nope")

    def test_a_player_is_not_offered_it(self, mcp_client, player_key, library):
        listed = result_of(mcp_client, player_key, "tools/list")["tools"]
        assert "tag_books" not in {t["name"] for t in listed}
        msg = call_error(
            mcp_client, player_key, "tag_books", {"book_ids": [library["book"].id], "tags": ["x"]}
        )
        assert "a gm account" in msg

    def test_a_read_only_key_cannot_write(self, mcp_client, read_key, library):
        listed = {t["name"]: t for t in result_of(mcp_client, read_key, "tools/list")["tools"]}
        assert "tag_books" not in listed and "add_bookmark" not in listed
        assert listed["get_book"]["annotations"] == {"readOnlyHint": True, "openWorldHint": False}

    def test_write_tools_carry_behaviour_hints(self, mcp_client, admin_key):
        listed = {t["name"]: t for t in result_of(mcp_client, admin_key, "tools/list")["tools"]}
        assert listed["tag_books"]["annotations"] == {
            "readOnlyHint": False,
            "openWorldHint": False,
            "destructiveHint": False,
            "idempotentHint": True,
        }


class TestAddBookmark:
    def test_bookmarks_a_page(self, mcp_client, player_key, player_id, library):
        text = call_text(
            mcp_client,
            player_key,
            "add_bookmark",
            {"book_id": library["book"].id, "page": 2, "label": "Grappling", "notes": "check"},
        )
        assert text.startswith("Bookmarked page 2 of Drake Rules [bookmark_id: ")
        db = SessionLocal()
        try:
            bm = db.query(Bookmark).filter_by(user_id=player_id, book_id=library["book"].id).one()
            assert (bm.page_number, bm.label, bm.notes) == (2, "Grappling", "check")
        finally:
            db.close()

    def test_page_past_the_end(self, mcp_client, player_key, library):
        msg = call_error(
            mcp_client, player_key, "add_bookmark", {"book_id": library["book"].id, "page": 99}
        )
        assert msg == "Drake Rules has 4 pages"

    def test_cannot_bookmark_a_book_it_cannot_see(self, mcp_client, player_key, library):
        args = {"book_id": library["restricted"].id, "page": 1}
        assert call_error(mcp_client, player_key, "add_bookmark", args) == "Book not found"


# ---------------------------------------------------------------------------
# Campaigns
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def campaign(client, admin_id, admin_headers, player_id, player_headers):
    """An admin-run group campaign with the player in it, a session and wiki pages."""
    c = make_campaign(
        admin_id, name=f"Drake Hunt {uuid.uuid4().hex[:4]}", is_gm_campaign=True,
        description="Hunting drakes.",
    )
    db = SessionLocal()
    db.add(
        CampaignMember(
            campaign_id=c.id, user_id=player_id, status="accepted", character_name="Brakka"
        )
    )
    db.commit()
    db.close()
    base = f"/api/campaigns/{c.id}"

    def page(**body):
        resp = client.post(f"{base}/wiki", json={"visibility": "group", **body}, headers=admin_headers)
        assert resp.status_code in (200, 201), resp.text
        return resp.json()

    notes = page(title="Session Notes")
    session = page(
        title="The heist",
        body="We met the baron at the docks.",
        page_type="session",
        session_date="2026-10-01",
        parent_id=notes["id"],
    )
    gm_only = page(title="Twist", body="The baron is lying.", visibility="gm")
    baron = page(title="Baron Vex", body="A noble. ||He is the king's brother.||")
    page(title="Castle", body="Home of [[Baron Vex]].")
    return {"campaign": c, "session": session, "gm_only": gm_only, "baron": baron}


class TestListCampaigns:
    def test_the_gm_runs_it(self, mcp_client, admin_key, campaign):
        text = call_text(mcp_client, admin_key, "list_campaigns", {})
        c = campaign["campaign"]
        assert f"- {c.name} (runs it) [campaign_id: {c.id}]" in text

    def test_a_player_sees_the_gm(self, mcp_client, player_key, campaign):
        text = call_text(mcp_client, player_key, "list_campaigns", {})
        assert f"{campaign['campaign'].name} (GM: admin)" in text

    def test_invitations_are_flagged(self, mcp_client, client, admin_headers, admin_id):
        user = _fresh_user(client, admin_headers)
        c = make_campaign(admin_id, name="Pending Game", is_gm_campaign=True)
        _join(c.id, user["id"], "invited")
        text = call_text(mcp_client, user["key"], "list_campaigns", {})
        assert "Pending Game (GM: admin, invitation not yet accepted)" in text

    def test_no_campaigns(self, mcp_client, client, admin_headers):
        user = _fresh_user(client, admin_headers)
        assert call_text(mcp_client, user["key"], "list_campaigns", {}) == (
            "The user has no campaigns."
        )


def _fresh_user(client, admin_headers):
    """A new player who holds a full-access key and belongs to nothing."""
    name = f"mcp-{uuid.uuid4().hex[:6]}"
    created = client.post(
        "/api/users",
        json={"username": name, "password": "mcpuserpass1", "role": "player",
              "api_keys_enabled": True},
        headers=admin_headers,
    )
    assert created.status_code == 201, created.text
    token = client.post(
        "/api/auth/login", json={"username": name, "password": "mcpuserpass1"}
    ).json()["token"]
    client.cookies.clear()
    key = make_key(client, {"Authorization": f"Bearer {token}"}, {"*": "write"})
    return {"id": created.json()["id"], "key": key}


def _join(campaign_id, user_id, status="accepted"):
    db = SessionLocal()
    db.add(CampaignMember(campaign_id=campaign_id, user_id=user_id, status=status))
    db.commit()
    db.close()


class TestGetCampaign:
    def test_overview(self, mcp_client, player_key, campaign):
        c = campaign["campaign"]
        text = call_text(mcp_client, player_key, "get_campaign", {"campaign_id": c.id})
        assert text.startswith(f"# {c.name}\ncampaign_id: {c.id}")
        assert "GM: admin" in text and "Hunting drakes." in text
        assert " playing Brakka" in text
        # Session pages sit under their parent page, dated.
        assert "- Session Notes [page_id: " in text
        assert (
            f"\n  - The heist (session 2026-10-01) [page_id: {campaign['session']['id']}]" in text
        )
        assert f"- Baron Vex [page_id: {campaign['baron']['id']}]" in text
        # A player never sees a GM-only page, even by title.
        assert "Twist" not in text

    def test_the_gm_sees_their_own_pages(self, mcp_client, admin_key, campaign):
        text = call_text(
            mcp_client, admin_key, "get_campaign", {"campaign_id": campaign["campaign"].id}
        )
        assert f"- Twist [page_id: {campaign['gm_only']['id']}]" in text

    def test_long_wiki_index_is_cut(self, mcp_client, admin_key, campaign, monkeypatch):
        monkeypatch.setattr(campaign_tools, "LIST_LIMIT", 1)
        text = call_text(
            mcp_client, admin_key, "get_campaign", {"campaign_id": campaign["campaign"].id}
        )
        assert "more not listed - use search_campaign_wiki]" in text

    def test_outsiders_are_refused(self, mcp_client, client, admin_headers, campaign):
        user = _fresh_user(client, admin_headers)
        msg = call_error(
            mcp_client, user["key"], "get_campaign", {"campaign_id": campaign["campaign"].id}
        )
        assert msg == "Not a member of this campaign"


class TestReadWikiPage:
    def _read(self, mcp_client, key, campaign):
        return call_text(
            mcp_client,
            key,
            "read_wiki_page",
            {"campaign_id": campaign["campaign"].id, "page_id": campaign["baron"]["id"]},
        )

    def test_the_gm_sees_secrets_and_backlinks(self, mcp_client, admin_key, campaign):
        text = self._read(mcp_client, admin_key, campaign)
        assert text.startswith("# Baron Vex\nWritten by admin")
        assert "king's brother" in text
        assert "Linked from:\n- Castle [page_id: " in text

    def test_a_player_never_sees_gm_secrets(self, mcp_client, player_key, campaign):
        text = self._read(mcp_client, player_key, campaign)
        assert "A noble." in text
        assert "king's brother" not in text


class TestSearchCampaignWiki:
    def _search(self, mcp_client, key, campaign, query):
        return call_text(
            mcp_client,
            key,
            "search_campaign_wiki",
            {"campaign_id": campaign["campaign"].id, "query": query},
        )

    def test_finds_pages_with_an_excerpt(self, mcp_client, player_key, campaign):
        text = self._search(mcp_client, player_key, campaign, "baron")
        assert text.startswith('Wiki pages mentioning "baron" (')
        assert f"- The heist (session 2026-10-01) [page_id: {campaign['session']['id']}]: " in text
        assert "met the baron at the docks" in text
        assert f"- Baron Vex [page_id: {campaign['baron']['id']}]" in text

    def test_a_player_cannot_find_gm_pages_or_secrets(self, mcp_client, player_key, campaign):
        assert "Twist" not in self._search(mcp_client, player_key, campaign, "lying")
        assert self._search(mcp_client, player_key, campaign, "king's brother") == (
            "No wiki pages mention \"king's brother\"."
        )

    def test_the_gm_finds_them(self, mcp_client, admin_key, campaign):
        assert "Twist" in self._search(mcp_client, admin_key, campaign, "lying")


class TestCreateWikiPage:
    def _visibility(self, page_id):
        db = SessionLocal()
        try:
            return db.query(WikiPage).filter_by(id=page_id).one().visibility
        finally:
            db.close()

    def test_private_by_default(self, mcp_client, player_key, campaign):
        text = call_text(
            mcp_client,
            player_key,
            "create_wiki_page",
            {"campaign_id": campaign["campaign"].id, "title": "Brakka's plan", "body": "Run."},
        )
        assert text.startswith("Created wiki page \"Brakka's plan\" [page_id: ")
        page_id = text.rsplit("page_id: ", 1)[1].rstrip("].")
        assert self._visibility(page_id) == "gm"

    def test_always_private_to_the_user(self, mcp_client, admin_key, campaign):
        """An older client still sending a visibility gets a private page all the same."""
        text = call_text(
            mcp_client,
            admin_key,
            "create_wiki_page",
            {"campaign_id": campaign["campaign"].id, "title": "Recap", "visibility": "shared"},
        )
        assert self._visibility(text.rsplit("page_id: ", 1)[1].rstrip("].")) == "gm"

    def test_the_tool_offers_no_visibility(self, mcp_client, admin_key):
        tools = result_of(mcp_client, admin_key, "tools/list")["tools"]
        schema = next(t for t in tools if t["name"] == "create_wiki_page")["inputSchema"]
        assert "visibility" not in schema["properties"]

    def test_pages_its_links_create_are_private_too(
        self, mcp_client, client, admin_key, campaign, player_headers
    ):
        cid = campaign["campaign"].id
        title = f"Hidden Vault {uuid.uuid4().hex[:6]}"
        call_text(
            mcp_client,
            admin_key,
            "create_wiki_page",
            {"campaign_id": cid, "title": "Prep", "body": f"See [[{title}]]."},
        )
        db = SessionLocal()
        try:
            stub = db.query(WikiPage).filter_by(campaign_id=cid, title=title).one()
            assert stub.visibility == "gm"
        finally:
            db.close()
        seen = client.get(f"/api/campaigns/{cid}/wiki", headers=player_headers).json()
        assert title not in {p["title"] for p in seen}

    def test_not_while_the_gms_campaign_access_is_off(
        self, mcp_client, client, admin_headers, player_id, player_headers, player_key
    ):
        gm = _fresh_user(client, admin_headers)
        c = make_campaign(gm["id"], name=f"Locked {uuid.uuid4().hex[:4]}", is_gm_campaign=True)
        _join(c.id, player_id)
        resp = client.patch(
            f"/api/users/{gm['id']}", json={"campaign_access": False}, headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        for key in (gm["key"], player_key):
            msg = call_error(
                mcp_client, key, "create_wiki_page", {"campaign_id": c.id, "title": "Hi"}
            )
            assert msg == "Campaign is locked: the GM's campaign access has been disabled"
        # The app refuses it the same way.
        resp = client.post(f"/api/campaigns/{c.id}/wiki", json={"title": "Hi"}, headers=player_headers)
        assert resp.status_code == 403

    def test_outsiders_cannot_write(self, mcp_client, client, admin_headers, campaign):
        user = _fresh_user(client, admin_headers)
        msg = call_error(
            mcp_client,
            user["key"],
            "create_wiki_page",
            {"campaign_id": campaign["campaign"].id, "title": "Hi"},
        )
        assert msg == "Not a member of this campaign"
