"""Tests for the 3D format capability table (backend/indexer/models3d.py)."""
import pytest

from backend.indexer.models3d import (
    MESH_EXTS,
    MODEL_EXTS,
    SLICED_EXTS,
    THUMBNAILABLE_EXTS,
    VIEWABLE_EXTS,
    _FORMATS,
    can_thumbnail,
    is_viewable,
    model_mime,
    spec_for_ext,
    spec_for_path,
    viewer_loader,
)


class TestTable:
    def test_derived_sets_agree_with_the_table(self):
        assert MODEL_EXTS == set(_FORMATS)
        assert VIEWABLE_EXTS == {e for e, s in _FORMATS.items() if s.viewable}
        assert THUMBNAILABLE_EXTS == {e for e, s in _FORMATS.items() if s.thumbnailable}

    def test_every_extension_is_lowercase_and_dotted(self):
        for ext in _FORMATS:
            assert ext.startswith(".") and ext == ext.lower()

    def test_families_are_known(self):
        for spec in _FORMATS.values():
            assert spec.family in {"mesh", "container", "sliced"}

    def test_viewable_formats_name_a_loader(self):
        """The loader key is the frontend contract; viewable without one is unusable."""
        for ext, spec in _FORMATS.items():
            assert bool(spec.loader) == spec.viewable, ext

    def test_thumbnailable_implies_viewable(self):
        """Nothing should render a card image it cannot also open in the viewer."""
        assert THUMBNAILABLE_EXTS <= VIEWABLE_EXTS

    def test_sliced_formats_are_never_viewable(self):
        """Sliced output is a per-printer image stack, not geometry."""
        for ext in SLICED_EXTS:
            assert not _FORMATS[ext].viewable

    def test_stl_is_the_thumbnailable_format(self):
        """STL is a bare triangle list, which is why it is the one we rasterise."""
        assert THUMBNAILABLE_EXTS == {".stl"}
        assert ".stl" in MESH_EXTS

    def test_multi_file_formats_are_not_viewable(self):
        """.obj and .gltf reference siblings by name, so one file is not enough."""
        assert not _FORMATS[".obj"].viewable
        assert not _FORMATS[".gltf"].viewable
        # .glb is the self-contained spelling of the same format.
        assert _FORMATS[".glb"].viewable


class TestLookups:
    @pytest.mark.parametrize("ext", sorted(MODEL_EXTS))
    def test_spec_for_ext_round_trip(self, ext):
        assert spec_for_ext(ext) is _FORMATS[ext]

    def test_lookup_is_case_insensitive(self):
        assert spec_for_ext(".STL") is _FORMATS[".stl"]
        assert spec_for_path("/lib/models/DRAGON.STL") is _FORMATS[".stl"]

    def test_spec_for_path(self):
        assert spec_for_path("/lib/models/mini.stl") is _FORMATS[".stl"]

    def test_unknown_extensions(self):
        assert spec_for_ext(".pdf") is None
        assert spec_for_path("/lib/books/x.pdf") is None
        assert not is_viewable("/lib/books/x.pdf")
        assert not can_thumbnail("/lib/books/x.pdf")
        assert viewer_loader("/lib/books/x.pdf") == ""

    def test_predicates(self):
        assert is_viewable("/m/a.stl")
        assert can_thumbnail("/m/a.stl")
        assert not can_thumbnail("/m/a.3mf")
        assert is_viewable("/m/a.3mf")
        assert not is_viewable("/m/a.ctb")

    def test_viewer_loader_values(self):
        assert viewer_loader("/m/a.stl") == "stl"
        assert viewer_loader("/m/a.glb") == "gltf"
        assert viewer_loader("/m/a.ctb") == ""


class TestMime:
    def test_known_formats(self):
        assert model_mime("/m/a.stl") == "model/stl"
        assert model_mime("/m/a.glb") == "model/gltf-binary"

    def test_unknown_falls_back_to_octet_stream(self):
        """A wrong model/* type invites the browser to render what it cannot."""
        assert model_mime("/m/a.xyz") == "application/octet-stream"

    def test_sliced_formats_are_opaque_downloads(self):
        for ext in SLICED_EXTS:
            assert model_mime(f"/m/a{ext}") == "application/octet-stream"
