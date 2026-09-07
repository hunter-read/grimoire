"""The collection registry is the single source of truth — prove it stays that way.

``models/collections.py`` exists so "every collection" is written once. This
suite is the enforcement: it imports each table that still spells the
collections out by hand and asserts it agrees with the registry. A sixth
collection added to ``COLLECTIONS`` but missed somewhere fails here, loudly,
instead of failing silently in production the way the pre-registry tables could
— an unlisted type dropped its tags, orphaned its references on delete, or
refused a scoped rescan with no error anywhere.
"""
import pytest

from backend.models.collections import (
    COLLECTIONS,
    MEDIA_SINGULARS,
    SECTIONS,
    SINGULARS,
    models_by_singular,
    section_for,
    singular_for,
    spec_for,
    spec_for_model,
    spec_for_section,
    thumb_sections,
)


class TestRegistryShape:
    def test_every_spec_is_keyed_by_its_own_singular(self):
        for key, spec in COLLECTIONS.items():
            assert spec.singular == key

    def test_sections_are_unique(self):
        assert len(set(SECTIONS)) == len(SECTIONS)

    def test_models_are_unique(self):
        models = [spec.model for spec in COLLECTIONS.values()]
        assert len(set(models)) == len(models)

    def test_folder_models_are_unique(self):
        folders = [spec.folder_model for spec in COLLECTIONS.values()]
        assert len(set(folders)) == len(folders)

    def test_media_singulars_exclude_books(self):
        """Books are the one collection with category/container structure."""
        assert "book" not in MEDIA_SINGULARS
        assert set(MEDIA_SINGULARS) | {"book"} == set(SINGULARS)

    @pytest.mark.parametrize("singular", list(COLLECTIONS))
    def test_singular_section_round_trip(self, singular):
        """Neither spelling is derivable from the other — "audio" is its own plural."""
        assert singular_for(section_for(singular)) == singular

    @pytest.mark.parametrize("singular", list(COLLECTIONS))
    def test_lookups_agree(self, singular):
        spec = spec_for(singular)
        assert spec is not None
        assert spec_for_section(spec.section) is spec
        assert spec_for_model(spec.model) is spec

    def test_unknown_lookups_return_none(self):
        assert spec_for("nonsense") is None
        assert spec_for_section("nonsense") is None
        assert spec_for_model(object) is None
        assert section_for("nonsense") is None
        assert singular_for("nonsense") is None

    def test_mergeable_fields_exclude_file_identity(self):
        """Copying any of these across a merge would corrupt the row's link to its file."""
        forbidden = {
            "id",
            "filepath",
            "filename",
            "relative_path",
            "content_hash",
            "file_mtime",
            "file_size",
            "variant_parent_id",
            "variant_kind",
            "variant_label",
        }
        for spec in COLLECTIONS.values():
            assert not (spec.mergeable_fields & forbidden), spec.singular

    @pytest.mark.parametrize("singular", list(COLLECTIONS))
    def test_declared_fields_exist_on_the_model(self, singular):
        """A typo'd field name would silently never copy or never display."""
        spec = COLLECTIONS[singular]
        columns = set(spec.model.__table__.columns.keys())
        # `tags` is a shared-tag relation resolved by the tag service, not a
        # column on the row (issue #235), so it is exempt from the check.
        declared = (spec.mergeable_fields | set(spec.compare_fields)) - {"tags"}
        assert declared <= columns, declared - columns


class TestThumbnailSections:
    def test_derived_from_specs(self):
        assert thumb_sections() == {
            spec.section: spec.thumb_section
            for spec in COLLECTIONS.values()
            if spec.thumb_section
        }

    def test_audio_has_no_thumbnail_directory(self):
        """Audio art is embedded or folder artwork resolved per request, not a file."""
        assert COLLECTIONS["audio"].thumb_section is None
        assert "audio" not in thumb_sections()

    def test_collections_with_has_thumbnail_declare_a_section(self):
        """A collection that stores has_thumbnail writes a file, so it needs a home.

        This is the invariant whose violation strands thumbnails on disk after a
        delete and shows a broken image after a move.
        """
        for spec in COLLECTIONS.values():
            if "has_thumbnail" in spec.model.__table__.columns:
                assert spec.thumb_section, f"{spec.singular} renders but has no section"


class TestDownstreamTablesAgree:
    """Every table that still enumerates collections by hand must match the registry."""

    def test_bulk_service(self):
        from backend.services.bulk_service import _MODELS

        # The bulk service also edits game systems, which are not a collection.
        assert {k: v for k, v in _MODELS.items() if k != "system"} == models_by_singular()

    def test_duplicates_router_models(self):
        from backend.routers.duplicates._helpers import MODELS

        assert MODELS == models_by_singular()

    def test_duplicates_mergeable_fields(self):
        from backend.routers.duplicates._helpers import MERGEABLE_FIELDS

        assert MERGEABLE_FIELDS == {
            k: spec.mergeable_fields for k, spec in COLLECTIONS.items()
        }

    def test_duplicates_compare_fields(self):
        from backend.routers.duplicates._helpers import COMPARE_FIELDS

        assert COMPARE_FIELDS == {
            k: spec.compare_fields for k, spec in COLLECTIONS.items()
        }

    def test_duplicates_job(self):
        from backend.services.duplicates.job import RESOURCE_MODELS

        assert RESOURCE_MODELS == models_by_singular()

    def test_duplicates_dismissals(self):
        from backend.services.duplicates.dismissals import _MODELS

        assert _MODELS == models_by_singular()

    def test_library_fs_collections(self):
        from backend.services.library_fs.constants import COLLECTIONS as FS

        assert FS == {spec.section: spec.model for spec in COLLECTIONS.values()}

    def test_library_fs_thumb_sections(self):
        from backend.services.library_fs.constants import _THUMB_SECTIONS

        assert _THUMB_SECTIONS == thumb_sections()

    def test_library_fs_item_types(self):
        from backend.services.library_fs.references import _ITEM_TYPES

        assert _ITEM_TYPES == {
            spec.section: spec.singular for spec in COLLECTIONS.values()
        }

    def test_tag_resource_types(self):
        from backend.models.tags import RESOURCE_TYPES

        # Systems and the shared category are taggable but are not collections.
        assert set(SINGULARS) <= RESOURCE_TYPES

    def test_variant_kinds_cover_every_collection(self):
        from backend.models.variants import VARIANT_KINDS_BY_TYPE

        assert set(VARIANT_KINDS_BY_TYPE) == set(SINGULARS)

    def test_tag_service_folder_sources(self):
        from backend.services.tag_service import _FOLDER_SOURCES

        # Books are tagged through the category tree rather than a flat folder walk.
        expected = {
            (spec.folder_model, spec.model, spec.singular)
            for spec in COLLECTIONS.values()
            if spec.singular in MEDIA_SINGULARS
        }
        assert set(_FOLDER_SOURCES) == expected
