"""Tests for animated-map (.webm/.mp4) frame extraction and thumbnailing.

The decoder is a purpose-built ffmpeg baked into the Docker image, which CI and
dev machines may not have. So everything here mocks at the ``subprocess.run``
boundary: the contract under test is "what does Grimoire do with what ffmpeg
returns", not whether ffmpeg itself decodes VP9. The one end-to-end test is
skipped unless a real binary is present.
"""
from __future__ import annotations

import io
import os
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

from backend.indexer import generate_thumbnail
from backend.indexer.constants import MAP_VIDEO_EXTS
from backend.indexer.media import _needs_thumbnail_backfill
from backend.indexer.video_frames import (
    FFMPEG_BINARY,
    ffmpeg_path,
    video_first_frame,
)


def _png_bytes(size=(64, 48), color=(120, 30, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


class _Proc:
    """Stand-in for the CompletedProcess returned by subprocess.run."""

    def __init__(self, returncode=0, stdout=b"", stderr=b""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


# ---------------------------------------------------------------------------
# locating the binary
# ---------------------------------------------------------------------------

class TestFfmpegPath:
    def test_prefers_bundled_binary(self, tmp_path):
        fake = tmp_path / "ffmpeg"
        fake.write_text("#!/bin/sh\n")
        fake.chmod(0o755)
        with patch("backend.indexer.video_frames.FFMPEG_BINARY", str(fake)):
            assert ffmpeg_path() == str(fake)

    def test_falls_back_to_path(self, tmp_path):
        missing = str(tmp_path / "nope")
        with patch("backend.indexer.video_frames.FFMPEG_BINARY", missing):
            with patch("backend.indexer.video_frames.shutil.which", return_value="/usr/bin/ffmpeg"):
                assert ffmpeg_path() == "/usr/bin/ffmpeg"

    def test_none_when_no_decoder_anywhere(self, tmp_path):
        with patch("backend.indexer.video_frames.FFMPEG_BINARY", str(tmp_path / "nope")):
            with patch("backend.indexer.video_frames.shutil.which", return_value=None):
                assert ffmpeg_path() is None

    def test_non_executable_bundled_binary_is_ignored(self, tmp_path):
        fake = tmp_path / "ffmpeg"
        fake.write_text("not executable")
        fake.chmod(0o644)
        with patch("backend.indexer.video_frames.FFMPEG_BINARY", str(fake)):
            with patch("backend.indexer.video_frames.shutil.which", return_value=None):
                assert ffmpeg_path() is None

    def test_default_binary_path_matches_dockerfile(self):
        # The Dockerfile COPYs the built binary to exactly this path.
        assert FFMPEG_BINARY.endswith("ffmpeg")


# ---------------------------------------------------------------------------
# frame extraction
# ---------------------------------------------------------------------------

class TestVideoFirstFrame:
    def test_returns_frame_bytes(self):
        png = _png_bytes()
        with patch("backend.indexer.video_frames.ffmpeg_path", return_value="/x/ffmpeg"):
            with patch("subprocess.run", return_value=_Proc(0, png)) as run:
                assert video_first_frame("/maps/keep.webm") == png
        cmd = run.call_args[0][0]
        assert cmd[0] == "/x/ffmpeg"
        assert "/maps/keep.webm" in cmd

    def test_seeks_before_input_for_fast_seek(self):
        # -ss must precede -i, or ffmpeg decodes every frame up to the offset.
        with patch("backend.indexer.video_frames.ffmpeg_path", return_value="/x/ffmpeg"):
            with patch("subprocess.run", return_value=_Proc(0, _png_bytes())) as run:
                video_first_frame("/maps/keep.webm")
        cmd = run.call_args[0][0]
        assert cmd.index("-ss") < cmd.index("-i")

    def test_requests_exactly_one_frame(self):
        with patch("backend.indexer.video_frames.ffmpeg_path", return_value="/x/ffmpeg"):
            with patch("subprocess.run", return_value=_Proc(0, _png_bytes())) as run:
                video_first_frame("/maps/keep.webm")
        cmd = run.call_args[0][0]
        assert cmd[cmd.index("-frames:v") + 1] == "1"

    def test_passes_a_timeout(self):
        # generate_thumbnail's guard is a daemon thread, which cannot kill a
        # wedged child — the subprocess needs its own budget.
        with patch("backend.indexer.video_frames.ffmpeg_path", return_value="/x/ffmpeg"):
            with patch("subprocess.run", return_value=_Proc(0, _png_bytes())) as run:
                video_first_frame("/maps/keep.webm")
        assert run.call_args.kwargs["timeout"] > 0

    def test_none_without_decoder(self):
        with patch("backend.indexer.video_frames.ffmpeg_path", return_value=None):
            assert video_first_frame("/maps/keep.webm") is None

    def test_none_on_nonzero_exit(self):
        with patch("backend.indexer.video_frames.ffmpeg_path", return_value="/x/ffmpeg"):
            with patch("subprocess.run", return_value=_Proc(1, b"", b"boom")):
                assert video_first_frame("/maps/keep.webm") is None

    def test_none_on_empty_output(self):
        # A clip shorter than the seek offset exits 0 with nothing on the pipe.
        with patch("backend.indexer.video_frames.ffmpeg_path", return_value="/x/ffmpeg"):
            with patch("subprocess.run", return_value=_Proc(0, b"")):
                assert video_first_frame("/maps/tiny.webm") is None

    def test_none_on_timeout(self):
        with patch("backend.indexer.video_frames.ffmpeg_path", return_value="/x/ffmpeg"):
            with patch(
                "subprocess.run",
                side_effect=subprocess.TimeoutExpired(cmd="ffmpeg", timeout=20),
            ):
                assert video_first_frame("/maps/hung.webm") is None

    def test_none_when_binary_cannot_run(self):
        with patch("backend.indexer.video_frames.ffmpeg_path", return_value="/x/ffmpeg"):
            with patch("subprocess.run", side_effect=OSError("exec format error")):
                assert video_first_frame("/maps/keep.webm") is None

    def test_oversized_frame_rejected(self):
        with patch("backend.indexer.video_frames.ffmpeg_path", return_value="/x/ffmpeg"):
            with patch("backend.indexer.video_frames._MAX_FRAME_BYTES", 10):
                with patch("subprocess.run", return_value=_Proc(0, b"x" * 100)):
                    assert video_first_frame("/maps/huge.webm") is None


# ---------------------------------------------------------------------------
# thumbnail worker integration
# ---------------------------------------------------------------------------

class TestVideoThumbnail:
    def setup_method(self):
        self.tmp = tempfile.mkdtemp()

    @pytest.mark.parametrize("ext", sorted(MAP_VIDEO_EXTS))
    def test_thumbnail_written_for_each_video_ext(self, ext):
        src = os.path.join(self.tmp, f"keep{ext}")
        Path(src).write_bytes(b"fake container bytes")
        out = os.path.join(self.tmp, f"thumb{ext}.webp")
        with patch(
            "backend.indexer.video_frames.video_first_frame",
            return_value=_png_bytes((800, 600)),
        ):
            assert generate_thumbnail(src, out) is True
        assert Path(out).exists()
        w, h = Image.open(out).size
        assert w <= 300 and h <= 400

    def test_thumbnail_false_when_no_frame(self):
        src = os.path.join(self.tmp, "keep.webm")
        Path(src).write_bytes(b"fake")
        out = os.path.join(self.tmp, "thumb.webp")
        with patch("backend.indexer.video_frames.video_first_frame", return_value=None):
            assert generate_thumbnail(src, out) is False
        assert not Path(out).exists()

    def test_grayscale_frame_converted_to_rgb(self):
        # WebP save would fail on an unconverted mode.
        buf = io.BytesIO()
        Image.new("L", (120, 90), 128).save(buf, "PNG")
        src = os.path.join(self.tmp, "gray.mp4")
        Path(src).write_bytes(b"fake")
        out = os.path.join(self.tmp, "gray.webp")
        with patch(
            "backend.indexer.video_frames.video_first_frame", return_value=buf.getvalue()
        ):
            assert generate_thumbnail(src, out) is True
        assert Image.open(out).mode in ("RGB", "RGBX")

    def test_corrupt_frame_bytes_return_false(self):
        src = os.path.join(self.tmp, "keep.webm")
        Path(src).write_bytes(b"fake")
        out = os.path.join(self.tmp, "bad.webp")
        with patch(
            "backend.indexer.video_frames.video_first_frame", return_value=b"not a png"
        ):
            assert generate_thumbnail(src, out) is False


# ---------------------------------------------------------------------------
# rescan backfill — existing rows registered before the decoder shipped
# ---------------------------------------------------------------------------

class _Row:
    def __init__(self, has_thumbnail=False):
        self.has_thumbnail = has_thumbnail


class TestBackfill:
    @pytest.mark.parametrize("ext", sorted(MAP_VIDEO_EXTS))
    def test_existing_video_without_thumbnail_is_backfilled(self, ext):
        # The whole point: maps scanned by an older build sit at has_thumbnail=0
        # and never re-enter the insert path, so a rescan must pick them up.
        assert _needs_thumbnail_backfill(_Row(False), ext, "") is True

    @pytest.mark.parametrize("ext", sorted(MAP_VIDEO_EXTS))
    def test_video_with_thumbnail_is_not_redone(self, ext):
        assert _needs_thumbnail_backfill(_Row(True), ext, "") is False

    def test_vtt_backfill_still_works(self):
        assert _needs_thumbnail_backfill(_Row(False), ".uvtt", "") is True

    def test_archives_are_never_backfilled(self):
        assert _needs_thumbnail_backfill(_Row(False), ".zip", ".zip") is False


# ---------------------------------------------------------------------------
# end-to-end, only where a real decoder exists
# ---------------------------------------------------------------------------

@pytest.mark.skipif(ffmpeg_path() is None, reason="no ffmpeg available")
class TestRealDecode:
    def test_real_clip_produces_a_thumbnail(self, tmp_path):
        """Decode a genuinely encoded clip, if the host can make one."""
        exe = ffmpeg_path()
        clip = tmp_path / "map.mp4"
        made = subprocess.run(
            [
                exe, "-nostdin", "-loglevel", "error",
                "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10",
                "-t", "2", "-pix_fmt", "yuv420p", "-y", str(clip),
            ],
            capture_output=True,
            timeout=60,
        )
        if made.returncode != 0 or not clip.exists():
            pytest.skip("host ffmpeg cannot encode a test clip")

        out = tmp_path / "thumb.webp"
        assert generate_thumbnail(str(clip), str(out)) is True
        w, h = Image.open(out).size
        assert w <= 300 and h <= 400
