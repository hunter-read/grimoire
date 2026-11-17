"""Wiki import at the size its limits allow (issue #897).

An import may hold `_MAX_IMPORT_FILES` pages. Ordering parents before children
recursed once per ancestor, so a `parent:` chain that long ran past Python's
recursion limit and the import failed with a 500. Choosing slugs probed the
database once per suffix tried, so many pages sharing a title cost a number of
queries quadratic in how many there were.
"""
import json
import uuid

from sqlalchemy import event

from backend.config import SessionLocal
from backend.models import WikiPage
from backend.routers.campaigns._wiki_helpers import SlugAllocator, _ensure_unique_slug
from backend.routers.campaigns.wiki_io import _MAX_IMPORT_FILES, _order_parents_first
from backend.tests.conftest import make_campaign


def _campaign(client, gm_headers):
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Scale {uuid.uuid4().hex[:8]}", "is_gm_campaign": True},
        headers=gm_headers,
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def _import_bundle(client, headers, cid, pages):
    bundle = {"grimoire_wiki_version": 1, "campaign": "X", "pages": pages}
    return client.post(
        f"/api/campaigns/{cid}/wiki/import",
        files={"file": ("wiki.json", json.dumps(bundle).encode(), "application/json")},
        headers=headers,
    )


def _rec(key, parent=None):
    return {"title": key, "source_key": key, "parent_key": parent}


def _keys(records):
    return [r["source_key"] for r in records]


class TestOrderParentsFirst:
    def test_ancestors_come_first_and_the_rest_keep_input_order(self):
        records = [_rec("c", "b"), _rec("x"), _rec("b", "a"), _rec("a"), _rec("y", "a")]
        assert _keys(_order_parents_first(records)) == ["a", "b", "c", "x", "y"]

    def test_an_unknown_parent_is_a_root(self):
        records = [_rec("orphan", "missing"), _rec("b", "orphan")]
        assert _keys(_order_parents_first(records)) == ["orphan", "b"]

    def test_a_page_naming_itself_as_parent_is_a_root(self):
        records = [_rec("self", "self"), _rec("child", "self")]
        assert _keys(_order_parents_first(records)) == ["self", "child"]

    def test_a_cycle_falls_back_to_input_order(self):
        # a -> b -> c -> a: starting from a, the climb stops on reaching a again,
        # so the cycle goes in as found and nothing is dropped or repeated.
        records = [_rec("a", "c"), _rec("b", "a"), _rec("c", "b"), _rec("d", "b")]
        assert _keys(_order_parents_first(records)) == ["b", "c", "a", "d"]

    def test_a_cycle_as_long_as_an_import_allows_keeps_every_page_once(self):
        n = _MAX_IMPORT_FILES
        records = [_rec(f"p{i}", f"p{(i + 1) % n}") for i in range(n)]
        ordered = _order_parents_first(records)
        assert sorted(_keys(ordered)) == sorted(_keys(records))

    def test_a_chain_as_deep_as_an_import_allows_orders_root_first(self):
        n = _MAX_IMPORT_FILES
        # Deepest first, so the first record climbs the whole chain.
        records = [_rec(f"p{i}", f"p{i - 1}" if i else None) for i in reversed(range(n))]
        assert _keys(_order_parents_first(records)) == [f"p{i}" for i in range(n)]


class TestDeepChainImport:
    def test_a_parent_chain_as_deep_as_the_file_limit_imports_with_its_nesting(
        self, client, gm_headers
    ):
        cid = _campaign(client, gm_headers)
        n = _MAX_IMPORT_FILES
        pages = [
            {"title": f"Level {i}", "slug": f"level-{i}", "body": "",
             **({"parent": f"level-{i - 1}"} if i else {})}
            for i in reversed(range(n))
        ]
        resp = _import_bundle(client, gm_headers, cid, pages)
        assert resp.status_code == 201, resp.text
        assert resp.json()["imported"] == n

        db = SessionLocal()
        try:
            rows = db.query(WikiPage).filter_by(campaign_id=cid).all()
        finally:
            db.close()
        by_title = {p.title: p for p in rows}
        assert by_title["Level 0"].parent_id is None
        for i in range(1, n):
            assert by_title[f"Level {i}"].parent_id == by_title[f"Level {i - 1}"].id


class TestSlugAllocator:
    def _page(self, db, cid, slug):
        db.add(WikiPage(campaign_id=cid, title=slug, slug=slug, body=""))
        db.flush()

    def test_gives_what_one_probe_per_page_would(self, gm_id):
        campaign = make_campaign(gm_id)
        db = SessionLocal()
        try:
            # Gaps and a page whose own title slugs to a suffixed form.
            for slug in ("inn", "inn-3", "inn-2-2"):
                self._page(db, campaign.id, slug)
            bases = ["inn", "inn", "inn-2", "inn", "tavern", "tavern", "inn-2"]

            allocate = SlugAllocator(db, campaign.id)
            batched = [allocate(b) for b in bases]
            db.rollback()

            for slug in ("inn", "inn-3", "inn-2-2"):
                self._page(db, campaign.id, slug)
            probed = []
            for b in bases:
                slug = _ensure_unique_slug(db, campaign.id, b)
                self._page(db, campaign.id, slug)
                probed.append(slug)
            db.rollback()
        finally:
            db.close()
        assert batched == probed
        assert batched == ["inn-2", "inn-4", "inn-2-3", "inn-5", "tavern", "tavern-2", "inn-2-4"]

    def test_other_campaigns_slugs_are_not_taken(self, gm_id):
        mine, theirs = make_campaign(gm_id), make_campaign(gm_id)
        db = SessionLocal()
        try:
            self._page(db, theirs.id, "inn")
            assert SlugAllocator(db, mine.id)("inn") == "inn"
            db.rollback()
        finally:
            db.close()


def _slug_probes(client, headers, cid, count):
    """Import `count` pages titled alike; return the slug lookups it ran."""
    db = SessionLocal()
    engine = db.get_bind()
    db.close()
    probes: list[str] = []

    def record(_conn, _cursor, statement, *_args):
        if "FROM wiki_pages" in statement and "wiki_pages.slug = " in statement:
            probes.append(statement)

    pages = [{"title": "Goblin", "slug": f"g{i}", "body": ""} for i in range(count)]
    event.listen(engine, "before_cursor_execute", record)
    try:
        resp = _import_bundle(client, headers, cid, pages)
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert resp.status_code == 201, resp.text
    return probes, resp.json()["pages"]


class TestSameTitleImport:
    def test_slug_lookups_do_not_grow_with_the_number_of_pages(self, client, gm_headers):
        few, few_pages = _slug_probes(client, gm_headers, _campaign(client, gm_headers), 20)
        many, many_pages = _slug_probes(
            client, gm_headers, _campaign(client, gm_headers), _MAX_IMPORT_FILES
        )
        assert len(many) == len(few)
        slugs = [p["slug"] for p in many_pages]
        assert slugs == ["goblin"] + [f"goblin-{n}" for n in range(2, _MAX_IMPORT_FILES + 1)]
        assert [p["slug"] for p in few_pages] == slugs[:20]

    def test_an_import_beside_existing_pages_skips_their_slugs(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        for _ in range(2):
            client.post(f"/api/campaigns/{cid}/wiki", json={"title": "Goblin"}, headers=gm_headers)
        _, pages = _slug_probes(client, gm_headers, cid, 3)
        assert [p["slug"] for p in pages] == ["goblin-3", "goblin-4", "goblin-5"]
