# Stage 1: Build frontend
# Pinned to BUILDPLATFORM: the Vite bundle is architecture-independent, so on a
# multi-arch build this stage runs once natively instead of once per target
# platform (the arm64 pass would otherwise run the whole build under QEMU).
#
# Every base image is pinned by digest as well as tag, so a re-pushed tag can't
# change what a build pulls. Dependabot's docker ecosystem keeps the digests
# current (.github/dependabot.yml).
FROM --platform=$BUILDPLATFORM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Python dependencies (compilers live here, not in the runtime image)
FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159 AS backend-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
# PyMuPDF 2 folded its layout analysis into the main package: 50 MB of ONNX
# models, with onnxruntime, numpy, networkx and more as hard dependencies
# (~135 MB of image in all). Grimoire renders pages and extracts text, which
# needs none of it, and since 2.1 `import pymupdf` loads none of it either: the
# layout code is imported on first use and skipped when absent. So PyMuPDF is
# installed on its own with --no-deps, and the layout package, the pymupdf4llm
# wrapper around it and the MuPDF headers are deleted. The smoke test checks
# that none of those packages reached the image.
#
# psycopg's binary wheel ships the 7 MB of generated C its extension was
# compiled from; nothing reads it.
#
# Strip debug symbols from the compiled extensions (pymupdf, uvloop, cryptography
# and friends ship them unstripped). --strip-unneeded leaves the dynamic symbols
# needed for linking, so this is a pure size win: ~40 MB off the runtime image.
# `strip` comes from binutils, already present as a dependency of gcc/g++ above.
# Only the strip is allowed to fail (the parentheses matter: a bare `|| true`
# would also swallow a failed pip install).
RUN grep -v '^pymupdf==' requirements.txt > requirements-rest.txt \
    && pip install --no-cache-dir --prefix=/install -r requirements-rest.txt \
    && pip install --no-cache-dir --prefix=/install --no-deps "$(grep '^pymupdf==' requirements.txt)" \
    && cd /install/lib/python3.12/site-packages \
    && rm -rf pymupdf/layout pymupdf4llm pymupdf/mupdf-devel \
    && find psycopg_binary -name '*.c' -delete \
    && (find /install -name '*.so*' -type f -exec strip --strip-unneeded {} + || true) \
    && find /install -name '__pycache__' -type d -prune -exec rm -rf {} +

# Stage 3: Build a decode-only ffmpeg for animated-map thumbnails
#
# Animated battlemaps (.webm/.mp4) need exactly one decoded frame, which Pillow
# then resizes like any other thumbnail. Every off-the-shelf way to get a decoder
# is wildly out of proportion to that: imageio-ffmpeg bundles a 76 MB static
# binary, `apt-get install ffmpeg` pulls 430 MB across 202 packages, and PyAV
# lands at 115 MB. Almost all of it is *encoders* (x265 alone is 18 MB) plus a
# codec/X11 dependency chain this image spends real effort elsewhere avoiding.
#
# Configuring ffmpeg down to the decoders a battlemap can plausibly use gives a
# ~5 MB binary that links only libc/libm/libz — all already in the runtime —
# so it adds no packages and no shared libraries at all.
#
# --enable-zlib is not optional despite nothing here compressing video: the PNG
# *encoder* needs it, and without it the build silently produces a binary that
# demuxes and decodes correctly, then dies with "Unknown encoder 'png'".
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc AS ffmpeg-builder

# Bumping the version means bumping the checksum with it. Take it from a tarball
# whose signature checks out against the FFmpeg release key
# (https://ffmpeg.org/ffmpeg-devel.asc, fingerprint
# FCF9 86EA 15E6 E293 A564 4F10 B432 2F04 D676 58D8):
#   gpg --verify ffmpeg-X.tar.xz.asc ffmpeg-X.tar.xz && sha256sum ffmpeg-X.tar.xz
# Stay on a release branch FFmpeg still backports fixes to: the newest point
# release on https://ffmpeg.org/download.html. An older branch stops getting
# them without notice (7.0 did, while the mov demuxer and swscale kept getting
# fixed on 7.1 and 8.x).
ARG FFMPEG_VERSION=8.1.3
ARG FFMPEG_SHA256=7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    yasm \
    nasm \
    pkg-config \
    curl \
    ca-certificates \
    xz-utils \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /ffmpeg
RUN curl -fsSL -o /tmp/ffmpeg.tar.xz "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
    && echo "${FFMPEG_SHA256}  /tmp/ffmpeg.tar.xz" | sha256sum -c - \
    && tar xJf /tmp/ffmpeg.tar.xz --strip-components=1 \
    && rm /tmp/ffmpeg.tar.xz

# vp8/vp9 cover .webm, h264/hevc cover .mp4, av1 is the emerging third; mjpeg and
# rawvideo are cheap insurance for oddly-muxed exports. matroska and mov are the
# only two containers those ship in.
RUN ./configure \
        --disable-everything \
        --disable-autodetect \
        --disable-doc \
        --disable-network \
        --disable-debug \
        --disable-programs \
        --enable-ffmpeg \
        --enable-zlib \
        --enable-swscale \
        --enable-decoder=vp8,vp9,h264,hevc,av1,mjpeg,rawvideo \
        --enable-demuxer=matroska,mov \
        --enable-parser=vp8,vp9,h264,hevc,av1,mjpeg \
        --enable-muxer=image2,image2pipe \
        --enable-encoder=png,mjpeg \
        --enable-protocol=file,pipe \
        --enable-filter=scale,null \
    && make -j"$(nproc)" \
    && strip ffmpeg

# Stage 4: unar and tesseract, cut down to what they load
#
# `unar` provides RAR extraction for rarfile (compressed .cbr comics: covers and
# pages); without it those archives are listed but cannot be read. It is the
# only tool in Debian main that can actually decompress RAR: p7zip-full parses
# RAR headers but fails to extract ("Unsupported Method" - the codec is in the
# non-free p7zip-rar), and bsdtar handles RAR5 but exits 1 on solid RAR3, a
# common CBR layout. Tesseract is the OCR image's engine.
#
# Both are tiny next to what their packages depend on. unar's GNUstep runtime
# hard-Depends on graphviz, which drags in the AV1/HEIF codecs, X11 and pango,
# plus perl and binutils; tesseract-ocr ships its training tools, and with them
# cairo, pango and a set of fonts. An `apt-get install` of the three unpacks
# some 260 MB; `ldd` says the two programs load under 90 MB of libraries, part
# of that already in the base image. So they are installed here, on the same
# base as the runtime so every library matches, and bundle_tool.sh copies out
# each program, its data and the libraries it loads that the base does not
# already have. The runtime stages copy those bundles in.
#
# One of those libraries is ICU's data, 30 MB of mostly locale data that unar
# never asks for; trim_icu_data.sh rebuilds it without (see the script).
#
# The cost: the bundled files belong to no package in the runtime image's dpkg
# database, so an image scanner does not match them against Debian advisories.
# Rebuilding picks up whatever Debian has fixed, as before.
FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159 AS tools-builder

# /base-files is written first: it is how bundle_tool.sh knows what the runtime
# image already has. icu-devtools and binutils are for trim_icu_data.sh.
RUN find /usr /etc ! -type d | sort > /base-files \
    && apt-get update && apt-get install -y --no-install-recommends \
        unar \
        tesseract-ocr \
        tesseract-ocr-eng \
        icu-devtools \
        binutils \
    && rm -rf /var/lib/apt/lists/*

COPY backend/scripts/bundle_tool.sh backend/scripts/trim_icu_data.sh /usr/local/bin/

# unar reads GNUstep.conf and the gnustep-base resources at start-up. GNUstep
# also shells out to dpkg-architecture for one constant string; dpkg-dev (and
# the perl it runs on) stays behind, so a shell stub answers instead.
#
# The tesseract bundle holds only what unar's does not, so the OCR image can
# lay it over the unar one. osd.traineddata (10.5 MB - larger than the English
# data itself) is only read for orientation/script detection, i.e.
# image_to_osd() or --psm 0. Grimoire only ever calls image_to_string() with an
# explicit lang, so it is never loaded. Mounting your own tessdata for
# OCR_LANGUAGES is unaffected.
RUN trim_icu_data.sh \
    && bundle_tool.sh /bundle/unar /usr/bin/unar /etc/GNUstep /usr/share/GNUstep/Libraries \
    && printf '#!/bin/sh\necho "%s"\n' "$(dpkg-architecture -qDEB_HOST_MULTIARCH)" \
        > /bundle/unar/usr/bin/dpkg-architecture \
    && chmod +x /bundle/unar/usr/bin/dpkg-architecture \
    && rm -f /usr/share/tesseract-ocr/*/tessdata/osd.traineddata \
    && SKIP_BUNDLES=/bundle/unar bundle_tool.sh /bundle/tesseract /usr/bin/tesseract /usr/share/tesseract-ocr

# Stage 5: Runtime base shared by both variants (no build toolchain)
FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159 AS runtime-base

WORKDIR /app

# Bring in the pre-built Python packages from the builder stage.
COPY --from=backend-builder /install /usr/local

# The decode-only ffmpeg used for animated-map thumbnails. Path matches
# FFMPEG_BINARY in backend/indexer/video_frames.py; that module degrades to "no
# thumbnail" if it is ever absent, so this stays a single self-contained file.
COPY --from=ffmpeg-builder /ffmpeg/ffmpeg /usr/local/bin/ffmpeg

# unar, from the tools stage. Its libraries are new to this image, so the
# loader's cache is rebuilt below.
COPY --from=tools-builder /bundle/unar/ /

# tini runs as PID 1 and reaps orphaned processes, such as a tesseract left
# behind when an OCR worker is killed. The entrypoint starts it once it has
# switched users (see with_init in backend/container_entrypoint.py).
# Only the dynamic binary is kept; tini-static is a 650 KB copy of it.
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -f /usr/bin/tini-static \
    && rm -rf /var/lib/apt/lists/* \
    && ldconfig

COPY backend/ ./backend/
COPY alembic.ini ./alembic.ini
# Read and parsed at runtime by /api/changelog for the About dialog.
COPY CHANGELOG.md ./CHANGELOG.md
# Fallback version source when the image is built without --build-arg
# APP_VERSION (the released images always pass it).
COPY VERSION ./VERSION
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# The unprivileged user Grimoire runs as (issue #579). 1000:1000 is only the
# default: the entrypoint switches to PUID/PGID, or to whoever owns the mounted
# library, and skips all of this under --user. /data and /library are owned by
# it so a fresh named volume starts out writable; /app stays root-owned, so the
# running app can't rewrite its own code.
RUN groupadd --gid 1000 grimoire \
    && useradd --uid 1000 --gid 1000 --home-dir /home/grimoire --create-home \
        --shell /usr/sbin/nologin grimoire \
    && mkdir -p /data /library \
    && chown grimoire:grimoire /data /library

# Ship bytecode for exactly the modules the server imports. The base image and
# the builder stage both strip __pycache__, so without this every freshly
# created container compiles ~1,350 modules on first start: ~4 s slower, and
# the compiler's scratch allocations fragment the heap for the life of the
# process (~18 MB more RSS per worker, measured). Importing the app once here
# writes .pyc files for what it actually loads (~30 MB uncompressed) instead of
# compiling all of site-packages (~52 MB). Importing the app does no I/O, so
# startup() runs too, against a throwaway DATA_PATH: that is what loads Alembic
# and the migrations, which every container runs on its first start.
RUN DATA_PATH=/tmp/warm LIBRARY_PATH=/tmp/warm DISABLE_VERSION_CHECKING=true \
        python -c "import backend.main; from backend.config import startup; startup()" \
    && rm -rf /tmp/warm

# Empty by default so an image built without --build-arg falls through to the
# VERSION file copied above rather than reporting a literal "dev".
ARG APP_VERSION=""
ARG COMMIT_HASH="dev"
ENV APP_VERSION=${APP_VERSION}
ENV COMMIT_HASH=${COMMIT_HASH}
ENV PYTHONUNBUFFERED=1
# glibc otherwise gives each thread its own malloc arena (up to 8 per core), and
# page renders run on a threadpool, so freed memory ends up scattered across
# arenas it can't be returned from. Two arenas measured 34-51 MB lower peak
# memory during concurrent reading with no change in render throughput.
ENV MALLOC_ARENA_MAX=2

EXPOSE 9481

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:9481/api/health', timeout=4).status == 200 else 1)" || exit 1

# One worker by default. Each uvicorn worker is a full copy of the app (125-190
# MB idle). One worker matches two for a single reader; with four people reading
# uncached pages at once, two measured ~10% faster on 2 cores and ~40% on 4. See
# docs/performance.md#workers for when raising it is worth the memory.
ENV WORKERS=1
# Starts as root only long enough to hand /data to the unprivileged user, then
# drops to it before exec'ing the command under tini. See backend/container_entrypoint.py
# and docs/docker-install.md#which-user-grimoire-runs-as. -I keeps backend/ off
# sys.path, so nothing there can shadow a stdlib module.
ENTRYPOINT ["python", "-I", "/app/backend/container_entrypoint.py"]
CMD ["sh", "-c", "exec python -m uvicorn backend.main:app --host 0.0.0.0 --port 9481 --workers ${WORKERS}"]

# Stage 6a: Slim variant — no OCR engine. Grimoire degrades gracefully: image-only
# PDFs stay excluded from full-text search, exactly as before OCR was added. Built
# with `--target slim` and published under the `-slim` tag family.
FROM runtime-base AS slim

# Stage 6b: Default variant — bundles Tesseract + English language data so image-only
# PDFs are OCR'd into the full-text index out of the box. Extra languages can be added
# at runtime by mounting tessdata and setting OCR_LANGUAGES (see README); no rebuild
# required. This is the last stage, so a plain `docker build` (no --target) yields it.
FROM runtime-base AS ocr

COPY --from=tools-builder /bundle/tesseract/ /
RUN ldconfig
