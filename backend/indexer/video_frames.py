"""Single-frame extraction from animated battlemaps (.webm/.mp4).

Publishers like CzePeku ship looping video cuts alongside the still maps. Those
files used to sit in the gallery as blank tiles: rendering a frame needs a video
decoder, and the obvious ways to get one are expensive — ``imageio-ffmpeg``
bundles a 76 MB static binary (almost all of it *encoders* we never use), a
Debian ``ffmpeg`` pulls 430 MB across 202 packages, and PyAV lands at 115 MB.

So the image builds its own decode-only ffmpeg instead (see the ``ffmpeg-builder``
stage in the Dockerfile): ``--disable-everything`` plus the handful of decoders
and two demuxers a battlemap can plausibly use, which strips to ~4.7 MB and links
nothing beyond libc/libm/libz. This module is the Python side of that bargain —
it shells out to that binary for exactly one frame and hands the bytes to Pillow,
which already does every other thumbnail in the app.

Failure is always ``None``, never an exception: a map whose frame cannot be read
simply keeps the blank tile it had before, exactly like an archive with no
readable cover.
"""
import logging
import os
import shutil
import subprocess
from typing import Optional

logger = logging.getLogger("grimoire.indexer")

# Where the Dockerfile installs the purpose-built decode-only binary. Overridable
# so a dev machine can point at a system ffmpeg (the flags used here are ordinary
# ones that any build supports).
FFMPEG_BINARY = os.environ.get("FFMPEG_BINARY", "/usr/local/bin/ffmpeg")

# Seek offset for the grabbed frame. Frame 0 of a looping battlemap is often a
# fade-in or a black leader, which would thumbnail as an empty tile; half a
# second in, the map is drawn. Applied as an *input* seek (before -i) so ffmpeg
# jumps via the container index instead of decoding up to the timestamp.
FRAME_SEEK_SECONDS = 0.5

# Wall-clock budget for the child process. generate_thumbnail's own timeout runs
# in a daemon *thread*, which cannot kill a wedged subprocess — without a timeout
# here a hung ffmpeg would outlive the scan that started it.
_FFMPEG_TIMEOUT = 20

# Ceiling on the PNG we read back from the pipe. A 1080p frame is a few hundred
# KB; this is only a guard against a malformed file that somehow provokes an
# unbounded write.
_MAX_FRAME_BYTES = 64 * 1024 * 1024


def ffmpeg_path() -> Optional[str]:
    """Absolute path to a usable ffmpeg, or None when the build has no decoder.

    Falls back to ``PATH`` so a developer running outside Docker gets frames from
    whatever ffmpeg they already have. Returning None is a supported state — the
    slim image could be built without the decoder and videos would simply go back
    to having no thumbnail.
    """
    if os.path.isfile(FFMPEG_BINARY) and os.access(FFMPEG_BINARY, os.X_OK):
        return FFMPEG_BINARY
    return shutil.which("ffmpeg")


def video_first_frame(filepath: str) -> Optional[bytes]:
    """Return one frame of *filepath* as PNG bytes, or None if it cannot be read.

    The PNG is an intermediate that never touches disk: it goes straight into
    Pillow, which resizes and re-encodes it as the WebP thumbnail like every
    other format. Never raises.
    """
    exe = ffmpeg_path()
    if exe is None:
        logger.debug(f"No ffmpeg available; skipping video thumbnail for {filepath}")
        return None

    cmd = [
        exe,
        "-nostdin",  # never block waiting on a terminal that isn't there
        "-loglevel", "error",
        "-ss", str(FRAME_SEEK_SECONDS),
        "-i", filepath,
        "-frames:v", "1",
        "-f", "image2pipe",
        "-vcodec", "png",
        "-",
    ]
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=_FFMPEG_TIMEOUT,
            check=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning(f"ffmpeg timed out after {_FFMPEG_TIMEOUT}s reading {filepath}")
        return None
    except OSError as e:
        logger.warning(f"Could not run ffmpeg for {filepath}: {e}")
        return None

    if proc.returncode != 0 or not proc.stdout:
        # A clip shorter than the seek offset decodes zero frames and exits 0
        # with an empty pipe, so "no output" is a normal miss, not an error.
        detail = proc.stderr.decode("utf-8", "replace").strip()
        logger.warning(f"No frame extracted from {filepath}: {detail or 'empty output'}")
        return None

    if len(proc.stdout) > _MAX_FRAME_BYTES:
        logger.warning(f"Frame from {filepath} exceeds {_MAX_FRAME_BYTES} bytes; ignoring")
        return None

    return proc.stdout
