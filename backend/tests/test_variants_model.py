"""The variant grouping rules: two levels, same collection, nothing lost.

These guards are the backbone of the feature — the schema deliberately does not
enforce them (see migration 0025), so this is where they live or die.
"""
import pytest

from backend.config import SessionLocal
from backend.models import Audio, Book, GenericMap, Token
from backend.services import variants
from backend.services.variants import VariantError
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


def _fresh(db, model, record):
    return db.query(model).filter_by(id=record.id).first()


class TestLinking:
    def test_links_a_child_to_a_parent(self, system):
        parent = make_book(system_id=system.id, title="Core Rules")
        child = make_book(system_id=system.id, title="Core Rules (Printer Friendly)")
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "printer-friendly", "B&W")
            db.commit()
            row = _fresh(db, Book, child)
            assert row.variant_parent_id == parent.id
            assert row.variant_kind == "printer-friendly"
            assert row.variant_label == "B&W"
        finally:
            db.close()

    def test_rejects_self_parent(self, system):
        book = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            with pytest.raises(VariantError) as exc:
                variants.link(db, Book, book.id, book.id, "other")
            assert "itself" in str(exc.value)
        finally:
            db.close()

    def test_rejects_grandchildren(self, system):
        """Two levels only — linking under a variant is refused."""
        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        grandchild = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "version")
            db.commit()
            with pytest.raises(VariantError) as exc:
                variants.link(db, Book, child.id, grandchild.id, "version")
            assert exc.value.code == "conflict"
            assert "main version" in str(exc.value)
        finally:
            db.close()

    def test_rejects_parent_that_already_has_children(self, system):
        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        other = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "version")
            db.commit()
            # `parent` has a child, so it cannot itself become a variant.
            with pytest.raises(VariantError) as exc:
                variants.link(db, Book, other.id, parent.id, "version")
            assert "variant(s) of its own" in str(exc.value)
        finally:
            db.close()

    def test_rejects_unknown_kind(self, system):
        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            with pytest.raises(VariantError) as exc:
                variants.link(db, Book, parent.id, child.id, "not-a-real-kind")
            assert "Unknown variant kind" in str(exc.value)
        finally:
            db.close()

    def test_rejects_missing_rows(self, system):
        book = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            with pytest.raises(VariantError) as exc:
                variants.link(db, Book, "no-such-id", book.id, "other")
            assert exc.value.code == "not_found"
            with pytest.raises(VariantError) as exc:
                variants.link(db, Book, book.id, "no-such-id", "other")
            assert exc.value.code == "not_found"
        finally:
            db.close()

    def test_kind_is_normalised(self, system):
        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "  Printer-Friendly  ")
            db.commit()
            assert _fresh(db, Book, child).variant_kind == "printer-friendly"
        finally:
            db.close()

    def test_label_is_truncated(self, system):
        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "version", "x" * 300)
            db.commit()
            assert len(_fresh(db, Book, child).variant_label) == 120
        finally:
            db.close()


class TestQueries:
    def test_parents_only_hides_variants(self, system):
        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "version")
            db.commit()
            visible = variants.parents_only(db.query(Book), Book).all()
            ids = {b.id for b in visible}
            assert parent.id in ids
            assert child.id not in ids
            # ...but the row is still reachable by id.
            assert db.query(Book).filter_by(id=child.id).first() is not None
        finally:
            db.close()

    def test_variant_counts_batches(self, system):
        p1 = make_book(system_id=system.id)
        p2 = make_book(system_id=system.id)
        c1 = make_book(system_id=system.id)
        c2 = make_book(system_id=system.id)
        c3 = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, p1.id, c1.id, "version")
            variants.link(db, Book, p1.id, c2.id, "spreads")
            variants.link(db, Book, p2.id, c3.id, "version")
            db.commit()
            counts = variants.variant_counts(db, Book, [p1.id, p2.id])
            assert counts == {p1.id: 2, p2.id: 1}
            assert variants.variant_counts(db, Book, []) == {}
        finally:
            db.close()

    def test_family_resolves_from_either_end(self, system):
        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "version")
            db.commit()
            from_parent, kids = variants.family_for(db, Book, _fresh(db, Book, parent))
            assert from_parent.id == parent.id and [k.id for k in kids] == [child.id]
            from_child, kids2 = variants.family_for(db, Book, _fresh(db, Book, child))
            assert from_child.id == parent.id and [k.id for k in kids2] == [child.id]
        finally:
            db.close()

    def test_family_tolerates_a_dangling_parent(self, system):
        """A parent deleted outside the service layer must not break the viewer."""
        child = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            row = _fresh(db, Book, child)
            row.variant_parent_id = "gone-forever"
            db.commit()
            parent, kids = variants.family_for(db, Book, _fresh(db, Book, child))
            assert parent.id == child.id
            assert kids == []
        finally:
            db.close()

    def test_serialize_includes_book_fields_only_for_books(self, system):
        book = make_book(system_id=system.id, title="T", page_count=10)
        mapp = make_map()
        db = SessionLocal()
        try:
            b = variants.serialize_variant(_fresh(db, Book, book))
            assert b["title"] == "T" and b["page_count"] == 10 and "mime_type" in b
            m = variants.serialize_variant(_fresh(db, GenericMap, mapp))
            assert "title" not in m and "page_count" not in m
            assert m["id"] == mapp.id
        finally:
            db.close()


class TestUnlinking:
    def test_unlink_promotes(self, system):
        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "version", "v2")
            db.commit()
            assert variants.unlink(db, Book, [child.id]) == [child.id]
            db.commit()
            row = _fresh(db, Book, child)
            assert row.variant_parent_id is None
            assert row.variant_kind == "" and row.variant_label == ""
            # Already-standalone rows are skipped, not re-reported.
            assert variants.unlink(db, Book, [child.id]) == []
            assert variants.unlink(db, Book, []) == []
        finally:
            db.close()

    def test_unlink_children_promotes_the_whole_family(self, system):
        parent = make_book(system_id=system.id)
        kids = [make_book(system_id=system.id) for _ in range(3)]
        db = SessionLocal()
        try:
            for k in kids:
                variants.link(db, Book, parent.id, k.id, "version")
            db.commit()
            assert variants.unlink_children(db, Book, parent.id) == 3
            db.commit()
            assert variants.variants_of(db, Book, parent.id) == []
            for k in kids:
                assert _fresh(db, Book, k).variant_parent_id is None
        finally:
            db.close()

    def test_reparent_moves_siblings_onto_the_new_parent(self, system):
        parent = make_book(system_id=system.id)
        heir = make_book(system_id=system.id)
        sibling = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, heir.id, "version")
            variants.link(db, Book, parent.id, sibling.id, "spreads")
            db.commit()
            moved = variants.reparent_children(db, Book, parent.id, heir.id)
            db.commit()
            assert moved == 1
            assert _fresh(db, Book, heir).variant_parent_id is None
            assert _fresh(db, Book, sibling).variant_parent_id == heir.id
        finally:
            db.close()

    def test_reparent_rejects_an_outsider(self, system):
        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        outsider = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "version")
            db.commit()
            with pytest.raises(VariantError) as exc:
                variants.reparent_children(db, Book, parent.id, outsider.id)
            assert "must be one of this item's variants" in str(exc.value)
        finally:
            db.close()

    def test_reparent_with_no_heir_promotes_everyone(self, system):
        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "version")
            db.commit()
            assert variants.reparent_children(db, Book, parent.id, None) == 1
            db.commit()
            assert _fresh(db, Book, child).variant_parent_id is None
        finally:
            db.close()


class TestAllCollections:
    """Maps, tokens, and audio carry the same columns and the same rules."""

    @pytest.mark.parametrize(
        "factory,model,kind",
        [
            (make_map, GenericMap, "gridless"),
            (make_token, Token, "other"),
            (make_audio, Audio, "version"),
        ],
    )
    def test_media_link_and_hide(self, factory, model, kind):
        parent = factory()
        child = factory()
        db = SessionLocal()
        try:
            variants.link(db, model, parent.id, child.id, kind)
            db.commit()
            ids = {r.id for r in variants.parents_only(db.query(model), model).all()}
            assert parent.id in ids and child.id not in ids
            assert [c.id for c in variants.variants_of(db, model, parent.id)] == [child.id]
        finally:
            db.close()


class TestPromote:
    """Handing an established family a different main version.

    The scenario, from issue #304 review: a user links a printable copy under a
    form-fillable one, then meets a lined copy they consider the real edition.
    Plain ``link`` refuses that ("has variants of its own"), which would strand
    them with whichever copy they happened to review first.
    """

    def test_promotes_an_outsider_and_rehomes_the_family(self, system):
        form = make_book(system_id=system.id, title="Sheet (Form Fillable)")
        printable = make_book(system_id=system.id, title="Sheet (Printable)")
        lined = make_book(system_id=system.id, title="Sheet (Lined)")
        db = SessionLocal()
        try:
            variants.link(db, Book, form.id, printable.id, "printer-friendly")
            db.commit()

            moved = variants.promote(db, Book, lined.id, form.id, "form-fillable", "v2")
            db.commit()

            # The new parent stands alone...
            assert _fresh(db, Book, lined).variant_parent_id is None
            # ...the old parent is now a variant of it, described as asked...
            old = _fresh(db, Book, form)
            assert old.variant_parent_id == lined.id
            assert old.variant_kind == "form-fillable"
            assert old.variant_label == "v2"
            # ...and its child came along rather than dangling under a variant,
            # which would be the three-level tree the rules forbid.
            assert _fresh(db, Book, printable).variant_parent_id == lined.id
            assert moved == 2
        finally:
            db.close()

    def test_promotes_a_child_over_its_own_parent(self, system):
        parent = make_book(system_id=system.id, title="Core")
        child = make_book(system_id=system.id, title="Core (Revised)")
        other = make_book(system_id=system.id, title="Core (Printable)")
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "version")
            variants.link(db, Book, parent.id, other.id, "printer-friendly")
            db.commit()

            variants.promote(db, Book, child.id, parent.id, "version", "old")
            db.commit()

            assert _fresh(db, Book, child).variant_parent_id is None
            assert _fresh(db, Book, child).variant_kind == ""
            assert _fresh(db, Book, parent).variant_parent_id == child.id
            assert _fresh(db, Book, other).variant_parent_id == child.id
        finally:
            db.close()

    def test_promotes_a_lone_parent_with_no_children(self, system):
        a = make_book(system_id=system.id)
        b = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            moved = variants.promote(db, Book, b.id, a.id, "other")
            db.commit()
            assert _fresh(db, Book, a).variant_parent_id == b.id
            assert moved == 1
        finally:
            db.close()

    def test_rejects_self_promotion(self, system):
        book = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            with pytest.raises(VariantError) as exc:
                variants.promote(db, Book, book.id, book.id, "other")
            assert "itself" in str(exc.value)
        finally:
            db.close()

    def test_rejects_a_new_parent_owned_by_another_family(self, system):
        a_parent = make_book(system_id=system.id)
        a_child = make_book(system_id=system.id)
        b_parent = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, a_parent.id, a_child.id, "other")
            db.commit()
            with pytest.raises(VariantError) as exc:
                variants.promote(db, Book, a_child.id, b_parent.id, "other")
            assert "already a variant" in str(exc.value)
        finally:
            db.close()

    def test_rejects_demoting_something_that_is_itself_a_variant(self, system):
        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        outsider = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            variants.link(db, Book, parent.id, child.id, "other")
            db.commit()
            with pytest.raises(VariantError) as exc:
                variants.promote(db, Book, outsider.id, child.id, "other")
            assert "itself a variant" in str(exc.value)
        finally:
            db.close()

    def test_rejects_missing_rows(self, system):
        book = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            with pytest.raises(VariantError) as exc:
                variants.promote(db, Book, "nope", book.id, "other")
            assert exc.value.code == "not_found"
            with pytest.raises(VariantError) as exc:
                variants.promote(db, Book, book.id, "nope", "other")
            assert exc.value.code == "not_found"
        finally:
            db.close()

    def test_validates_the_demoted_kind(self, system):
        a = make_book(system_id=system.id)
        b = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            with pytest.raises(VariantError):
                variants.promote(db, Book, b.id, a.id, "not-a-kind")
        finally:
            db.close()


class TestKindVocabulary:
    """The kind vocabulary is scoped per collection (models/variants.py)."""

    def test_kinds_for_returns_only_that_collections_kinds(self):
        from backend.models.variants import kinds_for

        assert "gridless" in kinds_for("map")
        assert "gridless" not in kinds_for("token")
        assert "form-fillable" in kinds_for("book")
        assert "form-fillable" not in kinds_for("audio")
        assert "remix" in kinds_for("audio")
        assert "remix" not in kinds_for("map")
        assert "color-variation" in kinds_for("token")
        assert "color-variation" not in kinds_for("book")

    def test_map_only_kinds_are_map_only(self):
        from backend.models.variants import VARIANT_KINDS_BY_TYPE, kinds_for

        for kind in ("universal-vtt", "video", "image", "gridded", "gridless"):
            assert kind in kinds_for("map"), kind
            for other in set(VARIANT_KINDS_BY_TYPE) - {"map"}:
                assert kind not in kinds_for(other), (kind, other)

    def test_version_and_other_are_universal(self):
        from backend.models.variants import VARIANT_KINDS_BY_TYPE, kinds_for

        for rtype in VARIANT_KINDS_BY_TYPE:
            assert {"version", "other"} <= kinds_for(rtype), rtype

    def test_printer_friendly_and_black_and_white_reach(self):
        from backend.models.variants import kinds_for

        # printer-friendly: book and map. black-and-white: those plus tokens.
        assert "printer-friendly" in kinds_for("book")
        assert "printer-friendly" in kinds_for("map")
        assert "printer-friendly" not in kinds_for("token")
        assert "printer-friendly" not in kinds_for("audio")
        for rtype in ("book", "map", "token"):
            assert "black-and-white" in kinds_for(rtype), rtype
        assert "black-and-white" not in kinds_for("audio")

    def test_unknown_resource_type_accepts_everything(self):
        from backend.models.variants import VARIANT_KINDS, kinds_for

        # Callers that do not know their collection keep pre-scoping behaviour.
        assert kinds_for("") == VARIANT_KINDS
        assert kinds_for("widget") == VARIANT_KINDS

    def test_flat_set_is_the_union(self):
        from backend.models.variants import VARIANT_KINDS, VARIANT_KINDS_BY_TYPE

        union = set().union(*VARIANT_KINDS_BY_TYPE.values())
        assert VARIANT_KINDS == union


class TestValidateKind:
    def test_normalises_case_and_whitespace(self):
        assert variants.validate_kind("  GridLess ", "map") == "gridless"

    def test_rejects_a_kind_from_another_collection(self):
        with pytest.raises(VariantError) as excinfo:
            variants.validate_kind("gridless", "audio")
        # The message lists what *is* accepted, so the caller can fix it.
        assert "remix" in excinfo.value.message
        assert excinfo.value.code == "invalid"

    def test_no_resource_type_accepts_any_kind(self):
        assert variants.validate_kind("gridless") == "gridless"
        assert variants.validate_kind("remix") == "remix"

    def test_keeps_a_legacy_kind_the_row_already_has(self):
        # A token filed as form-fillable before the vocabulary was scoped.
        assert variants.validate_kind("form-fillable", "token", "form-fillable") == "form-fillable"

    def test_legacy_exemption_does_not_extend_to_other_kinds(self):
        with pytest.raises(VariantError):
            variants.validate_kind("spreads", "token", "form-fillable")

    def test_still_rejects_a_kind_no_collection_defines(self):
        with pytest.raises(VariantError):
            variants.validate_kind("bogus", "map", "bogus")
