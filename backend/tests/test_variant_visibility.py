"""Where a variant is hidden, and — just as important — where it is not.

This is the regression net for the whole variant feature. A variant is hidden
from browsing, counts, and search so one book occupies one shelf slot, but it
stays a first-class row: reachable by id, downloadable, cleanable, and counted
where the count is about files rather than titles. Getting either half wrong is
a bug, and the two halves pull in opposite directions, so both are asserted here.

The test DB is shared session-wide (see conftest), so every assertion is about
*these* ids — never about global totals.
"""
from pathlib import Path

import pytest

from backend.config import SessionLocal
from backend.models import Audio, Book, GenericMap, Token
from backend.services import variants
from backend.tests.conftest import (
    make_audio,
    make_book,
    make_game_system,
    make_map,
    make_token,
)


@pytest.fixture
def system():
    return make_game_system()


@pytest.fixture
def pair(system):
    """A parent book and a variant of it, already linked."""
    parent = make_book(system_id=system.id, title="Visibility Core", category="core")
    child = make_book(system_id=system.id, title="Visibility Core PF", category="core")
    db = SessionLocal()
    try:
        variants.link(db, Book, parent.id, child.id, "printer-friendly", "B&W")
        db.commit()
    finally:
        db.close()
    return parent, child


class TestHidden:
    def test_book_list(self, client, admin_headers, system, pair):
        parent, child = pair
        body = client.get(f"/api/books?system_id={system.id}", headers=admin_headers).json()
        ids = [b["id"] for b in body["books"]]
        assert parent.id in ids
        assert child.id not in ids

    def test_book_list_reports_variant_count(self, client, admin_headers, system, pair):
        parent, _ = pair
        body = client.get(f"/api/books?system_id={system.id}", headers=admin_headers).json()
        row = next(b for b in body["books"] if b["id"] == parent.id)
        assert row["variant_count"] == 1

    def test_system_detail_grid_and_count(self, client, admin_headers, system, pair):
        parent, child = pair
        body = client.get(f"/api/systems/{system.id}", headers=admin_headers).json()
        ids = [b["id"] for b in body["books"]]
        assert parent.id in ids and child.id not in ids
        # The card's count must agree with the number of rows rendered.
        assert body["book_count"] == len(ids)

    def test_system_detail_reports_variant_count(self, client, admin_headers, system, pair):
        """The system detail rows must carry the badge signal too.

        Regression: this endpoint hid the variant but serialized no
        variant_count, so every book on the system page reported "no other
        versions" — which silently disabled the badge, the download version
        picker, and the versions editor on the one page most likely to show a
        book that has them.
        """
        parent, _ = pair
        body = client.get(f"/api/systems/{system.id}", headers=admin_headers).json()
        row = next(b for b in body["books"] if b["id"] == parent.id)
        assert row["variant_count"] == 1

    def test_system_detail_count_is_zero_without_variants(self, client, admin_headers, system):
        solo = make_book(system_id=system.id, title="Visibility Solo", category="core")
        body = client.get(f"/api/systems/{system.id}", headers=admin_headers).json()
        row = next(b for b in body["books"] if b["id"] == solo.id)
        assert row["variant_count"] == 0

    def test_systems_list_count(self, client, admin_headers, system, pair):
        body = client.get("/api/systems", headers=admin_headers).json()
        systems = body["systems"] if isinstance(body, dict) else body
        row = next(s for s in systems if s["id"] == system.id)
        assert row["book_count"] == 1

    def test_search_hides_the_variant(self, client, admin_headers, system, pair):
        parent, child = pair
        db = SessionLocal()
        try:
            from sqlalchemy import text

            for book_id in (parent.id, child.id):
                db.execute(
                    text(
                        "INSERT INTO book_search (book_id, page_number, content) "
                        "VALUES (:b, 1, 'zzqqx unique needle')"
                    ),
                    {"b": book_id},
                )
            db.commit()
        finally:
            db.close()

        body = client.get("/api/search?q=zzqqx", headers=admin_headers).json()
        hit_ids = {r["id"] for r in body.get("results", [])}
        assert parent.id in hit_ids
        assert child.id not in hit_ids

        scoped = client.get(
            f"/api/search?q=zzqqx&system_id={system.id}", headers=admin_headers
        ).json()
        scoped_ids = {r["id"] for r in scoped.get("results", [])}
        assert parent.id in scoped_ids
        assert child.id not in scoped_ids

    def test_search_within_a_variant_still_works(self, client, admin_headers, pair):
        """Scoping to one book by id must work even when that book is a variant."""
        _, child = pair
        db = SessionLocal()
        try:
            from sqlalchemy import text

            db.execute(
                text(
                    "INSERT INTO book_search (book_id, page_number, content) "
                    "VALUES (:b, 1, 'wwvvz inner needle')"
                ),
                {"b": child.id},
            )
            db.commit()
        finally:
            db.close()

        body = client.get(
            f"/api/search?q=wwvvz&book_id={child.id}", headers=admin_headers
        ).json()
        assert {r["id"] for r in body.get("results", [])} == {child.id}

    @pytest.mark.parametrize(
        "factory,model,path,key",
        [
            (make_map, GenericMap, "/api/maps", "maps"),
            (make_token, Token, "/api/tokens", "tokens"),
            (make_audio, Audio, "/api/audio", "audio"),
        ],
    )
    def test_media_lists(self, client, admin_headers, factory, model, path, key):
        parent, child = factory(), factory()
        db = SessionLocal()
        try:
            variants.link(db, model, parent.id, child.id, "other")
            db.commit()
        finally:
            db.close()
        body = client.get(f"{path}?limit=100000", headers=admin_headers).json()
        ids = [i["id"] for i in body[key]]
        assert parent.id in ids
        assert child.id not in ids
        row = next(i for i in body[key] if i["id"] == parent.id)
        assert row["variant_count"] == 1

    def test_stats_counts_titles_not_files(self, client, admin_headers, system):
        """Item counts drop variants; total size keeps their bytes."""
        before = client.get("/api/stats", headers=admin_headers).json()
        parent = make_book(system_id=system.id, file_size=1000)
        child = make_book(system_id=system.id, file_size=1000)
        after_add = client.get("/api/stats", headers=admin_headers).json()
        assert after_add["books"] == before["books"] + 2

        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "version")
            db.commit()
        finally:
            db.close()

        after_link = client.get("/api/stats", headers=admin_headers).json()
        # One fewer *title*...
        assert after_link["books"] == after_add["books"] - 1
        # ...but the bytes are still on disk, so size is unchanged.
        assert after_link["total_size_mb"] == after_add["total_size_mb"]


class TestStillReachable:
    def test_variant_detail_by_id(self, client, admin_headers, pair):
        parent, child = pair
        body = client.get(f"/api/books/{child.id}", headers=admin_headers).json()
        assert body["id"] == child.id
        assert body["variant_parent_id"] == parent.id
        assert body["variant_kind"] == "printer-friendly"
        assert body["variant_main_id"] == parent.id

    def test_family_is_returned_from_either_end(self, client, admin_headers, pair):
        parent, child = pair
        from_parent = client.get(f"/api/books/{parent.id}", headers=admin_headers).json()
        from_child = client.get(f"/api/books/{child.id}", headers=admin_headers).json()
        assert [v["id"] for v in from_parent["variants"]] == [child.id]
        assert [v["id"] for v in from_child["variants"]] == [child.id]

    def test_book_with_no_variants_has_an_empty_family(self, client, admin_headers, system):
        book = make_book(system_id=system.id)
        body = client.get(f"/api/books/{book.id}", headers=admin_headers).json()
        assert body["variants"] == []
        assert body["variant_main_id"] == book.id
        assert body["variant_parent_id"] is None

    def test_orphaned_system_pruning_counts_variants(self, system):
        """A system whose only books are variants is not empty — it must survive."""
        from backend.models import GameSystem
        from backend.routers.maintenance._helpers import _prune_orphaned_systems

        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "version")
            db.commit()
            _prune_orphaned_systems(db)
            assert db.query(GameSystem).filter_by(id=system.id).first() is not None
        finally:
            db.close()

    def test_downloads_include_variants(self):
        """A system archive should hold every file, not just the visible ones."""
        import os

        from backend.routers.downloads._helpers import _files_for_system

        system = make_game_system()
        # _safe_filepath rejects anything outside the library root, so the files
        # have to live there rather than in a tmp_path.
        root = os.path.join(os.environ["LIBRARY_PATH"], "books", "variant-dl")
        os.makedirs(root, exist_ok=True)
        a = Path(root) / "main.pdf"
        b = Path(root) / "printer.pdf"
        a.write_bytes(b"%PDF-1.4 a")
        b.write_bytes(b"%PDF-1.4 b")
        parent = make_book(system_id=system.id, filepath=str(a), filename="main.pdf")
        child = make_book(system_id=system.id, filepath=str(b), filename="printer.pdf")

        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "printer-friendly")
            db.commit()
            files, _name = _files_for_system(db, system.id, True)
            arcnames = {arc for _path, arc in files}
            assert any("main.pdf" in n for n in arcnames)
            # The variant is deliberately included - see _files_for_system.
            assert any("printer.pdf" in n for n in arcnames)
        finally:
            db.close()


class TestVariantKinds:
    """What the other versions *are*, not just how many.

    The gallery card names the versions ("Universal VTT", "Video") instead of
    showing a bare count, so the kinds have to reach the list rows — and, like
    the count, they have to do it in one query per page rather than one per row.
    """

    def test_service_groups_kinds_by_parent(self):
        a, b = make_map(), make_map()
        a_vtt, a_video, b_video = make_map(), make_map(), make_map()
        db = SessionLocal()
        try:
            variants.link(db, GenericMap, a.id, a_vtt.id, "universal-vtt")
            variants.link(db, GenericMap, a.id, a_video.id, "video")
            variants.link(db, GenericMap, b.id, b_video.id, "video")
            db.commit()
            kinds = variants.variant_kinds(db, GenericMap, [a.id, b.id])
        finally:
            db.close()
        assert kinds[a.id] == ["universal-vtt", "video"]
        assert kinds[b.id] == ["video"]

    def test_service_deduplicates_repeated_kinds(self):
        parent = make_map()
        # Rows are created up front: make_map opens its own session, and doing
        # that inside an open one deadlocks the shared SQLite test DB.
        children = [make_map() for _ in range(3)]
        db = SessionLocal()
        try:
            for child in children:
                variants.link(db, GenericMap, parent.id, child.id, "video")
            db.commit()
            kinds = variants.variant_kinds(db, GenericMap, [parent.id])
        finally:
            db.close()
        # Three video cuts are still one kind of thing to tell the user about.
        assert kinds[parent.id] == ["video"]

    def test_service_omits_parents_with_no_kinded_variants(self):
        """A variant linked without a kind leaves the count to speak for it."""
        parent, child, lonely = make_map(), make_map(), make_map()
        db = SessionLocal()
        try:
            # link() refuses an empty kind, so the column is set directly — this
            # is the shape of a row linked before a kind was recorded.
            db.query(GenericMap).filter_by(id=child.id).update(
                {"variant_parent_id": parent.id, "variant_kind": ""}
            )
            db.commit()
            kinds = variants.variant_kinds(db, GenericMap, [parent.id, lonely.id])
        finally:
            db.close()
        assert parent.id not in kinds
        assert lonely.id not in kinds

    def test_service_handles_empty_input(self):
        db = SessionLocal()
        try:
            assert variants.variant_kinds(db, GenericMap, []) == {}
            assert variants.variant_kinds(db, GenericMap, [""]) == {}
        finally:
            db.close()

    @pytest.mark.parametrize(
        "factory,model,path,key",
        [
            (make_map, GenericMap, "/api/maps", "maps"),
            (make_token, Token, "/api/tokens", "tokens"),
            (make_audio, Audio, "/api/audio", "audio"),
        ],
    )
    def test_media_lists_expose_kinds(self, client, admin_headers, factory, model, path, key):
        parent, child = factory(), factory()
        db = SessionLocal()
        try:
            # "version" is universal, so one parametrised case covers all three.
            variants.link(db, model, parent.id, child.id, "version")
            db.commit()
        finally:
            db.close()
        body = client.get(f"{path}?limit=100000", headers=admin_headers).json()
        row = next(i for i in body[key] if i["id"] == parent.id)
        assert row["variant_kinds"] == ["version"]

    def test_list_row_without_variants_reports_empty_kinds(self, client, admin_headers):
        lonely = make_map()
        body = client.get("/api/maps?limit=100000", headers=admin_headers).json()
        row = next(i for i in body["maps"] if i["id"] == lonely.id)
        assert row["variant_count"] == 0
        assert row["variant_kinds"] == []
