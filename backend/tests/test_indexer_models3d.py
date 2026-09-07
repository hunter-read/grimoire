"""Tests for scanning the 3D models tree.

Covers registration of every model format, the STL-only thumbnail rule, the
triangle count read from the binary header, and the presupported/unsupported
detection — including the ordering trap that "unsupported" contains "supported".
"""
from __future__ import annotations

import os
import struct
import tempfile
from pathlib import Path

from backend.config import LIBRARY_PATH, SessionLocal
from backend.indexer import scan_library
from backend.indexer.media import _detect_support
from backend.indexer.models3d import MODEL_EXTS, THUMBNAILABLE_EXTS
from backend.models import Model3D
from backend.services.library_fs.uploads import allowed_upload_exts


def _cube():
    h = 0.5
    v = [
        (-h, -h, -h), (h, -h, -h), (h, h, -h), (-h, h, -h),
        (-h, -h, h), (h, -h, h), (h, h, h), (-h, h, h),
    ]
    faces = [
        (0, 3, 2), (0, 2, 1), (4, 5, 6), (4, 6, 7),
        (0, 1, 5), (0, 5, 4), (2, 3, 7), (2, 7, 6),
        (1, 2, 6), (1, 6, 5), (0, 4, 7), (0, 7, 3),
    ]
    return [tuple(v[i] for i in f) for f in faces]


def _write_stl(path: Path, tris=None):
    tris = tris or _cube()
    with open(path, "wb") as f:
        f.write(b"\0" * 80)
        f.write(struct.pack("<I", len(tris)))
        for tri in tris:
            f.write(struct.pack("<3f", 0, 0, 0))
            for vertex in tri:
                f.write(struct.pack("<3f", *vertex))
            f.write(b"\0\0")


class TestSupportDetection:
    """The heuristic behind the presupported/unsupported badge."""

    def test_folder_convention(self):
        """Folder-level is the near-universal convention on model sites."""
        assert _detect_support("models/Goblins/Presupported/a.stl") is True
        assert _detect_support("models/Goblins/Unsupported/a.stl") is False

    def test_filename_convention(self):
        assert _detect_support("models/goblin_presupported.stl") is True
        assert _detect_support("models/goblin_unsupported.stl") is False

    def test_unsupported_wins_over_the_substring(self):
        """"unsupported" contains "supported" — order is the whole trick here.

        A supported-first check labels every unsupported file as presupported,
        which is exactly backwards and would mislead a user into printing a mesh
        with no supports.
        """
        for path in (
            "models/dragon_unsupported.stl",
            "models/dragon (unsupported).stl",
            "models/UNSUPPORTED/dragon.stl",
            "models/dragon-un-supported.stl",
        ):
            assert _detect_support(path) is False, path

    def test_separator_spellings(self):
        for path in ("a_pre-supported.stl", "a pre supported.stl", "a.presupported.stl"):
            assert _detect_support(f"models/{path}") is True, path

    def test_abbreviations(self):
        assert _detect_support("models/orc_sup.stl") is True
        assert _detect_support("models/orc_unsup.stl") is False

    def test_no_supports_phrasing(self):
        assert _detect_support("models/no supports/orc.stl") is False
        assert _detect_support("models/orc_no-support.stl") is False

    def test_unknown_stays_none(self):
        """Tri-state: a library not using the convention asserts nothing."""
        assert _detect_support("models/Goblins/goblin.stl") is None
        assert _detect_support("models/dragon.stl") is None

    def test_case_insensitive(self):
        assert _detect_support("models/PRESUPPORTED/a.stl") is True
        assert _detect_support("models/Unsupported/a.stl") is False

    def test_windows_separators(self):
        assert _detect_support("models\\\\Goblins\\\\Presupported\\\\a.stl") is True


class TestUploadAcceptance:
    def test_models_tree_accepts_mesh_formats(self):
        allowed = allowed_upload_exts(Path(LIBRARY_PATH) / "models" / "Minis")
        assert ".stl" in allowed
        assert ".3mf" in allowed

    def test_models_tree_rejects_images(self):
        """A PNG in the models tree is a misfiled token."""
        allowed = allowed_upload_exts(Path(LIBRARY_PATH) / "models" / "Minis")
        assert ".png" not in allowed

    def test_tokens_tree_rejects_meshes(self):
        allowed = allowed_upload_exts(Path(LIBRARY_PATH) / "tokens" / "Pack")
        assert ".stl" not in allowed


class TestModelScan:
    def setup_method(self):
        self.tmp = tempfile.mkdtemp()
        self.lib = Path(self.tmp) / "library"
        # Unique folder per instance keeps the shared session DB isolated.
        self.dir = self.lib / "models" / f"Minis_{os.path.basename(self.tmp)}"
        self.dir.mkdir(parents=True)

    def _scan(self):
        db = SessionLocal()
        try:
            return scan_library(str(self.lib), self.tmp, db)
        finally:
            db.close()

    def _get(self, filename: str):
        db = SessionLocal()
        try:
            return db.query(Model3D).filter(Model3D.filename == filename).first()
        finally:
            db.close()

    def test_stl_is_registered_with_a_thumbnail(self):
        name = f"mini_{os.path.basename(self.tmp)}.stl"
        _write_stl(self.dir / name)
        self._scan()
        row = self._get(name)
        assert row is not None
        assert row.has_thumbnail is True

    def test_triangle_count_is_recorded(self):
        name = f"counted_{os.path.basename(self.tmp)}.stl"
        _write_stl(self.dir / name)
        self._scan()
        assert self._get(name).triangle_count == 12

    def test_scan_counts_new_models(self):
        _write_stl(self.dir / f"a_{os.path.basename(self.tmp)}.stl")
        stats = self._scan()
        assert stats.get("new_models", 0) >= 1

    def test_sliced_file_registered_without_thumbnail(self):
        """A .ctb is a per-printer image stack, not geometry — visible, not viewable."""
        name = f"sliced_{os.path.basename(self.tmp)}.ctb"
        (self.dir / name).write_bytes(b"not a mesh")
        self._scan()
        row = self._get(name)
        assert row is not None
        assert not row.has_thumbnail

    def test_container_registered_without_thumbnail(self):
        name = f"packed_{os.path.basename(self.tmp)}.3mf"
        (self.dir / name).write_bytes(b"PK\x03\x04stub")
        self._scan()
        row = self._get(name)
        assert row is not None
        assert not row.has_thumbnail

    def test_unreadable_stl_still_registers(self):
        """Registration must not depend on the thumbnail succeeding."""
        name = f"broken_{os.path.basename(self.tmp)}.stl"
        (self.dir / name).write_bytes(b"not really an stl")
        self._scan()
        row = self._get(name)
        assert row is not None
        assert not row.has_thumbnail

    def test_support_flag_from_folder(self):
        stamp = os.path.basename(self.tmp)
        (self.dir / "Presupported").mkdir()
        (self.dir / "Unsupported").mkdir()
        _write_stl(self.dir / "Presupported" / f"pre_{stamp}.stl")
        _write_stl(self.dir / "Unsupported" / f"un_{stamp}.stl")
        self._scan()
        assert self._get(f"pre_{stamp}.stl").is_supported is True
        assert self._get(f"un_{stamp}.stl").is_supported is False

    def test_support_flag_unknown_is_null(self):
        name = f"plain_{os.path.basename(self.tmp)}.stl"
        _write_stl(self.dir / name)
        self._scan()
        assert self._get(name).is_supported is None

    def test_content_hash_recorded(self):
        """Shared with every other collection — what makes move detection work."""
        name = f"hashed_{os.path.basename(self.tmp)}.stl"
        _write_stl(self.dir / name)
        self._scan()
        assert self._get(name).content_hash

    def test_non_model_file_ignored(self):
        name = f"notes_{os.path.basename(self.tmp)}.txt"
        (self.dir / name).write_text("read me")
        self._scan()
        assert self._get(name) is None

    def test_rescan_does_not_duplicate(self):
        name = f"twice_{os.path.basename(self.tmp)}.stl"
        _write_stl(self.dir / name)
        self._scan()
        self._scan()
        db = SessionLocal()
        try:
            assert db.query(Model3D).filter(Model3D.filename == name).count() == 1
        finally:
            db.close()


class TestFormatConstants:
    def test_only_stl_thumbnails(self):
        assert THUMBNAILABLE_EXTS == {".stl"}

    def test_thumbnailable_is_a_subset_of_registered(self):
        assert THUMBNAILABLE_EXTS <= MODEL_EXTS

    def test_model_exts_do_not_collide_with_images(self):
        """A mesh must never be mistaken for a token image, or vice versa."""
        from backend.indexer.constants import IMAGE_EXTS

        assert not (MODEL_EXTS & IMAGE_EXTS)
