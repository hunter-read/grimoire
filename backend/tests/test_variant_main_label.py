"""Naming the main version of a family instead of "Main version" (issue #556).

A map pack's main copy is often the gridless cut and its only variant the
gridded one. The picker used to call the main "Main version" whatever it was,
which hides the one distinction the family exists to make. The parent row now
carries its own kind and label, and every detail response hands them to the
picker - including the response for a variant, which is where the main entry
is hardest to describe.
"""
import pytest

from backend.config import SessionLocal
from backend.models import Book, GenericMap
from backend.services import variants
from backend.services.variants import VariantError
from backend.tests.conftest import make_book, make_game_system, make_map, make_token

API = "/api/duplicates"


@pytest.fixture
def system():
    return make_game_system()


def _link(client, headers, parent, child, kind="gridded", rtype="map", **extra):
    return client.post(
        f"{API}/link",
        headers=headers,
        json={
            "resource_type": rtype,
            "parent_id": parent,
            "children": [{"id": child, "kind": kind, "label": ""}],
            **extra,
        },
    )


def _describe(client, headers, item_id, kind="", label="", rtype="map"):
    return client.post(
        f"{API}/describe",
        headers=headers,
        json={"resource_type": rtype, "id": item_id, "kind": kind, "label": label},
    )


class TestDescribeService:
    def test_a_main_version_may_carry_a_kind_and_label(self):
        main = make_map(filename="Tavern_nogrid.png")
        db = SessionLocal()
        try:
            variants.describe(db, GenericMap, main.id, "Gridless", "  night  ", "map")
            db.commit()
            row = db.query(GenericMap).filter_by(id=main.id).first()
            assert row.variant_kind == "gridless"
            assert row.variant_label == "night"
        finally:
            db.close()

    def test_a_main_version_may_go_back_to_no_kind(self):
        main = make_map(variant_kind="gridless", variant_label="x")
        db = SessionLocal()
        try:
            variants.describe(db, GenericMap, main.id, "", "", "map")
            db.commit()
            row = db.query(GenericMap).filter_by(id=main.id).first()
            assert (row.variant_kind, row.variant_label) == ("", "")
        finally:
            db.close()

    def test_a_variant_still_needs_a_kind(self):
        main = make_map()
        child = make_map()
        db = SessionLocal()
        try:
            variants.link(db, GenericMap, main.id, child.id, "gridded", resource_type="map")
            db.commit()
            with pytest.raises(VariantError):
                variants.describe(db, GenericMap, child.id, "", "", "map")
        finally:
            db.close()

    def test_refuses_a_kind_the_collection_does_not_offer(self, system):
        book = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            with pytest.raises(VariantError):
                variants.describe(db, Book, book.id, "gridless", "", "book")
        finally:
            db.close()

    def test_refuses_a_missing_item(self):
        db = SessionLocal()
        try:
            with pytest.raises(VariantError) as exc:
                variants.describe(db, GenericMap, "nope", "gridless")
            assert exc.value.code == "not_found"
        finally:
            db.close()

    def test_promote_keeps_the_new_mains_description(self):
        """The kind describes the file, so a promoted gridded cut stays gridded."""
        main = make_map()
        child = make_map()
        db = SessionLocal()
        try:
            variants.link(db, GenericMap, main.id, child.id, "gridded", "v2", "map")
            db.commit()
            variants.promote(db, GenericMap, child.id, main.id, "gridless", "", "map")
            db.commit()
            row = db.query(GenericMap).filter_by(id=child.id).first()
            assert row.variant_parent_id is None
            assert (row.variant_kind, row.variant_label) == ("gridded", "v2")
        finally:
            db.close()

    def test_reparent_keeps_the_promoted_childs_description(self):
        main = make_map()
        a = make_map()
        b = make_map()
        db = SessionLocal()
        try:
            variants.link(db, GenericMap, main.id, a.id, "gridded", resource_type="map")
            variants.link(db, GenericMap, main.id, b.id, "video", resource_type="map")
            db.commit()
            variants.reparent_children(db, GenericMap, main.id, a.id)
            db.commit()
            row = db.query(GenericMap).filter_by(id=a.id).first()
            assert row.variant_parent_id is None
            assert row.variant_kind == "gridded"
        finally:
            db.close()


class TestDescribeEndpoint:
    def test_names_the_main_in_every_family_detail(self, client, admin_headers):
        main = make_map(filename="Tavern_nogrid.png")
        child = make_map(filename="Tavern_grid.png")
        assert _link(client, admin_headers, main.id, child.id).status_code == 200

        resp = _describe(client, admin_headers, main.id, "gridless", "")
        assert resp.status_code == 200
        assert resp.json() == {"id": main.id, "kind": "gridless", "label": ""}

        # From the main itself, and from the variant - the viewer holding the
        # variant is the one that cannot read the main's row.
        for item_id in (main.id, child.id):
            body = client.get(f"/api/maps/{item_id}", headers=admin_headers).json()
            assert body["variant_main_id"] == main.id
            assert body["variant_main_kind"] == "gridless"
            assert body["variant_main_label"] == ""
            assert body["variant_main_filename"] == "Tavern_nogrid.png"

    def test_renames_a_variant_without_naming_its_parent(self, client, admin_headers):
        main = make_map()
        child = make_map()
        _link(client, admin_headers, main.id, child.id)
        resp = _describe(client, admin_headers, child.id, "gridded", "night")
        assert resp.status_code == 200
        body = client.get(f"/api/maps/{main.id}", headers=admin_headers).json()
        assert body["variants"][0]["label"] == "night"
        assert body["variant_main_kind"] == ""

    def test_bad_kind_is_a_400(self, client, admin_headers):
        token = make_token()
        resp = _describe(client, admin_headers, token.id, "gridless", rtype="token")
        assert resp.status_code == 400

    def test_missing_item_is_a_404(self, client, admin_headers):
        assert _describe(client, admin_headers, "nope", "gridless").status_code == 404

    def test_admin_only(self, client, gm_headers):
        main = make_map()
        assert _describe(client, gm_headers, main.id, "gridless").status_code == 403

    def test_book_detail_carries_the_main_fields(self, client, admin_headers, system):
        main = make_book(system_id=system.id, filename="core.pdf")
        child = make_book(system_id=system.id)
        _link(client, admin_headers, main.id, child.id, kind="printer-friendly", rtype="book")
        _describe(client, admin_headers, main.id, "form-fillable", "v2", rtype="book")
        body = client.get(f"/api/books/{child.id}", headers=admin_headers).json()
        assert body["variant_main_kind"] == "form-fillable"
        assert body["variant_main_label"] == "v2"
        assert body["variant_main_filename"] == "core.pdf"


class TestLinkDescribesParent:
    def test_link_can_name_the_parent(self, client, admin_headers):
        main = make_map()
        child = make_map()
        resp = _link(client, admin_headers, main.id, child.id, parent_kind="gridless")
        assert resp.status_code == 200
        assert resp.json()["errors"] == []
        body = client.get(f"/api/maps/{main.id}", headers=admin_headers).json()
        assert body["variant_main_kind"] == "gridless"

    def test_parent_fields_left_out_leave_it_alone(self, client, admin_headers):
        main = make_map(variant_kind="gridless", variant_label="keep")
        child = make_map()
        _link(client, admin_headers, main.id, child.id)
        body = client.get(f"/api/maps/{main.id}", headers=admin_headers).json()
        assert (body["variant_main_kind"], body["variant_main_label"]) == ("gridless", "keep")

    def test_label_alone_keeps_the_existing_kind(self, client, admin_headers):
        main = make_map(variant_kind="gridless")
        child = make_map()
        _link(client, admin_headers, main.id, child.id, parent_label="Night")
        body = client.get(f"/api/maps/{main.id}", headers=admin_headers).json()
        assert (body["variant_main_kind"], body["variant_main_label"]) == ("gridless", "Night")

    def test_a_bad_parent_kind_is_reported_not_fatal(self, client, admin_headers):
        """The child link still lands - matching the per-item error contract."""
        main = make_map()
        child = make_map()
        resp = _link(client, admin_headers, main.id, child.id, parent_kind="form-fillable")
        assert resp.status_code == 200
        body = resp.json()
        assert body["linked"] == [child.id]
        assert body["errors"][0]["id"] == main.id

    def test_nothing_linked_means_the_parent_is_not_touched(self, client, admin_headers):
        main = make_map()
        resp = _link(client, admin_headers, main.id, main.id, parent_kind="gridless")
        assert resp.json()["linked"] == []
        body = client.get(f"/api/maps/{main.id}", headers=admin_headers).json()
        assert body["variant_main_kind"] == ""


class TestCompareSuggestions:
    def test_suggests_a_kind_for_both_sides(self, client, admin_headers):
        gridless = make_map(filename="Tavern_nogrid.png")
        gridded = make_map(filename="Tavern_grid.png")
        body = client.get(
            f"{API}/compare?resource_type=map&ids={gridless.id}&ids={gridded.id}",
            headers=admin_headers,
        ).json()
        kinds = {i["id"]: i["suggested_kind"] for i in body["items"]}
        assert kinds == {gridless.id: "gridless", gridded.id: "gridded"}

    def test_no_suggestion_for_a_wider_compare(self, client, admin_headers):
        ids = [make_map(filename=f"m{i}_grid.png").id for i in range(3)]
        qs = "&".join(f"ids={i}" for i in ids)
        body = client.get(f"{API}/compare?resource_type=map&{qs}", headers=admin_headers).json()
        assert all(i["suggested_kind"] == "" for i in body["items"])


class TestResourceSearch:
    def test_hit_carries_the_mains_description(self, client, admin_headers):
        main = make_map(filename="Zzqx_nogrid.png", variant_kind="gridless")
        child = make_map(filename="Zzqx_grid.png")
        _link(client, admin_headers, main.id, child.id)
        resp = client.get(
            "/api/campaigns/resources/search?q=Zzqx&resource_type=map", headers=admin_headers
        )
        assert resp.status_code == 200
        hits = [h for h in resp.json() if h["resource_id"] == main.id]
        assert hits and hits[0]["variant_kind"] == "gridless"
