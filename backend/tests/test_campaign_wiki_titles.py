"""Page titles a `[[link]]` can hold, and renames that leave linking pages as they read."""
import uuid

import pytest

from backend import config
from backend.models import WikiPage
from backend.routers.campaigns._wiki_helpers import rewrite_inbound_titles
from backend.routers.campaigns.wiki_io import _record
from backend.text.wikilinks import clean_title, title_is_linkable


def uid():
    return uuid.uuid4().hex[:8]


SECRETS = ("The innkeeper is the murderer.", "The bridge is trapped.")
PLOT = (
    "Start at the [[Tavern]].\n\n||The innkeeper is the murderer.||\n\n"
    "Then travel north.\n\n||The bridge is trapped.||\n"
)


@pytest.fixture()
def campaign_with_member(client, gm_headers, player_headers, player_id):
    c = client.post(
        "/api/campaigns",
        json={"name": f"Titles {uid()}", "is_gm_campaign": True},
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
    return client.post(f"/api/campaigns/{cid}/wiki", json=kwargs, headers=headers)


def _rename(client, headers, cid, pid, title):
    return client.patch(f"/api/campaigns/{cid}/wiki/{pid}", json={"title": title}, headers=headers)


def _body(client, headers, cid, pid):
    return client.get(f"/api/campaigns/{cid}/wiki/{pid}", headers=headers).json()["body"]


def _served(client, headers, cid, pid):
    """Everything a member is sent that carries the page's text."""
    body = _body(client, headers, cid, pid)
    bundle = client.get(f"/api/campaigns/{cid}/wiki/export?format=json", headers=headers)
    hits = [
        client.get(f"/api/campaigns/{cid}/wiki/search?q={word}", headers=headers).json()
        for word in ("innkeeper", "bridge", "travel")
    ]
    return body + bundle.text + str(hits)


@pytest.fixture()
def tavern_and_plot(client, gm_headers, campaign_with_member):
    cid = campaign_with_member
    tavern = _create(client, gm_headers, cid, title="Tavern", visibility="group").json()
    plot = _create(client, gm_headers, cid, title="Plot", visibility="group", body=PLOT).json()
    return cid, tavern["id"], plot["id"]


class TestTitleRule:
    @pytest.mark.parametrize("title", ["Inn ||", "a|b", "[x]", "Two\nlines", "cr\rhere"])
    def test_link_syntax_is_not_linkable(self, title):
        assert not title_is_linkable(title)

    @pytest.mark.parametrize("title", ["Tavern", "Ruins: The Depths", "Q&A #1", ""])
    def test_ordinary_titles_are(self, title):
        assert title_is_linkable(title)

    def test_clean_title_turns_runs_into_one_space(self):
        assert clean_title("  Inn || of [[the]]\nNorth ") == "Inn of the North"
        assert clean_title("||") == ""
        assert clean_title(None) == ""


class TestRefusedOverTheApi:
    @pytest.mark.parametrize("title", ["Inn ||", "a | b", "[Inn]", "Inn\nNorth"])
    def test_create_refuses(self, client, gm_headers, campaign_with_member, title):
        resp = _create(client, gm_headers, campaign_with_member, title=title)
        assert resp.status_code == 400
        assert "line break" in resp.json()["detail"]

    def test_player_rename_to_a_secret_marker_is_refused(
        self, client, gm_headers, player_headers, tavern_and_plot
    ):
        cid, tavern, plot = tavern_and_plot
        assert _rename(client, player_headers, cid, tavern, "Inn ||").status_code == 400
        served = _served(client, player_headers, cid, plot)
        assert not any(s in served for s in SECRETS)
        # The GM's page is untouched.
        assert _body(client, gm_headers, cid, plot) == PLOT

    def test_ordinary_rename_still_rewrites_the_link(
        self, client, gm_headers, player_headers, tavern_and_plot
    ):
        cid, tavern, plot = tavern_and_plot
        assert _rename(client, player_headers, cid, tavern, "The Inn").status_code == 200
        assert _body(client, gm_headers, cid, plot) == PLOT.replace("[[Tavern]]", "[[The Inn]]")
        served = _served(client, player_headers, cid, plot)
        assert "[[The Inn]]" in served
        assert not any(s in served for s in SECRETS)

    def test_a_link_inside_a_secret_is_still_rewritten(
        self, client, gm_headers, player_headers, campaign_with_member
    ):
        cid = campaign_with_member
        tavern = _create(client, gm_headers, cid, title="Tavern", visibility="group").json()
        body = "Open.\n\n||Meet at the [[Tavern]] at night.||\n"
        plot = _create(client, gm_headers, cid, title="Plot", visibility="group", body=body).json()
        assert _rename(client, player_headers, cid, tavern["id"], "Inn").status_code == 200
        assert _body(client, gm_headers, cid, plot["id"]) == body.replace("Tavern", "Inn")
        assert _body(client, player_headers, cid, plot["id"]) == "Open.\n\n\n"

    def test_a_page_already_titled_so_still_saves(self, client, gm_headers, campaign_with_member):
        # A title an older version accepted is only checked when it changes.
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Old").json()
        db = config.SessionLocal()
        try:
            db.query(WikiPage).filter_by(id=page["id"]).update({"title": "Old | Page"})
            db.commit()
        finally:
            db.close()
        resp = client.patch(
            f"/api/campaigns/{cid}/wiki/{page['id']}",
            json={"title": "Old | Page", "body": "edited"},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert _body(client, gm_headers, cid, page["id"]) == "edited"


class TestCleanedWhereNotTyped:
    def test_a_link_stub_gets_a_clean_title(self, client, gm_headers, campaign_with_member):
        cid = campaign_with_member
        _create(client, gm_headers, cid, title="Src", body="See [[Odd[ Place]].")
        titles = [
            p["title"]
            for p in client.get(f"/api/campaigns/{cid}/wiki", headers=gm_headers).json()
        ]
        assert "Odd Place" in titles
        assert not any("[" in t for t in titles)

    def test_a_pin_stub_gets_a_clean_title(self, client, gm_headers, campaign_with_member):
        cid = campaign_with_member
        page = _create(client, gm_headers, cid, title="Region", page_type="map").json()
        resp = client.post(
            f"/api/campaigns/{cid}/wiki/{page['id']}/pins",
            json={"x": 0.5, "y": 0.5, "target_title": "Keep || Hall"},
            headers=gm_headers,
        )
        assert resp.status_code in (200, 201), resp.text
        assert resp.json()["target_title"] == "Keep Hall"

    def test_an_imported_title_is_cleaned_but_keeps_its_links(self):
        rec = _record("Inn || North", "body")
        assert rec["title"] == "Inn North"
        # Other records still name it as it was written.
        assert rec["source_key"] == "Inn || North"
        assert _record("||", "")["title"] == "Untitled"


class TestRewriteGuard:
    def test_a_rewrite_that_would_repair_secrets_is_skipped(
        self, client, gm_headers, tavern_and_plot
    ):
        # The title rule keeps such a title out; this checks the rewrite holds
        # the line on its own, should one ever get through.
        cid, tavern, plot = tavern_and_plot
        db = config.SessionLocal()
        try:
            page = db.query(WikiPage).filter_by(id=tavern).one()
            page.title = "Inn ||"
            rewrite_inbound_titles(db, cid, page, "Tavern")
            src = db.query(WikiPage).filter_by(id=plot).one()
            assert src.body == PLOT
        finally:
            db.rollback()
            db.close()
