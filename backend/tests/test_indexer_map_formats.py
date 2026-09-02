"""Tests for animated-map and VTT-data indexing in the maps tree.

CzePeku and similar publishers ship looping video variants (.webm/.mp4) and
Universal VTT exports (.uvtt) alongside the still images. These are registered
as maps so they are visible and downloadable, but are opaque to the
thumbnailer - there is no still frame to render without a video decoder. Universal
VTT files do get one: the battlemap is embedded in the JSON as base64.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from PIL import Image

from backend.config import SessionLocal
from backend.indexer import scan_library
from backend.indexer.constants import (
    MAP_IMAGE_EXTS,
    MAP_OPAQUE_EXTS,
    MAP_VIDEO_EXTS,
    VTT_DATA_EXTS,
)
from backend.models import GenericMap
from backend.config import LIBRARY_PATH
from backend.services.library_fs.uploads import allowed_upload_exts


# ---------------------------------------------------------------------------
# constants
# ---------------------------------------------------------------------------

class TestMapFormatConstants:
    def test_video_exts_in_map_exts(self):
        assert MAP_VIDEO_EXTS <= MAP_IMAGE_EXTS

    def test_vtt_exts_in_map_exts(self):
        assert VTT_DATA_EXTS <= MAP_IMAGE_EXTS

    def test_opaque_is_union_of_video_and_vtt(self):
        assert MAP_OPAQUE_EXTS == MAP_VIDEO_EXTS | VTT_DATA_EXTS

    def test_expected_members(self):
        assert ".webm" in MAP_VIDEO_EXTS
        assert ".mp4" in MAP_VIDEO_EXTS
        assert ".uvtt" in VTT_DATA_EXTS

    def test_opaque_formats_are_not_still_images(self):
        # They must not leak into the tokens tree, which is images-only.
        from backend.indexer.constants import IMAGE_EXTS

        assert not (MAP_OPAQUE_EXTS & IMAGE_EXTS)


# ---------------------------------------------------------------------------
# upload validation
# ---------------------------------------------------------------------------

class TestUploadAcceptance:
    def test_maps_tree_accepts_video(self):
        allowed = allowed_upload_exts(Path(LIBRARY_PATH) / "maps" / "CzePeku")
        assert ".webm" in allowed
        assert ".mp4" in allowed

    def test_maps_tree_accepts_uvtt(self):
        allowed = allowed_upload_exts(Path(LIBRARY_PATH) / "maps" / "CzePeku")
        assert ".uvtt" in allowed

    def test_tokens_tree_still_rejects_video(self):
        # Tokens are images only; a video there is a misfiled map.
        allowed = allowed_upload_exts(Path(LIBRARY_PATH) / "tokens" / "Pack")
        assert ".webm" not in allowed
        assert ".uvtt" not in allowed


# ---------------------------------------------------------------------------
# scan_library integration
# ---------------------------------------------------------------------------

def _mk_lib() -> tuple[str, Path]:
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    (lib / "maps").mkdir(parents=True)
    return tmp, lib


class TestMapFormatScan:
    def setup_method(self):
        self.tmp, self.lib = _mk_lib()
        # Unique folder per instance keeps the shared session DB isolated.
        self.map_dir = self.lib / "maps" / f"CzePeku_{os.path.basename(self.tmp)}"
        self.map_dir.mkdir(parents=True)

    def _scan(self):
        db = SessionLocal()
        try:
            scan_library(str(self.lib), self.tmp, db)
        finally:
            db.close()

    def _get_map(self, filename: str) -> GenericMap | None:
        db = SessionLocal()
        try:
            return db.query(GenericMap).filter(GenericMap.filename == filename).first()
        finally:
            db.close()

    def test_webm_registered_without_thumbnail(self):
        name = f"animated_{os.path.basename(self.tmp)}.webm"
        (self.map_dir / name).write_bytes(b"\x1a\x45\xdf\xa3fake-webm")
        self._scan()

        m = self._get_map(name)
        assert m is not None, "webm should be registered as a map"
        assert m.has_thumbnail is False

    def test_mp4_registered_without_thumbnail(self):
        name = f"animated_{os.path.basename(self.tmp)}.mp4"
        (self.map_dir / name).write_bytes(b"\x00\x00\x00\x18ftypmp42")
        self._scan()

        m = self._get_map(name)
        assert m is not None
        assert m.has_thumbnail is False

    def test_uvtt_without_an_image_registers_without_thumbnail(self):
        name = f"walls_{os.path.basename(self.tmp)}.uvtt"
        (self.map_dir / name).write_text('{"format": 0.3, "image": ""}')
        self._scan()

        m = self._get_map(name)
        assert m is not None
        assert m.has_thumbnail is False

    def test_uvtt_with_an_image_gets_a_thumbnail(self):
        # Unlike a video, the battlemap is right there in the JSON as base64, so
        # a real cover is generated with no extra decoder.
        import base64
        import io as _io
        import json as _json

        buf = _io.BytesIO()
        Image.new("RGB", (200, 150), (10, 90, 40)).save(buf, "PNG")
        name = f"tavern_{os.path.basename(self.tmp)}.uvtt"
        (self.map_dir / name).write_text(
            _json.dumps({"format": 0.3, "image": base64.b64encode(buf.getvalue()).decode()})
        )
        self._scan()

        m = self._get_map(name)
        assert m is not None
        assert m.has_thumbnail is True

    def test_still_image_alongside_still_thumbnails(self):
        # The opaque formats must not regress normal image handling.
        stem = os.path.basename(self.tmp)
        Image.new("RGB", (60, 80)).save(self.map_dir / f"still_{stem}.png", "PNG")
        (self.map_dir / f"still_{stem}.webm").write_bytes(b"\x1a\x45\xdf\xa3fake")
        self._scan()

        png = self._get_map(f"still_{stem}.png")
        webm = self._get_map(f"still_{stem}.webm")
        assert png is not None and png.has_thumbnail is True
        assert webm is not None and webm.has_thumbnail is False
